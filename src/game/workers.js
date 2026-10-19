import { addResource, storageCapacity } from "./economy.js";
import { operational } from "./construction.js";
import { extraHousing, RESIDENT_FOOD, dailyFoodFor } from "./economy.js";
import { seasonOf } from "./calendar.js";
/**
 * Workers: the people who actually do the work.
 *
 * Before this, starting a job was a decision and then a wait. Now it is a
 * decision, someone walking there, and then a wait — which is the difference
 * between a spreadsheet and a place.
 *
 * WHAT WORKERS DO AND DO NOT GATE. Workers are needed for JOBS: converting
 * terrain, planting, clearing. Buildings, once they exist, produce on their
 * own. That keeps the game idle-friendly — you can leave it running and the
 * economy still ticks — while making people the thing you direct.
 *
 * A job costs WORKER-HOURS, not elapsed hours. One worker on the tile
 * contributes 1 an hour, so two workers halve the wait. That single change is
 * what makes a second worker feel worth having.
 *
 * Workers live in `world.workers` as a flat array, for the same reason
 * animals do: a worker moves, a tile does not.
 */
import { key, neighbors, distance } from "./hex.js";
import { travelBonus } from "./management.js";
import { getTerrain, getTile, touchTile, activeTiles } from "./tiles.js";
import { TERRAIN, moveCost } from "./terrain.js";
import { BUILDINGS, blocksMovement } from "./buildings.js";
import {
  workRate, equipFor, unequip, baseHouses, hireCostFor, canTrain, trainCostFor,
  wearTool, bestWeapon,
} from "./base.js";
import { canAfford, stableCapacity } from "./buildings.js";
import { freeHorse } from "./livestock.js";
import { shouldRetreat, isRecovered, restHour } from "./danger.js";
import { careHour, sickbayFor } from "./healing.js";
import { campById, assaultTarget } from "./rivalcamp.js";
import {
  nextOpenOrder, nearestWildHorse, catchChanceFor, ridingBonus, horseById,
  CATCH_PATIENCE, BOLT_DISTANCE,
} from "./horses.js";

/** Movement points a worker gets each day on foot. One point accrues per hour. */
export const FOOT_SPEED = 24;

/** ...and mounted. A horse doubles travel speed. */
export const HORSE_SPEED = 48;

/** Food one worker eats a day. A farm makes 24 a day, so it feeds four. */
export const FOOD_PER_WORKER = RESIDENT_FOOD;

/** Food in the store needed before another worker will come and join you. */
export const RECRUIT_FOOD = 30;

/** Hours between one worker arriving and the next being considered. */
export const RECRUIT_HOURS = 12;

/** Workers your base supports. Raised by base levels in a later pass. */
export const BASE_WORKER_CAP = 4;

/**
 * Idle workers repair things on their own.
 *
 * This is what makes it an idle game rather than a queue of chores: you leave
 * it running, and the people you already have keep the place standing instead
 * of loitering at the base while the farms rot. Anything you dispatch by hand
 * outranks it, so it never gets in your way.
 */
export const AUTO_REPAIR_BELOW = 70;   // leave it alone until it is actually worn
export const REPAIR_PER_HOUR = 8;      // condition restored per worker-hour
export const REPAIR_WOOD_PER_HOUR = 0.25;

/**
 * Foraging — what an idle worker does when there is nothing to mend.
 *
 * Added after measuring, not on a hunch: in a realistic settlement over two
 * simulated years, workers were out of the base 2% of the time. Everything
 * built on being in the field — the fox, the horse, the whole map — was
 * therefore inert, and four people stood around a fire all year.
 *
 * The yield is deliberately small. This is not an alternative to farming; it
 * is a reason to be outdoors, which is what makes the rest of the game happen.
 */
// Range is in TILES. At the current walking speed, four tiles is a four-hour
// outward journey over open ground; rough terrain and hunger make it longer.
export const FORAGE_RANGE = 4;
export const FORAGE_HOURS = 4;   // spent at the spot before coming back
// Faster travel must not turn idle foraging into a replacement for farming.
// One food per trip keeps it useful while remaining below a worker's upkeep.
export const FORAGE_FOOD = 1;    // per trip, from grass or forest
export const FORAGE_SEED_CHANCE = 0.15; // in forest only
// Herbs are the one thing foraging produces that you cannot get any other
// way, which is what stops foraging being purely what idle people do when
// there is nothing better. A settlement with hurt people has a reason to send
// somebody out.
export const FORAGE_HERB_CHANCE = 0.2;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// --- who exists ------------------------------------------------------------

export function makeWorker(world, q, r) {
  const worker = {
    id: world.nextWorkerId++,
    name: workerName(world.nextWorkerId - 1),
    q, r,
    // idle | travelling | working | returning
    state: "idle",
    target: null,     // {q,r} the tile being walked to
    job: null,        // {q,r} of the tile being worked
    move: 0,          // movement points banked, spent 1+ per step
    path: null,       // the remaining steps of a plotted route
    horseId: null,
    hungry: false,
    health: 100,
    skills: {},       // trained at the base; see base.js
    tool: null,       // claimed from the pool for the job in hand
    joinedOn: world.day,
  };
  world.workers.push(worker);
  return worker;
}

const NAMES = [
  "Ada", "Bram", "Cira", "Dov", "Esa", "Fen", "Gwen", "Hal", "Isa", "Jori",
  "Kit", "Lune", "Mira", "Nils", "Odd", "Pell", "Quin", "Rhys", "Sila", "Tove",
];
export const workerName = (n) => NAMES[(n - 1) % NAMES.length] + (n > NAMES.length ? ` ${Math.ceil(n / NAMES.length)}` : "");

export const workerAt = (world, q, r) =>
  world.workers.find((w) => w.q === q && w.r === r) || null;

export const idleWorkers = (world) => world.workers.filter((w) => w.state === "idle");

/**
 * Is this worker free of anything the player asked for?
 *
 * Not the same as `state === "idle"`. A worker with nothing assigned still
 * potters about — mending, foraging, walking home — so "idle" is a fleeting
 * state rather than a resting one. What callers and tests usually mean is
 * "available", and that is this.
 */
export const isAvailable = (worker) =>
  !worker.job &&
  !["working", "travelling", "training", "goingHome", "resting", "catching",
    "marching", "storming"].includes(worker.state);

/**
 * Workers you are allowed to interrupt, worst-priority first.
 *
 * Repairing is a chore a worker picked up on its own, so a job you asked for
 * beats it. An explicit dispatch should never be refused because someone
 * wandered off to hammer a fence.
 */
export const availableWorkers = (world) => [
  ...world.workers.filter((w) => w.state === "idle"),
  // Anything a worker chose for itself can be interrupted: mending, walking
  // to something to mend, foraging, or wandering back. Leaving foraging off
  // this list meant a worker who had strolled off could not be given a job
  // at all, which — with foraging as the default idle behaviour — was very
  // nearly all of them.
  ...world.workers.filter(
    (w) =>
      w.state === "repairing" ||
      w.state === "travellingToChore" ||
      w.state === "foraging" ||
      w.state === "returning" ||
      w.chore
  ),
];

/**
 * How many workers the settlement can support.
 *
 * Two ceilings, and the lower one wins: what the base can house, and what the
 * food can feed. This is your point about population following resources —
 * the food ceiling is the one that actually binds in practice.
 */
export function workerCapacity(world) {
  const foodPerDay = foodIncomePerDay(world);
  // The largest settlement this food can feed, with upkeep rising with size
  // (economy.js, residentFood). A short count up; populations are small.
  let byFood = 1;
  while (byFood < 500 && dailyFoodFor(byFood + 1) <= foodPerDay) byFood++;

  /*
   * THE BASE TIER IS THE CEILING, AND HOUSES FILL IT IN.
   *
   * It used to be `tier + 4 per house`, with nothing limiting how many houses
   * you built — so the tier was a small addend rather than a ceiling and the
   * whole ladder in BASE_LEVELS meant nothing. MEASURED (scratch/pace.mjs, the
   * greedy bot, three seeds): a "Hamlet" of 15 people and 31 buildings on day
   * 35, a "Village" of 20 on day 60, and 55 people standing in a Village when
   * Town was finally unlocked on day 134. The label described something a
   * quarter of the size of the thing on the ground, and "Town — as large as
   * this valley will hold" was holding 55 people before it was built.
   *
   * Now: the base's own roof sleeps BASE_WORKER_CAP, each house sleeps four
   * more, and the TIER caps the total at 4 / 7 / 11 / 16 / 22. Houses are how
   * you reach your tier's number; they can never take you past it. So a Camp
   * that wants more hands has to become a Homestead, which is what the levels
   * were for. Five houses fills a Town and a sixth is a waste, which is a far
   * better thing for a player to learn than "build houses forever".
   */
  const hasBase = activeTiles(world).some(t => operational(t.building) && t.building.id === "base");
  const beds = hasBase ? BASE_WORKER_CAP + extraHousing(world) : 0;
  const tier = hasBase ? baseHouses(world) : 0;
  const byBase = Math.min(tier, beds);
  return {
    cap: Math.min(byFood, byBase),
    byFood,
    byBase,
    beds,
    tier,
    foodPerDay,
    // Which ceiling is actually binding. Lives here rather than in
    // workerSummary so there is only one definition of it. "houses" and "base"
    // are both housing, and they want opposite things from the player: one
    // says build a house, the other says the base itself is as big as it gets.
    limitedBy: byFood <= byBase ? "food" : (beds < tier ? "houses" : "base"),
  };
}

/** Food the standing farms make in a day, at their current condition. */
export function foodIncomePerDay(world) {
  let perHour = 0;
  for (const tile of activeTiles(world)) {
    const b = tile.building;
    if (!operational(b) || !BUILDINGS[b.id].yields) continue;
    const food = BUILDINGS[b.id].yields.food;
    if (food) perHour += food * (b.condition / 100);
  }
  return perHour * 24;
}

// --- movement --------------------------------------------------------------

export const canWalk = (world, q, r, actor = "friendly") => {
  const terrain = getTerrain(world, q, r);
  return terrain !== null && TERRAIN[terrain].walkable && (actor === "siege" || !blocksMovement(world, q, r, actor));
};


/**
 * A real path, not a greedy walk.
 *
 * The first version of this stepped to whichever neighbour was closest to the
 * goal, which deadlocks the moment the direct route is blocked: the worker
 * banks movement forever and never moves, because no neighbour is an
 * improvement. A lake between you and the job was enough to do it.
 *
 * A* over walkable tiles, bounded so a hopeless search on a 400x200 board
 * cannot stall a frame. Forest costs 2, everything else 1, so paths naturally
 * prefer open ground and go round woods rather than through them.
 *
 * WHY A*, NOT DIJKSTRA. This was plain Dijkstra, and it was measured at 194ms
 * PER SIMULATED DAY on a 40x28 board once the farms were old enough to need
 * mending — against 3ms with auto-repair switched off, a sixty-fold
 * difference. Dijkstra expands outward in every direction until it happens to
 * meet the goal, so a worker walking to a farm they can see explored most of
 * the map to get there, several times an hour.
 *
 * The fix is one extra term: order the frontier by cost-so-far PLUS the hex
 * distance remaining. That heuristic never over-estimates — hex distance is
 * the fewest possible steps and the cheapest terrain costs 1 — so the path
 * found is still the genuinely shortest one; the search simply stops wandering
 * off in the wrong direction. Do not replace `distance` here with anything
 * that could exceed the true remaining cost, or paths silently stop being
 * optimal.
 *
 * This matters beyond frame time: offline catch-up replays up to 120 days in
 * one go, and at 194ms a day that is twenty-three seconds of a frozen screen
 * on return.
 *
 * WHY THE FRONTIER IS A HEAP. It was a linear scan, with a comment saying that
 * was "fine at these distances" and that a heap "would be more code than the
 * search itself is worth". That was true on a 24x16 board and wrong on a
 * 400x200 one: individual hours were measured at 25-35ms, and the board cost
 * 104ms a simulated day against 3-5ms on every smaller size. A search that
 * expands its full 3000-node budget does 3000 pops, and each pop was scanning
 * a frontier a couple of hundred entries long.
 *
 * With a binary heap that is 3000 x log2(3000) instead of 3000 x 200 — the
 * same board now costs about 8ms a day. Thirty lines, and they buy the largest
 * board size the game offers.
 */

/**
 * A binary min-heap on `f`. Deliberately not a class and deliberately not
 * generic: this is the hottest loop in the game and it has exactly one caller.
 */
function heapPush(heap, node) {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].f <= heap[i].f) break;
    const swap = heap[parent];
    heap[parent] = heap[i];
    heap[i] = swap;
    i = parent;
  }
}

function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let small = i;
      if (left < heap.length && heap[left].f < heap[small].f) small = left;
      if (right < heap.length && heap[right].f < heap[small].f) small = right;
      if (small === i) break;
      const swap = heap[small];
      heap[small] = heap[i];
      heap[i] = swap;
      i = small;
    }
  }
  return top;
}
export function findPath(world, from, to, limit = 3000, actor = "friendly") {
  if (from.q === to.q && from.r === to.r) return [];
  if (!canWalk(world, to.q, to.r, actor)) return null;

  const startKey = key(from.q, from.r);
  const goalKey = key(to.q, to.r);
  const dist = new Map([[startKey, 0]]);
  const prev = new Map();
  // Entries carry `d` (cost so far) and `f` (cost so far + optimistic guess).
  const frontier = [];
  heapPush(frontier, { q: from.q, r: from.r, d: 0, f: distance(from, to) });
  let visited = 0;
  let reached = false;

  while (frontier.length && visited < limit) {
    const cur = heapPop(frontier);
    const ck = key(cur.q, cur.r);
    if (cur.d > (dist.get(ck) ?? Infinity)) continue;
    visited++;

    if (ck === goalKey) {
      reached = true;
      break;
    }

    for (const n of neighbors(cur.q, cur.r)) {
      if (!canWalk(world, n.q, n.r, actor)) continue;
      const nk = key(n.q, n.r);
      const nd = cur.d + moveCost(getTerrain(world, n.q, n.r));
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, ck);
        heapPush(frontier, { q: n.q, r: n.r, d: nd, f: nd + distance(n, to) });
      }
    }
  }

  if (!reached) return null;

  const path = [];
  let k = goalKey;
  while (k !== startKey) {
    const [q, r] = k.split(",").map(Number);
    path.unshift({ q, r });
    k = prev.get(k);
    if (k === undefined) return null;
  }
  return path;
}

/**
 * Where a worker actually stands to do a job.
 *
 * You cannot stand on a mountain to quarry it, or on open water to drain it —
 * both are unwalkable, which would have left those two jobs permanently
 * unreachable. So the work spot is the tile itself when you can stand on it,
 * and the nearest walkable neighbour when you cannot.
 */
export function workSpotFor(world, q, r, from = null) {
  if (canWalk(world, q, r)) return { q, r };
  if (from) {
    const choices = neighbors(q, r).filter(n => canWalk(world, n.q, n.r))
      .map(n => ({ spot: n, path: findPath(world, from, n) }))
      .filter(c => c.path !== null)
      .map(c => ({ ...c, cost: c.path.reduce((sum, n) => sum + moveCost(getTerrain(world, n.q, n.r)), 0) }));
    choices.sort((a, b) => a.cost - b.cost);
    return choices[0]?.spot || null;
  }
  for (const n of neighbors(q, r)) {
    if (canWalk(world, n.q, n.r)) return { q: n.q, r: n.r };
  }
  return null;
}

/**
 * How far someone gets in a day.
 *
 * Horsemanship multiplies the MOUNTED figure only. Training it does nothing
 * for somebody on foot, which is what stops it being a strictly-better
 * alternative to labour for a settlement with no horses.
 */
export const speedOf = (worker) =>
  worker.horseId ? HORSE_SPEED * ridingBonus(worker) : FOOT_SPEED;

/**
 * Spend banked movement following the worker's path.
 * Returns true once they are standing on the target.
 */
function followPath(world, worker) {
  if (!worker.path || worker.path.length === 0) return true;

  // Walk as far as the banked movement allows this hour. A mounted worker
  // covers several tiles at once, which is the point of the horse.
  while (worker.path.length > 0) {
    const next = worker.path[0];
    const cost = moveCost(getTerrain(world, next.q, next.r));
    if (!canWalk(world, next.q, next.r)) {
      // The ground changed under the plan — flooded, or built on. Replan.
      worker.path = null;
      return false;
    }
    if (worker.move < cost) return false;
    worker.move -= cost;
    worker.q = next.q;
    worker.r = next.r;
    worker.path.shift();
  }
  return true;
}

/** Plot a course, or give up and go idle if there is no way through. */
function setCourse(world, worker, to) {
  worker.target = to;
  worker.path = findPath(world, worker, to);
  return worker.path !== null;
}

// --- jobs ------------------------------------------------------------------

/** The tile a worker should go home to when it has nothing to do. */
export function homeOf(world) {
  for (const tile of activeTiles(world)) {
    if (tile.building && tile.building.id === "base") return { q: tile.q, r: tile.r };
  }
  return world.home;
}

/**
 * Send someone to a job. Picks the nearest idle worker.
 *
 * Returns the worker, or null if everyone is busy — which the UI reports, so
 * "nothing is happening" always has a reason attached to it.
 */
/**
 * Put one worker on one job. Returns true if they took it.
 *
 * Shared by `dispatch` (the player starting a job) and by idle workers
 * picking up an unstaffed one, so both routes behave identically.
 */
/** Check all living workers, including busy ones, before declaring access blocked. */
export function jobHasAccess(world, q, r) {
  return (world.workers || []).some(w => {
    if (w.health <= 0) return false;
    const spot = workSpotFor(world, q, r, w);
    return spot && findPath(world, w, spot) !== null;
  });
}

function noteJobRouteFailure(world, worker, q, r) {
  const job = getTile(world, q, r)?.work;
  if (!job) return;
  job.lastPathFail = world.day;
  job.routeFailures = { ...job.routeFailures, [worker.id]: world.day };
  if (!jobHasAccess(world, q, r)) job.accessBlocked = true;
}

export function retryJobAccess(world, q, r) {
  const job = getTile(world, q, r)?.work;
  if (!job) return { ok: false, reason: "This job no longer exists." };
  if (!(world.workers || []).some(w => w.health > 0)) return { ok: false, reason: "You need a living worker before checking access." };
  if (!jobHasAccess(world, q, r)) {
    job.accessBlocked = true;
    return { ok: false, reason: "Still unreachable. Open a route or a place to stand beside the job, then check again." };
  }
  job.accessBlocked = false;
  job.routeFailures = {};
  delete job.lastPathFail;
  dispatch(world, q, r);
  return { ok: true, reason: "Route found. The job is ready for an available worker." };
}

export function assignTo(world, worker, q, r) {
  if (getTile(world, q, r)?.work?.accessBlocked) return false;
  // Where they will actually stand — the tile itself if it is walkable, a
  // neighbour if it is a mountain or a lake.
  const spot = workSpotFor(world, q, r, worker);
  if (!spot) { noteJobRouteFailure(world, worker, q, r); return false; }

  // Whatever they had wandered off to do, they are not doing it now.
  worker.forageHours = 0;

  // Somebody already standing there starts NOW. Sending them on a journey of
  // zero tiles cost an hour of "arriving" and made every job take one hour
  // longer than it advertised.
  if (worker.q === spot.q && worker.r === spot.r) {
    worker.job = { q, r };
    worker.chore = null;
    worker.state = "working";
    worker.target = spot;
    worker.path = [];
    return true;
  }

  if (!setCourse(world, worker, spot)) {
    noteJobRouteFailure(world, worker, q, r);
    worker.state = "idle";
    worker.job = null;
    worker.target = null;
    return false;
  }

  worker.job = { q, r };
  worker.chore = null;
  worker.state = "travelling";
  return true;
}

/**
 * Send someone to a job. Picks the nearest available worker.
 *
 * Returns the worker, or null if everyone is busy. A job with nobody on it is
 * NOT lost — it stays on the tile and the next worker to come free picks it
 * up, see findOpenJob. Before that existed, dispatching once and failing left
 * the job sitting there for the rest of the game while people stood idle.
 */
export function dispatch(world, q, r) {
  const available = availableWorkers(world);
  if (available.length === 0) return null;

  // Nearest first, but never prefer someone mid-chore over someone idle:
  // availableWorkers already lists the idle ones first, so only beat the
  // incumbent on a strictly shorter walk.
  let best = available[0];
  let bestD = distance(best, { q, r });
  for (const w of available) {
    const d = distance(w, { q, r });
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }

  for (const worker of [best, ...available.filter(w => w !== best)]) {
    if (assignTo(world, worker, q, r)) return worker;
    if (getTile(world, q, r)?.work?.accessBlocked) break;
  }
  return null;
}

/** How many workers are on their way to, or already on, this job. */
export function staffOn(world, q, r) {
  let n = 0;
  for (const w of world.workers) {
    if (!w.job || w.job.q !== q || w.job.r !== r) continue;
    if (w.state === "travelling" || w.state === "working") n++;
  }
  return n;
}

/**
 * The job an idle worker should pick up, or null.
 *
 * THE QUEUE. Jobs are not assigned once and forgotten — every job sits on its
 * tile until somebody does it, and whoever comes free next looks here first.
 * Ordering, in strict priority:
 *
 *   1. Player priority first (Urgent, High, Normal), then FEWEST WORKERS ALREADY ON IT. Three jobs and three workers should mean
 *      three jobs progressing, not all three people on the first one.
 *   2. OLDEST FIRST, by the sequence number stamped when the job was started.
 *      That makes it a real queue: what you asked for first gets done first.
 *   3. NEAREST, only to break a tie between equals.
 *
 * Unreachable jobs wait for the player to restore access and resume them.
 * A worker-specific failed route must not prevent other workers taking a job.
 */
export function findOpenJob(world, from) {
  let best = null;
  let bestKey = null;

  for (const tile of activeTiles(world)) {
    const job = tile.work;
    if (!job || job.finished) continue;
    if (job.accessBlocked || job.routeFailures?.[from.id] === world.day) continue;

    const k = [-(job.priority || 0), staffOn(world, tile.q, tile.r), job.seq || 0, distance(from, tile)];
    const firstDifference = bestKey ? k.findIndex((v, i) => v !== bestKey[i]) : -1;
    if (!bestKey || (firstDifference >= 0 && k[firstDifference] < bestKey[firstDifference])) {
      bestKey = k;
      best = { q: tile.q, r: tile.r };
    }
  }
  return best;
}

// --- standing orders -------------------------------------------------------
//
// The bridge between the order queue in horses.js and the worker state
// machine. Kept here rather than there because these three need to write to a
// worker, and horses.js deliberately knows nothing about the shape of one.

/**
 * Put an idle worker on the oldest unclaimed catch order, if there is one and
 * there is a horse within reach. Returns true if they took it.
 */
export function takeCatchOrder(world, worker, events = null) {
  const order = nextOpenOrder(world);
  if (!order || order.kind !== "catch") return false;

  let horse;
  if (order.horseId != null) {
    // A marked order: this horse and no other.
    horse = horseById(world, order.horseId);
    if (!horse || horse.tamed) {
      order.done = true;
      if (events) events.push({
        type: "catchTargetGone",
        q: worker.q, r: worker.r,
        text: "The horse you marked is gone, so nobody went after it.",
      });
      return false;
    }
    if (horse.claimedBy) return false;
  } else {
    // No range limit: this is an instruction, not a whim. See CATCH_RANGE.
    horse = nearestWildHorse(world, worker);
  }
  // Nothing left to catch is not a failure of the order — it stays queued,
  // and horses breed.
  if (!horse) return false;
  if (!setCourse(world, worker, { q: horse.q, r: horse.r })) return false;

  order.takenBy = worker.id;
  // Claiming it stops the rest of the settlement setting off after the same
  // animal the moment they come free.
  horse.claimedBy = worker.id;
  worker.catching = {
    horseId: horse.id,
    aim: { q: horse.q, r: horse.r },
    hours: 0,
    best: distance(worker, horse),
  };
  worker.chore = null;
  worker.state = "catching";
  return true;
}

/**
 * Put an idle worker on the oldest unclaimed war-party order.
 *
 * The march is a plain walk to a known place, so unlike the horse chase there
 * is nothing to re-plan: the camp does not move. What it does need is the same
 * discipline as every other order — it queues, it can be given up on, and the
 * order goes back if the worker cannot get there.
 */
export function takeWarOrder(world, worker) {
  const order = nextOpenOrder(world);
  if (!order || order.kind !== "warparty") return false;

  // The order names the camp it was issued against. It may have been burned
  // out by somebody else, or starved itself out, while this sat in the queue.
  const target = campById(world, order.campId);
  if (!target) {
    order.done = true;
    return false;
  }

  const camp = assaultTarget(target, worker);
  if (!camp) { order.done = true; return false; }
  const spot = workSpotFor(world, camp.q, camp.r, worker);
  if (!spot || !setCourse(world, worker, spot)) {
    // No way through. Drop the order rather than leaving it to be retried by
    // every idle worker every hour — the same lesson as `lastPathFail`.
    order.done = true;
    return false;
  }

  order.takenBy = worker.id;
  // They take a weapon if there is one spare. This is the single biggest
  // factor in whether the attack works, and it is why the workshop matters.
  if (!worker.tool) {
    const spear = bestWeapon(world);
    if (spear) worker.tool = spear;
  }
  worker.chore = null;
  worker.marching = { q: camp.q, r: camp.r, campId: target.id };
  worker.state = "marching";
  return true;
}

/** Their order is finished — mark it done so it stops being handed out. */
function completeOrder(world, worker) {
  const order = (world.orders || []).find((o) => o.takenBy === worker.id && !o.done);
  if (order) order.done = true;
}

/** They gave up. The order goes back on the queue for somebody else. */
function releaseOrder(world, worker) {
  const order = (world.orders || []).find((o) => o.takenBy === worker.id && !o.done);
  if (order) order.takenBy = null;
}

/**
 * Let go of a horse this worker was chasing.
 *
 * Must be called from EVERY path that takes a worker off a chase — recall,
 * retreating hurt, and dying. A claim left on a horse after its pursuer has
 * gone makes that animal permanently uncatchable, and nothing in the game
 * would ever tell you why.
 */
export function abandonWar(world, worker) {
  if (!worker.marching && worker.state !== "storming" && worker.state !== "marching") return;
  const order = (world.orders || []).find((o) => o.takenBy === worker.id && !o.done);
  if (order) order.done = true; // the attack is off for this one, not requeued
  worker.marching = null;
}

export function abandonChase(world, worker) {
  if (!worker.catching) return;
  const horse = horseById(world, worker.catching.horseId);
  if (horse) horse.claimedBy = null;
  const order = (world.orders || []).find((o) => o.takenBy === worker.id && !o.done);
  if (order) order.takenBy = null;
  worker.catching = null;
}

/** Take a worker off whatever it was doing and send it home. */
export function recall(world, worker) {
  abandonChase(world, worker);
  abandonWar(world, worker);
  worker.state = "returning";
  worker.job = null;
  worker.chore = null;
  unequip(worker);
  setCourse(world, worker, homeOf(world));
}

/**
 * The building most worth walking to and fixing, or null.
 *
 * Worst condition first, then nearest — a barely-scratched farm next door
 * matters less than the one about to stop working across the valley. Returns
 * nothing if there is no wood, because a worker standing at a ruin with
 * nothing to mend it with is worse than one waiting at home.
 */
export function findRepairChore(world, from) {
  if ((world.store.wood || 0) < 1) return null;
  if (world.autoRepair === false) return null;

  let best = null;
  let bestScore = Infinity;

  const reserved = new Set(world.workers.filter(w => w.id !== from.id &&
    (w.state === "repairing" || w.state === "travellingToChore") && w.chore)
    .map(w => `${w.chore.q},${w.chore.r}`));

  for (const tile of activeTiles(world)) {
    const b = tile.building;
    if (!b || !BUILDINGS[b.id].decay) continue;
    if (!operational(b) || b.construction || b.condition >= AUTO_REPAIR_BELOW) continue;
    // Nobody could reach it today. Skip it until tomorrow — see the note on
    // `lastPathFail` below, and the identical guard on jobs in `assignTo`.
    if (b.lastPathFail === world.day) continue;

    // Reserve the repair while travelling as well as while working. Without
    // this, every idle worker chooses the same worst-condition building.
    if (reserved.has(`${tile.q},${tile.r}`)) continue;

    // Condition dominates; distance only breaks ties between similar states.
    const score = b.condition * 4 + distance(from, tile);
    if (score < bestScore) {
      bestScore = score;
      best = { q: tile.q, r: tile.r };
    }
  }
  return best;
}

/**
 * Somewhere worth wandering to, or null.
 *
 * Picked at random within range rather than optimised: a worker looking for
 * berries is not solving a routing problem, and randomness spreads them over
 * the map, which is exactly what makes encounters happen.
 */
export function findForageSpot(world, from, rnd) {
  if (world.autoForage === false) return null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const dq = Math.round((rnd() * 2 - 1) * FORAGE_RANGE);
    const dr = Math.round((rnd() * 2 - 1) * FORAGE_RANGE);
    const q = from.q + dq;
    const r = from.r + dr;
    if (q === from.q && r === from.r) continue;
    const terrain = getTerrain(world, q, r);
    if (terrain !== "grass" && terrain !== "forest") continue;
    if (distance(from, { q, r }) > FORAGE_RANGE) continue;
    return { q, r };
  }
  return null;
}

/** Everyone assigned to the job on this tile. */
export const workersOn = (world, q, r) =>
  world.workers.filter((w) => w.state === "working" && w.job && w.job.q === q && w.job.r === r);

// --- horses ----------------------------------------------------------------

/**
 * A rider is gone — they died, or left hungry. Their horse is still YOURS.
 *
 * It used to go straight back to the wild, which was one of the four ways
 * horses disappeared: somebody leaves over a bad week and takes nothing, but
 * the horse they rode is suddenly out on the hills. Now it walks back into a
 * paddock if there is room, and only runs off (announced, and counted in
 * `world.livestock.lost`) if there is nowhere to keep it.
 */
export function releaseHorse(world, worker, reason = "riderGone") {
  if (!worker.horseId) return null;
  const horse = world.animals.find((a) => a.id === worker.horseId);
  worker.horseId = null;
  if (!horse) return null;
  horse.riderId = null;
  const kept = world.animals.filter((a) => a.species === "horse" && a.tamed && !a.riderId && a !== horse).length;
  const pen = nearestPaddock(world, horse);
  if (pen && kept < stableCapacity(world)) {
    horse.q = pen.q;
    horse.r = pen.r;
    horse.tamed = true;
    return horse;
  }
  freeHorse(world, horse, reason);
  return horse;
}

/** Keep a tamed horse under its rider. */
/** The building standing on a tile, as a live object we can repair. */
function getBuildingAt(world, q, r) {
  const tile = getTile(world, q, r);
  return tile ? tile.building : null;
}

function moveHorseWithRider(world, worker) {
  // The horse under them...
  if (worker.horseId) {
    const horse = world.animals.find((a) => a.id === worker.horseId);
    if (!horse) worker.horseId = null; // it died or was removed; carry on on foot
    else {
      horse.q = worker.q;
      horse.r = worker.r;
    }
  }

  // ...and the one on the end of a rope. A horse you have just caught has to
  // physically come home with you, or it stays standing in the field where it
  // was caught — which looks like nothing happened, and leaves it out where
  // raiders can walk off with it.
  if (worker.leadingHorseId) {
    const led = world.animals.find((a) => a.id === worker.leadingHorseId);
    if (!led || !led.tamed) worker.leadingHorseId = null;
    else {
      led.q = worker.q;
      led.r = worker.r;
    }
  }
}

/** The nearest paddock to somewhere, or null if none is standing. */
export function nearestPaddock(world, from) {
  let best = null;
  let bestD = Infinity;
  for (const tile of activeTiles(world)) {
    if (!tile.building || tile.building.id !== "paddock") continue;
    const d = distance(from, tile);
    if (d < bestD) {
      bestD = d;
      best = { q: tile.q, r: tile.r };
    }
  }
  return best;
}

// --- the hourly step -------------------------------------------------------

/**
 * One hour for every worker. Called from advanceHour, and only from there.
 *
 * Order: bank movement, walk, work, then finish anything that is done. Work
 * happens after walking so a worker that arrives this hour starts the same
 * hour rather than standing about for one.
 */
export function stepWorkers(world, rnd) {
  const events = [];
  const home = homeOf(world);

  for (const worker of world.workers) {
    // --- self-preservation, before anything else --------------------------
    // Somebody badly hurt drops what they are doing and walks home. Automatic
    // for the same reason auto-repair is: an idle game must not punish you
    // for looking away, and a wounded worker left in a field is how a
    // settlement loses people while nobody is watching.
    if (shouldRetreat(worker) && worker.state !== "resting" && worker.state !== "goingHome") {
      unequip(worker);
      abandonChase(world, worker);
      // Somebody hurt badly enough to walk home is out of the fight. Their
      // order is cancelled rather than requeued: the party that set out is the
      // party you sent, and quietly conscripting a replacement is not what the
      // player asked for.
      abandonWar(world, worker);
      worker.job = null;
      worker.chore = null;
      worker.state = "goingHome";
      // An infirmary if the settlement has built one, the base otherwise.
      setCourse(world, worker, sickbayFor(world, worker, home));
      events.push({
        type: "retreat",
        q: worker.q, r: worker.r,
        text: `${worker.name} is hurt and heading back to the base.`,
      });
    }

    if (worker.state === "goingHome") {
      if (!worker.path) setCourse(world, worker, home);
      worker.move = clamp(worker.move + speedOf(worker) * travelBonus(world) / 24, 0, 6);
      const arrived = followPath(world, worker);
      moveHorseWithRider(world, worker);
      if (arrived || !worker.path) {
        worker.state = "resting";
        worker.path = null;
      }
      continue;
    }

    if (worker.state === "training") {
      // Walk home first if they were out, then spend the hours learning.
      if (worker.path && worker.path.length) {
        worker.move = clamp(worker.move + speedOf(worker) * travelBonus(world) / 24, 0, 6);
        followPath(world, worker);
        moveHorseWithRider(world, worker);
        continue;
      }
      worker.training.hoursLeft -= 1;
      if (worker.training.hoursLeft <= 0) {
        const skill = worker.training.skill;
        worker.training = null;
        worker.state = "idle";
        events.push({
          type: "trained",
          text: `${worker.name} finished training in ${skill}.`,
        });
      }
      continue;
    }

    if (worker.state === "resting") {
      // Ordinary rest, plus whatever the settlement's medicine is worth on
      // top — a bed, herbs, and somebody who knows what to do with them.
      // `restHour` stays the single definition of resting; healing.js only
      // ever adds to it.
      restHour(world, worker);
      careHour(world, worker);
      if (isRecovered(worker)) {
        worker.state = "idle";
        events.push({
          type: "recovered",
          text: `${worker.name} is back on their feet.`,
        });
      }
      continue;
    }

    // Movement accrues over the day: 24 points is one open-ground tile each
    // hour, and 48 mounted is two. Hungry workers are slower.
    const rate = speedOf(worker) * travelBonus(world) / 24;
    worker.move = clamp(worker.move + rate * (worker.hungry ? 0.5 : 1), 0, 6);

    if (worker.state === "travelling" && worker.target) {
      const arrived = followPath(world, worker);
      moveHorseWithRider(world, worker);
      if (!worker.path && !setCourse(world, worker, worker.target)) {
        if (worker.job) noteJobRouteFailure(world, worker, worker.job.q, worker.job.r);
        worker.state = "idle";      // the route closed; give up rather than freeze
        worker.job = null;
        continue;
      }
      if (arrived) {
        const job = worker.job && getTile(world, worker.job.q, worker.job.r);
        if (job && job.work) {
          worker.state = "working";
        } else {
          // Cancelled or finished while they were walking. Take the next
          // waiting job rather than trudging home first.
          unequip(worker);
          worker.job = null;
          const next = findOpenJob(world, worker);
          if (!next || !assignTo(world, worker, next.q, next.r)) {
            worker.state = "returning";
            setCourse(world, worker, home);
          }
        }
      }
      continue;
    }

    if (worker.state === "returning") {
      if (!worker.path) setCourse(world, worker, worker.target || home);
      const arrived = followPath(world, worker);
      moveHorseWithRider(world, worker);
      if (arrived || !worker.path) {
        // A horse led home goes into a paddock and stays there. It is yours
        // now, and where it stands is the difference between "in the paddock"
        // and "standing in a field waiting to be stolen".
        if (worker.leadingHorseId) {
          const led = world.animals.find((a) => a.id === worker.leadingHorseId);
          const pen = nearestPaddock(world, worker);
          if (led && pen) {
            led.q = pen.q;
            led.r = pen.r;
          }
          worker.leadingHorseId = null;
        }
        worker.state = "idle";
        worker.target = null;
        worker.path = null;
      }
      continue;
    }

    // --- the repair chore -------------------------------------------------
    if (worker.state === "repairing") {
      const b = getBuildingAt(world, worker.chore?.q ?? worker.q, worker.chore?.r ?? worker.r);
      // Somebody else finished it, it was torn down, or the wood ran out.
      if (!b || b.condition >= 100 || (world.store.wood || 0) < 1) {
        worker.state = "returning";
        worker.chore = null;
        worker.target = home;
        continue;
      }

      const before = b.condition;
      b.condition = Math.min(100, b.condition + REPAIR_PER_HOUR * (worker.hungry ? 0.5 : 1));

      // Wood is spent in fractions and charged when a whole one adds up, so a
      // repair costs about what doing it by hand costs.
      world.woodDebt = (world.woodDebt || 0) + REPAIR_WOOD_PER_HOUR;
      while (world.woodDebt >= 1 && world.store.wood >= 1) {
        world.woodDebt -= 1;
        world.store.wood -= 1;
      }

      if (before < 100 && b.condition >= 100) {
        events.push({
          type: "repaired",
          q: worker.q, r: worker.r,
          text: `${worker.name} finished repairing the ${BUILDINGS[b.id].label.toLowerCase()} at ${worker.q},${worker.r}.`,
        });
        worker.state = "returning";
        worker.chore = null;
        worker.target = home;
      }
      continue;
    }

    if (worker.state === "working") {
      // The tile being worked, NOT the tile underfoot — quarrying a mountain
      // means standing next to it.
      const at = worker.job;
      const tile = at && getTile(world, at.q, at.r);
      if (!tile || !tile.work) {
        // Done. Straight on to whatever else is waiting — walking all the way
        // home between jobs is the sort of thing that makes a settlement feel
        // like it is run by idiots.
        unequip(worker);
        worker.job = null;
        const next = findOpenJob(world, worker);
        if (!next || !assignTo(world, worker, next.q, next.r)) {
          worker.state = "returning";
          setCourse(world, worker, home);
        }
        continue;
      }
      // Claim the best free tool for this kind of work, once.
      equipFor(world, worker, tile.work.id);

      // Skills, tool, hunger and injury all land in workRate — one place, so
      // there is never a second definition of how fast somebody works.
      const stored = touchTile(world, at.q, at.r);
      stored.work.done += workRate(world, worker, stored.work.id);

      // An hour of real use. Tools break from BEING USED, not from existing,
      // so a spare axe in the shed lasts forever and the one in the woods does
      // not — which is what gives the workshop something to do after the first
      // set is made.
      if (worker.tool) {
        const broke = wearTool(world, worker.tool, 1);
        if (broke) events.push({ ...broke, q: worker.q, r: worker.r });
      }
      continue;
    }

    // --- idle: find something useful to do --------------------------------
    if (worker.state === "idle") {
      // A job the player asked for always beats a chore the worker invented.
      const open = findOpenJob(world, worker);
      if (open) {
        assignTo(world, worker, open.q, open.r);
        continue;
      }

      // Then standing orders — catching a horse, or marching on the
      // neighbours. Ranked below tile jobs because those are the main loop,
      // but above anything the worker would have chosen for itself.
      if (takeCatchOrder(world, worker, events)) continue;
      if (takeWarOrder(world, worker)) continue;

      const chore = findRepairChore(world, worker);
      if (chore) {
        const spot = workSpotFor(world, chore.q, chore.r, worker);
        if (spot && spot.q === worker.q && spot.r === worker.r) {
          worker.state = "repairing";
          worker.chore = chore;
        } else if (spot && setCourse(world, worker, spot)) {
          worker.state = "travellingToChore";
          worker.chore = chore;
        } else {
          // NO ROUTE. Note it on the BUILDING, exactly as `assignTo` notes it
          // on the job, and for exactly the same reason.
          //
          // This was measured at 194ms per simulated day against 3ms with
          // auto-repair switched off — a sixty-fold cost that had nothing to
          // do with repairing and everything to do with SEARCHING. A failed
          // path is the most expensive kind: the search cannot stop early, so
          // it expands its full 3000-node budget before admitting defeat. One
          // unreachable farm therefore cost every idle worker a full search
          // every hour, forever, and the worker then stood still anyway.
          //
          // Retried tomorrow, which is soon enough to notice a new land
          // bridge or a wall coming down.
          const stored = getTile(world, chore.q, chore.r);
          if (stored && stored.building) stored.building.lastPathFail = world.day;
          worker.chore = null;
        }
        continue;
      }

      // Nothing to build and nothing to mend: go and look for something.
      const spot = findForageSpot(world, worker, rnd);
      if (spot && setCourse(world, worker, spot)) {
        worker.state = "foraging";
        worker.forageHours = FORAGE_HOURS;
      }
      continue;
    }

    // --- marching on the neighbours ------------------------------------------
    if (worker.state === "marching") {
      // They gave up, or somebody else finished the camp while we walked.
      if (!worker.marching || !campById(world, worker.marching.campId)) {
        completeOrder(world, worker);
        worker.marching = null;
        worker.state = "returning";
        setCourse(world, worker, home);
        continue;
      }
      const village = campById(world, worker.marching.campId);
      const current = village.buildings.find(b => b.q === worker.marching.q && b.r === worker.marching.r && b.condition > 0);
      const aim = current && (current.id !== "camp" || village.buildings.filter(b => b.condition > 0).length === 1) ? current : assaultTarget(village, worker);
      if (aim && (aim.q !== worker.marching.q || aim.r !== worker.marching.r)) {
        worker.marching = { q: aim.q, r: aim.r, campId: village.id };
        worker.path = null;
      }
      if (!worker.path && !setCourse(world, worker, worker.marching)) {
        completeOrder(world, worker);
        worker.marching = null;
        recall(world, worker);
        events.push({ type: "assaultBlocked", text: `${worker.name} cannot reach the village and is returning home.` });
        continue;
      }
      // Movement was already banked above; a march must not get a second hour.
      const there = followPath(world, worker);
      moveHorseWithRider(world, worker);
      if (there && distance(worker, worker.marching) <= 1) {
        worker.state = "storming";
        events.push({
          type: "arrivedAtCamp",
          q: worker.q, r: worker.r,
          text: `${worker.name} has reached the neighbours' camp.`,
        });
      }
      continue;
    }

    // Standing outside their camp. The fighting itself is resolved every hour
    // by `stepAssault` in rivals.js, which owns every combat number in the
    // game — there must not be a second definition of how a fight goes.
    if (worker.state === "storming") {
      const village = campById(world, worker.marching?.campId);
      if (village && !worker.giveUpAssault) {
        const current = village.buildings.find(b => b.q === worker.marching.q && b.r === worker.marching.r && b.condition > 0);
        if (!current || (current.id === "camp" && village.buildings.some(b => b.id !== "camp" && b.condition > 0))) {
          const aim = assaultTarget(village, worker);
          if (aim) { worker.marching = { q: aim.q, r: aim.r, campId: village.id }; worker.state = "marching"; worker.path = null; worker.move = 0; }
        }
      }
      // Either the camp is gone, or the attack has failed and `stepAssault`
      // has called it off.
      if (!worker.marching || !campById(world, worker.marching.campId) || worker.giveUpAssault) {
        completeOrder(world, worker);
        worker.marching = null;
        worker.giveUpAssault = false;
        worker.stormDays = 0;
        worker.state = "returning";
        setCourse(world, worker, home);
      }
      continue;
    }

    // --- out after a horse --------------------------------------------------
    //
    // The only job in the game whose target MOVES. Everything else stands
    // still and waits to be worked on; a horse wanders off every day, so the
    // route has to be replotted whenever it does. That is why this is not a
    // tile job: a job that changes tiles would have to be added to and removed
    // from the active set daily, and the active set is the thing that keeps
    // the whole simulation cheap.
    if (worker.state === "catching") {
      const horse = horseById(world, worker.catching && worker.catching.horseId);
      const order = (world.orders || []).find((o) => o.takenBy === worker.id && !o.done && o.kind === "catch");

      // Called off. Cancelling used to mark the order done and leave the worker
      // chasing — and catching — the horse anyway.
      if (!order) {
        if (horse) horse.claimedBy = null;
        worker.catching = null;
        worker.state = "returning";
        setCourse(world, worker, home);
        events.push({
          type: "catchCalledOff",
          q: worker.q, r: worker.r,
          text: `${worker.name} was called off the chase and is heading home.`,
        });
        continue;
      }

      // It died, was stolen, or somebody else got it. This used to send the
      // worker home and leave the order "taken" by them for ever: it never
      // retried, never closed, and held a paddock place.
      if (!horse || horse.tamed) {
        if (horse) horse.claimedBy = null;
        worker.catching = null;
        worker.state = "returning";
        setCourse(world, worker, home);
        if (order.horseId != null) {
          order.done = true;
          events.push({
            type: "catchTargetGone",
            q: worker.q, r: worker.r,
            text: `The horse ${worker.name} was after is gone. The order is closed.`,
          });
        } else {
          order.takenBy = null; // any horse will do: back on the queue
          events.push({
            type: "catchTargetGone",
            q: worker.q, r: worker.r,
            text: `The horse ${worker.name} was after is gone. Somebody will look for another.`,
          });
        }
        continue;
      }

      // Patience measures WASTED hours, not elapsed ones: closing the gap
      // resets it, so a long walk never times out and a horse that keeps
      // outrunning them does.
      const gap = distance(worker, horse);
      if (worker.catching.best === undefined || gap < worker.catching.best) {
        worker.catching.best = gap;
        worker.catching.hours = 0;
      } else {
        worker.catching.hours = (worker.catching.hours || 0) + 1;
      }
      if (worker.catching.hours > CATCH_PATIENCE) {
        horse.claimedBy = null;
        // A marked horse that got away closes its order: sending the next
        // person after the same animal for ever is not what was asked for.
        if (order.horseId != null) order.done = true;
        else releaseOrder(world, worker);
        worker.catching = null;
        worker.state = "returning";
        setCourse(world, worker, home);
        events.push({
          type: "catchGaveUp",
          q: worker.q, r: worker.r,
          text: `${worker.name} lost the horse and came back empty-handed.`,
        });
        continue;
      }

      const onIt = worker.q === horse.q && worker.r === horse.r;
      if (!onIt) {
        // Replot whenever the animal is no longer where the plan assumed.
        const aim = worker.catching.aim;
        if (!worker.path || !worker.path.length || !aim || aim.q !== horse.q || aim.r !== horse.r) {
          worker.catching.aim = { q: horse.q, r: horse.r };
          if (!setCourse(world, worker, { q: horse.q, r: horse.r })) {
            // No route — it is across water or behind a wall. Wait a day; it
            // moves, and the way through may open.
            continue;
          }
        }
        // Movement was already credited once for this hour.
        followPath(world, worker);
        moveHorseWithRider(world, worker);
        continue;
      }

      // Standing on it. One attempt an hour.
      if (rnd() < catchChanceFor(worker)) {
        horse.tamed = true;
        horse.claimedBy = null;
        // Caught, but NOT automatically ridden. It goes to the paddock, and
        // mounting is a separate decision — otherwise the first worker to
        // catch anything is permanently the one on horseback.
        horse.riderId = null;
        completeOrder(world, worker);
        worker.leadingHorseId = horse.id;
        worker.catching = null;
        worker.state = "returning";
        setCourse(world, worker, home);
        events.push({
          type: "tamed",
          q: worker.q, r: worker.r,
          text: `${worker.name} caught a horse at ${worker.q},${worker.r}.`,
        });
      } else {
        // It bolts. The chase carries on, which is the point: a failed attempt
        // costs time and distance, not the order.
        const away = neighbors(horse.q, horse.r).filter((n) => canWalk(world, n.q, n.r));
        for (let i = 0; i < BOLT_DISTANCE && away.length; i++) {
          const step = away[Math.floor(rnd() * away.length)];
          horse.q = step.q;
          horse.r = step.r;
          away.length = 0;
          away.push(...neighbors(horse.q, horse.r).filter((n) => canWalk(world, n.q, n.r)));
        }
        worker.catching.aim = null;
      }
      continue;
    }

    if (worker.state === "foraging") {
      // Walking out to the spot, then a few hours picking over it.
      if (worker.path && worker.path.length) {
        followPath(world, worker);
        moveHorseWithRider(world, worker);
        continue;
      }
      worker.forageHours -= 1;
      if (worker.forageHours <= 0) {
        const terrain = getTerrain(world, worker.q, worker.r);
        // A rider covers more ground and has somewhere to put it: double.
        addResource(world, "food", FORAGE_FOOD * (worker.horseId ? 2 : 1));

        // Herbs grow in the rough ground, not on a farm.
        // Through addResource, so the store's ceiling applies. It did not
        // before, which is the whole reason herbs reached 300 by year two.
        if ((terrain === "forest" || terrain === "grass") && rnd() < FORAGE_HERB_CHANCE) {
          if (addResource(world, "herbs", 1) > 0) {
            events.push({
              type: "forage",
              q: worker.q, r: worker.r,
              text: `${worker.name} brought back herbs from ${worker.q},${worker.r}.`,
            });
          } else if (!world.herbsFull) {
            world.herbsFull = true;
            events.push({
              type: "full",
              q: worker.q, r: worker.r,
              text: "There is nowhere left to put herbs. An infirmary would keep more.",
            });
          }
        }
        if ((world.store.herbs || 0) < storageCapacity(world).herbs) world.herbsFull = false;

        if (terrain === "forest" && rnd() < FORAGE_SEED_CHANCE) {
          if (addResource(world, "seeds", 1) > 0) {
            events.push({
              type: "forage",
              q: worker.q, r: worker.r,
              text: `${worker.name} found a seed while foraging at ${worker.q},${worker.r}.`,
            });
          }
        }
        worker.state = "returning";
        worker.forageHours = 0;
        setCourse(world, worker, home);
      }
      continue;
    }

    if (worker.state === "travellingToChore") {
      const arrived = followPath(world, worker);
      moveHorseWithRider(world, worker);
      if (arrived || !worker.path) {
        const b = getBuildingAt(world, worker.chore?.q ?? worker.q, worker.chore?.r ?? worker.r);
        // It may have been mended by somebody else, or fallen down, en route.
        worker.state = b && b.condition < 100 && worker.chore && distance(worker, worker.chore) <= 1 ? "repairing" : "idle";
        if (worker.state === "idle") worker.chore = null;
      }
      continue;
    }
  }

  // --- finish anything that is done ---------------------------------------
  for (const tile of activeTiles(world)) {
    const job = tile.work;
    if (!job || job.done < job.needed) continue;

    // A hunt has no terrain to change and is resolved by tick.js, which owns
    // everything that actually alters the world. Just mark it done.
    if (job.hunt || job.claim) {
      job.finished = true;
      continue;
    }

    const was = tile.terrain;
    events.push({
      type: "conversion",
      q: tile.q, r: tile.r,
      to: job.to,
      text: `${tile.q},${tile.r} is now ${job.to}${was === job.to ? "" : ` (was ${was})`}.`,
    });

    if (job.yields) {
      for (const [res, n] of Object.entries(job.yields)) {
        addResource(world, res, n);
      }
      events.push({
        type: "haul",
        q: tile.q, r: tile.r,
        text: `Hauled back ${Object.entries(job.yields).map(([r2, n]) => `${n} ${r2}`).join(", ")}.`,
      });
    }
    // The tile itself is finished by tick.js, which owns terrain changes.
    job.finished = true;
  }

  return events;
}

/**
 * One day of eating and recruiting. Called from advanceHour on the day roll.
 *
 * Food is the population control. Run a surplus and people turn up; run out
 * and they go hungry, work at half speed, and eventually leave. Nobody dies
 * of hunger here — death arrives with the fox, in the next pass.
 */
export function dailyWorkers(world, rnd) {
  const events = [];
  const owed = dailyFoodFor(world.workers.length);
  const had = world.store.food;

  world.store.food = Math.max(0, had - owed);
  const fed = had >= owed;

  for (const w of world.workers) w.hungry = !fed;

  if (!fed && world.workers.length > 0) {
    events.push({
      type: "hunger",
      text: `There was not enough food. Everyone is working at half pace.`,
    });

    // Someone leaves, rather than everyone slowly starving. Keeps the
    // settlement matched to what it can actually feed.
    world.hungryDays = (world.hungryDays || 0) + 1;
    if (world.hungryDays >= 3 && world.workers.length > 1) {
      const leaver = world.workers[world.workers.length - 1];
      releaseHorse(world, leaver, "riderLeft");
      world.workers = world.workers.filter((w) => w.id !== leaver.id);
      world.hungryDays = 0;
      events.push({ type: "leave", text: `${leaver.name} left to find somewhere better fed.` });
    }
  } else {
    world.hungryDays = 0;
  }

  // Recruiting.
  const { cap } = workerCapacity(world);
  world.recruitHours = (world.recruitHours || 0) + 24;
  if (
    world.workers.length < cap &&
    seasonOf(world.day).id !== "winter" &&
    world.store.food >= RECRUIT_FOOD &&
    world.recruitHours >= RECRUIT_HOURS
  ) {
    world.recruitHours = 0;
    const at = homeOf(world);
    const w = makeWorker(world, at.q, at.r);
    events.push({
      type: "recruit",
      q: w.q, r: w.r,
      text: `${w.name} joined the settlement.`,
    });
  }

  return events;
}

/**
 * Buy a worker, rather than waiting for one to wander in.
 *
 * Paying does not lift the ceiling — you still cannot house or feed more than
 * the base and the farms allow. What it buys is TIME: somebody today instead
 * of somebody next week. Each hire costs more than the last, so a pile of
 * food cannot simply be converted into a crowd.
 */
export function hire(world) {
  const { cap, limitedBy } = workerCapacity(world);
  if ((world.workers || []).length >= cap) {
    return {
      ok: false,
      reason: limitedBy === "food"
        ? "there is not enough food to feed another"
        : limitedBy === "houses"
          ? "no room in housing — build a house"
          : "the base is full — a bigger base is the only way to house more",
    };
  }
  const at = homeOf(world);
  if (!activeTiles(world).some((t) => operational(t.building) && t.building.id === "base")) {
    return { ok: false, reason: "you need a base for somebody to arrive at" };
  }

  const cost = hireCostFor(world);
  if (!canAfford(world.store, cost)) {
    return { ok: false, reason: `not enough — needs ${cost.food} food and ${cost.wood} wood` };
  }
  for (const [res, n] of Object.entries(cost)) world.store[res] -= n;

  const worker = makeWorker(world, at.q, at.r);
  return { ok: true, worker, cost };
}

/**
 * Train a worker in a trade.
 *
 * Costs resources AND the worker's time — they stand at the base learning
 * instead of working, which is what stops training being a pure resource
 * dump. The hours are spent as a job with no tile, so it uses the ordinary
 * state machine.
 */
export function train(world, worker, skillId) {
  const check = canTrain(world, worker, skillId);
  if (!check.ok) return check;

  for (const [res, n] of Object.entries(check.cost)) world.store[res] -= n;
  worker.skills = worker.skills || {};
  worker.skills[skillId] = (worker.skills[skillId] || 0) + 1;

  // They are busy learning for a while: send them home and keep them there.
  unequip(worker);
  worker.job = null;
  worker.chore = null;
  // Mastery takes three times as long as an ordinary level — the cost of the
  // last two levels is as much the worker's absence as the resources.
  // `check.hours` was worked out BEFORE the level above was applied, which is
  // the one that matters — asking again now would price the NEXT level.
  worker.training = { skill: skillId, hoursLeft: check.hours };
  worker.state = "training";
  setCourse(world, worker, homeOf(world));

  return { ok: true, skill: skillId, level: worker.skills[skillId], cost: check.cost };
}

/** A short read-out for the panel and the text assistant. */
export function workerSummary(world) {
  const { cap, byFood, byBase, foodPerDay, limitedBy } = workerCapacity(world);
  const busy = world.workers.filter((w) => w.state !== "idle").length;
  return {
    total: world.workers.length,
    idle: world.workers.length - busy,
    busy,
    cap,
    limitedBy,
    foodPerDay: Math.round(foodPerDay),
    mounted: world.workers.filter((w) => w.horseId).length,
  };
}
