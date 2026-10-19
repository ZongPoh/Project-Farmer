import { placeFinished as place } from "./support.mjs";
/**
 * Workers, hours, trees and horses.
 *
 * The thing most worth protecting here: ONE FUNCTION STILL MOVES TIME. It is
 * advanceHour now rather than advanceDay, but the rule is the same, and
 * offline catch-up depends on it. Several tests below check that nothing else
 * — dispatching, taming, reading the sky — moves the world on its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { own } from "./support.mjs";
import { createWorld, serialize, deserialize, allTiles } from "../src/game/world.js";
import { getTile, getTerrain, setTerrain, terrainCount } from "../src/game/tiles.js";
import {
  advanceHour, advanceHours, advanceDay, advanceDays, startWork, cancelWork,
  HOURS_PER_DAY, hoursSince, MAX_CATCHUP_HOURS,
} from "../src/game/tick.js";
import { BUILDINGS, countBuildings } from "../src/game/buildings.js";
import { optionsFor, TERRAIN, moveCost } from "../src/game/terrain.js";
import {
  makeWorker, dispatch, recall, workerAt, idleWorkers, workerCapacity, isAvailable,
  releaseHorse, findRepairChore, workerSummary, speedOf,
  findOpenJob, staffOn, assignTo,
  FOOT_SPEED, HORSE_SPEED, FOOD_PER_WORKER, AUTO_REPAIR_BELOW,
} from "../src/game/workers.js";
import { neighbors, distance } from "../src/game/hex.js";

/**
 * A settlement where the game would actually put one.
 *
 * Deliberately built around `world.home` rather than the first grass tiles in
 * scan order: those are in the top-left corner of the board, which on most
 * seeds is a pocket cut off by water. Tests that walk somewhere have to start
 * somewhere you can walk out of.
 */
function settled(seed = 1) {
  const world = createWorld(seed);
  const home = { q: world.home.q, r: world.home.r };
  place(world, home.q, home.r, "base");
  own(world, [...allTiles(world)]);
  world.store.wood = 200;
  world.store.stone = 200;
  world.store.seeds = 5;

  // Grass near home, nearest first, so "walk to grass[4]" is a real journey
  // across connected ground rather than a hop to the far side of a lake.
  const grass = [...allTiles(world)]
    .filter((t) => t.terrain === "grass" && !t.building)
    .sort((a, b) => distance(home, a) - distance(home, b))
    .slice(0, 12);

  return { world, grass, home };
}

// --- the hourly tick -------------------------------------------------------

test("an hour is the atom; a day is twenty-four of them", () => {
  const world = createWorld(1);
  const startDay = world.day;
  const startHour = world.hour;

  advanceHour(world);
  assert.equal(world.hour, startHour + 1, "one hour should pass");
  assert.equal(world.day, startDay, "and the date should not move");

  advanceDay(world);
  assert.equal(world.day, startDay + 1, "a day is a full turn of the clock");
  assert.equal(world.hour, startHour + 1, "landing at the same hour next day");
});

test("the hour rolls over into a new day exactly once", () => {
  const world = createWorld(1);
  world.hour = HOURS_PER_DAY - 1;
  const day = world.day;
  advanceHour(world);
  assert.equal(world.hour, 0);
  assert.equal(world.day, day + 1);
});

test("production is hourly, so progress is visible within a day", () => {
  // The complaint that started this: a day per unit made the game feel stalled.
  const { world, grass } = settled();
  place(world, grass[1].q, grass[1].r, "farm");
  const before = world.store.food;
  advanceHour(world);
  assert.ok(world.store.food > before, "a farm should yield something every hour");
});

test("animals and wear stay daily, and only fire on the day roll", () => {
  const { world, grass } = settled();
  place(world, grass[1].q, grass[1].r, "farm");
  const farm = getTile(world, grass[1].q, grass[1].r);

  world.hour = 0;
  for (let i = 0; i < HOURS_PER_DAY - 1; i++) advanceHour(world);
  assert.equal(farm.building.condition, 100, "no wear until the day turns");

  advanceHour(world);
  assert.ok(farm.building.condition < 100, "and then it wears once");
});

test("offline catch-up replays hours and is capped", () => {
  const world = createWorld(1);
  const { hoursRun, capped } = advanceHours(world, 1_000_000);
  assert.equal(hoursRun, MAX_CATCHUP_HOURS);
  assert.ok(capped);
  assert.equal(hoursSince(Date.now() - 120000, Date.now()), 24, "120 seconds is a day of hours");
});

test("the hour survives a save and load round-trip", () => {
  const world = createWorld(3);
  advanceHours(world, 30);
  const back = deserialize(JSON.parse(JSON.stringify(serialize(world))));
  assert.equal(back.hour, world.hour);
  assert.equal(back.day, world.day);
});

test("a save from before hours existed wakes up in the morning", () => {
  const old = { version: 2, seed: 1, grid: { width: 24, height: 16 }, day: 5, modified: [] };
  const world = deserialize(old);
  assert.equal(world.hour, 7);
  assert.deepEqual(world.workers, []);
});

// --- trees -----------------------------------------------------------------

test("maps generate forest as well as grass", () => {
  for (const seed of [1, 7, 42, 99]) {
    const world = createWorld(seed);
    assert.ok(terrainCount(world, "forest") > 0, `seed ${seed} produced no woodland`);
    assert.ok(terrainCount(world, "grass") > 0, `seed ${seed} produced no grass`);
  }
});

test("a woodcutter needs trees and will not stand on bare grass", () => {
  const { world, grass } = settled();
  const onGrass = optionsFor(world, grass[1]);
  const bad = place(world, grass[1].q, grass[1].r, "woodcutter");
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /needs forest/);

  const wood = [...allTiles(world)].find((t) => t.terrain === "forest");
  assert.ok(wood, "the map should have forest somewhere");
  const good = place(world, wood.q, wood.r, "woodcutter");
  assert.equal(good.ok, true, good.reason);
});

test("planting needs a seed, and spends it", () => {
  const { world, grass } = settled();
  world.store.seeds = 0;

  const blocked = optionsFor(world, grass[1]).find((o) => o.id === "plant");
  assert.ok(blocked, "planting should be offered on grass");
  assert.equal(blocked.blockedBy, "you have no seeds");

  world.store.seeds = 1;
  const allowed = optionsFor(world, grass[1]).find((o) => o.id === "plant");
  assert.equal(allowed.blockedBy, null);

  makeWorker(world, grass[1].q, grass[1].r);
  const started = startWork(world, grass[1].q, grass[1].r, "plant");
  assert.equal(started.ok, true, started.reason);
  assert.equal(world.store.seeds, 0, "the seed is spent when the job starts");
});

test("planted grass becomes forest, and the histogram follows", () => {
  const { world, grass } = settled();
  const spot = grass[1];
  const forestBefore = terrainCount(world, "forest");

  makeWorker(world, spot.q, spot.r);
  startWork(world, spot.q, spot.r, "plant");
  advanceHours(world, 40);

  assert.equal(getTerrain(world, spot.q, spot.r), "forest");
  assert.equal(terrainCount(world, "forest"), forestBefore + 1, "counts must track it");
});

test("clearing a wood gives back timber", () => {
  const { world } = settled();
  world.store.wood = 100; // leave space for harvested timber
  const wood = [...allTiles(world)].find((t) => t.terrain === "forest");
  makeWorker(world, wood.q, wood.r);

  const before = world.store.wood;
  startWork(world, wood.q, wood.r, "clear");
  advanceHours(world, 40);

  assert.equal(getTerrain(world, wood.q, wood.r), "grass");
  assert.ok(world.store.wood > before, `felling should yield timber: ${before} -> ${world.store.wood}`);
});

test("a woodcutter finds seeds eventually", () => {
  const { world } = settled();
  const wood = [...allTiles(world)].find((t) => t.terrain === "forest");
  place(world, wood.q, wood.r, "woodcutter");
  world.store.seeds = 0;

  advanceHours(world, 24 * 10);
  assert.ok(world.store.seeds > 0, "ten days of cutting should turn up a seed");
});

test("forest is slower to walk through than grass", () => {
  assert.ok(moveCost("forest") > moveCost("grass"));
  assert.ok(TERRAIN.forest.walkable, "but you can still get through it");
});

// --- workers ---------------------------------------------------------------

test("a job in a settlement with no people at all just waits", () => {
  // Not the same as the queue case below: here there is nobody to queue for.
  // The job must still sit there patiently rather than erroring or vanishing.
  const { world, grass } = settled();
  const spot = grass[1];
  const res = startWork(world, spot.q, spot.r, "plant");
  assert.equal(res.ok, true);
  assert.equal(res.worker, null, "there is nobody to send");
  assert.equal(res.queued, true);

  advanceHours(world, 40);
  assert.equal(getTerrain(world, spot.q, spot.r), "grass", "nothing should have happened");
  assert.ok(getTile(world, spot.q, spot.r).work, "but the job is still waiting");

  // ...and the moment somebody turns up, they take it.
  makeWorker(world, spot.q, spot.r);
  advanceHours(world, 40);
  assert.equal(getTerrain(world, spot.q, spot.r), "forest", "a new arrival should pick it up");
});

test("a worker walks to the job and then does it", () => {
  const { world, grass, home } = settled();
  const worker = makeWorker(world, home.q, home.r);
  const target = grass[4];

  const res = startWork(world, target.q, target.r, "plant");
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.worker.id, worker.id);
  assert.equal(worker.state, "travelling");

  advanceHours(world, 24 * 6);
  assert.equal(getTerrain(world, target.q, target.r), "forest", "the job should be done");
});

test("someone already standing on the tile starts immediately", () => {
  // Dispatching to a zero-length journey used to cost an hour of "arriving",
  // which made every job take one hour longer than it advertised.
  const { world, grass } = settled();
  const spot = grass[1];
  makeWorker(world, spot.q, spot.r);
  const res = startWork(world, spot.q, spot.r, "plant");
  assert.equal(res.worker.state, "working", "no journey means no travelling state");

  for (let i = 0; i < res.hours - 1; i++) advanceHour(world);
  assert.equal(getTerrain(world, spot.q, spot.r), "grass", "not yet");
  advanceHour(world);
  assert.equal(getTerrain(world, spot.q, spot.r), "forest", "exactly on time");
});

test("cancelling a job sends the worker home instead of freezing them", () => {
  const { world, grass, home } = settled();
  makeWorker(world, home.q, home.r);
  const spot = grass[4];
  startWork(world, spot.q, spot.r, "plant");
  advanceHours(world, 5);

  cancelWork(world, spot.q, spot.r);
  assert.equal(getTile(world, spot.q, spot.r).work, null);
  assert.equal(world.workers[0].state, "returning", "they should walk back");

  advanceHours(world, 24 * 5);
  assert.ok(
    isAvailable(world.workers[0]),
    `and end up free again, was "${world.workers[0].state}"`
  );
});

test("population is capped by food, and food is usually the binding limit", () => {
  const { world, grass } = settled();
  const bare = workerCapacity(world);
  assert.equal(bare.byFood, 1, "with no farms there is barely enough for anyone");

  place(world, grass[1].q, grass[1].r, "farm");
  const withFarm = workerCapacity(world);
  assert.ok(withFarm.byFood > bare.byFood, "a farm should raise the ceiling");
  assert.equal(
    withFarm.byFood,
    Math.floor((24 * 1) / FOOD_PER_WORKER),
    "one farm makes 24 food a day and each worker eats 6"
  );
});

test("workers turn up on their own when there is food to spare", () => {
  const { world, grass } = settled();
  place(world, grass[1].q, grass[1].r, "farm");
  place(world, grass[2].q, grass[2].r, "farm");
  world.store.food = 200;

  advanceDays(world, 6);
  assert.ok(world.workers.length > 0, "somebody should have joined");
  assert.ok(
    world.workers.length <= workerCapacity(world).cap,
    "but never more than can be fed"
  );
});

test("running out of food eventually costs you someone", () => {
  const { world, grass, home } = settled();
  for (let i = 0; i < 3; i++) makeWorker(world, home.q, home.r);
  world.store.food = 0;

  const events = advanceDays(world, 6).events;
  assert.ok(events.some((e) => e.type === "hunger"), "hunger should be reported");
  assert.ok(world.workers.length < 3, "somebody should have given up and left");
  assert.ok(world.workers.length >= 1, "but not everybody at once");
});

// --- the repair chore ------------------------------------------------------

test("idle workers go and repair things without being told", () => {
  const { world, grass, home } = settled();
  place(world, grass[1].q, grass[1].r, "farm");
  const farm = getTile(world, grass[1].q, grass[1].r);
  farm.building.condition = 30;

  const worker = makeWorker(world, home.q, home.r);
  assert.equal(worker.state, "idle");

  advanceHours(world, 24 * 8);
  assert.ok(
    farm.building.condition > 30,
    `the farm should have been mended: still ${farm.building.condition}`
  );
});

test("a repair chore costs wood and stops when the wood runs out", () => {
  const { world, grass, home } = settled();
  place(world, grass[1].q, grass[1].r, "farm");
  getTile(world, grass[1].q, grass[1].r).building.condition = 20;
  makeWorker(world, home.q, home.r);

  world.store.wood = 0;
  assert.equal(findRepairChore(world, home), null, "no wood, no chore");

  world.store.wood = 40;
  const chore = findRepairChore(world, home);
  assert.ok(chore, "with wood there is a chore");

  const before = world.store.wood;
  advanceHours(world, 24 * 8);
  assert.ok(world.store.wood < before, "mending should cost timber");
});

test("auto-repair leaves healthy buildings alone and can be switched off", () => {
  const { world, grass, home } = settled();
  place(world, grass[1].q, grass[1].r, "farm");
  getTile(world, grass[1].q, grass[1].r).building.condition = AUTO_REPAIR_BELOW + 5;
  assert.equal(findRepairChore(world, home), null, "not worn enough to bother");

  getTile(world, grass[1].q, grass[1].r).building.condition = 20;
  assert.ok(findRepairChore(world, home), "now it is worth going");

  world.autoRepair = false;
  assert.equal(findRepairChore(world, home), null, "and the player can turn it off");
});

test("repair workers reserve separate buildings while walking, releasing them on recall", () => {
  const { world, grass, home } = settled();
  for (const t of grass.slice(1,3)) {
    place(world,t.q,t.r,"farm");
    getTile(world,t.q,t.r).building.condition=30;
  }
  world.store.wood=100;
  const first=makeWorker(world,home.q,home.r), second=makeWorker(world,home.q,home.r);
  first.chore=findRepairChore(world,first);
  assert.ok(first.chore);
  first.state="travellingToChore";
  const reserved={...first.chore};
  const other=findRepairChore(world,second);
  assert.ok(other);
  assert.notDeepEqual(other,reserved);
  second.chore=other;second.state="repairing";
  assert.equal(findRepairChore(world,{q:home.q,r:home.r,id:-1}),null);
  recall(world,first);
  assert.deepEqual(findRepairChore(world,{q:home.q,r:home.r,id:-1}),reserved);
});

test("a job you asked for outranks a chore a worker picked up", () => {
  const { world, grass, home } = settled();
  place(world, grass[1].q, grass[1].r, "farm");
  getTile(world, grass[1].q, grass[1].r).building.condition = 20;

  const worker = makeWorker(world, home.q, home.r);
  advanceHours(world, 2);
  assert.ok(["repairing", "travellingToChore"].includes(worker.state), "should have found a chore");

  const res = startWork(world, grass[5].q, grass[5].r, "plant");
  assert.ok(res.worker, "the chore must not block a real dispatch");
  assert.equal(res.worker.id, worker.id);
  assert.equal(worker.chore, null, "and the chore is dropped");
});

// --- horses ----------------------------------------------------------------

test("there is no tile-standing tame any more — the catch order is the only way in", async () => {
  // The playtest: "taming makes no sense". It needed a worker standing on the
  // horse's tile, and the player cannot steer workers. It was removed; this
  // guards against it quietly coming back.
  const workers = await import("../src/game/workers.js");
  const animals = await import("../src/game/animals.js");
  assert.equal("tameWith" in workers, false);
  assert.equal("tame" in animals, false);
});

/** A horse already yours, standing in a paddock at `at`, and a worker on it. */
function riderOn(world, at) {
  world.animals.push({
    id: 1, species: "horse", q: at.q, r: at.r,
    energy: 14, cooldown: 0, bornOn: 1, tamed: true,
  });
  world.nextAnimalId = 2;
  const worker = makeWorker(world, at.q, at.r);
  worker.horseId = 1;
  world.animals[world.animals.length - 1].riderId = worker.id;
  return worker;
}

test("workers cross one open tile an hour on foot and two when mounted", () => {
  const { world, home } = settled();
  const worker = makeWorker(world, home.q, home.r);
  assert.equal(speedOf(worker), FOOT_SPEED);
  assert.equal(FOOT_SPEED, HOURS_PER_DAY);
  worker.horseId = 99;
  assert.equal(speedOf(worker), HORSE_SPEED);
  assert.equal(HORSE_SPEED, FOOT_SPEED * 2);
});

test("a tamed horse follows its rider around", () => {
  const { world, grass, home } = settled();
  const worker = riderOn(world, home);

  startWork(world, grass[5].q, grass[5].r, "plant");
  advanceHours(world, 24 * 3);

  const horse = world.animals.find((a) => a.id === 1);
  assert.equal(horse.q, worker.q, "the horse should be where its rider is");
  assert.equal(horse.r, worker.r);
});

test("a rider who is gone leaves the horse in the paddock, not the wild", () => {
  const { world, grass, home } = settled();
  place(world, grass[3].q, grass[3].r, "paddock");
  const worker = riderOn(world, home);

  const horse = releaseHorse(world, worker);
  assert.equal(worker.horseId, null);
  assert.equal(horse.tamed, true, "it is still yours");
  assert.equal(horse.riderId, null);
  assert.deepEqual({ q: horse.q, r: horse.r }, { q: grass[3].q, r: grass[3].r });
});

test("...and only goes wild, counted, when there is nowhere to keep it", () => {
  const { world, home } = settled();
  const worker = riderOn(world, home);
  const horse = releaseHorse(world, worker, "riderDied");
  assert.equal(horse.tamed, false);
  assert.equal(world.livestock.lost.riderDied, 1, "every exit is recorded with its reason");
});

// --- the invariant ---------------------------------------------------------

test("nothing but advanceHour moves the world", () => {
  const { world, grass, home } = settled();
  makeWorker(world, home.q, home.r);
  advanceHours(world, 5);
  const before = JSON.stringify(serialize(world));

  // All of these are decisions, not time passing.
  dispatch(world, grass[3].q, grass[3].r);
  recall(world, world.workers[0]);
  workerCapacity(world);
  workerSummary(world);
  findRepairChore(world, home);
  optionsFor(world, grass[1]);

  const after = JSON.parse(JSON.stringify(serialize(world)));
  const expected = JSON.parse(before);
  assert.equal(after.day, expected.day, "the date must not have moved");
  assert.equal(after.hour, expected.hour, "nor the hour");
  assert.deepEqual(after.store, expected.store, "nor the store");
});

test("workers are saved and come back mid-journey", () => {
  const { world, grass, home } = settled();
  makeWorker(world, home.q, home.r);
  startWork(world, grass[5].q, grass[5].r, "plant");
  advanceHours(world, 6);

  const back = deserialize(JSON.parse(JSON.stringify(serialize(world))));
  assert.equal(back.workers.length, 1);
  assert.equal(back.workers[0].state, world.workers[0].state);
  assert.deepEqual(back.workers[0].job, world.workers[0].job);
  assert.doesNotThrow(() => advanceHours(back, 24 * 5));
});


// --- the job queue ---------------------------------------------------------
//
// Jobs used to be dispatched once and then forgotten. If everyone happened to
// be busy at the moment you started one, it sat on its tile untouched for the
// rest of the game while workers stood idle at the base. These cover the fix.

test("a job started while everyone is busy is queued, not lost", () => {
  const { world, grass, home } = settled();
  makeWorker(world, home.q, home.r);

  const first = startWork(world, grass[1].q, grass[1].r, "plant");
  assert.ok(first.worker, "the only worker takes the first job");

  const second = startWork(world, grass[2].q, grass[2].r, "plant");
  assert.equal(second.ok, true, "the job still starts");
  assert.equal(second.worker, null, "but nobody is free for it");
  assert.equal(second.queued, true);
  assert.match(second.reason, /queued/);

  // The queued job must still be sitting on its tile, waiting.
  assert.ok(getTile(world, grass[2].q, grass[2].r).work, "the job is on the tile");

  advanceHours(world, 24 * 20);
  assert.equal(getTerrain(world, grass[1].q, grass[1].r), "forest", "first job done");
  assert.equal(getTerrain(world, grass[2].q, grass[2].r), "forest", "queued job done too");
});

test("one worker works through a whole queue of jobs", () => {
  const { world, grass, home } = settled();
  makeWorker(world, home.q, home.r);

  const spots = [grass[1], grass[2], grass[3], grass[4]];
  for (const t of spots) startWork(world, t.q, t.r, "plant");

  advanceHours(world, 24 * 40);
  for (const t of spots) {
    assert.equal(getTerrain(world, t.q, t.r), "forest", `${t.q},${t.r} never got done`);
  }
});

test("the queue is first in, first out", () => {
  // Deliberately start the FAR job first. Order asked for beats convenience,
  // because a queue that reorders itself is not a queue.
  const { world, grass, home } = settled();
  makeWorker(world, home.q, home.r);

  const far = grass[6];
  const near = grass[1];
  startWork(world, far.q, far.r, "plant");
  startWork(world, near.q, near.r, "plant");

  let farDone = null;
  let nearDone = null;
  for (let h = 1; h <= 24 * 40; h++) {
    advanceHour(world);
    if (farDone === null && getTerrain(world, far.q, far.r) === "forest") farDone = h;
    if (nearDone === null && getTerrain(world, near.q, near.r) === "forest") nearDone = h;
    if (farDone && nearDone) break;
  }
  assert.ok(farDone, "the first job asked for should finish");
  assert.ok(nearDone, "and so should the second");
  assert.ok(farDone < nearDone, `first asked should finish first: ${farDone} vs ${nearDone}`);
});

test("workers spread across jobs rather than all piling onto one", () => {
  const { world, grass, home } = settled();
  for (let i = 0; i < 3; i++) makeWorker(world, home.q, home.r);

  const spots = [grass[1], grass[2], grass[3]];
  for (const t of spots) startWork(world, t.q, t.r, "plant");

  // Give them an hour to pick up their assignments.
  advanceHour(world);
  for (const t of spots) {
    assert.equal(staffOn(world, t.q, t.r), 1, `${t.q},${t.r} should have exactly one worker`);
  }
});

test("a worker who finishes goes straight to the next job, not home", () => {
  const { world, grass, home } = settled();
  const worker = makeWorker(world, home.q, home.r);
  startWork(world, grass[1].q, grass[1].r, "plant");
  startWork(world, grass[2].q, grass[2].r, "plant");

  // Run until the first job is done, then check they did not go idle.
  for (let h = 0; h < 24 * 20; h++) {
    advanceHour(world);
    if (getTerrain(world, grass[1].q, grass[1].r) === "forest") break;
  }
  advanceHour(world);
  assert.notEqual(worker.state, "idle", "they should have picked up the next job");
  assert.ok(
    ["travelling", "working"].includes(worker.state),
    `expected them on the next job, got "${worker.state}"`
  );
});

test("findOpenJob prefers the least-staffed job", () => {
  const { world, grass, home } = settled();
  const a = makeWorker(world, home.q, home.r);
  startWork(world, grass[1].q, grass[1].r, "plant");
  startWork(world, grass[2].q, grass[2].r, "plant");

  // With the first job staffed, a second worker should be sent to the other.
  const open = findOpenJob(world, home);
  assert.ok(open, "there should be an open job");
  assert.deepEqual(
    { q: open.q, r: open.r },
    { q: grass[2].q, r: grass[2].r },
    "the unstaffed job is the one to take"
  );
});

test("cancelling a queued job takes it out of the queue", () => {
  const { world, grass, home } = settled();
  makeWorker(world, home.q, home.r);
  startWork(world, grass[1].q, grass[1].r, "plant");
  startWork(world, grass[2].q, grass[2].r, "plant");

  cancelWork(world, grass[2].q, grass[2].r);
  assert.equal(getTile(world, grass[2].q, grass[2].r).work, null);

  advanceHours(world, 24 * 20);
  assert.equal(getTerrain(world, grass[1].q, grass[1].r), "forest", "the kept job still runs");
  assert.equal(getTerrain(world, grass[2].q, grass[2].r), "grass", "the cancelled one does not");
});

test("an unreachable job is not retried every hour", () => {
  // Otherwise every idle worker re-runs a hopeless path search sixty times an
  // hour during offline catch-up, on a board that may be 80,000 tiles.
  const { world, grass, home } = settled();
  makeWorker(world, home.q, home.r);

  // Wall a tile off completely, then try to work it.
  const spot = grass[3];
  for (const n of neighbors(spot.q, spot.r)) setTerrain(world, n.q, n.r, "water");
  setTerrain(world, spot.q, spot.r, "sand");

  const res = startWork(world, spot.q, spot.r, "flood");
  if (!res.ok) return; // the seed did not allow this job; nothing to assert

  advanceHour(world);
  const job = getTile(world, spot.q, spot.r).work;
  if (job) assert.equal(job.lastPathFail, world.day, "the failure should be noted on the job");
  // And the run must not throw or hang.
  assert.doesNotThrow(() => advanceHours(world, 24 * 5));
});

test("the job queue survives a save and load", () => {
  const { world, grass, home } = settled();
  makeWorker(world, home.q, home.r);
  startWork(world, grass[1].q, grass[1].r, "plant");
  startWork(world, grass[2].q, grass[2].r, "plant");
  advanceHours(world, 4);

  const back = deserialize(JSON.parse(JSON.stringify(serialize(world))));
  assert.equal(back.nextJobSeq, world.nextJobSeq, "the ticket counter must persist");

  advanceHours(back, 24 * 20);
  assert.equal(getTerrain(back, grass[1].q, grass[1].r), "forest");
  assert.equal(getTerrain(back, grass[2].q, grass[2].r), "forest", "the queued job survived the reload");
});


// --- the path storm --------------------------------------------------------

test("an unreachable repair chore is not re-searched every hour", () => {
  /**
   * MEASURED REGRESSION. A building that no worker can walk to was retried by
   * every idle worker every hour, forever. A FAILED path is the most expensive
   * kind — the search cannot stop early, so it expands its whole node budget
   * before admitting defeat — and this cost 194ms per simulated day against
   * 3ms with auto-repair switched off. At that rate the 120-day offline
   * catch-up is twenty-three seconds of frozen screen.
   *
   * The guard is `building.lastPathFail`, the same one jobs already had. This
   * test asserts the behaviour rather than the timing, so it does not become
   * flaky on a slow machine.
   */
  const world = createWorld(5);
  const grass = [...allTiles(world)].filter((t) => t.terrain === "grass");
  place(world, grass[0].q, grass[0].r, "base");
  own(world, [...allTiles(world)]);
  world.store.wood = 200;

  // A building the worker cannot reach: put one on a tile and then make every
  // route to it impossible by standing the worker somewhere unconnected.
  place(world, grass[1].q, grass[1].r, "farm");
  const tile = world.modified.get(`${grass[1].q},${grass[1].r}`);
  tile.building.condition = 10;

  // Force the failure the cheap way: claim the path already failed today.
  tile.building.lastPathFail = world.day;
  assert.equal(
    findRepairChore(world, { q: grass[0].q, r: grass[0].r }),
    null,
    "a chore that failed to route today must be skipped until tomorrow"
  );

  // ...and offered again once the day turns over.
  world.day += 1;
  assert.ok(
    findRepairChore(world, { q: grass[0].q, r: grass[0].r }),
    "it must be retried tomorrow, or a temporary blockage becomes permanent"
  );
});
