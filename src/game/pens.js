/**
 * Enclosures: what you keep behind a fence, and what you keep in a coop.
 *
 * A PEN is not a building. It is any patch of your own ground that a ring of
 * fences closes off, found by flood fill from any tile inside it. That is why
 * a pen has no `id` and no construction: you build fences, and an enclosure is
 * what happens when they meet. A gap anywhere and there is no pen at all.
 *
 * THREE KINDS OF KEPT ANIMAL LIVE HERE, and each is here for a different
 * reason — the playtest said "animals serve no purpose", and three copies of
 * the same animal would not have answered it:
 *
 *   RABBITS breed fast and turn a full pen into meat. Grass only.
 *   GOATS graze SAND as happily as grass, which is the whole point of them:
 *     they are the only use the game has ever had for dry ground, and they
 *     give milk every day of the year, including the winter when the farms
 *     give nothing at all.
 *   HENS live in a COOP, which IS a building, and eat GRAIN — the first use
 *     seeds have ever had beyond planting a wood, and the reason a woodcutter
 *     now feeds you indirectly. They lay all year too, and a fox will have
 *     them if you do not fence them in.
 *
 * THE FOX AND INVARIANT 6. A fox that gets into a coop kills a hen and gains
 * NOTHING for it — no energy, no shortened hunt. The predator-prey balance is
 * tuned across three simulated years on the assumption that rabbits are the
 * only food a fox has, and a second source would rewrite all of it silently.
 * So the hen is a loss to you and not a meal to the fox, which is both the
 * safe thing to code and, as it happens, what foxes in a henhouse actually do.
 */
import { neighbors, key, distance } from "./hex.js";
import { getTerrain, activeTiles } from "./tiles.js";
import { barrierAt } from "./buildings.js";
import { operational } from "./construction.js";
import { isOwned } from "./territory.js";
import { seasonOf } from "./calendar.js";
import { addResource } from "./economy.js";
import { livestockState, recordLoss } from "./livestock.js";

/**
 * What can be kept behind a fence, and on what.
 *
 *   perTile     how many the ground will carry, per enclosed tile
 *   terrain     ground this animal will live on — and the flood fill is
 *               scoped to it, so a rabbit pen still has to be all grass
 *   stockFood   what a starting pair costs
 *   matureDays  age before it counts as breeding stock
 *   breedEvery  days between one young per mature pair
 *   winterFeed  food a day, each, when there is nothing to graze
 *   meat        food from one the pen has no room for
 *   milk        food a day from each mature animal, all year (goats only)
 */
export const PENNED = {
  rabbit: {
    label: "Rabbit", plural: "rabbits",
    perTile: 4, terrain: ["grass"], stockFood: 20,
    matureDays: 4, breedEvery: 4, winterFeed: 0.5, meat: 3,
  },
  goat: {
    label: "Goat", plural: "goats",
    perTile: 1, terrain: ["grass", "sand"], stockFood: 45,
    matureDays: 20, breedEvery: 20, winterFeed: 1, meat: 8, milk: 0.6,
  },
};
export const PENNED_IDS = Object.keys(PENNED);

/** What a coop is and what it wants. */
export const COOP = {
  /** Hens to a coop. */
  roosts: 6,
  /** What a starting clutch of three costs. */
  stockFood: 15,
  /** Grain a hen eats a day. Seeds, which had one use before this. */
  grain: 0.35,
  /** Food a hen eats a day when there is no grain — scratch feed, dearer. */
  scratch: 1,
  /** Food a fed hen lays a day. Winter included: this is the point of them. */
  eggs: 0.8,
  /** Days between chicks, in a fed coop with room. */
  chickEvery: 10,
  matureDays: 6,
  /** Days a hen will go unfed before it is lost. */
  patience: 5,
  /** How far off a fox will notice a coop that is not fenced in. */
  foxReach: 4,
};

// --- enclosures --------------------------------------------------------------

/**
 * The enclosure containing q,r, or null.
 *
 * `terrains` scopes the fill, so asking as a rabbit ("grass") and asking as a
 * goat ("grass", "sand") are different questions about the same fences, and a
 * rabbit pen is still all grass exactly as it was.
 */
export function enclosure(world, q, r, terrains = ["grass", "sand"]) {
  if (!terrains.includes(getTerrain(world, q, r)) || barrierAt(world, q, r) || !isOwned(world, q, r)) return null;
  const cells = new Set([key(q, r)]);
  const queue = [{ q, r }];
  let fences = 0;
  for (let i = 0; i < queue.length; i++) {
    for (const n of neighbors(queue[i].q, queue[i].r)) {
      const barrier = barrierAt(world, n.q, n.r);
      if (barrier) { if (barrier.building.id === "fence") fences++; continue; }
      const k = key(n.q, n.r);
      if (cells.has(k)) continue;
      // Off the board, off your land, or wrong ground: the ring is not closed.
      if (!terrains.includes(getTerrain(world, n.q, n.r)) || !isOwned(world, n.q, n.r) || cells.size >= 128) return null;
      cells.add(k);
      queue.push(n);
    }
  }
  return fences ? { cells, fences } : null;
}

/** Is this tile fenced in? What keeps the fox off a coop. */
export const isEnclosed = (world, q, r) =>
  !!(barrierAt(world, q, r) ? null : enclosure(world, q, r));

/** The pen at q,r for a given animal, with its capacity and its occupants. */
export function penFor(world, q, r, species = "rabbit") {
  const def = PENNED[species];
  if (!def) return null;
  const found = enclosure(world, q, r, def.terrain);
  if (!found) return null;
  const animals = (world.animals || []).filter((a) => a.species === species && found.cells.has(key(a.q, a.r)));
  return { cells: found.cells, capacity: found.cells.size * def.perTile, species, animals, rabbits: animals };
}

/** The old name, and still the common case. */
export const rabbitPen = (world, q, r) => penFor(world, q, r, "rabbit");

/** Buy a breeding pair and put them in. */
export function stockPen(world, q, r, species = "rabbit") {
  const def = PENNED[species];
  if (!def) return { ok: false, reason: "nothing like that can be penned" };
  const pen = penFor(world, q, r, species);
  if (!pen) {
    return { ok: false, reason: `enclose owned ${def.terrain.join(" or ")} completely with fences and a gate` };
  }
  if (pen.animals.length + 2 > pen.capacity) return { ok: false, reason: `not enough room for two ${def.plural}` };
  if (world.store.food < def.stockFood) return { ok: false, reason: `need ${def.stockFood} food for a breeding pair` };
  world.store.food -= def.stockFood;
  for (let i = 0; i < 2; i++) {
    world.animals.push({
      id: world.nextAnimalId++, species, q, r,
      energy: 20, cooldown: def.breedEvery, bornOn: world.day, tamed: true, pen: key(q, r),
    });
  }
  return { ok: true, species };
}
export const stockRabbitPen = (world, q, r) => stockPen(world, q, r, "rabbit");

/** Food a penned rabbit eats a day in winter, when the enclosure has nothing to graze. */
export const PEN_WINTER_FEED = PENNED.rabbit.winterFeed;
/** Food from a surplus kit a full pen cannot hold. */
export const PEN_MEAT = PENNED.rabbit.meat;

/**
 * One day of every pen.
 *
 * WAS (before the playtest pass): every rabbit ate a whole food a day all year
 * and the pen produced one rabbit every fourth day whatever its size, so a full
 * pen of eight cost 32 food per rabbit it made and did nothing else. It was a
 * food sink with a picture on it.
 *
 * NOW: they graze their own enclosure for free outside winter. Every
 * `breedEvery` days each mature PAIR has one young, and one the pen has no room
 * for becomes meat. Goats also give milk every day of the year, which is the
 * one food in the game that does not stop in winter.
 */
export function stepPens(world) {
  const events = [];
  const winter = seasonOf(world.day).id === "winter";
  const groups = new Map(); // anchor+species -> animals
  for (const a of world.animals || []) {
    if (!a.pen || !PENNED[a.species]) continue;
    const k = `${a.pen}|${a.species}`;
    const list = groups.get(k) || [];
    list.push(a);
    groups.set(k, list);
  }

  let meat = 0;
  let milk = 0;
  for (const [k, animals] of groups) {
    const [anchor, species] = k.split("|");
    const def = PENNED[species];
    const [q, r] = anchor.split(",").map(Number);
    const pen = penFor(world, q, r, species);
    if (!pen) {
      for (const a of animals) { delete a.pen; a.tamed = false; }
      events.push({
        type: "penOpened", q, r, species,
        text: `The ${def.label.toLowerCase()} enclosure at ${q},${r} is open. Its ${def.plural} can escape.`,
      });
      continue;
    }

    const feed = winter ? Math.ceil(animals.length * def.winterFeed) : 0;
    const fed = world.store.food >= feed;
    if (fed) {
      world.store.food -= feed;
      for (const a of animals) a.energy = 20;
    }
    if (!fed) continue;

    const mature = animals.filter((a) => world.day - a.bornOn >= def.matureDays);
    if (def.milk) milk += mature.length * def.milk;

    if (world.day % def.breedEvery !== 0) continue;
    const pairs = Math.floor(mature.length / 2);
    let room = pen.capacity - pen.animals.length;
    let born = 0;
    for (let i = 0; i < pairs; i++) {
      if (room > 0) {
        world.animals.push({
          id: world.nextAnimalId++, species, q, r,
          energy: 20, cooldown: def.breedEvery, bornOn: world.day, tamed: true, pen: anchor,
        });
        room--; born++;
      } else meat += def.meat;
    }
    if (born) {
      events.push({
        type: species === "rabbit" ? "rabbitBred" : "penBred", q, r, species, born,
        text: born > 1
          ? `${born} ${def.plural} were born in the enclosure at ${q},${r}.`
          : `A ${def.label.toLowerCase()} was born in the enclosure at ${q},${r}.`,
      });
    }
  }

  if (meat) {
    const got = addResource(world, "food", meat);
    events.push({ type: "penMeat", food: got, text: `The pens were full — the surplus gave ${got} food.` });
  }
  if (milk) {
    const got = carry(world, "milk", milk);
    if (got) events.push({ type: "milk", food: got, text: `The goats gave ${got} food in milk and cheese.` });
  }
  return events;
}

/** The old name. tick.js and the tests both still say this. */
export const stepRabbitPens = stepPens;

/**
 * Whole units out of a daily trickle.
 *
 * Milk and eggs are fractions of a food per animal per day, and flooring each
 * day separately would round a four-hen coop's 3.2 food down to 3 forever —
 * 6% of the point of the building, lost to arithmetic. The remainder is kept
 * on `world.livestock` and paid out when it reaches a whole one.
 */
function carry(world, kind, amount) {
  const state = livestockState(world);
  state.carry = state.carry || {};
  const total = (state.carry[kind] || 0) + amount;
  const whole = Math.floor(total);
  state.carry[kind] = total - whole;
  return whole > 0 ? addResource(world, "food", whole) : 0;
}

/** Take some out of a pen for the pot. Always leaves the breeding pair. */
export function cullPen(world, q, r, count = 2, species = "rabbit") {
  const def = PENNED[species];
  const pen = def && penFor(world, q, r, species);
  if (!pen) return { ok: false, reason: "there is no closed pen here" };
  const spare = Math.min(count, pen.animals.length - 2);
  if (spare <= 0) return { ok: false, reason: "only the breeding pair is left" };
  const gone = new Set(pen.animals.slice(-spare).map((a) => a.id));
  world.animals = world.animals.filter((a) => !gone.has(a.id));
  const food = addResource(world, "food", spare * def.meat * 2);
  return { ok: true, taken: spare, rabbits: spare, food };
}
export const cullRabbits = (world, q, r, count = 2) => cullPen(world, q, r, count, "rabbit");

// --- coops -------------------------------------------------------------------

/** Every standing coop. */
export function coopTiles(world) {
  const out = [];
  for (const tile of activeTiles(world)) {
    if (tile.building && tile.building.id === "coop" && operational(tile.building)) out.push(tile);
  }
  return out;
}

/** The hens of one coop. */
export const hensOf = (world, q, r) =>
  (world.animals || []).filter((a) => a.species === "chicken" && a.coop === key(q, r));

/** Buy a clutch of three and put them in. */
export function stockCoop(world, q, r) {
  const tile = coopTiles(world).find((t) => t.q === q && t.r === r);
  if (!tile) return { ok: false, reason: "there is no finished coop here" };
  const hens = hensOf(world, q, r);
  if (hens.length + 3 > COOP.roosts) return { ok: false, reason: `a coop roosts ${COOP.roosts}` };
  if (world.store.food < COOP.stockFood) return { ok: false, reason: `need ${COOP.stockFood} food for three hens` };
  world.store.food -= COOP.stockFood;
  for (let i = 0; i < 3; i++) {
    world.animals.push({
      id: world.nextAnimalId++, species: "chicken", q, r,
      energy: 10, cooldown: COOP.chickEvery, bornOn: world.day, tamed: true, coop: key(q, r),
    });
  }
  return { ok: true };
}

/**
 * One day of every coop: grain in, eggs out, and the fox.
 *
 * Grain is the interesting half. Seeds have had exactly one use since step two
 * — planting a wood — and a woodcutter turns one up every day and a half, so
 * they piled up against a ceiling (docs/15) with nowhere to go. A coop eats
 * them, which quietly turns "wood" into "food" through the seed the cutter
 * found, and gives the cap something to push against.
 *
 * Scratch feed is the fallback so a coop is never a trap: out of grain it eats
 * plain food instead, dearer per hen than the grain would have been.
 */
export function stepCoops(world, rnd = Math.random) {
  const events = [];
  const coops = coopTiles(world);
  if (!coops.length) return events;
  const foxes = (world.animals || []).filter((a) => a.species === "fox" && !a.tamed);
  let eggs = 0;

  for (const tile of coops) {
    const hens = hensOf(world, tile.q, tile.r);
    if (!hens.length) continue;

    // --- feeding. Grain first, then scratch feed, then they go hungry.
    const wantGrain = hens.length * COOP.grain;
    const grain = Math.min(wantGrain, world.store.seeds || 0);
    world.store.seeds = (world.store.seeds || 0) - grain;
    const unfed = Math.max(0, Math.round((wantGrain - grain) / COOP.grain));
    const scratch = Math.min(unfed * COOP.scratch, world.store.food || 0);
    world.store.food -= scratch;
    const hungry = unfed - Math.floor(scratch / COOP.scratch);

    if (hungry > 0) {
      tile.building.henHunger = (tile.building.henHunger || 0) + 1;
      if (tile.building.henHunger >= COOP.patience) {
        tile.building.henHunger = 0;
        const lost = hens[hens.length - 1];
        world.animals = world.animals.filter((a) => a.id !== lost.id);
        recordLoss(world, "chicken", "hunger");
        events.push({
          type: "henLost", reason: "hunger", q: tile.q, r: tile.r,
          text: `A hen was lost at ${tile.q},${tile.r} — the coop has had no grain for days.`,
        });
      }
      continue; // a hungry coop lays nothing
    }
    tile.building.henHunger = 0;
    eggs += hens.length * COOP.eggs;

    // --- a chick, if there is room and a pair old enough
    const mature = hens.filter((a) => world.day - a.bornOn >= COOP.matureDays).length;
    if (mature >= 2 && hens.length < COOP.roosts && world.day % COOP.chickEvery === 0) {
      world.animals.push({
        id: world.nextAnimalId++, species: "chicken", q: tile.q, r: tile.r,
        energy: 10, cooldown: COOP.chickEvery, bornOn: world.day, tamed: true, coop: key(tile.q, tile.r),
      });
      events.push({ type: "chick", q: tile.q, r: tile.r, text: `A chick hatched at ${tile.q},${tile.r}.` });
    }

    // --- and the fox. A coop behind a fence is safe; one standing in the
    // open is a larder. The fox gains nothing — see the header, invariant 6.
    if (isEnclosed(world, tile.q, tile.r)) continue;
    const near = foxes.find((f) => distance(f, tile) <= COOP.foxReach);
    if (near && rnd() < 0.5) {
      const taken = hens[hens.length - 1];
      world.animals = world.animals.filter((a) => a.id !== taken.id);
      recordLoss(world, "chicken", "fox");
      events.push({
        type: "henLost", reason: "fox", q: tile.q, r: tile.r,
        text: `A fox took a hen from the coop at ${tile.q},${tile.r}. A fence around it would stop that.`,
      });
    }
  }

  if (eggs) {
    const got = carry(world, "eggs", eggs);
    if (got) events.push({ type: "eggs", food: got, text: `The coops gave ${got} food in eggs.` });
  }
  return events;
}

/** What the panels say about a coop. */
export function coopSummary(world, q, r) {
  const tile = coopTiles(world).find((t) => t.q === q && t.r === r);
  if (!tile) return null;
  const hens = hensOf(world, q, r);
  return {
    hens: hens.length,
    roosts: COOP.roosts,
    grain: Math.round(hens.length * COOP.grain * 10) / 10,
    eggs: Math.round(hens.length * COOP.eggs * 10) / 10,
    safe: isEnclosed(world, q, r),
  };
}
