import { placeFinished as place } from "./support.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, serialize, deserialize } from "../src/game/world.js";

import { setTerrain, getTile } from "../src/game/tiles.js";
import { claimTile } from "../src/game/territory.js";
import { makeWorker, findOpenJob } from "../src/game/workers.js";
import { startClaim, advanceHour } from "../src/game/tick.js";
import { jobQueue, setJobPriority, moveJob, dailyPrograms, setProgram, travelBonus, recordMilestones, milestones } from "../src/game/management.js";

function settlement() {
  const w = createWorld(23);
  place(w, w.home.q, w.home.r, "base");
  w.workers = [];
  w.autoForage = false;
  return w;
}

test("priority changes actual dispatch; manual order survives saving", () => {
  const w = settlement();
  w.owned.clear(); w.claims.clear();
  for (const at of [{q: 1, r: 0}, {q: 2, r: 0}, {q: 3, r: 0}]) {
    setTerrain(w, at.q, at.r, "grass");
    claimTile(w, at.q, at.r - 1);
    assert.ok(startClaim(w, at.q, at.r).ok);
  }
  assert.deepEqual(findOpenJob(w, {q: 0, r: 0}), {q: 1, r: 0});
  setJobPriority(w, 3, 0, 2);
  assert.deepEqual(findOpenJob(w, {q: 0, r: 0}), {q: 3, r: 0});
  assert.ok(moveJob(w, 2, 0, -1).ok);
  assert.deepEqual(jobQueue(w).map(t => t.q), [3, 2, 1]);
  const restored = deserialize(JSON.parse(JSON.stringify(serialize(w))));
  assert.deepEqual(jobQueue(restored).map(t => t.q), [3, 2, 1]);
});

test("programmes spend daily, provide benefits, and stop before using reserves", () => {
  const w = settlement();
  for (let i = 0; i < 4; i++) makeWorker(w, w.home.q, w.home.r);
  w.workers[0].health = 70;
  w.store.stone = 22; w.store.herbs = 11;
  setProgram(w, "roads", true); setProgram(w, "medicine", true);
  dailyPrograms(w);
  assert.equal(w.store.stone, 20); assert.equal(w.store.herbs, 10);
  assert.equal(w.workers[0].health, 72);
  assert.equal(travelBonus(w), 1.35);
  dailyPrograms(w);
  assert.equal(w.store.stone, 20); assert.equal(w.store.herbs, 10);
  assert.equal(travelBonus(w), 1);
  assert.equal(dailyPrograms(w).length, 0, "shortage warnings do not repeat daily");
});

test("milestones are remembered after requirements cease and after reload", () => {
  const w = settlement(); w.day = 97;
  recordMilestones(w);
  w.day = 1;
  const restored = deserialize(JSON.parse(JSON.stringify(serialize(w))));
  assert.ok(milestones(restored).find(m => m.id === "winter").done);
  assert.equal(recordMilestones(restored).length, 0);
});

test("claiming land reports ownership without inventing a terrain conversion", () => {
  const w = settlement();
  w.owned.clear(); w.claims.clear();
  claimTile(w, 1, -1); setTerrain(w, 1, 0, "grass");
  makeWorker(w, 1, 0);
  assert.ok(startClaim(w, 1, 0).ok);
  const events = [];
  for (let i = 0; i < 12; i++) events.push(...advanceHour(w));
  assert.ok(events.some(e => e.type === "claimed"));
  assert.ok(!events.some(e => e.type === "conversion" || e.text.includes("null")));
  assert.equal(getTile(w, 1, 0).terrain, "grass");
});
