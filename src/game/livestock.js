/**
 * Livestock: animals you keep, as opposed to wildlife.
 *
 * THE PLAYTEST SAID THREE THINGS: animals serve no purpose, horses keep
 * disappearing, and taming makes no sense. This module answers the first two;
 * the third was fixed by deleting `tameWith` — the catch ORDER in horses.js is
 * now the only way to get a horse.
 *
 * WHY HORSES VANISHED (measured, scratch/horsediag.mjs, 3 seeds x 400 days):
 * every single loss was STARVATION. Kept horses were fed only by the wild
 * ecology — grazing, on grass, on the daily tick — and that loop skipped eating
 * for any animal on a cooldown. A horse's cooldown is its breeding cooldown, so
 * a mare that foaled went twenty days without eating and died; a ridden horse
 * standing on the base or a field never grazed at all. Then the ecology's
 * starvation sweep removed it, with no event naming the horse. 27 of 27
 * recorded losses were that, and 0 were raiders.
 *
 * So kept animals are now OUTSIDE the wild ecology entirely: animals.js skips
 * anything `tamed`, and this file feeds them from the store, breeds them, and
 * says so out loud whenever one leaves. They stay in `world.animals` with the
 * `tamed` flag rather than moving to a separate list: the renderer, the raid
 * code, the horse orders and the save validator all read that one list, and a
 * second list would have to be threaded through every one of them for no
 * change in behaviour. The wild balance is protected by the skip, not by where
 * the objects live.
 *
 * WHAT THEY ARE FOR:
 *   - Horses: riders move faster (workers.js), forage further and bring back
 *     double, and add weight to a war party (rivals.js). Two or more in the
 *     paddocks breed. The market buys and sells them.
 *   - Rabbits: a pen breeds, and a full pen turns its surplus into meat. They
 *     graze their own enclosure for free except in winter.
 *   - Both: MANURE. A farm within MANURE_RADIUS of kept animals yields more and
 *     keeps its fertility (buildings.js). This is what ties livestock into the
 *     farmland depletion added in the same pass.
 */
import { distance, key } from "./hex.js";
import { activeTiles, getTerrain } from "./tiles.js";
import { operational } from "./construction.js";
import { seasonOf } from "./calendar.js";
import { stableCapacity } from "./buildings.js";

/** Food a horse eats on a day it cannot graze (ridden, or winter). */
export const HORSE_FEED = 2;
/** Days a kept horse will go unfed before it gives up on you and runs. */
export const HORSE_PATIENCE = 4;
/** Days between foals, while at least two horses stand in your paddocks. */
export const FOAL_EVERY = 30;

/** How far manure reaches from a paddock or a pen. */
export const MANURE_RADIUS = 2;
/** Extra farm output from manured ground. */
export const MANURE_BOOST = 0.25;

/** Every kept animal, whatever it is. */
export const keptAnimals = (world) => (world.animals || []).filter((a) => a.tamed);

/** Where the paddocks are. */
export function paddockTiles(world) {
  const out = [];
  for (const tile of activeTiles(world)) {
    if (tile.building && tile.building.id === "paddock" && operational(tile.building)) out.push(tile);
  }
  return out;
}

/** The nearest standing paddock to somewhere, or null. */
export function nearestPaddockTo(world, from) {
  let best = null;
  let bestD = Infinity;
  for (const t of paddockTiles(world)) {
    const d = distance(from, t);
    if (d < bestD) { bestD = d; best = { q: t.q, r: t.r }; }
  }
  return best;
}

/**
 * The per-world bookkeeping, created on demand so old saves need nothing.
 * `lost` counts every horse that ever left, by reason — the log the roadmap
 * asked for, and what to read first if horses go missing again.
 */
export function livestockState(world) {
  if (!world.livestock) world.livestock = { lost: {}, foalIn: FOAL_EVERY };
  if (!world.livestock.lost) world.livestock.lost = {};
  if (world.livestock.foalIn == null) world.livestock.foalIn = FOAL_EVERY;
  return world.livestock;
}

/**
 * Record a kept animal leaving. Every exit goes through here, so none is
 * silent — which was the actual complaint the playtest made about horses.
 *
 * Horses keep the flat `lost` map they have always had, because the panel and
 * the save format both read it. Everything else is counted per species under
 * `lostBy`, so "a fox has had three hens" is a question with an answer.
 */
export function recordLoss(world, species, reason) {
  const state = livestockState(world);
  if (species === "horse") {
    state.lost[reason] = (state.lost[reason] || 0) + 1;
    return;
  }
  state.lostBy = state.lostBy || {};
  state.lostBy[species] = state.lostBy[species] || {};
  state.lostBy[species][reason] = (state.lostBy[species][reason] || 0) + 1;
}

/** Record a horse leaving. */
export const recordHorseLoss = (world, reason) => recordLoss(world, "horse", reason);

/**
 * A kept horse goes back to the wild. Clears its rider too, so nobody is left
 * riding a horse that is no longer theirs.
 */
export function freeHorse(world, horse, reason) {
  if (horse.riderId) {
    const rider = (world.workers || []).find((w) => w.id === horse.riderId);
    if (rider && rider.horseId === horse.id) rider.horseId = null;
  }
  horse.tamed = false;
  horse.riderId = null;
  horse.hungry = 0;
  horse.energy = Math.max(horse.energy || 0, 10);
  recordHorseLoss(world, reason);
}

/**
 * Farms that manure reaches, as a Set of tile keys.
 *
 * Built once a day and cached on the world (not saved — it is derived). The
 * hourly production loop only does a Set lookup. Rebuilt lazily if missing, so
 * a freshly loaded save is right from its first hour.
 */
export function manuredFarms(world) {
  if (world._manure && world._manure.day === world.day) return world._manure.farms;
  const sources = [];
  for (const a of world.animals || []) {
    if (!a.tamed) continue;
    if (a.stolen || (a.species === "horse" && a.riderId)) continue; // out working, not in the muck heap
    sources.push(a);
  }
  const farms = new Set();
  if (sources.length) {
    for (const tile of activeTiles(world)) {
      if (!tile.building || tile.building.id !== "farm") continue;
      if (sources.some((s) => distance(s, tile) <= MANURE_RADIUS)) farms.add(key(tile.q, tile.r));
    }
  }
  world._manure = { day: world.day, farms };
  return farms;
}

/**
 * One day for every kept horse. Rabbits in pens are pens.js.
 *
 * Called from advanceHour once a day, after people have eaten — people come
 * first, and a settlement short of food should see its horses go hungry
 * before its workers do.
 */
export function stepLivestock(world, rnd = Math.random) {
  const events = [];
  const state = livestockState(world);
  const winter = seasonOf(world.day).id === "winter";
  const paddocks = paddockTiles(world);

  // A horse a raider is leading away is theirs until it is recovered.
  const horses = (world.animals || []).filter((a) => a.species === "horse" && a.tamed && !a.stolen);
  for (const horse of horses) {
    // A horse standing in a paddock on grass grazes for nothing, outside
    // winter. Everything else — ridden, or the snow is down — eats from the store.
    const inPaddock = !horse.riderId && paddocks.some((p) => p.q === horse.q && p.r === horse.r);
    const grazing = inPaddock && !winter && getTerrain(world, horse.q, horse.r) === "grass";
    // A stabled horse that is not actually in a paddock (put away in a field,
    // or its paddock was rebuilt elsewhere) walks back to the nearest one.
    if (!horse.riderId && !inPaddock && paddocks.length) {
      const pen = nearestPaddockTo(world, horse);
      horse.q = pen.q;
      horse.r = pen.r;
    }
    if (grazing) {
      horse.hungry = 0;
      continue;
    }
    if ((world.store.food || 0) >= HORSE_FEED) {
      world.store.food -= HORSE_FEED;
      horse.hungry = 0;
      continue;
    }
    horse.hungry = (horse.hungry || 0) + 1;
    if (horse.hungry >= HORSE_PATIENCE) {
      freeHorse(world, horse, "hunger");
      events.push({
        type: "horseLost",
        reason: "hunger",
        q: horse.q, r: horse.r,
        text: "A horse went unfed for days and has run off to find its own grass.",
      });
    } else if (horse.hungry === 1) {
      events.push({
        type: "horseHungry",
        q: horse.q, r: horse.r,
        text: `A horse went unfed today — it needs ${HORSE_FEED} food a day when it cannot graze.`,
      });
    }
  }

  // Foals. Two horses in the paddocks and room for a third, and every
  // FOAL_EVERY days there is one more. The countdown pauses rather than resets
  // when the conditions lapse, so a paddock that was briefly full does not
  // lose a month's progress.
  const stabled = horses.filter((h) => h.tamed && !h.riderId);
  const kept = stabled.length;
  if (kept >= 2 && kept < stableCapacity(world) && !winter) {
    state.foalIn -= 1;
    if (state.foalIn <= 0) {
      const at = paddocks[0] || world.home;
      world.animals.push({
        id: world.nextAnimalId++,
        species: "horse",
        q: at.q, r: at.r,
        energy: 14,
        cooldown: 0,
        bornOn: world.day,
        tamed: true,
      });
      state.foalIn = FOAL_EVERY;
      events.push({
        type: "foal",
        q: at.q, r: at.r,
        text: "A foal was born in the paddock.",
      });
    }
  }

  // Refresh the manure map for today's production.
  world._manure = null;
  manuredFarms(world);
  return events;
}

/** One line for the panels: what you keep and what it costs. */
export function livestockSummary(world) {
  const kept = keptAnimals(world);
  const of = (species) => kept.filter((a) => a.species === species);
  const horses = of("horse");
  const rabbits = of("rabbit");
  const goats = of("goat");
  const hens = of("chicken");
  const winter = seasonOf(world.day).id === "winter";
  const ridden = horses.filter((h) => h.riderId).length;
  // Feed, in food a day. Rabbits and goats graze for nothing until the snow
  // comes; hens eat grain rather than food, so they are counted separately.
  const feed = (winter ? horses.length : ridden) * HORSE_FEED
    + (winter ? Math.ceil(rabbits.length / 2) + goats.length : 0);
  const state = livestockState(world);
  return {
    horses: horses.length,
    ridden,
    rabbits: rabbits.length,
    goats: goats.length,
    hens: hens.length,
    dailyFeed: feed,
    dailyGrain: Math.round(hens.length * 0.35 * 10) / 10,
    manuredFarms: manuredFarms(world).size,
    foalIn: horses.filter((h) => !h.riderId).length >= 2 ? state.foalIn : null,
    lost: { ...state.lost },
    lostBy: { ...(state.lostBy || {}) },
  };
}
