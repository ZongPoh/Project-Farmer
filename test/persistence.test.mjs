import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, serialize } from "../src/game/world.js";
import { encodeSave, decodeSave, catchUp, writeSave } from "../src/game/persistence.js";
import { advanceHours } from "../src/game/tick.js";

test("backup restores world, programmes, accounting, and playback preferences", () => {
  const w = createWorld(42);
  w.programs = { roads: true }; w.herbDebt = 0.5; w.woodDebt = 0.75;
  const loaded = decodeSave(encodeSave(w, { running: true, secondsPerDay: 48, offline: true }, 1000));
  assert.equal(loaded.world.seed, 42); assert.equal(loaded.world.herbDebt, 0.5);
  assert.equal(loaded.world.woodDebt, 0.75); assert.equal(loaded.settings.secondsPerDay, 120);
  assert.ok(loaded.world.programs.roads);
});

test("offline progress uses current day length for older saves and matches live simulation", () => {
  const settings = { running: true, secondsPerDay: 48, offline: true };
  const a = decodeSave(encodeSave(createWorld(23), settings, 1000));
  const b = decodeSave(encodeSave(createWorld(23), settings, 1000));
  const result = catchUp(a, 121_000);
  assert.equal(result.hoursRun, 24);
  advanceHours(b.world, 24);
  assert.deepEqual(serialize(a.world), serialize(b.world));
});

test("paused, disabled, and future timestamps do not progress; long absence is capped", () => {
  for (const settings of [{running:false,offline:true}, {running:true,offline:false}]) {
    const saved = decodeSave(encodeSave(createWorld(), { ...settings, secondsPerDay:24 }, 1000));
    assert.equal(catchUp(saved, 100_000).hoursRun, 0);
  }
  const saved = decodeSave(encodeSave(createWorld(), {running:true,offline:true,secondsPerDay:24}, 1000));
  assert.equal(catchUp(saved, 0).hoursRun, 0);
  const result = catchUp(saved, 20_000_000);
  assert.equal(result.hoursRun, 2880); assert.ok(result.capped);
});

test("invalid saves and storage failures are reported, without replacing a valid save", () => {
  assert.throws(() => decodeSave("{}"));
  const data = JSON.parse(encodeSave(createWorld()));
  data.world.grid.width = 1_000_000;
  assert.throws(() => decodeSave(JSON.stringify(data)));
  data.world.grid.width = 24; data.world.modified = [{q:0,r:0,terrain:"bogus"}];
  assert.throws(() => decodeSave(JSON.stringify(data)));
  const result = writeSave({setItem() { throw new Error("quota"); }}, "x");
  assert.equal(result.ok, false);
});
