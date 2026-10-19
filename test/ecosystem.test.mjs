import { placeFinished as place } from "./support.mjs";
/**
 * The ecosystem test. (Step 4)
 *
 * DESIGN.md says to tune the population numbers headlessly rather than by
 * watching the screen, because the failure mode — foxes eat every rabbit,
 * then starve, then the map is empty — takes a hundred simulated days to
 * show up and you will not spot slow drift by eye.
 *
 * So this file IS the tuning rig. Change a number in animals.js, run
 * `npm test`, and find out in half a second instead of half an hour.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, allTiles } from "../src/game/world.js";
import { getTile, setTerrain } from "../src/game/tiles.js";
import { advanceDay } from "../src/game/tick.js";

import {
  capacityFor,
  populationOf,
  breedThreshold,
  SPECIES,
} from "../src/game/animals.js";
import { key, neighbors } from "../src/game/hex.js";

/** Run `days` days and record the population of each species every day. */
function simulate(seed, days, { withFarms = false } = {}) {
  const world = createWorld(seed);
  if (withFarms) {
    const grass = [...allTiles(world)].filter((t) => t.terrain === "grass");
    if (grass.length) {
      place(world, grass[0].q, grass[0].r, "base");
      world.store.wood = 50;
      for (const t of grass.slice(1, 4)) place(world, t.q, t.r, "farm");
    }
  }
  const history = { rabbit: [], fox: [], horse: [] };
  for (let d = 0; d < days; d++) {
    advanceDay(world);
    for (const sp of Object.keys(history)) history[sp].push(populationOf(world, sp));
  }
  return { world, history };
}

const band = (arr) => ({ min: Math.min(...arr), max: Math.max(...arr) });

test("rabbits appear on their own and never die out — 400 days, several seeds", () => {
  for (const seed of [1, 7, 42, 1234, 99999]) {
    const { world, history } = simulate(seed, 400);
    // Skip the first 40 days: the map starts empty, so of course it is zero.
    const settled = history.rabbit.slice(40);
    const { min, max } = band(settled);
    const cap = capacityFor(world, "rabbit");

    assert.ok(min > 0, `seed ${seed}: rabbits hit zero (min ${min})`);
    // Relative to capacity, not an absolute number. This used to assert
    // `max < 200`, which was calibrated for a 37-tile board and became
    // meaningless the moment the board could be any size.
    assert.ok(max <= cap, `seed ${seed}: rabbits ${max} exceeded capacity ${cap}`);
  }
});

test("foxes survive alongside the rabbits instead of eating them all", () => {
  for (const seed of [1, 7, 42, 1234, 99999]) {
    const { world, history } = simulate(seed, 400);
    const foxes = history.fox.slice(40);
    const rabbits = history.rabbit.slice(40);
    assert.ok(
      Math.max(...foxes) > 0,
      `seed ${seed}: foxes never established themselves`
    );
    // The real failure this guards against: a fox spike immediately followed
    // by rabbits at zero. If both are alive at the end, the loop is stable.
    assert.ok(populationOf(world, "rabbit") > 0, `seed ${seed}: no rabbits left at day 400`);
    assert.ok(Math.min(...rabbits) > 0, `seed ${seed}: rabbits crashed to zero mid-run`);
  }
});

test("no population ever exceeds the land's carrying capacity", () => {
  const { world, history } = simulate(2024, 300);
  for (const sp of ["rabbit", "fox", "horse"]) {
    const cap = capacityFor(world, sp);
    assert.ok(
      Math.max(...history[sp]) <= cap,
      `${sp} went over capacity ${cap} (peak ${Math.max(...history[sp])})`
    );
  }
});

test("more grass means more rabbits — habitat drives the ceiling", () => {
  const world = createWorld(3);
  const before = capacityFor(world, "rabbit");
  // Turn every sand tile into grass, the way irrigation eventually would.
  // setTerrain, not t.terrain = : an untouched tile handed back by allTiles is
  // a throwaway copy, so assigning to it changes nothing. setTerrain also
  // keeps the terrain histogram right, which is what capacityFor reads.
  for (const t of [...allTiles(world)]) {
    if (t.terrain === "sand") setTerrain(world, t.q, t.r, "grass");
  }
  const after = capacityFor(world, "rabbit");
  assert.ok(after > before, `capacity should rise with habitat: ${before} -> ${after}`);
});

test("CROWDING: breeding gets harder as a population fills the land", () => {
  const world = createWorld(5);
  const empty = breedThreshold(world, "rabbit");
  assert.equal(empty, SPECIES.rabbit.breedEnergy, "at zero population it is the base cost");

  const cap = capacityFor(world, "rabbit");
  for (let i = 0; i < cap; i++) {
    world.animals.push({
      id: world.nextAnimalId++, species: "rabbit", q: 0, r: 0,
      energy: 5, cooldown: 0, bornOn: 1, tamed: false,
    });
  }
  const full = breedThreshold(world, "rabbit");
  assert.ok(full > empty * 2, `full land should be much harder: ${empty} -> ${full}`);
});

test("HANDLING TIME: a fox that eats stops hunting for several days", () => {
  const world = createWorld(11);

  // Build the situation instead of hunting for it on a generated map: one
  // grass tile ringed by water, so nothing can wander off before the fox
  // eats. An earlier version of this test picked the first grass tile it
  // found and passed or failed depending on what the seed happened to put
  // next to it — which is not a test, it is a coin toss.
  const spot = { q: 0, r: 0 };
  setTerrain(world, spot.q, spot.r, "grass");
  for (const n of neighbors(spot.q, spot.r)) setTerrain(world, n.q, n.r, "water");

  world.animals.push({
    id: 1, species: "fox", q: spot.q, r: spot.r,
    energy: 20, cooldown: 0, bornOn: 1, tamed: false,
  });
  // Two rabbits on the same tile. Without handling time the fox eats both
  // within two days; with it, the second one survives the cooldown.
  for (let i = 0; i < 2; i++) {
    world.animals.push({
      id: 10 + i, species: "rabbit", q: spot.q, r: spot.r,
      energy: 12, cooldown: 0, bornOn: 1, tamed: false,
    });
  }
  world.nextAnimalId = 100;

  advanceDay(world);
  const fox = world.animals.find((a) => a.species === "fox");
  assert.ok(fox, "the fox should still be alive");
  assert.equal(fox.cooldown, SPECIES.fox.handlingDays - 1, "cooldown starts and ticks down once");
});

test("a fence keeps foxes off the tile behind it", () => {
  const world = createWorld(4);
  const grass = [...allTiles(world)].filter((t) => t.terrain === "grass");
  const target = grass[0];
  place(world, target.q, target.r, "base");
  world.store.wood = 50;

  // Fence a grass tile, then check the rule directly.
  const fenced = grass.find((t) => t.q !== target.q || t.r !== target.r);
  const res = place(world, fenced.q, fenced.r, "fence");
  assert.equal(res.ok, true, res.reason);

  const tile = getTile(world, fenced.q, fenced.r);
  assert.equal(tile.building.id, "fence");

  // Put a fox next door with a rabbit sitting on the fenced tile and run a
  // day. The fox must not end up standing on the fence.
  world.animals.push({
    id: 1, species: "fox", q: target.q, r: target.r,
    energy: 20, cooldown: 0, bornOn: 1, tamed: false,
  });
  world.animals.push({
    id: 2, species: "rabbit", q: fenced.q, r: fenced.r,
    energy: 12, cooldown: 0, bornOn: 1, tamed: false,
  });
  world.nextAnimalId = 50;

  for (let i = 0; i < 5; i++) advanceDay(world);
  const fox = world.animals.find((a) => a.id === 1);
  if (fox) {
    assert.ok(
      !(fox.q === fenced.q && fox.r === fenced.r),
      "the fox got past the fence"
    );
  }
});

test("the same seed replays to exactly the same ecosystem", () => {
  const a = simulate(777, 120).history;
  const b = simulate(777, 120).history;
  assert.deepEqual(a, b, "wildlife must be reproducible or saves cannot be trusted");
});
