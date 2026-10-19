import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, serialize, deserialize, allTiles } from "../src/game/world.js";
import { setTerrain, touchTile, markActive } from "../src/game/tiles.js";
import { addResource, storageCapacity, currencyTrade, marketView, foodReserves, STORAGE_CEILING } from "../src/game/economy.js";
import { workerCapacity, makeWorker, dailyWorkers } from "../src/game/workers.js";
import { produceHour } from "../src/game/buildings.js";
import { advanceHours } from "../src/game/tick.js";
import { beginConstruction } from "../src/game/construction.js";
import { encodeSave, decodeSave } from "../src/game/persistence.js";

function building(world, q, id) {
  setTerrain(world, q, 0, "grass");
  const tile = touchTile(world, q, 0);
  tile.building = { id, condition: 100, builtOn: 1 };
  markActive(world, q, 0);
  return tile.building;
}
function settlement() {
  const world = createWorld(23);
  building(world, 0, "base");
  building(world, 1, "farm");
  building(world, 2, "farm");
  world.autoForage = false;
  world.autoRepair = false;
  return world;
}

test("storage stacks only functional facilities and preserves old surplus", () => {
  const world = settlement();
  const granary = building(world, 3, "granary");
  const warehouse = building(world, 4, "warehouse");
  // Herbs and seeds are capped too since the resource pass — a granary is
  // where seed corn is kept, so it raises that ceiling as well as food's.
  assert.deepEqual(storageCapacity(world), { food: 1500, wood: 800, stone: 600, herbs: 120, seeds: 60 });
  beginConstruction(warehouse);
  assert.equal(storageCapacity(world).wood, 200);
  warehouse.construction = null;
  warehouse.condition = 0;
  assert.equal(storageCapacity(world).wood, 200);
  granary.condition = 0;
  world.store.food = 2000;
  assert.equal(addResource(world, "food", 20), 0);
  assert.equal(world.store.food, 2000);
  world.store.food = 599;
  assert.equal(addResource(world, "food", 20), 1);
});

test("the small stores stop rising however many granaries you build", () => {
  // MEASURED: the growth bot ended three years with 580 seeds against a cap of
  // 40, because it had built twenty-seven granaries at +20 seeds each. A
  // ceiling that rises with a cheap building is a slope.
  const world = settlement();
  const spare = [...allTiles(world)].filter((t) => !t.building).slice(0, 27);
  const put = (tile, id) => {
    const stored = touchTile(world, tile.q, tile.r);
    stored.building = { id, condition: 100, builtOn: 1 };
    markActive(world, tile.q, tile.r);
  };
  for (const tile of spare.slice(0, 20)) put(tile, "granary");
  const capacity = storageCapacity(world);
  assert.equal(capacity.seeds, STORAGE_CEILING.seeds, "seed corn stops at the ceiling");
  assert.ok(capacity.food > 10_000, "food still scales with what you build — storing it is the game");
  world.store.seeds = STORAGE_CEILING.seeds;
  assert.equal(addResource(world, "seeds", 5), 0, "and nothing more fits");
  for (const tile of spare.slice(20)) put(tile, "infirmary");
  assert.equal(storageCapacity(world).herbs, STORAGE_CEILING.herbs);
});

test("a house sleeps four more, and the base level is the ceiling over it", () => {
  const world = settlement();
  assert.equal(workerCapacity(world).byBase, 4, "a Camp's own roof sleeps four");
  const house = building(world, 3, "house");
  assert.equal(workerCapacity(world).byBase, 4, "and a Camp holds four however many houses stand in it");
  assert.equal(workerCapacity(world).limitedBy, "base", "which is a reason to upgrade, not to build");

  world.baseLevel = 2; // a Homestead holds seven
  assert.equal(workerCapacity(world).byBase, 7, "now the house counts, up to what the tier holds");
  assert.equal(workerCapacity(world).beds, 8, "the beds are there — the tier is what caps them");

  beginConstruction(house);
  assert.equal(workerCapacity(world).byBase, 4, "an unfinished house sleeps nobody");
  house.construction = null;
  house.condition = 0;
  assert.equal(workerCapacity(world).byBase, 4, "nor does a ruined one");
});

test("winter stops all farm harvests including late winter; residents eat reserves", () => {
  const world = settlement();
  makeWorker(world, 0, 0);
  for (const day of [73, 90, 96]) {
    world.day = day;
    world.store.food = 100;
    for (let hour = 0; hour < 24; hour++) produceHour(world, () => 1);
    assert.equal(world.store.food, 100);
    dailyWorkers(world, () => 1);
    assert.equal(world.store.food, 94);
    assert.equal(world.workers.length, 1);
  }
  world.day = 97;
  produceHour(world, () => 1);
  assert.ok(world.store.food > 94);
});

test("reserve estimate uses resident count and remaining winter", () => {
  const world = settlement();
  for (let i = 0; i < 4; i++) makeWorker(world, 0, 0);
  world.store.food = 576;
  assert.equal(foodReserves(world).required, 576);
  assert.equal(foodReserves(world).shortfall, 0);
  world.day = 96;
  assert.equal(foodReserves(world).required, 24);
});

test("production respects caps and prepared residents survive winter", () => {
  const world = settlement();
  world.store.food = 600;
  produceHour(world, () => 1);
  assert.equal(world.store.food, 600);
  for (let i = 0; i < 4; i++) makeWorker(world, 0, 0);
  world.day = 73;
  world.hour = 0;
  world.animals = [];
  world.valleySettled = true;
  world.nextRaidDay = 99999;
  advanceHours(world, 24 * 24 - 1);
  assert.equal(world.workers.length, 4);
  assert.ok(world.store.food >= 24);
});

test("market rejects invalid trades atomically and has shared saved weekly limits", () => {
  const world = settlement();
  assert.equal(currencyTrade(world, "food", "buy", 10).ok, false);
  building(world, 3, "market");
  const before = JSON.stringify(serialize(world));
  for (const amount of [-1, 61, 1.5, NaN]) assert.equal(currencyTrade(world, "food", "buy", amount).ok, false);
  assert.equal(currencyTrade(world, "coins", "buy", 10).ok, false);
  assert.equal(currencyTrade(world, "food", "bad", 10).ok, false);
  assert.equal(JSON.stringify(serialize(world)), before);
  assert.equal(currencyTrade(world, "food", "buy", 10).ok, true);
  assert.equal(world.store.coins, 0);
  assert.equal(marketView(world).stock.food, 50);
  const loaded = decodeSave(encodeSave(world)).world;
  assert.equal(marketView(loaded).stock.food, 50);
  building(world, 4, "market");
  assert.equal(marketView(world).stock.food, 50);
  world.day = 8;
  assert.equal(marketView(world).stock.food, 60);
  world.store.wood = 100;
  assert.equal(currencyTrade(world, "wood", "sell", 60).ok, true);
  assert.equal(currencyTrade(world, "wood", "sell", 10).ok, false);
  world.store.food = 600;
  const saved = JSON.stringify(serialize(world));
  assert.equal(currencyTrade(world, "food", "buy", 10).ok, false);
  assert.equal(JSON.stringify(serialize(world)), saved);
});

test("old saves retain excess resources and gain currency; invalid markets are rejected", () => {
  const world = settlement();
  world.store.wood = 10000;
  const old = serialize(world);
  delete old.store.coins;
  assert.equal(deserialize(old).store.wood, 10000);
  assert.equal(deserialize(old).store.coins, 30);
  const data = JSON.parse(encodeSave(world));
  data.world.market = { period: 0, purse: -1, stock: { food: 60, wood: 60, stone: 60 } };
  assert.throws(() => decodeSave(JSON.stringify(data)), /market/);
});
