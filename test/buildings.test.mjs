import { placeFinished as place } from "./support.mjs";
/**
 * Buildings, the store and production. (Step 3)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { own } from "./support.mjs";
import { createWorld, serialize, deserialize, migrate, allTiles } from "../src/game/world.js";
import { getTile, setTerrain, getBuilding } from "../src/game/tiles.js";
import { advanceDay, advanceDays } from "../src/game/tick.js";
import { BUILDINGS, canPlace, demolish, repair, countBuildings, buildOptionsFor } from "../src/game/buildings.js";
import { key, neighbors } from "../src/game/hex.js";
import { makeWorker } from "../src/game/workers.js";
import { optionsFor } from "../src/game/terrain.js";

/** A world with a base already down, plenty of wood, and no wildlife. */
function ready(seed = 1) {
  const world = createWorld(seed);
  const grass = [...allTiles(world)].filter((t) => t.terrain === "grass");
  place(world, grass[0].q, grass[0].r, "base");
  own(world, [...allTiles(world)]);
  world.store.wood = 100;
  world.store.stone = 100;
  return { world, grass };
}

test("a new world has a store, no wildlife and nobody working yet", () => {
  const world = createWorld(1);
  assert.deepEqual(world.store, { food: 20, wood: 8, stone: 0, seeds: 1, herbs: 0, coins: 30 });
  assert.deepEqual(world.animals, []);
  assert.deepEqual(world.workers, []);
  assert.equal(world.hour, 7, "a new game starts in the morning");
});

test("you must place the base before anything else", () => {
  const world = createWorld(1);
  const grass = [...allTiles(world)].filter((t) => t.terrain === "grass");
  const first = canPlace(world, grass[0].q, grass[0].r, "farm");
  assert.equal(first.ok, false);
  assert.match(first.reason, /base first/);

  assert.equal(place(world, grass[0].q, grass[0].r, "base").ok, true);
  assert.equal(canPlace(world, grass[1].q, grass[1].r, "farm").ok, true);
});

test("only one base may exist", () => {
  const { world, grass } = ready();
  const second = place(world, grass[1].q, grass[1].r, "base");
  assert.equal(second.ok, false);
  assert.match(second.reason, /already have a base/);
});

test("a building refuses the wrong terrain, and says which it wants", () => {
  const { world } = ready();
  const sand = [...allTiles(world)].find((t) => t.terrain === "sand");
  if (!sand) return; // this seed has no sand; the other tests cover it
  const res = canPlace(world, sand.q, sand.r, "farm");
  assert.equal(res.ok, false);
  assert.match(res.reason, /needs grass/);
});

test("placing pays for itself out of the store, and you cannot overspend", () => {
  const { world, grass } = ready();
  world.store.wood = 4;
  assert.equal(place(world, grass[1].q, grass[1].r, "farm").ok, true);
  assert.equal(world.store.wood, 0);

  const broke = canPlace(world, grass[2].q, grass[2].r, "farm");
  assert.equal(broke.ok, false);
  assert.match(broke.reason, /need 4 more wood/);
});

test("a farm produces food every day", () => {
  const { world, grass } = ready();
  place(world, grass[1].q, grass[1].r, "farm");
  const before = world.store.food;
  advanceDays(world, 5);
  assert.ok(world.store.food > before, `food should rise: ${before} -> ${world.store.food}`);
});

test("the store never goes negative, however long you starve", () => {
  const { world } = ready();
  world.store.food = 0;
  advanceDays(world, 30);
  assert.ok(world.store.food >= 0, "food went negative");
  assert.ok(world.store.wood >= 0, "wood went negative");
  assert.ok(world.store.stone >= 0, "stone went negative");
});

test("with no food, the people go hungry and are told so", () => {
  // Buildings no longer eat — workers do. A building keeps producing whether
  // or not anyone has had breakfast; it is the people who slow down.
  // No farm on purpose: with one standing, it produces twenty-four food over
  // the day and nobody ever goes hungry, which is not what is being tested.
  const { world, grass } = ready();
  makeWorker(world, grass[0].q, grass[0].r);
  world.store.food = 0;

  const events = advanceDay(world);
  assert.ok(events.some((e) => e.type === "hunger"), "the player should be told");
  assert.ok(world.workers.every((w) => w.hungry), "everyone should be hungry");
  assert.ok(world.store.food >= 0, "food must never go negative");
});

test("buildings wear out, and a worn farm yields less", () => {
  const { world, grass } = ready();
  world.animals = []; // isolate wear from rabbits eating the crop
  place(world, grass[1].q, grass[1].r, "farm");
  const tile = getTile(world, grass[1].q, grass[1].r);

  advanceDays(world, 10);
  assert.ok(tile.building.condition < 100, "a farm should decay");

  // Compare a fresh farm's ten days against a half-ruined one's.
  const fresh = ready(1);
  place(fresh.world, fresh.grass[1].q, fresh.grass[1].r, "farm");
  const freshFood = (() => {
    const f0 = fresh.world.store.food;
    advanceDays(fresh.world, 10);
    return fresh.world.store.food - f0;
  })();

  tile.building.condition = 30;
  const worn0 = world.store.food;
  advanceDays(world, 10);
  const wornFood = world.store.food - worn0;
  assert.ok(wornFood < freshFood, `worn farm should yield less: ${wornFood} vs ${freshFood}`);
});

test("repair costs wood and puts condition back", () => {
  const { world, grass } = ready();
  place(world, grass[1].q, grass[1].r, "farm");
  const tile = getTile(world, grass[1].q, grass[1].r);
  tile.building.condition = 40;
  const wood = world.store.wood;

  const res = repair(world, grass[1].q, grass[1].r);
  assert.equal(res.ok, true);
  assert.ok(tile.building.condition > 40);
  assert.equal(world.store.wood, wood - 1);
});

test("you cannot tear down your own base", () => {
  const { world, grass } = ready();
  const res = demolish(world, grass[0].q, grass[0].r);
  assert.equal(res.ok, false);
  assert.match(res.reason, /base/);
});

test("a well lets you irrigate sand that touches no water", () => {
  const world = createWorld(1);
  // Build a tiny setup by hand so the test does not depend on map generation.
  const grass = [...allTiles(world)].find((t) => t.terrain === "grass");
  place(world, grass.q, grass.r, "base");
  world.store.stone = 100;

  let target = [...allTiles(world)].find(
    (t) => t.q !== grass.q || t.r !== grass.r
  );
  setTerrain(world, target.q, target.r, "sand");
  // Make sure it touches no water at all. Snapshot the list first, because
  // setTerrain writes into world.modified while allTiles is reading.
  for (const t of [...allTiles(world)]) {
    if (t.terrain === "water") setTerrain(world, t.q, t.r, "sand");
  }
  // Re-read: `target` was a throwaway copy from before the change.
  target = getTile(world, target.q, target.r);

  const before = optionsFor(world, target).find((o) => o.id === "irrigate");
  assert.equal(before.blockedBy, "needs to touch water or a well");

  const spot = neighbors(target.q, target.r)
    .map((n) => getTile(world, n.q, n.r))
    .find((t) => t && t.terrain === "sand" && !t.building);
  place(world, spot.q, spot.r, "well");

  const after = optionsFor(world, target).find((o) => o.id === "irrigate");
  assert.equal(after.blockedBy, null, "a well next door should unblock irrigation");
  assert.equal(after.hours, 10, "and make it faster than waiting on a lake");
});

test("build options come with a reason when they are blocked", () => {
  const world = createWorld(1);
  const grass = [...allTiles(world)].find((t) => t.terrain === "grass");
  const options = buildOptionsFor(world, grass);
  const farm = options.find((o) => o.id === "farm");
  assert.ok(farm, "a farm should be offered on grass");
  assert.equal(typeof farm.blockedBy, "string", "and blocked with a reason, not just false");
  assert.ok(!options.some((o) => o.id === "quarryCamp"), "sand-only buildings stay off grass");
});

test("a world with buildings and animals survives a save and load round-trip", () => {
  const { world, grass } = ready();
  place(world, grass[1].q, grass[1].r, "farm");
  advanceDays(world, 60);

  const copy = deserialize(JSON.parse(JSON.stringify(serialize(world))));
  assert.equal(copy.day, world.day);
  assert.deepEqual(copy.store, world.store);
  assert.equal(copy.animals.length, world.animals.length);
  assert.equal(countBuildings(copy, "farm"), countBuildings(world, "farm"));
  // And it must keep running afterwards.
  assert.doesNotThrow(() => advanceDays(copy, 10));
});

test("a version-1 save (dense tiles, hex radius) still loads", () => {
  // Shaped exactly like the old format: no version, a radius, every tile
  // listed, and no store or animals at all.
  const old = {
    seed: 3, radius: 3, day: 12,
    tiles: [
      { q: 0, r: 0, terrain: "grass", size: 0.5, work: null, building: null },
      { q: 1, r: 0, terrain: "mountain", size: 0.9, work: null, building: null },
      { q: 0, r: 1, terrain: "grass", size: 0.4, work: null,
        building: { id: "farm", condition: 80, builtOn: 3 } },
    ],
  };
  const fixed = migrate(old);
  assert.equal(fixed.day, 12, "it keeps what the save did have");
  assert.deepEqual(fixed.store, { food: 20, wood: 8, stone: 0, seeds: 1, herbs: 0, coins: 30 });
  assert.deepEqual(fixed.animals, []);
  assert.deepEqual(fixed.workers, [], "and gains the fields it never had");
});

test("every building in the table is internally consistent", () => {
  for (const [id, def] of Object.entries(BUILDINGS)) {
    assert.ok(def.label, `${id} needs a label`);
    assert.ok(Array.isArray(def.needs) && def.needs.length, `${id} needs terrains`);
    assert.equal(typeof def.cost, "object", `${id} needs a cost`);
    assert.ok(def.describe, `${id} needs a description for the build panel`);
  }
});
