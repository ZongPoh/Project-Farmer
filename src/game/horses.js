/**
 * Horses, and the player actually being able to do something about them.
 *
 * THE PROBLEM THIS FIXES. Taming worked, but only by accident: a worker had to
 * happen to be standing on the same tile as a wild horse at the moment you
 * happened to click it. There was no way to *decide* to get a horse. The
 * mechanic existed and the player could not reach it, which is the worst state
 * for a feature to be in — all of the code and none of the game.
 *
 * Now catching a horse is an ORDER. You ask for one, it queues like any other
 * instruction, and the next free worker goes out and does it. That means:
 *
 *   - It works while you are not watching, like everything else here.
 *   - It queues when everyone is busy, which was the whole point of the job
 *     queue fix; an order that silently evaporated would repeat that bug.
 *   - It can FAIL. A horse that bolts is the difference between a purchase
 *     and a hunt, and it is what makes horsemanship worth training.
 *
 * NO IMPORT FROM workers.js. That file imports this one, and a cycle between
 * the two largest modules in the game is not worth the convenience — every
 * function here takes the worker it operates on as an argument instead.
 */
import { distance } from "./hex.js";
import { stableCapacity } from "./buildings.js";
import { nearestPaddockTo, recordHorseLoss } from "./livestock.js";

/**
 * How far a worker will go looking for a horse NOBODY ASKED FOR.
 *
 * This cap applies to opportunism only. An explicit order searches the whole
 * board: the player asked for a horse, and a worker who refuses to walk a
 * thirteenth tile is a worker ignoring an instruction. The first version
 * capped ordered catches too, and the result was an order that sat in the
 * queue forever doing nothing — the exact bug the job queue was fixed for,
 * wearing a different hat.
 */
export const CATCH_RANGE = 12;

/**
 * Hours of NO PROGRESS before a worker gives up and comes home.
 *
 * Not hours spent — hours wasted. The counter resets every time they get
 * closer to the animal than they have ever been, so a long walk across the
 * map never times out, and a horse that keeps outrunning them does. That
 * distinction matters: a budget of elapsed hours would have made distant
 * horses permanently uncatchable while looking like a patience problem.
 */
export const CATCH_PATIENCE = 36;

/** Odds per attempt, before skill. Low enough that it is a story, not a tax. */
export const CATCH_BASE_CHANCE = 0.3;
export const CATCH_PER_SKILL = 0.13;

/** How far a spooked horse bolts when somebody gets it wrong. */
export const BOLT_DISTANCE = 3;

export const horseById = (world, id) =>
  (world.animals || []).find((a) => a.id === id) || null;

/** Every horse nobody has caught. */
export const wildHorses = (world) =>
  (world.animals || []).filter((a) => a.species === "horse" && !a.tamed);

/** Tamed horses with nobody on them — the ones standing in your paddocks. */
export const stabledHorses = (world) =>
  (world.animals || []).filter((a) => a.species === "horse" && a.tamed && !a.riderId);

/**
 * The closest wild horse worth walking to, or null.
 *
 * `claimedBy` keeps two workers from setting off after the same animal, which
 * looks ridiculous and wastes half your settlement.
 */
export function nearestWildHorse(world, from, range = Infinity) {
  let best = null;
  let bestD = Infinity;
  // A horse the player has marked belongs to that order. A general "catch a
  // horse" must not walk off with the one somebody picked out.
  const marked = markedHorseIds(world);
  for (const horse of wildHorses(world)) {
    if (horse.claimedBy || marked.has(horse.id)) continue;
    const d = distance(from, horse);
    if (d > range || d >= bestD) continue;
    bestD = d;
    best = horse;
  }
  return best;
}

/**
 * Odds of getting a rope on it this attempt.
 *
 * Capped below 1 on purpose: a master should be reliable, never certain. The
 * moment it is certain, the animal stops being an animal.
 */
export function catchChanceFor(worker) {
  const skill = (worker.skills && worker.skills.horsemanship) || 0;
  return Math.min(0.85, CATCH_BASE_CHANCE + CATCH_PER_SKILL * skill);
}

/** How much further a rider gets for knowing what they are doing. */
export function ridingBonus(worker) {
  const skill = (worker.skills && worker.skills.horsemanship) || 0;
  return 1 + 0.12 * skill;
}

// --- the order queue -------------------------------------------------------
//
// Deliberately a separate queue from the tile jobs in `world.active`. A tile
// job is attached to a place; catching a horse is attached to a moving animal,
// and forcing it into the tile queue would mean a job that has to change tiles
// every day — which is exactly the sort of thing that breaks the active set.

export function pendingOrders(world) {
  return (world.orders || []).filter((o) => !o.done);
}

/** Ids of horses that an open order has picked out by name. */
export function markedHorseIds(world) {
  const ids = new Set();
  for (const o of pendingOrders(world)) if (o.kind === "catch" && o.horseId != null) ids.add(o.horseId);
  return ids;
}

/** The open catch order aimed at this horse, if any. */
export function orderForHorse(world, horseId) {
  return pendingOrders(world).find((o) => o.kind === "catch" && o.horseId === horseId) || null;
}

/** Ask for a horse to be caught. Returns { ok } or { ok:false, reason }. */
/**
 * The wild herd is protected below this. Catching the last few horses on the
 * board would leave nothing to breed back from — and before the grazing fix in
 * animals.js, that was the usual state of the valley.
 */
export const WILD_HERD_FLOOR = 3;

export function orderCatch(world, horseId = null) {
  if (wildHorses(world).length === 0) {
    return { ok: false, reason: "there are no wild horses on the board" };
  }
  // A MARKED order names the horse the player picked on the map. Without this
  // the worker went after whichever horse was nearest to THEM, so the one you
  // clicked wandered off and somebody came back with a different animal.
  let target = null;
  if (horseId != null) {
    target = horseById(world, horseId);
    if (!target || target.species !== "horse" || target.tamed) {
      return { ok: false, reason: "that horse is not running wild any more" };
    }
    if (target.claimedBy || orderForHorse(world, horseId)) {
      return { ok: false, reason: "somebody is already after that horse" };
    }
  }
  const room = stableCapacity(world);
  const kept = stabledHorses(world).length;
  const asked = pendingOrders(world).filter((o) => o.kind === "catch").length;
  // Counting the orders already out stops you queueing ten catches against one
  // paddock and then wondering why nine horses went straight back to the wild.
  if (kept + asked >= room) {
    return {
      ok: false,
      reason: room === 0
        ? "build a paddock first — there is nowhere to keep a horse"
        : `your paddocks are full (${kept} kept, ${asked} on the way, room for ${room})`,
    };
  }

  const asking = pendingOrders(world).filter((o) => o.kind === "catch").length;
  if (wildHorses(world).length - asking <= WILD_HERD_FLOOR - 1) {
    return {
      ok: false,
      reason: `the wild herd is down to ${wildHorses(world).length} — leave them to breed back`,
    };
  }
  world.orders = world.orders || [];
  const order = {
    id: (world.nextOrderId = (world.nextOrderId || 0) + 1),
    kind: "catch",
    seq: world.nextOrderId,
    issuedOn: world.day,
    done: false,
  };
  if (target) order.horseId = target.id;
  world.orders.push(order);

  // How far the horse is, so the UI can say "this will take a while" rather
  // than leaving the player watching an order that looks stuck.
  const home = world.home || { q: 0, r: 0 };
  const aim = target || nearestWildHorse(world, home);
  return {
    ok: true,
    order,
    distance: aim ? distance(home, aim) : null,
  };
}

/**
 * Every open catch order, as the player needs to see it: which horse (if one
 * was marked), who is on it, how far apart they are, and how much patience is
 * left. Pure, so the UI shows exactly what the simulation is doing and the
 * status can be tested without a browser.
 */
export function catchStatus(world) {
  const workers = new Map((world.workers || []).map((w) => [w.id, w]));
  return pendingOrders(world)
    .filter((o) => o.kind === "catch")
    .sort((a, b) => a.seq - b.seq)
    .map((order) => {
      const worker = order.takenBy ? workers.get(order.takenBy) || null : null;
      const chasing = worker && worker.catching ? worker.catching : null;
      const horseId = chasing ? chasing.horseId : order.horseId;
      const horse = horseId != null ? horseById(world, horseId) : null;
      const gap = worker && horse ? distance(worker, horse) : null;
      return {
        order,
        horse,
        worker,
        marked: order.horseId != null,
        state: !worker ? "waiting" : gap === 0 ? "roping" : "chasing",
        distance: gap,
        patienceLeft: chasing ? Math.max(0, CATCH_PATIENCE - (chasing.hours || 0)) : null,
      };
    });
}

/** Drop an order nobody has picked up yet. */
export function cancelOrder(world, id) {
  const order = (world.orders || []).find((o) => o.id === id);
  if (!order) return { ok: false, reason: "no such order" };
  order.done = true;
  return { ok: true };
}

/**
 * Clear out finished orders, and any whose worker vanished.
 *
 * Called once a day rather than every hour: an order list is a handful of
 * entries, and sweeping it hourly is work for nothing.
 */
export function tidyOrders(world) {
  if (!world.orders) return;
  const byId = new Map((world.workers || []).map((w) => [w.id, w]));
  for (const order of world.orders) {
    if (!order.takenBy) continue;
    const w = byId.get(order.takenBy);
    // Gone, or no longer chasing anything. The second case is how saves made
    // before the chase-ending fix kept an order "taken" forever after the
    // horse vanished: it never retried, and it held a paddock place.
    if (!w || (order.kind === "catch" && (w.state !== "catching" || !w.catching))) order.takenBy = null;
  }
  // A marked order whose horse has gone for good (caught by somebody else,
  // died, stolen) can never be done. Close it rather than leave it queued.
  for (const order of world.orders) {
    if (order.done || order.kind !== "catch" || order.horseId == null || order.takenBy) continue;
    const horse = horseById(world, order.horseId);
    if (!horse || horse.tamed) order.done = true;
  }
  world.orders = world.orders.filter((o) => !o.done);
}

/** The oldest order nobody has taken, or null. */
export function nextOpenOrder(world) {
  let best = null;
  for (const order of pendingOrders(world)) {
    if (order.takenBy) continue;
    if (!best || order.seq < best.seq) best = order;
  }
  return best;
}

// --- stabling and mounting -------------------------------------------------

/** Is there room to keep another horse that nobody is riding? */
export function canStableMore(world) {
  return stabledHorses(world).length < stableCapacity(world);
}

/**
 * Put a worker on a horse that is already yours.
 *
 * This is the payoff for the paddock: a horse you caught last month is still
 * there, so a newly hired worker can be mounted immediately rather than being
 * sent out to catch one of their own.
 */
export function mount(world, worker) {
  if (!worker) return { ok: false, reason: "nobody selected" };
  if (worker.horseId) return { ok: false, reason: `${worker.name} already has a horse` };
  const horse = stabledHorses(world)[0];
  if (!horse) return { ok: false, reason: "no horse is standing idle in a paddock" };
  horse.riderId = worker.id;
  worker.horseId = horse.id;
  // It comes to them; a horse in a paddock is a horse you own, not a horse
  // you have to go and find again.
  horse.q = worker.q;
  horse.r = worker.r;
  return { ok: true, worker, horse };
}

/**
 * Get down and leave the horse in the paddock rather than in the wild.
 *
 * Without somewhere to put it a dismounted horse would simply go feral, which
 * is a silly punishment for swapping who rides.
 */
export function stable(world, worker) {
  if (!worker || !worker.horseId) return { ok: false, reason: "no horse to put away" };
  if (!canStableMore(world)) {
    return { ok: false, reason: "there is no room in your paddocks" };
  }
  const horse = horseById(world, worker.horseId);
  worker.horseId = null;
  if (horse) {
    horse.riderId = null;
    horse.tamed = true; // still yours; it is in the paddock, not the hills
    // ...and actually IN the paddock. It used to stay wherever the rider was
    // standing, which put it out in a field, off its grazing and in reach of
    // the next raid.
    const pen = nearestPaddockTo(world, worker);
    if (pen) { horse.q = pen.q; horse.r = pen.r; }
  }
  return { ok: true, horse };
}

/**
 * A caught horse that has nowhere to go goes back to the wild.
 *
 * Called when a paddock is demolished or rots away under the horses standing
 * in it. Losing them is the correct outcome — otherwise the capacity means
 * nothing — but it must be announced, because a horse quietly vanishing from
 * the census is indistinguishable from a bug.
 */
export function evictOverflow(world) {
  const events = [];
  let over = stabledHorses(world).length - stableCapacity(world);
  if (over <= 0) return events;
  for (const horse of stabledHorses(world)) {
    if (over <= 0) break;
    horse.tamed = false;
    horse.riderId = null;
    over -= 1;
    recordHorseLoss(world, "noPaddock");
    events.push({
      type: "horseLost",
      reason: "noPaddock",
      q: horse.q, r: horse.r,
      text: "A horse wandered off — there is no paddock left to keep it in.",
    });
  }
  return events;
}
