/**
 * The rival farmers, and what they come to take.
 *
 * WHAT THIS IS FOR. The settlement had no external pressure at all. Foxes bite
 * one person occasionally; weather is a multiplier; nothing else in the world
 * ever wanted anything from you. So the correct play was always to hoard — and
 * a two-year playthrough ended with three thousand wood, four hundred stone
 * and nothing that could possibly go wrong. Raids are the answer to that: a
 * standing reason for a pile of goods to be a liability as well as an asset.
 *
 * THE CENTRAL DESIGN RULE: a raid is a TAX ON VISIBLE SURPLUS, not a dice roll
 * on your settlement. Everything follows from that.
 *
 *   - Raids scale with what you are sitting on. A poor farm is not worth the
 *     walk; a fat one is raided often. This is self-balancing in a way a fixed
 *     schedule is not, and it means the threat grows exactly as fast as your
 *     ability to answer it.
 *   - There is always an answer, and it is BUILDING something. Granaries put
 *     goods out of reach, walls keep raiders out, watchtowers give you the day
 *     of warning you need to get people home. All three are stone, which is
 *     what stone was short of.
 *   - Nothing here can end a run. Raiders steal and injure; they do not burn
 *     your base down, and they leave when they have what they came for.
 *
 * WHY THEY ARE NOT ANIMALS. It would have been less code to add a "raider"
 * species to animals.js, and it would have been wrong: the predator-prey
 * balance there is tuned across three simulated years and assumes every
 * creature in the list eats, breeds and starves. Raiders do none of those. A
 * separate list costs a few functions and protects a tested system.
 *
 * THEY HAVE AN ADDRESS NOW. This file used to say a rival settlement you could
 * attack was "a whole second game" and out of scope, and raiders walked in from
 * the edge of the map. That made the threat weather rather than a neighbour:
 * nothing to scout, nothing to plan around, and paying them off was the only
 * interaction available. `rivalcamp.js` owns the settlement; this file still
 * owns the raid. Parties now set out from their camp, and the size of one is
 * driven by how well they are doing as much as by how rich you look — so
 * burning a field is visible as smaller parties rather than as a vague hope.
 *
 * Stepped DAILY, from advanceHour when the date rolls over — the same cadence
 * as the animals, for the same reason.
 */
import { distance, neighbors } from "./hex.js";
import { monumentPressure } from "./monument.js";
import { getTerrain, getTile, activeTiles } from "./tiles.js";
import { TERRAIN } from "./terrain.js";
import {
  BUILDINGS, protectedStores, watchtowers, barsRaiders, breachBarrier, stableCapacity,
} from "./buildings.js";
import { inTerritory, nearestOwned } from "./territory.js";
import {
  hasRaiders, raiderCamps, campById, campProsperity, campStrength,
  burnSomething, lootCamp, settleTheValley, BURN_DAMAGE,
} from "./rivalcamp.js";
import { TOOLS } from "./base.js";
import { healthOf, defenceOf, reapTheFallen, sheltered } from "./danger.js";
import { findPath, homeOf } from "./workers.js";
import { campDefence, creditCamp } from "./campAI.js";
import { addResource } from "./economy.js";
import { nearestPaddockTo, recordHorseLoss } from "./livestock.js";

// --- the dials -------------------------------------------------------------

/** Nobody comes calling before this. A new settlement gets a clear run. */
export const FIRST_RAID_DAY = 40;

/** Days between raids on a settlement with nothing worth taking. */
export const RAID_INTERVAL_MAX = 50;

/** ...and on the fattest one. Never faster than this, whatever you hoard. */
export const RAID_INTERVAL_MIN = 18;

/**
 * Surplus, in resources, at which the pressure is considered maxed out.
 *
 * Raised from 900 after a playthrough: at 900 the pressure pinned to 1 almost
 * immediately and stayed there, so every raid was a maximum raid and an
 * undefended farm ended two hundred days with sixty food in the barn. That is
 * confiscation, not taxation, and it makes the whole system read as a punishment
 * rather than a pressure. The curve should spend most of a real game in its
 * middle, not against its ceiling.
 */
export const SURPLUS_FOR_MAX_PRESSURE = 1500;

/** Most raiders in one party. */
export const MAX_PARTY = 5;

/**
 * What a rider adds to a war party. Less than a spear (ARMS x rating) — a
 * horse is reach and weight, not a weapon — but enough that keeping horses
 * changes whether an attack gets in.
 */
export const ASSAULT_MOUNTED = 2;

/** Tiles a raider covers in a day. Faster than a worker on foot, slower than a horse. */
export const RAIDER_SPEED = 24;

/**
 * What one raider can carry off, before greed.
 *
 * Scaled by pressure at the point of use. A flat load looked absurd against a
 * real hoard — five raiders taking 225 from a pile of eight thousand is not a
 * tax, it is a rounding error, and the whole point of the system is that a
 * hoard is a liability.
 */
export const RAIDER_LOAD = 45;
export const GREED_AT_MAX_PRESSURE = 1.5;

export const RAIDER_HEALTH = 40;

/**
 * Damage a raider does to a worker in a day's fighting, before defence.
 *
 * Was 16, which killed a worker in almost every raid — six dead in two hundred
 * days on the first playthrough. That breaks the rule at the top of this file:
 * raids cost you goods, not people. Twelve, against a hundred health and a
 * retreat at forty-five, means a caught worker has three or four days to get
 * out, which is enough for the existing retreat behaviour to save them.
 */
export const RAIDER_HIT = 12;

/**
 * ...and what a worker does back, before their own bonuses.
 *
 * The first version had this multiplied by `0.4 + defence`, which meant an
 * unarmed farmer did five damage a day against forty health — eight days to
 * drive off one raider, in a raid that lasts about seven. Workers therefore
 * killed exactly zero raiders across every playthrough while dying themselves.
 * A farmer with a pitchfork should lose slowly, not lose always.
 */
export const WORKER_HIT = 13;

/** A raider this badly hurt stops fighting and heads for the hills. */
export const RAIDER_BREAKS_AT = 0.4;

/**
 * How close is "in a fight".
 *
 * MEASURED, not guessed — and the measurement is the same one that fixed the
 * fox. At range 1, over 220 simulated days with raids every fortnight, workers
 * killed exactly ZERO raiders: a raider moves three tiles a day and a worker
 * six, so sharing a tile at the single instant the day is evaluated is very
 * nearly impossible. The unit here is a whole day of both parties moving
 * around the same few fields, not a snapshot. Three is what makes a defended
 * farm actually defend itself.
 */
export const FIGHT_RANGE = 3;

/** Condition a raider knocks off a building it passes through. */
export const RAID_DAMAGE = 18;

/*
 * THE TORCH. For fifteen passes raiders damaged whatever they happened to walk
 * over and nothing else: there was no equivalent of the player marching on
 * their camp and burning a hut, so the exchange only ever ran one way. Now a
 * party of TORCH_PARTY or more sends ONE of its number after a building it has
 * chosen, and that raider stays on it until it is a ruin.
 *
 * Which building, in order: a granary first, because a granary is what puts
 * your goods out of their reach and burning it is how they get at next year's;
 * then the rest of the economy. Never the base — they rob you, they do not
 * burn you out, which is the same rule `vandalise` has always had and the
 * reason a raid can never end the game. Never a wall, gate or tower either:
 * barriers already have the breaching rules, and a torch-bearer queueing to
 * knock down a wall would quietly replace them.
 *
 * A burned granary stops protecting anything, because `protectedStores` scales
 * with condition. So the raid after this one takes more — which is the sharper
 * exchange this was for, and an argument for more than one granary.
 */
export const TORCH_PARTY = 3;
/**
 * Condition the torch-bearer takes off its chosen building each day. Named
 * TORCH_DAMAGE rather than BURN_DAMAGE because rivalcamp.js already has one of
 * those — that is what YOU do to THEIR huts, and the two numbers are not the
 * same thing and should not drift into each other.
 */
export const TORCH_DAMAGE = 35;
/** What they go for, best first. */
export const TORCH_PRIORITY = ["granary", "warehouse", "market", "infirmary", "coop", "farm", "woodcutter", "quarryCamp"];

/** Days a tribute payment buys. */
export const TRIBUTE_DAYS = 20;

// --- attacking their camp ---------------------------------------------------

/** Damage a day outside their camp does to each attacker, before defence. */
export const ASSAULT_HIT = 11;

/**
 * How much one attacker is worth: `ASSAULT_BASE + defence rating x ASSAULT_ARMS`.
 *
 * MEASURED, and the first numbers were badly wrong in both directions. At
 * `1 + rating x 2` a full party of five armed workers mustered 8.5 against a
 * healthy camp's 12, so the attack could NEVER succeed — 400 days of
 * expeditions produced 98 repulsions, zero buildings burned and 101 dead. An
 * option the player cannot win is worse than no option at all.
 *
 * At `2 + rating x 4`: five trained and armed is about 26 against 12 and wins
 * comfortably; three armed but untrained is 10 against 12 and narrowly loses.
 * That is the tension worth having — you need numbers or training, and
 * preferably both.
 */
export const ASSAULT_BASE = 2;
export const ASSAULT_ARMS = 4;

/**
 * The worst beating a losing party takes in a day, as a multiple of ASSAULT_HIT.
 *
 * Uncapped, `defence / attack` reached 3 for a small unarmed party — 33 damage
 * a day, dead in three — and sending four farmers at a camp was not a mistake,
 * it was an execution. Capped at 1.6 a losing party is badly hurt, hits the
 * retreat threshold in about four days, and walks home.
 */
export const WORST_ODDS = 1.6;

/** Days of getting nowhere before a party gives up and comes home. */
export const ASSAULT_PATIENCE = 4;

/** What one attacker can carry home. */
export const ASSAULT_LOOT = 40;

/** Defenders lost each day the attackers get the better of it. */
export const DEFENDERS_LOST = 1;

/**
 * How hard one raider hammers at a fence or a wall in a day.
 *
 * Against a fence (integrity 25) a small party is through in a day; against a
 * wall (150) it is most of a week, by which time they have usually given up —
 * see RAID_PATIENCE. That difference IS the difference between the two
 * buildings; there is nothing else to it, and there does not need to be.
 */
export const BREACH_FORCE = 10;

/**
 * Days a raider will keep trying before giving up and going home.
 *
 * A SAFETY NET, not a balance dial, and it exists because of a real deadlock.
 * `raidEntry` picks a tile by walking outward from the base, which can land on
 * an island or the far side of a lake. A party that cannot reach its target
 * never loots, never leaves, and `world.raiders` never empties — so NO FURTHER
 * RAID IS EVER SCHEDULED. A 540-day playthrough froze on day 107 and the whole
 * system was silently dead for four hundred days while every test passed.
 *
 * The entry point is now checked for reachability, which fixes the cause. This
 * is the guard for every other cause: nothing may occupy `world.raiders`
 * indefinitely.
 */
export const RAID_PATIENCE = 12;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

// --- how much trouble you are in -------------------------------------------

/**
 * Goods sitting where a raid could take them.
 *
 * This is the number the whole system turns on, and it is deliberately what
 * you have UNPROTECTED rather than what you have. Build enough granaries and
 * this falls to zero however rich you are, which is the intended end state:
 * not immunity handed out, immunity built.
 */
export function exposedGoods(world) {
  const safe = protectedStores(world);
  let total = 0;
  for (const res of ["food", "wood", "stone"]) {
    total += Math.max(0, (world.store[res] || 0) - (safe[res] || 0));
  }
  return total;
}

/**
 * How much of the pressure comes from simply being BIG, whatever is under
 * cover. Changed after the first playtest ("the player grows very fast"): with
 * pressure driven only by exposed goods, a large settlement with enough
 * granaries was never raided again, so the one opponent in the game stopped
 * pushing back exactly when the player was running away with it.
 *
 * Granaries still decide what a raid can TAKE — a fully covered town is
 * visited, finds nothing, and the raid is foiled — but a town is now worth a
 * look. Nothing below SIZE_PRESSURE_FROM people, so a small settlement is
 * still left alone and the "immunity built" end state still exists for it.
 */
export const SIZE_PRESSURE = 0.35;
export const SIZE_PRESSURE_FROM = 6;
export const SIZE_PRESSURE_FULL = 22;

export function sizePressure(world) {
  const people = (world.workers || []).length;
  return SIZE_PRESSURE * clamp01((people - SIZE_PRESSURE_FROM) / (SIZE_PRESSURE_FULL - SIZE_PRESSURE_FROM));
}

/** 0 (not worth robbing) to 1 (worth bringing everyone). */
export function raidPressure(world) {
  // Exposed goods, how many of you there are, and whether you have built
  // something that can be seen from the far side of the valley.
  return clamp01(exposedGoods(world) / SURPLUS_FOR_MAX_PRESSURE + sizePressure(world) + monumentPressure(world));
}

/**
 * Days until the next raid is due.
 *
 * Two inputs again: how rich you look, and what shape THEY are in. A camp that
 * has been burned out raids rarely even against a fat settlement, which is the
 * lasting payoff for attacking them — party size shrinks immediately, and the
 * gap between raids stretches out for as long as they stay broken.
 */
export function raidInterval(world) {
  let p = raidPressure(world);
  const camp = strongestRaiderCamp(world);
  if (camp) {
    // Never to zero: even a wrecked camp will come for a rich enough farm.
    p *= 0.3 + 0.7 * campProsperity(camp);
  }
  return Math.round(RAID_INTERVAL_MAX - (RAID_INTERVAL_MAX - RAID_INTERVAL_MIN) * p);
}

/**
 * How many turn up. One is a nuisance; five is a bad morning.
 *
 * Two inputs, and both matter: how rich YOU look (the tax-on-surplus rule this
 * file is built around) and how many of THEM there are to send. The second is
 * what makes attacking their camp worth doing — a settlement whose fields have
 * been burned cannot field a full party however tempting you are.
 */
export function partySize(world, camp = null) {
  const tempting = 1 + Math.floor(raidPressure(world) * MAX_PARTY);
  const from = camp || strongestRaiderCamp(world);
  if (!from) return Math.max(1, Math.min(MAX_PARTY, tempting));
  // They will not send everybody — somebody stays to mind the camp.
  const canSend = Math.max(1, Math.floor(campStrength(from) * 0.7));
  return Math.max(1, Math.min(MAX_PARTY, tempting, canSend));
}

/**
 * Which raider camp is coming, when there is more than one.
 *
 * The strongest, deterministically — so a player who has burned one of them
 * out sees the raids shift to the other rather than watching a coin flip. It
 * also means grinding down the nearest camp does not simply hand the job to a
 * healthy one at random.
 */
export function strongestRaiderCamp(world) {
  let best = null;
  for (const camp of raiderCamps(world)) {
    if (!best || campStrength(camp) > campStrength(best)) best = camp;
  }
  return best;
}

/**
 * Could a raid physically happen?
 *
 * Raiders may not enter from ground the player holds, so a settlement that has
 * claimed every approach cannot be raided at all. That is a genuine end state
 * rather than a bug — you own the valley — but it has to be SAID, because a
 * threat that quietly stops arriving is indistinguishable from a broken
 * system, and this codebase has shipped that mistake twice already.
 */
export function raidsPossible(world, rnd = () => 0.5) {
  return raidEntry(world, rnd) !== null;
}

export const activeRaiders = (world) => world.raiders || [];
export const raidInProgress = (world) => activeRaiders(world).length > 0;

/** Days until the next raid, or null if none is scheduled yet. */
export function daysUntilRaid(world) {
  if (world.nextRaidDay === undefined || world.nextRaidDay === null) return null;
  return Math.max(0, world.nextRaidDay - world.day);
}

/**
 * Push the next raid back by paying them off.
 *
 * The honest alternative to building defences, and priced so it is the WORSE
 * one in the long run — it costs real food every time and buys a fixed number
 * of days, while a granary is bought once. It exists for the settlement that
 * gets caught out with nothing built and needs to survive one more month.
 */
export const tributeCost = (world) => ({
  food: 60 + Math.round(raidPressure(world) * 140),
  wood: 40 + Math.round(raidPressure(world) * 100),
});

export function canPayTribute(world) {
  if (raidInProgress(world)) {
    return { ok: false, reason: "too late — they are already here" };
  }
  const cost = tributeCost(world);
  for (const [res, n] of Object.entries(cost)) {
    if ((world.store[res] || 0) < n) {
      return { ok: false, reason: `not enough — need ${n} ${res}` };
    }
  }
  return { ok: true, cost };
}

export function payTribute(world) {
  const check = canPayTribute(world);
  if (!check.ok) return check;
  for (const [res, n] of Object.entries(check.cost)) world.store[res] -= n;
  world.nextRaidDay = Math.max(world.nextRaidDay || world.day, world.day) + TRIBUTE_DAYS;
  world.tributesPaid = (world.tributesPaid || 0) + 1;
  return { ok: true, cost: check.cost, until: world.nextRaidDay };
}

// --- where they come from --------------------------------------------------

const walkableForRaider = (world, q, r) => {
  const terrain = TERRAIN[getTerrain(world, q, r)];
  if (!terrain || !terrain.walkable) return false;
  return !barsRaiders(world, q, r);
};

/**
 * Somewhere they could plausibly have come FROM.
 *
 * Raiders arrive from outside. They do not appear in the middle of your farm,
 * and the rule for "your farm" is the territory — so a settlement that has
 * spread across the map pushes the place they can come from further and
 * further out, which is a quiet second reward for expanding.
 */
const validEntry = (world, q, r) =>
  walkableForRaider(world, q, r) && !inTerritory(world, q, r);

/**
 * A tile on the far edge of the board for a party to arrive at and leave by.
 *
 * They come from off the map rather than from a camp you could go and destroy.
 * That is a deliberate limit on scope: a rival settlement you can attack is a
 * whole second game, and this one is about farming. What the player gets is a
 * threat to defend against, not a war to win.
 */
export function raidEntry(world, rnd) {
  const home = homeOf(world) || world.home;
  const camps = raiderCamps(world).filter(c => campStrength(c) >= 2).sort((a,b) => campStrength(b) - campStrength(a));
  for (const camp of camps) {
    if (validEntry(world,camp.home.q,camp.home.r) && findPath(world,camp.home,home,3000,"siege")) return { ...camp.home, campId: camp.id };
  }
  return null;
}

// --- what they are after ---------------------------------------------------

/**
 * The tile a raider walks toward.
 *
 * Horses first, then the stores. That ordering is the one the player asked
 * for and it is also the more interesting one: goods are a number going down,
 * but a horse you spent four days catching being led away is a thing that
 * happened to you.
 */
export function raidTarget(world) {
  const home = homeOf(world) || { q: 0, r: 0 };

  // A paddock with something in it.
  for (const tile of activeTiles(world)) {
    if (!tile.building || tile.building.id !== "paddock") continue;
    const horse = (world.animals || []).find(
      (a) => a.species === "horse" && a.tamed && !a.riderId && a.q === tile.q && a.r === tile.r
    );
    if (horse) return { q: tile.q, r: tile.r, want: "horse" };
  }

  return { q: home.q, r: home.r, want: "goods" };
}

/**
 * The building a torch-bearer comes for, or null if you have nothing worth
 * burning. Best of the highest priority that still stands, nearest to home
 * among equals — they go for the middle of the settlement, not the outlying
 * farm they happen to pass.
 */
export function burnTarget(world) {
  const home = homeOf(world) || { q: 0, r: 0 };
  let best = null;
  for (const tile of activeTiles(world)) {
    const b = tile.building;
    if (!b || b.condition <= 0 || b.construction) continue;
    const rank = TORCH_PRIORITY.indexOf(b.id);
    if (rank < 0) continue;
    const d = distance(home, tile);
    if (!best || rank < best.rank || (rank === best.rank && d < best.d)) {
      best = { rank, d, q: tile.q, r: tile.r };
    }
  }
  return best ? { q: best.q, r: best.r, want: "burn" } : null;
}

// --- the raid ---------------------------------------------------------------

function makeRaider(world, at, target, campId) {
  return {
    id: (world.nextRaiderId = (world.nextRaiderId || 0) + 1),
    // Which camp sent them. Everything they carry home goes back here, and
    // with several neighbours on the board that has to be recorded at the
    // moment they set out — the strongest camp may be a different one by the
    // time they get back.
    campId,
    q: at.q,
    r: at.r,
    health: RAIDER_HEALTH,
    state: "incoming", // incoming | leaving
    target,
    home: { q: at.q, r: at.r },
    carrying: null, // {res, n} or {horseId}
    path: null,
  };
}

/**
 * Schedule the first raid, and re-schedule after each one.
 *
 * Kept in one function so there is exactly one definition of when they come.
 */
export function scheduleRaid(world) {
  const from = Math.max(world.day, FIRST_RAID_DAY);
  world.nextRaidDay = from + raidInterval(world);
  return world.nextRaidDay;
}

/** Send a party. Exported so a test can raid on demand rather than waiting. */
export function launchRaid(world, rnd) {
  const events = [];
  const entry = raidEntry(world, rnd);
  if (!entry) return events; // nowhere to come from; skip this one quietly

  const from = campById(world, entry.campId);
  const target = raidTarget(world);
  const n = partySize(world, from);
  world.raiders = world.raiders || [];
  // ONE of them goes for a horse; the rest go for the stores. Every raider
  // used to share the target, so a party of three led off up to three horses
  // — measured at two horses a raid, which was most of what the playtest
  // meant by "horses keep disappearing" once starvation was fixed.
  const goods = { ...homeOf(world) || { q: 0, r: 0 }, want: "goods" };
  // One for a horse if there is one standing about, one with a torch if the
  // party is big enough to spare somebody, and the rest for the stores.
  const aims = [];
  for (let i = 0; i < n; i++) aims.push(target.want === "horse" && i > 0 ? goods : target);
  const torch = n >= TORCH_PARTY ? burnTarget(world) : null;
  if (torch) aims[aims.length - 1] = torch;
  for (const aim of aims) {
    const raider = { ...makeRaider(world, entry, aim, from.id), reserved: true };
    world.raiders.push(raider);
  }
  from.fighters = Math.max(0, from.fighters - n);

  // A watchtower is the difference between a raid and an ambush — and what it
  // buys is TIME, not safety. A spotted party is announced the day it sets
  // out, which is several days before it arrives, so there is room to call
  // people in from the fields. An unspotted one is announced by the sound of
  // your granary being emptied.
  if (spotted(world, entry, target)) {
    const away = Math.max(1, Math.ceil(distance(entry, target) * 24 / RAIDER_SPEED));
    events.push({
      type: "raidSpotted",
      q: entry.q,
      r: entry.r,
      text: `Watchtower: ${n} raider${n === 1 ? "" : "s"} coming in from ${entry.q},${entry.r}` +
        ` — at least ${away} game hour${away === 1 ? "" : "s"} out.`,
    });
  }
  return events;
}

/**
 * Does any watchtower cover the route in?
 *
 * The test is whether a tower sits near the line from where they come in to
 * where they are going, which in hex distance is the familiar
 * `d(a,t) + d(t,b) <= d(a,b) + range`. Checking only the entry point — the
 * first version — meant towers built sensibly near the base almost never saw
 * anything, because raiders enter at the far edge of the map. A tower should
 * watch the APPROACH, which is the whole length of it.
 */
export function spotted(world, entry, target) {
  const towers = watchtowers(world);
  const span = distance(entry, target);
  return towers.some(
    (t) => distance(t, entry) + distance(t, target) <= span + t.range
  );
}

/** One step of a raider toward wherever it is going. */
function moveRaider(world, raider, to, hours = 24) {
  let budget = RAIDER_SPEED * hours / 24;
  while (budget > 0) {
    if (raider.q === to.q && raider.r === to.r) return true;
    if (!raider.path || raider.path.length === 0) {
      // Prefer a route around barriers; plan a siege only if every route is sealed.
      raider.path = findPath(world, raider, to, 3000, "hostile") || findPath(world, raider, to, 3000, "siege");
      if (!raider.path) return false;
    }
    const next = raider.path[0];
    if (!next) return true;
    if (!walkableForRaider(world, next.q, next.r)) {
      // A fence or a wall. They do not turn around — they start pulling it
      // apart, which is the whole reason a barrier has an integrity number
      // rather than simply being impassable. A day spent on the fence is a
      // day your people have to get home and get a spear.
      if (barsRaiders(world, next.q, next.r)) {
        const detour = findPath(world, raider, to, 3000, "hostile");
        if (detour?.length) { raider.path = detour; continue; }
        const through = breachBarrier(world, next.q, next.r, BREACH_FORCE * hours / 24);
        raider.breaching = { q: next.q, r: next.r, through };
        if (through) raider.path = null; // re-plan now the way is open
        return false;
      }
      // Water, or ground that changed under the plan. Re-plan once.
      raider.path = null;
      return false;
    }
    raider.q = next.q;
    raider.r = next.r;
    raider.path.shift();
    budget -= 1;
  }
  return raider.q === to.q && raider.r === to.r;
}

/** Take what they came for. */
function loot(world, raider) {
  const events = [];

  // A horse standing in a paddock, if that is what they came for.
  if (raider.target.want === "horse") {
    const horse = (world.animals || []).find(
      (a) => a.species === "horse" && a.tamed && !a.riderId &&
        a.q === raider.q && a.r === raider.r
    );
    if (horse) {
      raider.carrying = { horseId: horse.id };
      horse.riderId = null;
      horse.stolen = true;
      events.push({
        type: "stolen",
        q: raider.q, r: raider.r,
        text: "A raider has got hold of one of your horses.",
      });
      return events;
    }
  }

  // Otherwise, whatever is not in a granary. They carry more off a rich farm
  // than a poor one — see RAIDER_LOAD.
  const safe = protectedStores(world);
  const capacity = Math.round(RAIDER_LOAD * (1 + GREED_AT_MAX_PRESSURE * raidPressure(world)));
  let taken = 0;
  const took = {};
  for (const res of ["food", "wood", "stone"]) {
    if (taken >= capacity) break;
    const open = Math.max(0, (world.store[res] || 0) - (safe[res] || 0));
    if (open <= 0) continue;
    const n = Math.min(open, capacity - taken);
    world.store[res] -= n;
    took[res] = n;
    taken += n;
  }

  if (taken > 0) {
    raider.carrying = { goods: took };
    events.push({
      type: "stolen",
      q: raider.q, r: raider.r,
      text: `Raiders took ${Object.entries(took).map(([res, n]) => `${n} ${res}`).join(" and ")}.`,
    });
  } else {
    events.push({
      type: "raidFoiled",
      q: raider.q, r: raider.r,
      text: "Raiders found nothing they could carry — it is all under lock and key.",
    });
  }
  return events;
}

/** Break whatever they are standing on, on the way through. */
/**
 * A day of one raider working on the building it came for.
 *
 * Ends when the building is a ruin, or at once if somebody else has already
 * flattened it — a torch-bearer standing over a heap of ashes for a fortnight
 * would trip the give-up counter and look like a bug.
 */
function setFire(world, raider) {
  const tile = getTile(world, raider.q, raider.r);
  const b = tile && tile.building;
  if (!b || b.id === "base" || b.condition <= 0) {
    raider.state = "leaving";
    raider.burning = false;
    raider.path = null;
    return [];
  }
  b.condition = Math.max(0, b.condition - TORCH_DAMAGE);
  raider.burning = true;
  const label = BUILDINGS[b.id].label.toLowerCase();
  if (b.condition <= 0) {
    raider.state = "leaving";
    raider.burning = false;
    raider.path = null;
    return [{
      type: "raidBurned",
      q: raider.q, r: raider.r,
      building: b.id,
      text: `They have burned the ${label} at ${raider.q},${raider.r} to the ground. It will have to be rebuilt.`,
    }];
  }
  return [{
    type: "raidBurning",
    q: raider.q, r: raider.r,
    building: b.id,
    text: `A raider is setting about the ${label} at ${raider.q},${raider.r} with a torch.`,
  }];
}

function vandalise(world, raider) {
  // getTile, not a scan of the active set: this runs once per raider per day,
  // and spreading the active set into an array to find one tile is O(every
  // building you own) for a lookup the tile store answers in O(1).
  const tile = getTile(world, raider.q, raider.r);
  if (!tile || !tile.building) return null;
  const b = tile.building;
  if (b.id === "base") return null; // they rob you, they do not burn you out
  b.condition = Math.max(0, b.condition - RAID_DAMAGE);
  return {
    type: "raidDamage",
    q: raider.q, r: raider.r,
    text: `Raiders damaged the ${BUILDINGS[b.id].label.toLowerCase()} at ${raider.q},${raider.r}.`,
  };
}

/**
 * A day of fighting, for everybody standing close enough to be in one.
 *
 * Two-sided, unlike the fox: raiders hurt workers and workers hurt raiders.
 * The worker's side is `defenceOf` — the same spear and the same hunting
 * skill that answer a fox — plus whatever a nearby watchtower is worth. One
 * combat model, two threats, so there is no second place for the numbers to
 * drift out of line.
 */
function fight(world, rnd, hours = 24) {
  const events = [];
  const towers = watchtowers(world);
  const killed = new Set();

  // ONE FIGHT PER WORKER PER DAY. Without this every raider in the party
  // independently picked the nearest worker, so a party of five all found the
  // same person and dealt sixty damage in a day — a guaranteed death that had
  // nothing to do with how well defended the farm was. Five raiders should
  // mean five fights spread across whoever is out there, not one execution.
  const engaged = new Set();

  for (const raider of world.raiders) {
    // Somebody INDOORS is not in the fight. Same rule as the fox, and it is
    // what makes "get everyone home" a real answer to a raid rather than a
    // thing the player wishes they could do. It also stops raiders killing
    // the injured while they rest at the base, which is how the first version
    // managed to be lethal without ever feeling like a battle.
    const worker = world.workers.find(
      (w) =>
        healthOf(w) > 0 &&
        !engaged.has(w.id) &&
        !sheltered(world, w) &&
        distance(w, raider) <= FIGHT_RANGE
    );
    if (!worker) continue;
    engaged.add(worker.id);

    // Standing near a tower steadies you.
    const support = towers.reduce(
      (best, t) => (distance(t, worker) <= t.range ? Math.max(best, t.guards) : best),
      0
    );
    const defence = Math.min(0.85, defenceOf(world, worker) + support * 0.3);

    // Their turn — unless they are the one with the torch. A raider who has
    // come for a building is not also chasing farmers across it, and can be
    // hit back for free.
    //
    // MEASURED, and this is not a nicety. A torch-bearer walks further into
    // the settlement than a looter does and then stands on one spot for days,
    // so it picks up three or four times the contact a looter ever had: with
    // it fighting normally, a 220-day run went from 85 fights and NO deaths to
    // 122 fights and three. "A raid costs goods, not people" is the rule this
    // whole file is balanced around and there is a test that says so.
    const damage = raider.target && raider.target.want === "burn"
      ? 0
      : RAIDER_HIT * (1 - defence) * (hours === 24 ? 1 : 1 / 6);
    worker.health = Math.max(0, healthOf(worker) - damage);

    // And the worker's. An unarmed farmer is not helpless, but they are not
    // much more than an obstacle either — arming people is the point.
    const armed = worker.tool && TOOLS[worker.tool] && TOOLS[worker.tool].combat;
    const back = WORKER_HIT * (0.6 + defence) * (armed ? 1.8 : 1) * (hours === 24 ? 1 : 1 / 6);
    raider.health -= back;

    // A raider who is losing leaves. They came to rob a farm, not to die on
    // one — and "we drove them off" is a better outcome to play for than a
    // pile of bodies.
    if (raider.health > 0 && raider.health < RAIDER_HEALTH * RAIDER_BREAKS_AT
        && raider.state === "incoming") {
      raider.state = "leaving";
      raider.path = null;
      events.push({
        type: "raiderFled",
        q: raider.q, r: raider.r,
        text: `A raider has had enough of ${worker.name} and is pulling back.`,
      });
    }

    if (raider.health <= 0) {
      killed.add(raider.id);
      events.push({
        type: "raiderDown",
        q: raider.q, r: raider.r,
        text: `${worker.name} drove off a raider at ${raider.q},${raider.r}.`,
      });
    } else {
      events.push({
        type: "fought",
        q: worker.q, r: worker.r,
        text: `${worker.name} is fighting a raider at ${worker.q},${worker.r}.`,
      });
    }
  }

  if (killed.size) {
    // Anything a dead raider was carrying is dropped where they fell. A stolen
    // horse goes back to being a wild horse standing in your field, which is
    // a better outcome than losing it and a worse one than never losing it.
    for (const raider of world.raiders) {
      if (!killed.has(raider.id) || !raider.carrying) continue;
      if (raider.carrying.goods) {
        for (const [res, n] of Object.entries(raider.carrying.goods)) {
          addResource(world, res, n);
        }
        events.push({
          type: "raidRecovered",
          q: raider.q, r: raider.r,
          text: "What that one was carrying has been recovered.",
        });
      }
      if (raider.carrying.horseId) {
        const horse = (world.animals || []).find((a) => a.id === raider.carrying.horseId);
        if (horse) {
          // Yours again. It was `tamed = false` — loose, to be caught all over
          // again — which made killing the thief barely better than letting
          // them go. livestock.js walks it back to a paddock tomorrow.
          horse.stolen = false;
          horse.q = raider.q;
          horse.r = raider.r;
        }
      }
    }
    world.raiders = world.raiders.filter((r) => !killed.has(r.id));
  }

  events.push(...reapTheFallen(world));
  return events;
}

/**
 * One day of your people standing outside their camp.
 *
 * Resolved HERE rather than in workers.js or rivalcamp.js because this file
 * owns every combat number in the game, and a second definition of how a fight
 * goes is how the fox and the raider end up disagreeing about what a spear is
 * worth.
 *
 * The model is deliberately one roll for the whole party rather than a duel
 * each: what the player controls is how many people they sent and whether
 * those people have spears, so that is what the outcome should turn on.
 *
 *   attack   = sum over the party of (1 + their defence rating x 2)
 *   defence  = how many fighters the camp can still field
 *
 * Beat the defence and they get in: a building burns, goods come home, and a
 * defender is gone. Fail and the party simply takes another day of casualties,
 * which is what makes sending two unarmed farmers a genuinely bad idea.
 */
export function stepAssault(world, rnd, hours = 24) {
  const events = [];
  const groups = new Map();
  for (const w of world.workers || []) {
    if (w.state !== "storming") continue;
    const id = w.marching && w.marching.campId;
    const target = campById(world, id);
    if (!target || distance(w, w.marching) > 1) {
      w.giveUpAssault = true;
      continue;
    }
    const groupId = `${id}:${w.marching.q},${w.marching.r}`;
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(w);
  }
  for (const party of groups.values()) events.push(...assaultAt(world, rnd, party, campById(world, party[0].marching.campId), hours));
  return events;
}

function assaultAt(world, rnd, party, target, hours = 24) {
  const events = [];
  const camp = party[0].marching;
  const attacked = target.buildings.find(b => b.q === camp.q && b.r === camp.r && b.condition > 0);
  if (!attacked || (attacked.id === "camp" && target.buildings.some(b => b.id !== "camp" && b.condition > 0))) return events;
  // Even a failed attack ends a peaceful relationship.
  if (target.kind === "settler") {
    target.kind = "raider";
    target.turnedOn = world.day;
    world.caravans = (world.caravans || []).filter(c => c.campId !== target.id);
    events.push({ type: "hostility", text: `The settlers at ${target.home.q},${target.home.r} will no longer trade with you after this attack.` });
  }

  let attack = 0;
  for (const worker of party) {
    attack += ASSAULT_BASE + defenceOf(world, worker) * ASSAULT_ARMS +
      (worker.horseId ? ASSAULT_MOUNTED : 0);
  }
  const defence = Math.max(1, campDefence(target));

  const winning = attack > defence;

  if (winning) {
    const burned = burnSomething(world, target, camp, hours === 24 ? BURN_DAMAGE : 6 + party.length * 2);
    if (burned) {
      events.push({
        type: burned.razed ? "campRazed" : "campBurned",
        q: camp.q, r: camp.r,
        text: burned.routed
          ? "Their camp is burning and they have gone. The valley is yours for a while."
          : burned.razed
          ? `Your people burned their ${burned.label.toLowerCase()} to the ground.`
          : `Your people set fire to their ${burned.label.toLowerCase()}.`,
      });
    }

    if (burned?.razed && campById(world, target.id)) {
      const took = lootCamp(target, ASSAULT_LOOT * party.length);
      if (Object.keys(took).length) {
        for (const [res,n] of Object.entries(took)) addResource(world,res,n);
        events.push({
          type: "recovered",
          q: camp.q, r: camp.r,
          text: `They recovered ${Object.entries(took).map(([r,n]) => `${n} ${r}`).join(", ")}; excess above storage capacity was left behind.`,
        });
      }
      target.fighters = Math.max(0, (target.fighters || 0) - DEFENDERS_LOST);
      // Horses they took from you are standing in their camp.
      if ((target.horses || 0) > 0) {
        const pen = nearestPaddockTo(world, world.home || camp);
        const kept = (world.animals || []).filter((a) => a.species === "horse" && a.tamed && !a.riderId).length;
        if (pen && kept < stableCapacity(world)) {
          target.horses -= 1;
          world.animals.push({
            id: world.nextAnimalId++, species: "horse", q: pen.q, r: pen.r,
            energy: 14, cooldown: 0, bornOn: world.day, tamed: true,
          });
          events.push({
            type: "horseRecovered",
            q: camp.q, r: camp.r,
            text: "One of your stolen horses was found in their camp and led home.",
          });
        }
      }
    }
  }

  // Everybody takes something. Losing badly hurts far more than winning — but
  // not unboundedly, see WORST_ODDS.
  const odds = Math.min(WORST_ODDS, defence / Math.max(1, attack));
  for (const worker of party) {
    const damage = ASSAULT_HIT * odds * (1 - defenceOf(world, worker)) * (hours === 24 ? 1 : 1 / 6);
    if (damage > 0) worker.health = Math.max(0, healthOf(worker) - damage);
    // Days of getting nowhere, reset by any success. Same shape as the horse
    // chase: patience measures WASTED effort, not elapsed time, so a long
    // grinding siege that is actually working never times out.
    worker.stormDays = winning ? 0 : (worker.stormDays || 0) + hours / 24;
  }

  if (!winning) {
    events.push({
      type: "assaultRepulsed",
      q: camp.q, r: camp.r,
      text: `The camp is holding — ${plural(party.length, "attacker")} against ${defence} of them.`,
    });

    // Give up rather than standing there being whittled down. Without this the
    // only way an attack ended was every attacker being hurt badly enough to
    // retreat one at a time, which is a slow way of losing your settlement.
    if (party.every((w) => (w.stormDays || 0) >= ASSAULT_PATIENCE)) {
      for (const worker of party) worker.giveUpAssault = true;
      events.push({
        type: "assaultGaveUp",
        q: camp.q, r: camp.r,
        text: "The attack has failed. They are coming home.",
      });
    }
  }

  events.push(...reapTheFallen(world));
  return events;
}

/** Small local plural, so this file does not depend on the assistant. */
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Rivals advance hourly in the game; the optional daily step remains for batch callers.
 */
export function stepRaiders(world, rnd, hours = 24) {
  const events = [];
  if (!world.workers) return events;

  // Schedule the first one lazily, so an old save picks this up on load
  // without a migration having to guess a date. The camp is founded the same
  // way and for the same reason — a world made before the neighbours existed
  // and one made after behave identically on their first day.
  if (world.nextRaidDay === undefined || world.nextRaidDay === null) {
    scheduleRaid(world);
    // The valley fills itself on the first day either system runs, so a world
    // made before the neighbours existed and one made after behave identically.
    if (!world.valleySettled) events.push(...settleTheValley(world));
    return events;
  }

  world.raiders = world.raiders || [];

  // Time for one?
  if (world.raiders.length === 0 && world.day >= world.nextRaidDay) {
    world.raidAnnounced = false;
    events.push(...launchRaid(world, rnd));
    scheduleRaid(world);
  }

  if (world.raiders.length === 0) return events;

  for (const raider of world.raiders) {
    // Give-up counter, reset by any progress. See RAID_PATIENCE.
    const was = `${raider.q},${raider.r}`;

    if (raider.state === "incoming") {
      const arrived = moveRaider(world, raider, raider.target, hours);
      if (raider.breaching) {
        const { q, r, through } = raider.breaching;
        raider.breaching = null;
        events.push({
          type: through ? "barrierBroken" : "barrierAttacked",
          q, r,
          text: through
            ? `They have broken through the barrier at ${q},${r}.`
            : `Raiders are pulling at the barrier at ${q},${r}.`,
        });
      }
      const broke = (hours === 24 || world.hour === 0) ? vandalise(world, raider) : null;
      if (broke) events.push(broke);
      if (arrived) {
        if (!world.raidAnnounced) {
          world.raidAnnounced = true;
          events.push({
            type: "raidArrived",
            q: raider.q, r: raider.r,
            text: "Raiders are in among your buildings.",
          });
        }
        if (raider.target.want === "burn") {
          // They stay on it until it is a ruin, rather than taking a swing at
          // it on the way past. That is the whole difference between this and
          // vandalise, and it is what makes a raid something you can lose a
          // building to.
          events.push(...setFire(world, raider));
        } else {
          events.push(...loot(world, raider));
          raider.state = "leaving";
          raider.path = null;
        }
      }
    } else {
      const gone = moveRaider(world, raider, raider.home, hours);
      if (gone) raider.escaped = true;
    }

    if (`${raider.q},${raider.r}` === was) {
      raider.stuck = (raider.stuck || 0) + hours / 24;
    } else {
      raider.stuck = 0;
    }
  }

  // Anybody who has got nowhere for a fortnight gives up. Without this a
  // single unreachable party blocks every future raid, permanently.
  const givingUp = world.raiders.filter((r) => (r.stuck || 0) > RAID_PATIENCE);
  if (givingUp.length) {
    for (const raider of givingUp) raider.escaped = true;
    events.push({
      type: "raidGaveUp",
      q: givingUp[0].q, r: givingUp[0].r,
      text:
        givingUp.length === world.raiders.length
          ? "The raiders could not find a way in and have turned back."
          : "Some of the raiders could not get through and have turned back.",
    });
  }

  events.push(...fight(world, rnd, hours));

  // Anybody who made it off the board takes what they are holding with them.
  const escaped = world.raiders.filter((r) => r.escaped);
  if (escaped.length) {
    for (const raider of escaped) {
      // What they carried off ends up in their store — which is exactly where
      // a counter-raid goes to get it back. Goods that simply vanished would
      // make attacking their camp pointless.
      // Back to the camp THIS party came from — with several neighbours on the
      // board, crediting "the camp" would have one settlement's raid stocking
      // another's store, and a counter-raid would hit the wrong place.
      const owner = campById(world, raider.campId);
      if (owner && raider.reserved) owner.fighters = (owner.fighters || 0) + 1;
      if (raider.carrying && raider.carrying.goods && owner) {
        const total = Object.values(raider.carrying.goods).reduce((a, b) => a + b, 0);
        owner.stolenTotal = (owner.stolenTotal || 0) + total;
        for (const [resource, amount] of Object.entries(raider.carrying.goods)) creditCamp(owner, resource, amount);
      }
      if (raider.carrying && raider.carrying.horseId) {
        const id = raider.carrying.horseId;
        world.animals = (world.animals || []).filter((a) => a.id !== id);
        // Not gone for good any more: it stands in THEIR camp, and burning
        // that camp's buildings brings it home (assaultAt). A horse that
        // simply vanished made the counter-raid pointless for the one thing
        // players most wanted back.
        if (owner) owner.horses = (owner.horses || 0) + 1;
        recordHorseLoss(world, "stolen");
        events.push({
          type: "horseLost",
          reason: "stolen",
          q: raider.q, r: raider.r,
          text: owner
            ? `Your horse has been led off to village ${owner.id}. Burn them out and you can bring it back.`
            : "Your horse has gone over the hill with them.",
        });
      }
    }
    world.raiders = world.raiders.filter((r) => !r.escaped);
  }

  if (world.raiders.length === 0 && (escaped.length || events.length)) {
    world.raidsSurvived = (world.raidsSurvived || 0) + 1;
    events.push({
      type: "raidOver",
      text: "The raiders have gone.",
    });
  }

  return events;
}
