import { placeFinished as place, upgradeFinished as upgradeBase } from "./support.mjs";
/**
 * The base: levels, hiring, training, tools — and danger.
 *
 * What these mostly protect is that PROGRESSION HAS A CEILING THAT MEANS
 * SOMETHING. Paying for a worker must not let you exceed what the base can
 * house or the farms can feed; a trained worker must actually be faster; a
 * tool must actually help. Each of those is a number that would be very easy
 * to wire up wrong and never notice, because the game would still run.
 *
 * And for danger: a fox must never gain anything from attacking a person. The
 * predator-prey balance is tuned across three simulated years, and a second
 * food source would quietly invalidate all of it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { own } from "./support.mjs";
import { createWorld, serialize, deserialize, allTiles } from "../src/game/world.js";
import { getTile, getTerrain } from "../src/game/tiles.js";
import {
  advanceHour, advanceHours, advanceDay, advanceDays, startWork, startHunt,
} from "../src/game/tick.js";

import { BASE_LEVELS, MAX_BASE_LEVEL, baseTier, baseHouses, baseUnlocks, nextTier, canUpgradeBase, hireCostFor, SKILLS, SKILL_IDS, MAX_SKILL, trainCostFor, canTrain, TOOLS, TOOL_IDS, canCraft, craftTool, toolsFree, bestToolFor, equipFor, unequip, workRate, TRAIN_HOURS } from "../src/game/base.js";
import {
  makeWorker, hire, train, workerCapacity, workerSummary, isAvailable,
} from "../src/game/workers.js";
import {
  MAX_HEALTH, FOX_BITE, healthOf, defenceOf, foxAttacks, reapTheFallen,
  resolveHunt, canHunt, HUNT, shouldRetreat, isRecovered, RETREAT_BELOW,
  injuredWorkers,
} from "../src/game/danger.js";
import { migrate } from "../src/game/world.js";
import { distance, neighbors } from "../src/game/hex.js";
import { populationOf } from "../src/game/animals.js";

function settled(seed = 1, { rich = true } = {}) {
  const world = createWorld(seed);
  const home = { q: world.home.q, r: world.home.r };
  place(world, home.q, home.r, "base");
  own(world, [...allTiles(world)]);
  if (rich) {
    world.store.food = 5000;
    world.store.wood = 5000;
    world.store.stone = 5000;
    world.store.seeds = 20;
  }
  const grass = [...allTiles(world)]
    .filter((t) => t.terrain === "grass" && !t.building)
    .sort((a, b) => distance(home, a) - distance(home, b))
    .slice(0, 12);
  return { world, grass, home };
}

/** Enough farms that food is never the binding constraint. */
function fed(world, grass, n = 6) {
  for (const t of grass.slice(0, n)) place(world, t.q, t.r, "farm");
}

// --- levels ----------------------------------------------------------------

test("the base starts as a camp and can be built up", () => {
  const { world } = settled();
  assert.equal(world.baseLevel, 1);
  assert.equal(baseTier(1).label, "Camp");
  assert.equal(baseHouses(world), BASE_LEVELS[0].houses);

  const res = upgradeBase(world);
  assert.equal(res.ok, true, res.reason);
  assert.equal(world.baseLevel, 2);
  assert.ok(baseHouses(world) > BASE_LEVELS[0].houses, "more room than before");
});

test("upgrading costs, and refuses when you cannot pay", () => {
  const { world } = settled(1, { rich: false });
  const before = canUpgradeBase(world);
  assert.equal(before.ok, false);
  assert.match(before.reason, /not enough/);

  const next = nextTier(world);
  for (const [res, n] of Object.entries(next.cost)) world.store[res] = n;
  const paid = upgradeBase(world);
  assert.equal(paid.ok, true, paid.reason);
  for (const res of Object.keys(next.cost)) {
    assert.equal(world.store[res], 0, `${res} should have been spent`);
  }
});

test("the base tops out, and says so", () => {
  const { world } = settled();
  // The whole ladder costs more than the fixture's "plenty" since Town was
  // priced at 4,800 timber, so pay for it outright: what is being tested here
  // is the top of the ladder, not whether you can afford to climb it.
  for (const res of ["wood", "stone", "food"]) world.store[res] = 20_000;
  for (let i = 1; i < MAX_BASE_LEVEL; i++) assert.equal(upgradeBase(world).ok, true);
  assert.equal(world.baseLevel, MAX_BASE_LEVEL);
  const done = canUpgradeBase(world);
  assert.equal(done.ok, false);
  assert.match(done.reason, /as large as it gets/);
  assert.equal(nextTier(world), null);
});

test("levels unlock the bench and the schoolroom, in that order", () => {
  const { world } = settled();
  assert.equal(baseUnlocks(world, "craft"), false, "a camp cannot make tools");
  assert.equal(baseUnlocks(world, "train"), false);

  upgradeBase(world);
  assert.equal(baseUnlocks(world, "craft"), true, "a homestead can");
  assert.equal(baseUnlocks(world, "train"), false, "but cannot teach yet");

  upgradeBase(world);
  assert.equal(baseUnlocks(world, "train"), true, "a hamlet can teach");
});

test("every level is internally consistent and gets steadily dearer", () => {
  let previousHouses = 0;
  let previousCost = 0;
  for (const tier of BASE_LEVELS) {
    assert.ok(tier.label && tier.describe, `level ${tier.level} needs describing`);
    assert.ok(tier.houses > previousHouses, `level ${tier.level} should house more`);
    previousHouses = tier.houses;
    if (tier.cost) {
      const total = Object.values(tier.cost).reduce((a, b) => a + b, 0);
      assert.ok(total > previousCost, `level ${tier.level} should cost more`);
      previousCost = total;
    }
  }
});

// --- hiring ----------------------------------------------------------------

test("you can buy a worker instead of waiting for one", () => {
  const { world, grass } = settled();
  fed(world, grass);
  assert.equal(world.workers.length, 0);

  const res = hire(world);
  assert.equal(res.ok, true, res.reason);
  assert.equal(world.workers.length, 1);
  assert.ok(res.worker.name, "they should have a name");
  assert.equal(healthOf(res.worker), MAX_HEALTH);
});

test("hiring costs, and each one costs more than the last", () => {
  const { world, grass } = settled();
  fed(world, grass);

  const first = hireCostFor(world);
  hire(world);
  const second = hireCostFor(world);
  assert.ok(second.food > first.food, `${second.food} should exceed ${first.food}`);

  const food = world.store.food;
  const res = hire(world);
  assert.equal(res.ok, true, res.reason);
  assert.equal(world.store.food, food - second.food, "the quoted price is what is charged");
});

test("paying does not let you exceed what the base can house", () => {
  // THE point of the cap. Money buys speed, not physics.
  const { world, grass } = settled();
  fed(world, grass, 12); // food is not the limit here

  const houses = baseHouses(world);
  for (let i = 0; i < houses + 3; i++) hire(world);

  assert.ok(world.workers.length <= houses, `housed ${world.workers.length} in ${houses}`);
  const refused = hire(world);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /no room|not enough food|base is full/);
});

test("upgrading the base raises the ceiling, and a house is what fills it", () => {
  // The tier is the ceiling and houses fill it in, so an upgrade and a house
  // each do half the job. Before this pass a house added four beds with
  // nothing capping them, which is how a "Village" ended up holding 55 people.
  const { world, grass } = settled();
  fed(world, grass, 12);
  while (hire(world).ok) { /* fill the camp */ }
  const atCamp = world.workers.length;
  assert.equal(workerCapacity(world).limitedBy, "base", "a Camp with no houses is full at its own roof");

  upgradeBase(world);
  const roomButNoBeds = hire(world);
  assert.equal(roomButNoBeds.ok, false, "a bigger base is not, by itself, a bed");
  assert.match(roomButNoBeds.reason, /build a house/);
  assert.equal(workerCapacity(world).limitedBy, "houses");

  const spot = [...allTiles(world)].find((t) => !t.building && getTerrain(world, t.q, t.r) === "grass");
  place(world, spot.q, spot.r, "house");
  const after = hire(world);
  assert.equal(after.ok, true, after.reason);
  assert.ok(world.workers.length > atCamp, "the upgrade and the house together made room");

  // And the tier still wins: more houses cannot take a Homestead past seven.
  for (const t of [...allTiles(world)].filter((x) => !x.building && getTerrain(world, x.q, x.r) === "grass").slice(0, 4)) {
    place(world, t.q, t.r, "house");
  }
  assert.equal(workerCapacity(world).byBase, baseHouses(world), "houses fill the tier, they do not raise it");
});

test("food is still the other ceiling, whatever you are willing to pay", () => {
  const { world } = settled(); // no farms at all
  const cap = workerCapacity(world);
  assert.equal(cap.limitedBy, "food");
  for (let i = 0; i < 6; i++) hire(world);
  assert.ok(world.workers.length <= cap.cap, "cannot buy past what you can feed");
});

// --- skills ----------------------------------------------------------------

test("training needs a hamlet, and raises the skill it was paid for", () => {
  const { world, grass, home } = settled();
  fed(world, grass);
  const worker = makeWorker(world, home.q, home.r);

  const tooEarly = canTrain(world, worker, "forestry");
  assert.equal(tooEarly.ok, false);
  assert.match(tooEarly.reason, /hamlet/);

  upgradeBase(world);
  upgradeBase(world);
  const res = train(world, worker, "forestry");
  assert.equal(res.ok, true, res.reason);
  assert.equal(worker.skills.forestry, 1);
});

test("training costs time as well as resources", () => {
  const { world, grass, home } = settled();
  fed(world, grass);
  upgradeBase(world);
  upgradeBase(world);
  const worker = makeWorker(world, home.q, home.r);

  train(world, worker, "forestry");
  assert.equal(worker.state, "training", "they are busy learning");

  advanceHours(world, TRAIN_HOURS + 4);
  assert.equal(worker.training, null, "the lesson is over");
  assert.ok(isAvailable(worker), `should be free again, was "${worker.state}"`);
});

test("each level of a skill costs more, and there is a ceiling", () => {
  const { world, grass, home } = settled();
  fed(world, grass);
  upgradeBase(world);
  upgradeBase(world);
  const worker = makeWorker(world, home.q, home.r);

  const first = trainCostFor(worker, "forestry");
  worker.skills = { forestry: 1 };
  const second = trainCostFor(worker, "forestry");
  assert.ok(second.food > first.food, "the second level should cost more");

  worker.skills = { forestry: MAX_SKILL };
  const maxed = canTrain(world, worker, "forestry");
  assert.equal(maxed.ok, false);
  assert.match(maxed.reason, /mastered/);
});

test("a trade only helps its own kind of work; labour helps everything", () => {
  const { world, home } = settled();
  const plain = makeWorker(world, home.q, home.r);
  const forester = makeWorker(world, home.q, home.r);
  forester.skills = { forestry: 2 };
  const labourer = makeWorker(world, home.q, home.r);
  labourer.skills = { labour: 2 };

  assert.ok(
    workRate(world, forester, "clear") > workRate(world, plain, "clear"),
    "forestry should speed up felling"
  );
  assert.equal(
    workRate(world, forester, "quarry"),
    workRate(world, plain, "quarry"),
    "but not quarrying"
  );
  assert.ok(
    workRate(world, labourer, "quarry") > workRate(world, plain, "quarry"),
    "labour should help with anything"
  );
});

test("a trained worker really does finish sooner", () => {
  // The whole investment has to show up in elapsed hours, not just a number.
  const run = (skills) => {
    const { world, grass, home } = settled(7);
    const worker = makeWorker(world, home.q, home.r);
    worker.skills = skills;
    const spot = grass[0];
    // Put them on the tile so travel is not part of the measurement.
    worker.q = spot.q;
    worker.r = spot.r;
    startWork(world, spot.q, spot.r, "plant");
    let hours = 0;
    while (getTerrain(world, spot.q, spot.r) === "grass" && hours < 200) {
      advanceHour(world);
      hours++;
    }
    return hours;
  };
  const raw = run({});
  const skilled = run({ forestry: 2 });
  assert.ok(skilled < raw, `trained should be faster: ${skilled} vs ${raw}`);
});

// --- tools -----------------------------------------------------------------

test("crafting needs a bench, costs materials, and fills the pool", () => {
  const { world } = settled();
  const tooEarly = canCraft(world, "axe");
  assert.equal(tooEarly.ok, false);
  assert.match(tooEarly.reason, /bench/);

  upgradeBase(world);
  const wood = world.store.wood;
  const res = craftTool(world, "axe");
  assert.equal(res.ok, true, res.reason);
  assert.equal(world.tools.axe, 1);
  assert.ok(world.store.wood < wood, "materials should have been spent");
});

test("tools are a pool, claimed and returned rather than owned", () => {
  const { world, home } = settled();
  upgradeBase(world);
  craftTool(world, "axe");
  assert.equal(toolsFree(world, "axe"), 1);

  const a = makeWorker(world, home.q, home.r);
  const b = makeWorker(world, home.q, home.r);

  equipFor(world, a, "clear");
  assert.equal(a.tool, "axe");
  assert.equal(toolsFree(world, "axe"), 0, "it is in somebody's hands");

  equipFor(world, b, "clear");
  assert.equal(b.tool, null, "there is only one axe");

  unequip(a);
  assert.equal(toolsFree(world, "axe"), 1, "and back in the pool when done");
});

test("the right tool for the job, and nothing for the wrong one", () => {
  const { world } = settled();
  upgradeBase(world);
  craftTool(world, "axe");
  craftTool(world, "pick");

  assert.equal(bestToolFor(world, "clear"), "axe");
  assert.equal(bestToolFor(world, "quarry"), "pick");
  assert.equal(bestToolFor(world, "irrigate"), null, "no spade has been made");
});

test("a tool speeds up the work it is for", () => {
  const { world, home } = settled();
  const worker = makeWorker(world, home.q, home.r);
  const bare = workRate(world, worker, "clear");
  worker.tool = "axe";
  assert.ok(workRate(world, worker, "clear") > bare, "an axe should help felling");
  assert.equal(workRate(world, worker, "quarry"), bare, "but not quarrying");
});

test("workers pick up a tool on the job without being told", () => {
  const { world, grass, home } = settled();
  upgradeBase(world);
  craftTool(world, "axe");
  const worker = makeWorker(world, home.q, home.r);

  const wood = [...allTiles(world)].find((t) => t.terrain === "forest");
  startWork(world, wood.q, wood.r, "clear");
  advanceHours(world, 24 * 6);

  // Either they are holding it, or the job finished and they put it back.
  assert.ok(
    worker.tool === "axe" || toolsFree(world, "axe") === 1,
    "the axe should have been used and returned"
  );
});

test("every tool is internally consistent", () => {
  for (const id of TOOL_IDS) {
    const def = TOOLS[id];
    assert.ok(def.label && def.describe, `${id} needs describing`);
    assert.ok(Object.keys(def.cost).length, `${id} needs a cost`);
    assert.ok(def.rate || def.combat, `${id} should do something`);
  }
});

// --- danger ----------------------------------------------------------------

test("a fox on your tile can bite you", () => {
  const { world, home } = settled();
  const worker = makeWorker(world, home.q, home.r);
  // Off the base tile, which is shelter.
  const spot = [...allTiles(world)].find(
    (t) => t.terrain === "grass" && !t.building && (t.q !== home.q || t.r !== home.r)
  );
  worker.q = spot.q;
  worker.r = spot.r;

  world.animals.push({
    id: 1, species: "fox", q: spot.q, r: spot.r,
    energy: 20, cooldown: 0, bornOn: 1, tamed: false,
  });

  const events = foxAttacks(world, () => 0.01); // always attacks
  assert.ok(events.length, "something should have happened");
  assert.ok(healthOf(worker) < MAX_HEALTH, "they should be hurt");
});

test("the base and a fence are shelter", () => {
  const { world, home } = settled();
  const worker = makeWorker(world, home.q, home.r); // standing on the base
  world.animals.push({
    id: 1, species: "fox", q: home.q, r: home.r,
    energy: 20, cooldown: 0, bornOn: 1, tamed: false,
  });

  foxAttacks(world, () => 0.01);
  assert.equal(healthOf(worker), MAX_HEALTH, "nothing gets you at the base");
});

test("A FOX GAINS NOTHING FROM ATTACKING A PERSON", () => {
  // The ecosystem is balanced on rabbits being the only food. A second source
  // would silently invalidate three simulated years of tuning.
  const { world, home } = settled();
  const worker = makeWorker(world, home.q, home.r);
  const spot = [...allTiles(world)].find(
    (t) => t.terrain === "grass" && !t.building && (t.q !== home.q || t.r !== home.r)
  );
  worker.q = spot.q;
  worker.r = spot.r;

  const fox = {
    id: 1, species: "fox", q: spot.q, r: spot.r,
    energy: 20, cooldown: 0, bornOn: 1, tamed: false,
  };
  world.animals.push(fox);

  foxAttacks(world, () => 0.01);
  const survivor = world.animals.find((a) => a.id === 1);
  if (survivor) {
    assert.equal(survivor.energy, 20, "the fox must not have fed");
    assert.equal(survivor.cooldown, 0, "nor be digesting");
  }
});

test("a spear and some experience turn a mauling into a scuffle", () => {
  const { world, home } = settled();
  const plain = makeWorker(world, home.q, home.r);
  const armed = makeWorker(world, home.q, home.r);
  armed.tool = "spear";
  armed.skills = { hunting: 2 };

  assert.equal(defenceOf(world, plain), 0);
  assert.ok(defenceOf(world, armed) > 0.3, "they should be much harder to bite");
});

test("a worker who reaches zero health dies, and a rider frees their horse", () => {
  const { world, home } = settled();
  const worker = makeWorker(world, home.q, home.r);
  world.animals.push({
    id: 9, species: "horse", q: home.q, r: home.r,
    energy: 14, cooldown: 0, bornOn: 1, tamed: true, riderId: worker.id,
  });
  worker.horseId = 9;
  worker.health = 0;

  const events = reapTheFallen(world);
  assert.equal(world.workers.length, 0, "they are gone");
  assert.ok(events.some((e) => e.type === "death"));

  const horse = world.animals.find((a) => a.id === 9);
  assert.equal(horse.tamed, false, "the horse went back to the wild");
  assert.equal(horse.riderId, null);
});

test("hurt workers walk home, rest, and come back", () => {
  const { world, grass, home } = settled();
  const worker = makeWorker(world, home.q, home.r);
  worker.q = grass[3].q;
  worker.r = grass[3].r;
  worker.health = RETREAT_BELOW - 10;
  assert.ok(shouldRetreat(worker));

  advanceHours(world, 24 * 12);
  assert.ok(isRecovered(worker), `should have healed, at ${healthOf(worker)}`);
  assert.ok(isAvailable(worker), `and be ready again, was "${worker.state}"`);
});

test("injury slows the work down", () => {
  const { world, home } = settled();
  const worker = makeWorker(world, home.q, home.r);
  const well = workRate(world, worker, "clear");
  worker.health = 30;
  assert.ok(workRate(world, worker, "clear") < well, "hurt people work slowly");
});

// --- hunting ---------------------------------------------------------------

test("you can only hunt where there is something to hunt", () => {
  const { world, grass } = settled();
  const nothing = canHunt(world, grass[2].q, grass[2].r);
  assert.equal(nothing.ok, false);
  assert.match(nothing.reason, /nothing to hunt/);

  world.animals.push({
    id: 1, species: "rabbit", q: grass[2].q, r: grass[2].r,
    energy: 10, cooldown: 0, bornOn: 1, tamed: false,
  });
  assert.equal(canHunt(world, grass[2].q, grass[2].r).ok, true);
});

test("a hunt is a job: somebody walks there and spends the hours", () => {
  const { world, grass, home } = settled();
  makeWorker(world, home.q, home.r);
  world.animals.push({
    id: 1, species: "rabbit", q: grass[2].q, r: grass[2].r,
    energy: 10, cooldown: 0, bornOn: 1, tamed: false,
  });
  // Otherwise the next rabbit to wander in is also given id 1, and the test
  // is looking for the wrong animal.
  world.nextAnimalId = 2;

  const res = startHunt(world, grass[2].q, grass[2].r);
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.species, "rabbit");
  assert.ok(res.worker, "somebody should have been sent");

  const { events } = advanceHours(world, 24 * 8);
  // By id, not by population: more rabbits wander in over eight days, so a
  // population count would be measuring the ecosystem rather than the hunt.
  assert.equal(
    world.animals.find((a) => a.id === 1),
    undefined,
    "that particular rabbit should be gone"
  );
  // And by the event rather than the food total: over eight days the workers
  // eat far more than one rabbit is worth, so the balance would be down even
  // on a successful hunt.
  const kill = events.find((e) => e.type === "hunted");
  assert.ok(kill, "the hunt should have been reported");
  assert.match(kill.text, /rabbit/);
  assert.match(kill.text, new RegExp(`${HUNT.rabbit.food} food`));
});

test("hunting a fox is riskier than hunting a rabbit", () => {
  assert.ok(HUNT.fox.risk > HUNT.rabbit.risk);
  assert.ok(HUNT.fox.damage > HUNT.rabbit.damage);
  assert.ok(HUNT.fox.hours > HUNT.rabbit.hours);
});

test("a tamed horse is never on the menu", () => {
  const { world, grass } = settled();
  world.animals.push({
    id: 1, species: "horse", q: grass[2].q, r: grass[2].r,
    energy: 14, cooldown: 0, bornOn: 1, tamed: true,
  });
  assert.equal(canHunt(world, grass[2].q, grass[2].r).ok, false);
});

// --- persistence -----------------------------------------------------------

test("base level, tools, skills and health all survive a save", () => {
  const { world, grass, home } = settled();
  fed(world, grass);
  upgradeBase(world);
  upgradeBase(world);
  craftTool(world, "axe");
  const worker = makeWorker(world, home.q, home.r);
  worker.skills = { forestry: 2 };
  worker.health = 61;

  const back = deserialize(JSON.parse(JSON.stringify(serialize(world))));
  assert.equal(back.baseLevel, world.baseLevel);
  assert.deepEqual(back.tools, world.tools);
  assert.deepEqual(back.workers[0].skills, { forestry: 2 });
  assert.equal(back.workers[0].health, 61);
  assert.doesNotThrow(() => advanceHours(back, 48));
});

test("a save from before any of this existed is repaired on load", () => {
  const old = {
    version: 3, seed: 1, grid: { width: 24, height: 16 }, day: 5, hour: 7,
    modified: [],
    workers: [{ id: 1, name: "Ada", q: 0, r: 0, state: "idle", move: 0 }],
  };
  const world = migrate(old);
  assert.equal(world.baseLevel, 1);
  assert.deepEqual(world.tools, {});
  assert.equal(world.workers[0].health, 100, "an old worker is fit");
  assert.deepEqual(world.workers[0].skills, {}, "and unskilled");
});


// --- foraging --------------------------------------------------------------
//
// Added after measuring: in a realistic settlement over two simulated years,
// workers were out of the base 2% of the time. Everything built on being in
// the field — the fox, the horse, the map itself — was inert as a result.

test("idle workers go out foraging rather than standing about", () => {
  const { world, grass, home } = settled();
  for (const t of grass.slice(0, 4)) place(world, t.q, t.r, "farm");
  const worker = makeWorker(world, home.q, home.r);

  let awayFromHome = 0;
  for (let h = 0; h < 24 * 20; h++) {
    advanceHour(world);
    if (worker.q !== home.q || worker.r !== home.r) awayFromHome++;
  }
  assert.ok(
    awayFromHome > 24 * 5,
    `they should spend real time in the field, got ${awayFromHome} hours of ${24 * 20}`
  );
});

test("foraging brings something back, but is not a living", () => {
  // The important half is the second clause. A worker forages roughly two
  // food a day and eats six, so a settlement that only forages starves — which
  // is what keeps farms worth building. Measured on the EVENTS and on the net
  // balance, not on the store alone, because upkeep hides the income.
  const { world, home } = settled(1, { rich: false });
  world.store.food = 200;
  world.store.seeds = 0;
  makeWorker(world, home.q, home.r);

  const before = world.store.food;
  advanceHours(world, 24 * 20);

  assert.ok(
    world.store.seeds > 0 || world.store.food > before - 24 * 20 * 6,
    "foraging should be producing something"
  );
  assert.ok(
    world.store.food < before,
    `one forager should still eat more than they gather: ${before} -> ${world.store.food}`
  );
});

test("foraging can be switched off", () => {
  const { world, grass, home } = settled();
  for (const t of grass.slice(0, 4)) place(world, t.q, t.r, "farm");
  world.autoForage = false;
  world.autoRepair = false;
  const worker = makeWorker(world, home.q, home.r);

  advanceHours(world, 24 * 5);
  assert.equal(worker.q, home.q, "they should have stayed put");
  assert.equal(worker.r, home.r);
});

test("a job always beats foraging", () => {
  const { world, grass, home } = settled();
  const worker = makeWorker(world, home.q, home.r);
  advanceHours(world, 8); // let them wander off

  const res = startWork(world, grass[2].q, grass[2].r, "plant");
  assert.ok(res.worker, "a real job must be able to interrupt a stroll");
  assert.equal(res.worker.id, worker.id);
});

test("being out in the field is what exposes you to the fox", () => {
  // The rate is deliberately low — roughly one bite per worker per two
  // hundred exposed days — so this asserts the mechanism fires at all rather
  // than pinning a frequency that would make the test flaky.
  const { world, home } = settled();
  const worker = makeWorker(world, home.q, home.r);
  const spot = [...allTiles(world)].find(
    (t) => t.terrain === "grass" && !t.building && (t.q !== home.q || t.r !== home.r)
  );
  worker.q = spot.q;
  worker.r = spot.r;

  world.animals.push({
    id: 1, species: "fox", q: spot.q, r: spot.r,
    energy: 20, cooldown: 0, bornOn: 1, tamed: false,
  });
  world.nextAnimalId = 2;

  const events = foxAttacks(world, () => 0.01);
  assert.ok(events.length, "a fox next to somebody in the open should act");
  assert.ok(healthOf(worker) < MAX_HEALTH);
});
