import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorld, serialize, deserialize, allTiles, worldTileCount, DEFAULT_GRID,
} from "../src/game/world.js";
import { getTile, getTerrain } from "../src/game/tiles.js";
import { optionsFor, touches, TERRAIN } from "../src/game/terrain.js";
import {
  startWork, advanceDay, advanceHour, advanceDays, daysSince, MAX_CATCHUP_DAYS,
} from "../src/game/tick.js";
import { makeWorker } from "../src/game/workers.js";
import { key } from "../src/game/hex.js";
import { own } from "./support.mjs";

test("a new world is width x height tiles and starts on day 1", () => {
  const w = createWorld(1);
  assert.equal(worldTileCount(w), DEFAULT_GRID.width * DEFAULT_GRID.height);
  assert.equal(w.day, 1);
  // Nothing is stored until the player changes something. The home tile may
  // have been forced to grass, so allow one.
  assert.ok(w.modified.size <= 1, `a fresh world stored ${w.modified.size} tiles`);
});

test("a board of any size can be asked for", () => {
  const big = createWorld(1, { width: 400, height: 200 });
  assert.equal(worldTileCount(big), 80_000);
  // ...and still stores almost nothing. This is the whole point.
  assert.ok(big.modified.size <= 1, `stored ${big.modified.size} tiles for an 80,000-tile board`);
});

test("every tile has a known terrain, across many seeds", () => {
  for (let s = 0; s < 60; s++) {
    for (const t of allTiles(createWorld(s))) {
      assert.ok(TERRAIN[t.terrain], `seed ${s} produced terrain "${t.terrain}"`);
    }
  }
});

test("every map has somewhere buildable to start", () => {
  for (let s = 0; s < 60; s++) {
    const w = createWorld(s);
    const home = getTile(w, w.home.q, w.home.r);
    assert.ok(home && TERRAIN[home.terrain].buildable, `seed ${s} has no buildable home`);
  }
});

test("maps vary but are reproducible from their seed", () => {
  const shape = (s) => [...allTiles(createWorld(s))].map((t) => t.terrain).join("");
  assert.equal(shape(5), shape(5), "same seed must rebuild the same map");
  const distinct = new Set([...Array(50).keys()].map(shape));
  assert.ok(distinct.size > 40, `only ${distinct.size} distinct maps in 50 seeds`);
});

test("terrain is a pure function of position — order of access cannot matter", () => {
  const a = createWorld(31);
  const b = createWorld(31);
  const coords = [...allTiles(a)].map((t) => ({ q: t.q, r: t.r }));

  // Read one world in order and the other backwards. Under the old
  // sequential RNG, `size` came out different; hashing by position fixes it.
  const forward = coords.map((c) => getTile(a, c.q, c.r));
  const backward = [...coords].reverse().map((c) => getTile(b, c.q, c.r)).reverse();

  for (let i = 0; i < forward.length; i++) {
    assert.equal(forward[i].terrain, backward[i].terrain, "terrain differed by access order");
    assert.equal(forward[i].size, backward[i].size, "size differed by access order");
  }
});

test("irrigating sand is blocked unless it touches water", () => {
  const w = createWorld(7);
  for (const t of allTiles(w)) {
    if (t.terrain !== "sand") continue;
    const opt = optionsFor(w, t).find((o) => o.id === "irrigate");
    const near = touches(w, t, "water");
    assert.equal(opt.blockedBy === null, near,
      `sand at ${t.q},${t.r}: touches water = ${near} but blocked = ${opt.blockedBy}`);
  }
});

test("a job finishes after the worker-hours it promised, not before", () => {
  // Jobs are costed in WORKER-HOURS now: one person on the tile contributes
  // one an hour. With exactly one worker, elapsed hours equal the cost.
  const w = createWorld(7);
  const sand = [...allTiles(w)].find(
    (t) => t.terrain === "sand" && touches(w, t, "water"));
  assert.ok(sand, "seed 7 should contain sand beside water");

  // Put a worker right on the tile so no time is spent walking. `own` states
  // the premise that this ground is already the player's — see support.mjs.
  makeWorker(w, sand.q, sand.r);
  own(w, sand);
  const started = startWork(w, sand.q, sand.r, "irrigate");
  assert.ok(started.ok, started.reason);
  assert.ok(started.worker, "somebody should have been sent");

  for (let i = 0; i < started.hours - 1; i++) {
    advanceHour(w);
    assert.equal(getTerrain(w, sand.q, sand.r), "sand", "changed early");
  }
  advanceHour(w);
  assert.equal(getTerrain(w, sand.q, sand.r), "grass", "should be done now");
});

test("two workers finish a job in half the time", () => {
  // The whole point of costing jobs in worker-hours rather than elapsed days.
  const run = (howMany) => {
    const w = createWorld(7);
    const sand = [...allTiles(w)].find(
      (t) => t.terrain === "sand" && touches(w, t, "water"));
    for (let i = 0; i < howMany; i++) makeWorker(w, sand.q, sand.r);
    own(w, sand);
    const started = startWork(w, sand.q, sand.r, "irrigate");
    // Everyone on the tile should be working it.
    for (const worker of w.workers) {
      worker.state = "working";
      worker.job = { q: sand.q, r: sand.r };
    }
    let hours = 0;
    while (getTerrain(w, sand.q, sand.r) === "sand" && hours < 200) {
      advanceHour(w);
      hours++;
    }
    return { hours, cost: started.hours };
  };

  const one = run(1);
  const two = run(2);
  assert.ok(two.hours < one.hours, `two workers should be faster: ${two.hours} vs ${one.hours}`);
  assert.ok(
    Math.abs(two.hours - one.hours / 2) <= 2,
    `two workers should be about twice as fast: ${one.hours} -> ${two.hours}`
  );
});

test("quarrying a bigger mountain takes longer", () => {
  const w = createWorld(3);
  const m = [...allTiles(w)].find((t) => t.terrain === "mountain");
  assert.ok(m, "seed 3 should contain a mountain");
  const small = { ...m, size: 0.3 }, big = { ...m, size: 1.0 };
  const hours = (t) => optionsFor(w, t).find((o) => o.id === "quarry").hours;
  assert.ok(hours(big) > hours(small), "size should matter");
});

test("you cannot start two jobs on one tile", () => {
  const w = createWorld(7);
  const sand = [...allTiles(w)].find(
    (t) => t.terrain === "sand" && touches(w, t, "water"));
  own(w, sand);
  assert.ok(startWork(w, sand.q, sand.r, "irrigate").ok);
  const second = startWork(w, sand.q, sand.r, "flood");
  assert.equal(second.ok, false);
  assert.match(second.reason, /already/);
});

test("offline catch-up is capped", () => {
  const w = createWorld(1);
  const { daysRun, capped } = advanceDays(w, 10_000);
  assert.equal(daysRun, MAX_CATCHUP_DAYS);
  assert.ok(capped);
  assert.equal(w.day, 1 + MAX_CATCHUP_DAYS);
});

test("days elapsed is computed from wall-clock time", () => {
  const now = Date.now();
  assert.equal(daysSince(now, now), 0);
  assert.equal(daysSince(now - 120_000, now), 1);
  assert.equal(daysSince(now - 1_200_000, now), 10);
});

test("a world survives a save and load round-trip", () => {
  const w = createWorld(12);
  const sand = [...allTiles(w)].find((t) => t.terrain === "sand" && touches(w, t, "water"));
  if (sand) {
    own(w, sand);
    startWork(w, sand.q, sand.r, "irrigate");
  }
  advanceDay(w);

  const back = deserialize(JSON.parse(JSON.stringify(serialize(w))));
  assert.equal(back.day, w.day);
  assert.equal(back.seed, w.seed);
  assert.deepEqual(back.grid, w.grid);
  assert.equal(back.modified.size, w.modified.size);
  assert.equal(back.active.size, w.active.size, "the active set is rebuilt on load");
  assert.deepEqual(back.terrainCounts, w.terrainCounts);

  // Every tile must read back the same, stored or regenerated.
  const mine = [...allTiles(w)];
  const theirs = [...allTiles(back)];
  assert.equal(mine.length, theirs.length);
  for (let i = 0; i < mine.length; i++) assert.deepEqual(theirs[i], mine[i]);
});

test("the save holds only what changed, not the whole board", () => {
  const w = createWorld(1, { width: 400, height: 200 });
  const size = JSON.stringify(serialize(w)).length;
  assert.ok(
    size < 50_000,
    `an 80,000-tile board saved as ${(size / 1024).toFixed(0)} KB — sparse storage is not working`
  );
});
