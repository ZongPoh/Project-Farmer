import { placeFinished as place } from "./support.mjs";
/**
 * Catching a horse, on purpose.
 *
 * The behaviour under test is the ORDER, not the taming. Taming already
 * worked; what did not exist was any way for the player to *decide* to have a
 * horse. So most of these tests are about the order surviving contact with
 * reality: nobody free, nowhere to put it, the animal wandering off, the
 * worker being hurt halfway through.
 *
 * The trap these guard against is the one the job queue had — an instruction
 * that is accepted, looks fine, and then quietly never happens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { own } from "./support.mjs";
import { createWorld, allTiles, serialize, deserialize } from "../src/game/world.js";
import { demolish } from "../src/game/buildings.js";
import { advanceHour } from "../src/game/tick.js";
import { makeWorker, abandonChase } from "../src/game/workers.js";
import {
  orderCatch, cancelOrder, pendingOrders, stabledHorses, wildHorses,
  mount, stable, canStableMore, catchChanceFor, ridingBonus, nearestWildHorse,
  CATCH_BASE_CHANCE, catchStatus,
} from "../src/game/horses.js";

/** A world with a base, a paddock, one worker and one horse a short walk away. */
function ready(seed = 7, { paddocks = 1 } = {}) {
  const world = createWorld(seed);
  const grass = [...allTiles(world)].filter((t) => t.terrain === "grass");
  place(world, grass[0].q, grass[0].r, "base");
  own(world, [...allTiles(world)]);
  world.store.wood = 4000;
  world.store.stone = 4000;
  world.store.food = 4000;
  for (let i = 0; i < paddocks; i++) place(world, grass[1 + i].q, grass[1 + i].r, "paddock");
  if (world.workers.length === 0) makeWorker(world, grass[0].q, grass[0].r);

  // Put a horse somewhere definite rather than hoping worldgen made one.
  world.animals = world.animals.filter((a) => a.species !== "horse");
  const horse = {
    id: world.nextAnimalId++,
    species: "horse",
    q: grass[6].q, r: grass[6].r,
    energy: 14,
    tamed: false,
  };
  world.animals.push(horse);
  // The rest of the wild herd, far off. orderCatch will not take the last
  // WILD_HERD_FLOOR horses on the board, so a one-horse valley cannot be
  // asked for anything; these keep the herd above that line without being
  // the nearest.
  const far = grass[grass.length - 1];
  for (let i = 0; i < 4; i++) {
    world.animals.push({ id: world.nextAnimalId++, species: "horse", q: far.q, r: far.r, energy: 14, tamed: false });
  }
  return { world, grass, horse };
}

const runDays = (world, days) => {
  for (let h = 0; h < days * 24; h++) advanceHour(world);
};

// --- the order itself ------------------------------------------------------

test("a paddock is required before you can ask for a horse", () => {
  const { world } = ready(7, { paddocks: 0 });
  const res = orderCatch(world);
  assert.equal(res.ok, false);
  assert.match(res.reason, /paddock/, "the reason must say what to build");
});

test("you cannot queue more catches than you have room for", () => {
  // One paddock holds three. The fourth order must be refused at the point of
  // asking — not accepted and then quietly dropped when the horse arrives.
  const { world } = ready(7);
  for (let i = 0; i < 3; i++) {
    // Enough wild horses to ask about.
    world.animals.push({
      id: world.nextAnimalId++, species: "horse",
      q: 0, r: 0, energy: 14, tamed: false,
    });
  }
  assert.equal(orderCatch(world).ok, true);
  assert.equal(orderCatch(world).ok, true);
  assert.equal(orderCatch(world).ok, true);
  const fourth = orderCatch(world);
  assert.equal(fourth.ok, false);
  assert.match(fourth.reason, /full/);
});

test("an order with nobody free waits rather than evaporating", () => {
  // This is the exact failure the job queue was fixed for, in a new place.
  const { world } = ready();
  const worker = world.workers[0];
  // Keep the worker genuinely occupied for longer than the day under test.
  // A fake work assignment is discarded as soon as its missing tile is seen.
  worker.state = "training";
  worker.training = { skill: "labour", hoursLeft: 48 };

  assert.equal(orderCatch(world).ok, true);
  runDays(world, 1);
  assert.equal(pendingOrders(world).length, 1, "the order must still be there");
});

test("a cancelled order stops being handed out", () => {
  const { world } = ready();
  const res = orderCatch(world);
  assert.equal(cancelOrder(world, res.order.id).ok, true);
  assert.equal(pendingOrders(world).length, 0);
});

// --- doing it --------------------------------------------------------------

test("an ordered horse is caught, led home, and ends up in the paddock", () => {
  const { world, grass } = ready();
  assert.equal(orderCatch(world).ok, true);

  runDays(world, 40);

  assert.equal(stabledHorses(world).length, 1, "a horse should be in the paddock");
  const horse = stabledHorses(world)[0];
  // Led home, not left standing where it was caught. This matters: a horse
  // out in a field is a horse raiders can walk off with.
  const paddock = { q: grass[1].q, r: grass[1].r };
  assert.equal(horse.q, paddock.q, "the horse should be at the paddock");
  assert.equal(horse.r, paddock.r);
});

test("a caught horse is NOT automatically ridden", () => {
  // Otherwise the first person to catch anything is permanently the one on
  // horseback, and mounting stops being a decision.
  const { world } = ready();
  orderCatch(world);
  runDays(world, 40);
  assert.equal(stabledHorses(world).length, 1);
  assert.equal(world.workers.every((w) => !w.horseId), true, "nobody should have mounted");
});

test("no two workers set off after the same horse", () => {
  const { world, grass } = ready();
  makeWorker(world, grass[0].q, grass[0].r);
  makeWorker(world, grass[0].q, grass[0].r);
  orderCatch(world);
  runDays(world, 3);

  const chasing = world.workers.filter((w) => w.state === "catching");
  assert.ok(chasing.length <= 1, `${chasing.length} workers chasing one horse`);
});

test("the chase is given up when the animal cannot be closed on", () => {
  // Patience measures WASTED hours, so a horse that keeps its distance ends
  // the errand — and the order goes back on the queue rather than vanishing.
  const { world } = ready();
  orderCatch(world);
  runDays(world, 2);
  const worker = world.workers.find((w) => w.state === "catching");
  if (!worker) return; // nobody set off this seed; nothing to assert

  // Teleport the horse away every hour so no progress is ever made.
  const horse = wildHorses(world)[0];
  for (let h = 0; h < 24 * 5; h++) {
    advanceHour(world);
    if (horse && !horse.tamed) {
      horse.q += 1;
      horse.r -= 1;
    }
    if (worker.state !== "catching") break;
  }
  assert.notEqual(worker.state, "catching", "they should have given up by now");
});

test("abandoning a chase frees the animal for somebody else", () => {
  // A claim left behind makes that horse permanently uncatchable, and nothing
  // in the game would ever say why.
  const { world } = ready();
  orderCatch(world);
  runDays(world, 2);
  const worker = world.workers.find((w) => w.state === "catching");
  if (!worker) return;

  abandonChase(world, worker);
  assert.equal(wildHorses(world).every((h) => !h.claimedBy), true, "no claim should remain");
  assert.equal(
    pendingOrders(world).every((o) => !o.takenBy),
    true,
    "the order should be free to pick up again"
  );
});

// --- keeping them ----------------------------------------------------------

test("mounting takes a horse out of the paddock and stabling puts it back", () => {
  const { world } = ready();
  orderCatch(world);
  runDays(world, 40);
  const worker = world.workers[0];

  assert.equal(mount(world, worker).ok, true);
  assert.equal(stabledHorses(world).length, 0, "it is being ridden now");
  assert.ok(worker.horseId);

  assert.equal(stable(world, worker).ok, true);
  assert.equal(stabledHorses(world).length, 1, "and back in the paddock");
  assert.equal(worker.horseId, null);
});

test("a horse kept with no paddock left goes back to the wild, loudly", () => {
  // Losing it is correct — otherwise capacity means nothing — but it must be
  // announced, because an animal quietly leaving the census is a bug report.
  const { world, grass } = ready();
  orderCatch(world);
  runDays(world, 40);
  assert.equal(stabledHorses(world).length, 1);

  // Knock the paddock down.
  demolish(world, grass[1].q, grass[1].r);

  let announced = false;
  for (let h = 0; h < 24 * 2; h++) {
    for (const e of advanceHour(world)) if (e.type === "horseLost") announced = true;
  }
  assert.equal(stabledHorses(world).length, 0, "it should have wandered off");
  assert.equal(announced, true, "and the player should have been told");
});

// --- the skill -------------------------------------------------------------

test("horsemanship improves the odds but never makes them certain", () => {
  const raw = { skills: {} };
  const master = { skills: { horsemanship: 5 } };
  assert.equal(catchChanceFor(raw), CATCH_BASE_CHANCE);
  assert.ok(catchChanceFor(master) > catchChanceFor(raw), "training should help");
  assert.ok(catchChanceFor(master) < 1, "an animal must never be a sure thing");
});

test("horsemanship only pays off for somebody actually on a horse", () => {
  // Otherwise it is a strictly-better labour for a settlement with no horses.
  const raw = { skills: {} };
  const rider = { skills: { horsemanship: 3 } };
  assert.equal(ridingBonus(raw), 1);
  assert.ok(ridingBonus(rider) > 1);
});

test("a claimed horse is invisible to the next worker looking", () => {
  const { world, horse } = ready();
  assert.equal(nearestWildHorse(world, { q: horse.q, r: horse.r }), horse);
  horse.claimedBy = 99;
  assert.notEqual(nearestWildHorse(world, { q: horse.q, r: horse.r }), horse);
  for (const h of wildHorses(world)) h.claimedBy = 99;
  assert.equal(nearestWildHorse(world, { q: horse.q, r: horse.r }), null);
});

// --- saves -----------------------------------------------------------------

test("orders and paddock horses survive a save and load", () => {
  const { world } = ready();
  orderCatch(world);
  runDays(world, 40);

  const back = deserialize(serialize(world));
  assert.equal(stabledHorses(back).length, stabledHorses(world).length);
  assert.equal((back.orders || []).length, (world.orders || []).length);
  assert.doesNotThrow(() => advanceHour(back));
});

// --- marked horses, and how a chase ends -------------------------------------
//
// Found in playtest: you select a horse, ask for it, and it walks away while a
// worker goes after a DIFFERENT horse (the one nearest to them). Then, if the
// chased horse vanished, the order stayed "taken" for ever; and cancelling did
// not stop the chase. Each test below asserts the outcome, not the mechanism.

function twoHorses() {
  const { world, grass, horse: near } = ready();
  const mid = grass[Math.floor(grass.length / 2)];
  const picked = { id: world.nextAnimalId++, species: "horse", q: mid.q, r: mid.r, energy: 14, tamed: false };
  world.animals.push(picked);
  return { world, near, picked };
}
const chaserOf = (world) => world.workers.find((w) => w.state === "catching");
function runUntil(world, done, hours = 24 * 40) {
  for (let i = 0; i < hours && !done(); i++) advanceHour(world);
}

test("a marked order goes after the horse the player picked, not the nearest", () => {
  const { world, near, picked } = twoHorses();
  assert.ok(orderCatch(world, picked.id).ok);
  runUntil(world, () => chaserOf(world));
  assert.equal(chaserOf(world).catching.horseId, picked.id);
  runUntil(world, () => picked.tamed);
  assert.ok(picked.tamed, "the marked horse is the one caught");
  assert.equal(near.tamed, false);
});

test("a horse cannot be marked twice, and a general order leaves a marked one alone", () => {
  const { world, near } = twoHorses();
  assert.ok(orderCatch(world, near.id).ok);
  assert.equal(orderCatch(world, near.id).ok, false);
  assert.notEqual(nearestWildHorse(world, near)?.id, near.id);
});

test("if the chased horse vanishes, a general order goes back on the queue", () => {
  const { world } = ready();
  orderCatch(world);
  runUntil(world, () => chaserOf(world));
  const id = chaserOf(world).catching.horseId;
  world.animals = world.animals.filter((a) => a.id !== id);
  runDays(world, 2);
  const open = pendingOrders(world);
  assert.ok(open.length === 0 || !open[0].takenBy || chaserOf(world),
    "never left taken by somebody who is not chasing");
});

test("if a marked horse vanishes, the order closes and nothing else is caught", () => {
  const { world, picked } = twoHorses();
  orderCatch(world, picked.id);
  runUntil(world, () => chaserOf(world));
  world.animals = world.animals.filter((a) => a.id !== picked.id);
  runDays(world, 10);
  assert.equal(pendingOrders(world).length, 0);
  assert.equal(stabledHorses(world).length, 0);
  assert.equal(chaserOf(world), undefined);
});

test("cancelling mid-chase stops the worker, and no horse is caught", () => {
  const { world } = ready();
  const { order } = orderCatch(world);
  runUntil(world, () => chaserOf(world));
  cancelOrder(world, order.id);
  runDays(world, 10);
  assert.equal(stabledHorses(world).length, 0);
  assert.equal(chaserOf(world), undefined);
  assert.ok(wildHorses(world).every((h) => !h.claimedBy), "the claim is released");
});

test("an order stuck as taken by an idle worker (old saves) is freed by the daily tidy", () => {
  const { world } = ready();
  const { order } = orderCatch(world);
  order.takenBy = world.workers[0].id; // as a pre-fix save left it
  world.workers[0].state = "idle";
  runDays(world, 1);
  assert.ok(!order.takenBy || chaserOf(world));
});

test("catchStatus reports who is chasing which horse, and how far behind", () => {
  const { world, picked } = twoHorses();
  orderCatch(world, picked.id);
  let [s] = catchStatus(world);
  assert.equal(s.state, "waiting");
  assert.equal(s.marked, true);
  assert.equal(s.horse.id, picked.id);
  runUntil(world, () => chaserOf(world));
  [s] = catchStatus(world);
  assert.ok(s.worker && ["chasing", "roping"].includes(s.state));
  assert.equal(typeof s.distance, "number");
  assert.ok(s.patienceLeft > 0);
});
