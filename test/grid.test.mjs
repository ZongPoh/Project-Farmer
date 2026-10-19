import { placeFinished as place } from "./support.mjs";
/**
 * The rectangular grid, sparse storage, and the render window.
 *
 * The rendering itself needs a browser, but the arithmetic that decides WHICH
 * tiles get rendered does not — and that is the part that would silently
 * break. These tests cover it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  offsetToAxial, axialToOffset, inBounds, isEdge, makeGrid, tileCountOf,
  gridExtent, worldToOffset, chunksInView, chunkBounds, chunkOf, CHUNK,
  colMin, colMax, rowMin, rowMax,
} from "../src/game/grid.js";
import { hexToWorld, neighbors, distance } from "../src/game/hex.js";
import { baseTerrainAt, baseSizeAt } from "../src/game/worldgen.js";
import { hash2, valueNoise2 } from "../src/game/noise.js";
import { createWorld, serialize, deserialize, allTiles } from "../src/game/world.js";
import {
  getTile, getTerrain, touchTile, setTerrain, isStored, terrainCount, countTerrain,
} from "../src/game/tiles.js";

import { advanceDay } from "../src/game/tick.js";

// --- coordinates -----------------------------------------------------------

test("offset and axial round-trip, including below the origin", () => {
  // Negative rows are where a naive (row & 1) goes wrong, so test them hard.
  for (let row = -20; row <= 20; row++) {
    for (let col = -20; col <= 20; col++) {
      const { q, r } = offsetToAxial(col, row);
      const back = axialToOffset(q, r);
      assert.equal(back.col, col, `col round-trip failed at ${col},${row}`);
      assert.equal(back.row, row, `row round-trip failed at ${col},${row}`);
    }
  }
});

test("the rectangle really is a rectangle in world space", () => {
  // Odd rows shift half a hex right; nothing else moves. If this drifts, the
  // board comes out as a parallelogram — the classic offset-coords bug.
  for (const row of [-3, -2, -1, 0, 1, 2, 3]) {
    for (const col of [-4, 0, 4]) {
      const { q, r } = offsetToAxial(col, row);
      const { x, z } = hexToWorld(q, r, 1);
      const expectedX = Math.sqrt(3) * (col + (row & 1) / 2);
      const expectedZ = 1.5 * row;
      assert.ok(Math.abs(x - expectedX) < 1e-9, `x at ${col},${row}: ${x} vs ${expectedX}`);
      assert.ok(Math.abs(z - expectedZ) < 1e-9, `z at ${col},${row}: ${z} vs ${expectedZ}`);
    }
  }
});

test("neighbours of a tile are still adjacent after the offset conversion", () => {
  const { q, r } = offsetToAxial(5, -7);
  for (const n of neighbors(q, r)) {
    assert.equal(distance({ q, r }, n), 1, "a neighbour was not one step away");
  }
});

test("worldToOffset inverts the layout", () => {
  for (const [col, row] of [[0, 0], [3, 4], [-6, -5], [11, -9]]) {
    const { q, r } = offsetToAxial(col, row);
    const { x, z } = hexToWorld(q, r, 1);
    assert.deepEqual(worldToOffset(x, z), { col, row });
  }
});

// --- bounds ----------------------------------------------------------------

test("a grid holds exactly width x height tiles", () => {
  for (const [w, h] of [[1, 1], [24, 16], [400, 200], [7, 13]]) {
    const grid = makeGrid(w, h);
    assert.equal(tileCountOf(grid), w * h);

    let counted = 0;
    for (let row = rowMin(grid); row <= rowMax(grid); row++) {
      for (let col = colMin(grid); col <= colMax(grid); col++) {
        const { q, r } = offsetToAxial(col, row);
        assert.ok(inBounds(grid, q, r), `${col},${row} should be in bounds`);
        counted++;
      }
    }
    assert.equal(counted, w * h, `${w}x${h} enumerated ${counted}`);
  }
});

test("tiles past the edge are out of bounds", () => {
  const grid = makeGrid(10, 10);
  const outside = offsetToAxial(colMax(grid) + 1, 0);
  assert.equal(inBounds(grid, outside.q, outside.r), false);
  const inside = offsetToAxial(colMax(grid), 0);
  assert.equal(inBounds(grid, inside.q, inside.r), true);
  assert.equal(isEdge(grid, inside.q, inside.r), true, "the last column is the rim");
});

test("a rectangular board is wider than it is deep for equal tile counts", () => {
  // Worth asserting because it catches the camera being set up from tile
  // counts rather than world units.
  const { width, depth } = gridExtent(makeGrid(100, 100));
  assert.ok(width > depth, `${width} should exceed ${depth}`);
});

// --- procedural generation -------------------------------------------------

test("terrain and size depend only on position, never on call order", () => {
  const coords = [];
  for (let i = 0; i < 200; i++) coords.push({ q: (i * 7) % 61 - 30, r: (i * 13) % 41 - 20 });

  const forward = coords.map((c) => baseTerrainAt(9, c.q, c.r) + baseSizeAt(9, c.q, c.r));
  const shuffled = [...coords].reverse().map((c) => baseTerrainAt(9, c.q, c.r) + baseSizeAt(9, c.q, c.r));
  assert.deepEqual(shuffled, [...forward].reverse());
});

test("the noise does not repeat across a wide board", () => {
  // The old lookup-table noise wrapped every 64 cells, which on a 400-wide
  // map showed the same island five times. Hashed noise has no period.
  const a = [];
  const b = [];
  for (let i = 0; i < 64; i++) {
    a.push(valueNoise2(1, i * 0.4, 0).toFixed(4));
    b.push(valueNoise2(1, (i + 64) * 0.4, 0).toFixed(4));
  }
  assert.notDeepEqual(a, b, "the noise repeated after 64 cells");
});

test("hash2 is well spread and stable", () => {
  const buckets = new Array(10).fill(0);
  for (let x = 0; x < 100; x++) {
    for (let y = 0; y < 100; y++) buckets[Math.floor(hash2(1, x, y) * 10)]++;
  }
  for (const b of buckets) assert.ok(b > 700 && b < 1300, `uneven bucket: ${b} of 10000`);
  assert.equal(hash2(1, 5, -9), hash2(1, 5, -9), "must be deterministic");
  assert.notEqual(hash2(1, 5, -9), hash2(2, 5, -9), "the seed must matter");
});

// --- sparse storage --------------------------------------------------------

test("nothing is stored until something is changed", () => {
  const world = createWorld(4, { width: 60, height: 40 });
  const before = world.modified.size;

  // Reading, however much of it, must not store anything.
  for (let i = 0; i < 50; i++) getTile(world, i % 20, i % 10);
  assert.equal(world.modified.size, before, "reading a tile stored it");

  touchTile(world, 3, 3);
  assert.equal(world.modified.size, before + 1, "touchTile should store one tile");
  assert.ok(isStored(world, 3, 3));
});

test("writing to the result of getTile on an untouched tile does nothing", () => {
  // This is THE mistake the accessor layer exists to prevent, so it gets a
  // test of its own. getTile may hand back a throwaway built from the seed.
  const world = createWorld(5, { width: 30, height: 30 });
  const spot = { q: 2, r: 2 };
  const original = getTerrain(world, spot.q, spot.r);

  const throwaway = getTile(world, spot.q, spot.r);
  throwaway.terrain = original === "grass" ? "water" : "grass";
  assert.equal(getTerrain(world, spot.q, spot.r), original, "a throwaway write leaked through");

  // The supported way round.
  setTerrain(world, spot.q, spot.r, "mountain");
  assert.equal(getTerrain(world, spot.q, spot.r), "mountain");
});

test("the terrain histogram stays correct as terrain changes", () => {
  const world = createWorld(6, { width: 40, height: 30 });
  assert.deepEqual(world.terrainCounts, countTerrain(world), "wrong from the start");

  const sand = [...allTiles(world)].find((t) => t.terrain === "sand");
  if (sand) {
    const before = terrainCount(world, "grass");
    setTerrain(world, sand.q, sand.r, "grass");
    assert.equal(terrainCount(world, "grass"), before + 1);
    assert.deepEqual(world.terrainCounts, countTerrain(world), "drifted after a change");
  }
});

test("a finished job updates the histogram, not just the tile", () => {
  // The conversion path goes through advanceDay, so it is worth checking that
  // it uses setTerrain and not a bare assignment — capacityFor reads these
  // numbers, and a drifting histogram would quietly break the ecosystem.
  const world = createWorld(7, { width: 40, height: 30 });
  const sand = [...allTiles(world)].find(
    (t) => t.terrain === "sand" && neighbors(t.q, t.r).some((n) => getTerrain(world, n.q, n.r) === "water")
  );
  if (!sand) return;

  const tile = touchTile(world, sand.q, sand.r);
  tile.work = { id: "irrigate", to: "grass", daysDone: 0, daysNeeded: 1, startedOn: 1 };
  world.active.add(`${sand.q},${sand.r}`);

  advanceDay(world);
  assert.equal(getTerrain(world, sand.q, sand.r), "grass");
  assert.deepEqual(world.terrainCounts, countTerrain(world), "histogram drifted after a conversion");
});

test("the active set holds only tiles that need daily work", () => {
  const world = createWorld(8, { width: 40, height: 30 });
  assert.equal(world.active.size, 0, "a fresh world has nothing to do");

  const grass = [...allTiles(world)].filter((t) => t.terrain === "grass");
  place(world, grass[0].q, grass[0].r, "base");
  assert.equal(world.active.size, 1, "the base should be active");

  world.store.wood = 50;
  place(world, grass[1].q, grass[1].r, "farm");
  assert.equal(world.active.size, 2);

  // The active set must not grow with the board.
  const big = createWorld(8, { width: 400, height: 200 });
  advanceDay(big);
  assert.ok(big.active.size < 10, `active set was ${big.active.size} on an empty 80,000-tile board`);
});

// --- the render window -----------------------------------------------------

test("the visible window covers the camera and not the whole board", () => {
  const grid = makeGrid(400, 200);
  const chunks = chunksInView(grid, 0, 0, 12, 14);

  let tiles = 0;
  for (const c of chunks) {
    const { col0, col1, row0, row1 } = chunkBounds(grid, c.cx, c.cy);
    tiles += (col1 - col0 + 1) * (row1 - row0 + 1);
  }

  assert.ok(tiles > 0, "nothing was visible");
  assert.ok(
    tiles < 4000,
    `${tiles} tiles in view — the window is not bounded, which defeats the point`
  );
  assert.ok(tiles < tileCountOf(grid) / 10, "the window should be a small slice of the board");
});

test("the window is clipped at the board edge rather than running off it", () => {
  const grid = makeGrid(40, 30);
  const chunks = chunksInView(grid, colMin(grid), rowMin(grid), 30, 30);
  for (const c of chunks) {
    const b = chunkBounds(grid, c.cx, c.cy);
    assert.ok(b.col0 >= colMin(grid) && b.col1 <= colMax(grid), "column out of bounds");
    assert.ok(b.row0 >= rowMin(grid) && b.row1 <= rowMax(grid), "row out of bounds");
  }
});

test("panning within a chunk does not change the visible set", () => {
  // This is what makes panning cheap: the chunk set only changes at a
  // boundary, so the instance buffers are not rebuilt every frame.
  const grid = makeGrid(400, 200);
  const id = (col) => chunksInView(grid, col, 0, 12, 14).map((c) => c.key).join("|");

  const base = chunkOf(0, 0);
  const insideSameChunk = base.cx * CHUNK + 1;
  assert.equal(id(base.cx * CHUNK), id(insideSameChunk), "the set changed without crossing a chunk");
  assert.notEqual(id(0), id(CHUNK * 6), "crossing several chunks must change the set");
});

// --- scaling ---------------------------------------------------------------

test("a huge board saves small and simulates fast", () => {
  const world = createWorld(3, { width: 400, height: 200 });
  assert.equal(tileCountOf(world.grid), 80_000);

  const save = JSON.stringify(serialize(world));
  assert.ok(save.length < 60_000, `save was ${(save.length / 1024).toFixed(0)} KB`);

  const t0 = performance.now();
  for (let i = 0; i < 30; i++) advanceDay(world);
  const perDay = (performance.now() - t0) / 30;
  assert.ok(perDay < 25, `advanceDay took ${perDay.toFixed(1)}ms on an 80,000-tile board`);

  const back = deserialize(JSON.parse(save));
  assert.deepEqual(back.grid, world.grid);
});
