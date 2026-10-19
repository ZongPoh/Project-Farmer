import { stepWatchtowers } from "./towers.js";
import { stepCampWorkers } from "./campWorkers.js";
import { storageCapacity } from "./economy.js";
import { seasonOf } from "./calendar.js";
import { stepCampExpeditions } from "./campExpeditions.js";
import { stepPens, stepCoops } from "./pens.js";
import { stepLivestock } from "./livestock.js";
import { stepGround, openSeam, noteCleared } from "./ground.js";
import { stepMonument } from "./monument.js";
/**
 * Time.
 *
 * THE ATOM IS NOW THE HOUR, not the day. A day per unit of anything made the
 * game feel stalled: you pressed a button and one number moved. Production,
 * worker movement and job progress all run hourly, so there is always
 * something happening.
 *
 * What did NOT move to hours: animals, building wear, eating and recruiting.
 * Those have a genuinely daily rhythm — a rabbit does not breed hourly — and
 * stepping the ecosystem twenty-four times as often would mean retuning a
 * predator-prey balance that is currently stable and tested. So advanceHour
 * runs the daily systems once, when the date rolls over.
 *
 * advanceHour owns simulated time. Player actions change state synchronously.
 * That is what buys turn-based play, idle play and offline catch-up from the
 * same code, and it is worth protecting.
 */
import { findConversion, optionsFor, TERRAIN } from "./terrain.js";
import {
  getTile, getTerrain, touchTile, setTerrain, activeTiles, markActive, unmarkActive,
} from "./tiles.js";
import { produceHour, dailyWear, canAfford, BUILDINGS } from "./buildings.js";
import { stepAnimals } from "./animals.js";
import {
  stepWorkers, dailyWorkers, dispatch, recall, workersOn, workerAt,
  makeWorker, workerCapacity, homeOf,
} from "./workers.js";
import { canHunt, resolveHunt, foxAttacks, HUNT } from "./danger.js";
import { tidyOrders, evictOverflow } from "./horses.js";
import { dailyWounds } from "./healing.js";
import { stepRaiders, stepAssault } from "./rivals.js";
import { stepCamps, takeMigrant } from "./rivalcamp.js";
import {
  inTerritory, outsideReason, claimTile, isFrontier, isOwned,
} from "./territory.js";
import { mulberry32 } from "./noise.js";
import { stepConstruction } from "./construction.js";
import { dailyPrograms, recordMilestones } from "./management.js";

export const HOURS_PER_DAY = 24;

/** Real seconds per game day when the game is running itself. */
export const SECONDS_PER_DAY = 120;

/** Never simulate more than this on return, however long you were away. */
export const MAX_CATCHUP_DAYS = 120;
export const MAX_CATCHUP_HOURS = MAX_CATCHUP_DAYS * HOURS_PER_DAY;

/**
 * Begin a job on a tile.
 *
 * Costs are paid up front, so you cannot queue a dozen plantings on one seed.
 * A worker is dispatched immediately; if everyone is busy the job still
 * starts and simply makes no progress until somebody is free, which is
 * reported rather than silently ignored.
 */
export function startWork(world, q, r, conversionId) {
  const tile = getTile(world, q, r);
  if (!tile) return { ok: false, reason: "no such tile" };
  if (tile.work) return { ok: false, reason: "already being worked on" };
  if (tile.building) return { ok: false, reason: "clear the building there first" };

  // Your land, or nothing. This is the single line that turns the board from
  // a menu into a place — see territory.js.
  const outside = outsideReason(world, q, r);
  if (outside) return { ok: false, reason: outside };

  const conv = findConversion(conversionId);
  if (!conv) return { ok: false, reason: `unknown job "${conversionId}"` };
  if (conv.from !== tile.terrain) {
    return { ok: false, reason: `that job is for ${conv.from}, this is ${tile.terrain}` };
  }
  const option = optionsFor(world, tile).find((o) => o.id === conversionId);
  if (option.blockedBy) return { ok: false, reason: option.blockedBy };

  if (option.cost && !canAfford(world.store, option.cost)) {
    return { ok: false, reason: "you cannot afford that" };
  }
  if (option.cost) {
    for (const [res, n] of Object.entries(option.cost)) world.store[res] -= n;
  }

  const stored = touchTile(world, q, r);
  stored.work = {
    id: conv.id,
    to: conv.to,
    done: 0,
    needed: option.hours,
    yields: option.yields || null,
    startedOn: world.day,
    // A monotonic ticket number. world.day is not enough to order a queue —
    // you can start six jobs on the same day, and they should still be done
    // in the order you asked for them.
    seq: world.nextJobSeq = (world.nextJobSeq || 0) + 1,
  };
  markActive(world, q, r);

  const worker = dispatch(world, q, r);
  return {
    ok: true,
    hours: option.hours,
    worker,
    queued: !worker,
    // Not an error. The job is on the tile; the next worker to come free
    // picks it up, oldest first.
    reason: worker ? null : "everyone is busy — it is queued",
  };
}

/**
 * Send somebody to kill an animal.
 *
 * Deliberately the same machinery as any other job: it goes on the tile, it
 * costs worker-hours, it joins the queue, and the nearest free worker walks
 * there. Hunting is not a button that makes an animal vanish — it is work.
 */
export function startHunt(world, q, r) {
  const tile = getTile(world, q, r);
  if (!tile) return { ok: false, reason: "no such tile" };
  if (tile.work) return { ok: false, reason: "already being worked on" };

  const check = canHunt(world, q, r);
  if (!check.ok) return check;

  const stored = touchTile(world, q, r);
  stored.work = {
    id: "hunt",
    hunt: true,
    species: check.prey.species,
    to: null,
    done: 0,
    needed: check.spec.hours,
    startedOn: world.day,
    seq: world.nextJobSeq = (world.nextJobSeq || 0) + 1,
  };
  markActive(world, q, r);

  const worker = dispatch(world, q, r);
  return {
    ok: true,
    hours: check.spec.hours,
    species: check.prey.species,
    worker,
    queued: !worker,
    reason: worker ? null : "everyone is busy — it is queued",
  };
}

/**
 * Worker-hours to take a tile that has nothing else worth doing to it.
 *
 * THE ESCAPE HATCH, and the reason territory does not softlock the opening.
 * The border grows when you finish something on a tile — but plain grass has
 * no job on it unless you happen to be holding a seed, and sand next to no
 * water has none either. Without this, a settlement whose nineteen starting
 * tiles contained no forest and no quarriable rock could never expand, and
 * the game would simply stop with no explanation. Invariant 7 again: every
 * resource needs a source that does not cost that resource, and here the
 * resource is LAND.
 *
 * It is deliberately dull and slightly slow. Claiming should be the thing you
 * do when there is nothing better, not the thing you spam.
 */
export const CLAIM_HOURS = 10;

/**
 * WHAT LAND COSTS, once you hold a lot of it.
 *
 * The claim job used to be free at any size, so land was unlimited for a
 * patient player — one of the reasons the first playtest found the player
 * growing very fast. It now costs food, rising with how much you already
 * hold: nothing for the first CLAIM_FREE_UP_TO tiles you have worked, then
 * CLAIM_FOOD_STEP more for every CLAIM_STEP tiles beyond, up to CLAIM_FOOD_MAX.
 *
 * INVARIANT 11 STILL HOLDS: there must always be something claimable. If you
 * cannot pay, the claim is not refused — it goes ahead for free, the slow way,
 * at CLAIM_SLOW_FACTOR times the hours. Paying buys speed, never permission.
 * territory.test.mjs runs its 25 seeds against exactly that.
 */
export const CLAIM_FREE_UP_TO = 24;
export const CLAIM_STEP = 8;
export const CLAIM_FOOD_STEP = 3;
export const CLAIM_FOOD_MAX = 45;
export const CLAIM_SLOW_FACTOR = 3;

export function claimCost(world) {
  const held = world.owned ? world.owned.size : 0;
  const over = Math.max(0, held - CLAIM_FREE_UP_TO);
  const food = Math.min(CLAIM_FOOD_MAX, Math.ceil(over / CLAIM_STEP) * CLAIM_FOOD_STEP);
  const affordable = (world.store?.food || 0) >= food;
  return {
    food: affordable ? food : 0,
    hours: affordable ? CLAIM_HOURS : CLAIM_HOURS * CLAIM_SLOW_FACTOR,
    slow: !affordable,
    asking: food,
  };
}

export function canClaim(world, q, r) {
  const tile = getTile(world, q, r);
  if (!tile) return { ok: false, reason: "no such tile" };
  if (tile.work) return { ok: false, reason: "already being worked on" };
  if (isOwned(world, q, r)) return { ok: false, reason: "this is already yours" };
  if (!inTerritory(world, q, r)) {
    return { ok: false, reason: "too far — you can only take ground next to your own" };
  }
  const terrain = getTerrain(world, q, r);
  if (!TERRAIN[terrain] || !TERRAIN[terrain].walkable) {
    return { ok: false, reason: `nobody can stand on ${terrain} to claim it` };
  }
  return { ok: true };
}

/** Put a marker on the frontier and make the ground beyond it yours. */
export function startClaim(world, q, r) {
  const check = canClaim(world, q, r);
  if (!check.ok) return check;

  const cost = claimCost(world);
  if (cost.food) world.store.food -= cost.food;

  const stored = touchTile(world, q, r);
  stored.work = {
    id: "claim",
    // Like `hunt`, a job with no terrain change. tick.js owns what happens
    // when it finishes, so there is still exactly one place the world changes.
    claim: true,
    to: null,
    done: 0,
    needed: cost.hours,
    startedOn: world.day,
    seq: world.nextJobSeq = (world.nextJobSeq || 0) + 1,
  };
  markActive(world, q, r);

  const worker = dispatch(world, q, r);
  return {
    ok: true,
    hours: cost.hours,
    food: cost.food,
    slow: cost.slow,
    worker,
    queued: !worker,
    reason: worker ? null : "everyone is busy — it is queued",
  };
}

export function cancelWork(world, q, r) {
  const tile = getTile(world, q, r);
  if (!tile || !tile.work) return { ok: false, reason: "nothing in progress there" };

  // Send anyone standing there home rather than leaving them frozen on a job
  // that no longer exists.
  for (const w of world.workers) {
    if (w.job && w.job.q === q && w.job.r === r) recall(world, w);
  }

  touchTile(world, q, r).work = null;
  unmarkActive(world, q, r);
  return { ok: true };
}

/**
 * Move the world on by exactly one hour. Mutates `world` and returns the list
 * of things that happened.
 */
export function advanceHour(world) {
  const events = [];
  const previousStore = { ...world.store };

  world.hour = (world.hour || 0) + 1;
  const newDay = world.hour >= HOURS_PER_DAY;
  if (newDay) {
    events.push(...dailyPrograms(world));
    world.hour = 0;
    world.day += 1;
  }

  // Derived from the seed, the day AND the hour, so a replay is identical.
  const rnd = mulberry32(world.seed * 7919 + world.day * 31 + world.hour);

  // --- hourly ---------------------------------------------------------------
  events.push(...stepConstruction(world));
  if (world.store) events.push(...produceHour(world, rnd));
  if (world.workers) events.push(...stepWorkers(world, rnd));

  events.push(...stepRaiders(world, rnd, 1));
  events.push(...stepAssault(world, rnd, 1));
  events.push(...stepCampExpeditions(world));
  stepCampWorkers(world);
  events.push(...stepWatchtowers(world));

  // Terrain changes are settled here, by the one function that owns them.
  // stepWorkers marks a job finished; tick.js is what actually converts the
  // tile, so there is still exactly one place terrain changes.
  for (const tile of activeTiles(world)) {
    const job = tile.work;
    if (!job || !job.finished) continue;

    if (job.hunt) {
      // Whoever is standing there is the one who did it.
      const hunter = workerAt(world, tile.q, tile.r);
      if (hunter) events.push(...resolveHunt(world, hunter, rnd));
    } else if (job.claim) {
      // Nothing changes about the ground. What changes is whose it is.
      events.push({
        type: "claimed",
        q: tile.q, r: tile.r,
        text: `${tile.q},${tile.r} is yours now — the ground beyond it is open.`,
      });
    } else {
      setTerrain(world, tile.q, tile.r, job.to);
      // What the job left in the ground. A broken-down mountain becomes the
      // richest quarry there is; cleared ground is remembered so the wood can
      // take it back. Both live in ground.js; both are recorded HERE because
      // this is the moment the old terrain stops existing.
      if (job.id === "quarry") openSeam(world, tile);
      if (job.id === "clear") noteCleared(world, tile.q, tile.r);
    }

    // ANY finished job takes the tile, which is the rule the player is told:
    // finish something and the land around it opens up. `worked` records that
    // the claim came from labour rather than from a building, so demolishing
    // whatever gets built here later does not hand the ground back.
    if (!job.hunt) {
      tile.worked = true;
      claimTile(world, tile.q, tile.r);
    }

    tile.work = null;
    unmarkActive(world, tile.q, tile.r);
  }

  // --- daily ----------------------------------------------------------------
  if (newDay) {
    events.push(...dailyWear(world));
    // The ground before the people: a stand that grew overnight is a stand
    // this morning's woodcutter can cut. Terrain changes are applied here
    // rather than inside ground.js, so setTerrain still has exactly one
    // caller in the simulation.
    {
      const ground = stepGround(world);
      events.push(...ground.events);
      for (const spot of ground.regrown) setTerrain(world, spot.q, spot.r, "forest");
    }
    // The masons before the meal, so a day that cannot feed everybody has
    // already spent what the monument took. It keeps a reserve back precisely
    // so that ordering can never be the thing that starves anyone.
    events.push(...stepMonument(world));
    if (world.workers) events.push(...dailyWorkers(world, rnd));
    if (world.animals) {
      // People have eaten; now the animals you keep. Kept animals are fed
      // from the store here and are invisible to the wild ecology below.
      events.push(...stepLivestock(world, rnd));
      events.push(...stepPens(world));
      // Coops after the pens and BEFORE the wild animals move, so the fox that
      // takes a hen is one that was standing near the coop when the day began
      // rather than one that happens to walk past during it.
      events.push(...stepCoops(world, rnd));
      events.push(...stepAnimals(world, rnd));
    }
    // After the animals have moved, so a fox that walked onto somebody is
    // the one that gets the chance.
    if (world.workers && world.animals) events.push(...foxAttacks(world, rnd));

    // Wounds turn bad BEFORE the rivals arrive, so a worker who was already
    // in trouble is in trouble when they get here rather than a day later.
    if (world.workers) events.push(...dailyWounds(world, rnd));

    // The rivals move after the animals and after the foxes, so a raider and
    // a fox never both claim the same worker's last few points of health in an
    // order that depends on which list happened to be walked first.
    // Raider movement and skirmishes now resolve hourly above.

    // Your war party fights before their day is worked out, so a camp that
    // lost a field this morning is a camp with less to eat tonight.
    // Assaults resolve against the actual building reached, hourly.

    // ...and the neighbours' own day runs AFTER both, so a party that was just
    // driven off is reflected in the strength that feeds them tonight.
    if (world.workers) events.push(...stepCamps(world, rnd));

    // Somebody walked back with a caravan and asked for work. Only if there is
    // room and food for them — a gift that starves the settlement is not one.
    if (world.workers && seasonOf(world.day).id !== "winter" && takeMigrant(world)) {
      const cap = workerCapacity(world);
      if (world.workers.length < cap.cap) {
        const home = homeOf(world);
        const joined = makeWorker(world, home.q, home.r);
        events.push({
          type: "migrant",
          q: home.q, r: home.r,
          text: `${joined.name} came back with the caravan and asked to stay.`,
        });
      }
    }

    // AFTER dailyWear, because a paddock that rotted below a whole stall this
    // morning is a paddock with one fewer horse in it tonight.
    if (world.animals) events.push(...evictOverflow(world));
    tidyOrders(world);
  }

  // Applies to foraging, loot, job yields and caravan deliveries as well.
  // Legacy overflow is kept; capacity loss never deletes already stored goods.
  for (const [resource, cap] of Object.entries(storageCapacity(world))) {
    world.store[resource] = Math.min(world.store[resource] || 0, Math.max(cap, previousStore[resource] || 0));
  }
  events.push(...recordMilestones(world));
  return events;
}

/** Run several hours at once. */
export function advanceHours(world, count) {
  const n = Math.max(0, Math.min(count, MAX_CATCHUP_HOURS));
  const events = [];
  for (let i = 0; i < n; i++) events.push(...advanceHour(world));
  return { events, hoursRun: n, capped: count > MAX_CATCHUP_HOURS };
}

/**
 * Move the world on by one whole day.
 *
 * Kept because a day is still the unit people think in — the button says
 * "advance a day", seasons turn on days, and every existing test speaks days.
 * It is twenty-four hours, nothing more.
 */
export function advanceDay(world) {
  const events = [];
  for (let i = 0; i < HOURS_PER_DAY; i++) events.push(...advanceHour(world));
  return events;
}

export function advanceDays(world, count) {
  const n = Math.max(0, Math.min(count, MAX_CATCHUP_DAYS));
  const events = [];
  for (let i = 0; i < n; i++) events.push(...advanceDay(world));
  return { events, daysRun: n, capped: count > MAX_CATCHUP_DAYS };
}

/** How many whole days passed in the real world since a saved timestamp. */
export function daysSince(savedAtMs, nowMs = Date.now()) {
  return Math.floor((nowMs - savedAtMs) / (SECONDS_PER_DAY * 1000));
}

/** ...and how many hours, which is what offline catch-up actually replays. */
export function hoursSince(savedAtMs, nowMs = Date.now()) {
  const secondsPerHour = SECONDS_PER_DAY / HOURS_PER_DAY;
  return Math.floor((nowMs - savedAtMs) / (secondsPerHour * 1000));
}

export { workersOn };
export { HUNT, canHunt } from "./danger.js";
