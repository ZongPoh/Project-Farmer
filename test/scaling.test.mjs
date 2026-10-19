import { placeFinished as place } from "./support.mjs";
/**
 * Does the simulation get slower on a bigger board?
 *
 * WHY THIS EXISTS. After the multi-camp rewrite a scratch benchmark reported
 * 104 ms per simulated day on a 400x200 board against 3 ms on 24x16, and two
 * rounds of optimisation went into chasing it — a binary heap in `findPath`,
 * then a terrain cache in `getTerrain`. Both were worth keeping, and neither
 * was the problem.
 *
 * The problem was the benchmark. It picked tiles out of `allTiles(...)`, whose
 * iteration order starts at the far corner, so on a big board it claimed land
 * and built farms two hundred tiles from home — something no player can do,
 * because building is confined to territory and territory grows outward from
 * the base. What it was actually measuring was six workers failing to walk to
 * an unreachable farm, and a failed A* search is the most expensive kind: it
 * cannot stop early, so it spends its whole node budget before admitting
 * defeat. Five of those a day is the entire cost.
 *
 * A later version of the same benchmark timed its own `[...allTiles(world)]`
 * scan — eighty thousand tiles, most of them generated on the spot — inside
 * the stopwatch, and blamed the forty milliseconds on the simulation.
 *
 * So this file measures ONE thing and measures it narrowly: the time inside
 * `advanceHour`, on a world played the way the game is played. The bounds are
 * deliberately loose. A timing test that fails on a busy machine gets deleted,
 * and a deleted test guards nothing; what this needs to catch is the
 * thirty-fold regression, not a ten-percent one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, allTiles } from "../src/game/world.js";
import { canPlace, BUILDING_IDS } from "../src/game/buildings.js";
import { advanceHour, startClaim, canClaim } from "../src/game/tick.js";
import { makeWorker } from "../src/game/workers.js";
import { frontierTiles, inTerritory } from "../src/game/territory.js";
import { allCamps } from "../src/game/rivalcamp.js";

/** The four boards the size menu in `App.jsx` offers. */
const SIZES = [
  { label: "Small", width: 24, height: 16 },
  { label: "Medium", width: 80, height: 50 },
  { label: "Large", width: 200, height: 120 },
  { label: "Huge", width: 400, height: 200 },
];

const DAYS = 90;

/**
 * Play a board the way it is meant to be played, and time only the clock.
 *
 * The scan that picks the next building site is deliberately OUTSIDE the
 * stopwatch. It is the test harness standing in for a player's eyes, it is the
 * most expensive thing in this file, and counting it is the mistake that sent
 * two optimisation passes down the wrong hole.
 */
function playAndTime(size, days = DAYS) {
  const world = createWorld(23, size);
  place(world, world.home.q, world.home.r, "base");
  while (world.workers.length < 6) makeWorker(world, world.home.q, world.home.r);

  let simMs = 0;
  for (let day = 1; day <= days; day++) {
    // Kept stocked on purpose: a settlement that runs out of wood stops
    // building, stops repairing and stops pathing, and then the big board
    // looks fast because nothing is happening on it.
    world.store.wood = 2000;
    world.store.stone = 2000;
    world.store.food = 2000;
    world.store.seeds = 20;

    const started = performance.now();
    for (let h = 0; h < 24; h++) advanceHour(world);
    simMs += performance.now() - started;

    const inside = [...allTiles(world)].filter(
      (t) => inTerritory(world, t.q, t.r) && !t.building && !t.work
    );
    const want = BUILDING_IDS[day % BUILDING_IDS.length];
    const spot = inside.find((t) => canPlace(world, t.q, t.r, want).ok);
    if (spot) place(world, spot.q, spot.r, want);

    if (day % 2 === 0) {
      const edge = frontierTiles(world).find((t) => canClaim(world, t.q, t.r).ok);
      if (edge) startClaim(world, edge.q, edge.r);
    }
  }

  return {
    world,
    perDay: simMs / days,
    buildings: [...allTiles(world)].filter((t) => t.building).length,
  };
}

test("the clock costs the same on a huge board as on a small one", () => {
  // One throwaway run first. V8 has not compiled anything yet on the first
  // board through, and without this the smallest board measures as the
  // slowest — which is how a warm-up artefact gets mistaken for a result.
  playAndTime(SIZES[0], 20);

  const measured = SIZES.map((size) => ({ size, ...playAndTime(size) }));
  for (const m of measured) {
    // Reported either way — when this test fails, the numbers are the message.
    console.log(
      `  ${m.size.label.padEnd(7)} ${m.size.width}x${m.size.height}`.padEnd(24) +
      `${m.perDay.toFixed(2)} ms/day  ` +
      `buildings ${m.buildings}  camps ${allCamps(m.world).length}`
    );
  }

  const small = measured[0].perDay;
  const huge = measured[measured.length - 1].perDay;

  // The absolute bound is what actually matters to a player: a hundred days of
  // offline catch-up has to feel instant, and twenty milliseconds a day would
  // be two seconds of it.
  assert.ok(
    huge < 20,
    `a day on the huge board cost ${huge.toFixed(1)} ms — offline catch-up will crawl`
  );

  // And the shape: the board is 208 times the area, so anything close to
  // proportional means something is walking the whole map every hour.
  assert.ok(
    huge < small * 8 + 4,
    `huge cost ${huge.toFixed(1)} ms/day against small's ${small.toFixed(1)} — ` +
    `something in the clock scales with board area`
  );
});

test("every board size gets neighbours, and bigger boards get more of them", () => {
  // The scaling the player actually sees. Not a timing claim — this one is
  // exact, and it is the thing the feature promised.
  const counts = SIZES.map((size) => {
    const world = createWorld(23, size);
    place(world, world.home.q, world.home.r, "base");
    for (let h = 0; h < 24 * 40; h++) advanceHour(world);
    return allCamps(world).length;
  });

  assert.ok(counts[0] >= 1, "the smallest board has nobody on it");
  assert.ok(
    counts[counts.length - 1] > counts[0],
    `the huge board has ${counts[counts.length - 1]} neighbours and the small one ${counts[0]} — ` +
    `camp count is not scaling with the map`
  );
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] >= counts[i - 1], `board ${i} has fewer neighbours than the one below it`);
  }
});
