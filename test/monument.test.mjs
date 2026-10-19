/**
 * Somewhere for the pile to go.
 *
 * Wood and stone got a source that argues back in ground.js. They still had no
 * sink: masonry upkeep takes a stone or two a day and the base upgrades are
 * finished by year two, so a three-year settlement sat on thousands of both.
 * The monument is the continuous sink — 2,000 stone and 480 timber, taken a
 * little at a time, for nothing but the milestone and the attention it draws.
 *
 * The other half of this pass is a ceiling on herbs and seeds, which had none
 * at all and so climbed forever.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeFinished } from "./support.mjs";
import { createWorld, allTiles, serialize, deserialize } from "../src/game/world.js";
import { setTerrain } from "../src/game/tiles.js";
import { claimTile } from "../src/game/territory.js";
import { advanceDay } from "../src/game/tick.js";
import { BUILDINGS, place, canPlace } from "../src/game/buildings.js";
import { storageCapacity, addResource, BASE_STORAGE } from "../src/game/economy.js";
import { milestones } from "../src/game/management.js";
import { raidPressure } from "../src/game/rivals.js";
import {
  MONUMENT, stepMonument, monumentTile, coursesStanding, monumentFinished,
  monumentPressure, monumentSummary, setMonumentWork,
} from "../src/game/monument.js";

function valley({ stone = 5000, wood = 5000 } = {}) {
  const w = createWorld(23, { width: 24, height: 16 });
  for (const t of allTiles(w)) { setTerrain(w, t.q, t.r, "grass"); claimTile(w, t.q, t.r); }
  assert.equal(placeFinished(w, 0, 0, "base").ok, true);
  w.store = { food: 2000, wood, stone, herbs: 0, seeds: 0, coins: 0 };
  w.workers = [];
  w.animals = [];
  w.valleySettled = true;
  w.nextRaidDay = 99999;
  w.autoRepair = false;
  return w;
}
const found = (w) => { assert.equal(placeFinished(w, 3, 0, "monument").ok, true); return monumentTile(w).building; };

// --- the sink ----------------------------------------------------------------

test("the monument takes stone and timber every day, and a course takes weeks", () => {
  const w = valley();
  const b = found(w);
  assert.equal(coursesStanding(w), 0);

  const before = w.store.stone;
  stepMonument(w);
  assert.equal(before - w.store.stone, MONUMENT.perDay.stone, "a day's carrying, no more");

  // A course is 250 stone at 20 a day: thirteen days, not one.
  let days = 1;
  while (coursesStanding(w) === 0 && days < 100) { stepMonument(w); days += 1; }
  assert.equal(coursesStanding(w), 1);
  assert.ok(days >= MONUMENT.course.stone / MONUMENT.perDay.stone,
    `a course should take weeks, took ${days} days`);
  assert.equal(b.laid.stone ?? 0, 0, "and the next course starts from nothing");
});

test("it is finished eventually, and that is the furthest milestone in the game", () => {
  const w = valley();
  found(w);
  const start = { ...w.store }; // after the founding cost, which is not a course
  let told = 0;
  for (let d = 0; d < 400 && !monumentFinished(w); d++) {
    for (const e of stepMonument(w)) if (e.type === "monument") told += 1;
  }
  assert.equal(monumentFinished(w), true);
  assert.equal(told, MONUMENT.COURSES, "one announcement per course, including the last");
  assert.equal(w.store.stone, start.stone - MONUMENT.COURSES * MONUMENT.course.stone);
  assert.equal(w.store.wood, start.wood - MONUMENT.COURSES * MONUMENT.course.wood);

  const m = milestones(w).find((x) => x.id === "monument");
  assert.equal(m.done, true, "raising it is a milestone");
});

test("it will not take the last of the stone, and says so once", () => {
  // Enough to found it and five spare on top of the reserve, so the masons
  // have exactly five stone they are allowed to touch.
  const w = valley({ stone: MONUMENT.reserve.stone + BUILDINGS.monument.cost.stone + 5, wood: 5000 });
  found(w);
  let told = 0;
  // Long enough for the timber for this course to be carried up too, so the
  // work has genuinely stopped rather than merely slowed.
  for (let d = 0; d < 40; d++) for (const e of stepMonument(w)) if (e.type === "monumentWaiting") told += 1;
  assert.equal(w.store.stone, MONUMENT.reserve.stone, "the reserve is untouchable");
  assert.equal(told, 1, "and you are told once, not every day");

  // Stone turns up again and the work resumes without anyone asking.
  w.store.stone += 500;
  stepMonument(w);
  assert.ok(w.store.stone < MONUMENT.reserve.stone + 500);
});

test("you can stop the work", () => {
  const w = valley();
  found(w);
  setMonumentWork(w, false);
  const before = w.store.stone;
  for (let d = 0; d < 20; d++) stepMonument(w);
  assert.equal(w.store.stone, before, "paused means paused");
  setMonumentWork(w, true);
  stepMonument(w);
  assert.ok(w.store.stone < before);
});

test("an unfinished monument does not build itself", () => {
  const w = valley();
  const res = place(w, 3, 0, "monument");
  assert.equal(res.ok, true);
  assert.ok(res.building.construction, "it has to be built first");
  const before = w.store.stone;
  stepMonument(w);
  assert.equal(w.store.stone, before, "nothing is carried up a scaffold");
});

// --- and what it costs you ---------------------------------------------------

test("a monument can be seen for miles, which raiders notice", () => {
  const w = valley();
  const b = found(w);
  Object.assign(w.store, { food: 0, wood: 0, stone: 0 });
  assert.equal(monumentPressure(w), 0, "an unbuilt tower is not a boast");
  const bare = raidPressure(w);

  b.courses = MONUMENT.COURSES;
  assert.ok(monumentPressure(w) > 0.2);
  assert.ok(raidPressure(w) > bare, "finishing it makes you worth the walk");
});

test("it is the tallest thing on the board, and there is only ever one", () => {
  const w = valley();
  found(w);
  assert.ok(BUILDINGS.monument.watch > BUILDINGS.watchtower.watch,
    "a monument sees further than a watchtower or it is not taller than one");
  assert.equal(canPlace(w, 6, 0, "monument").ok, false, "one to a valley");
});

test("the monument survives a save and load mid-course", () => {
  const w = valley();
  found(w);
  for (let d = 0; d < 20; d++) stepMonument(w);
  const summary = monumentSummary(w);
  assert.ok(summary.laid.stone > 0 || summary.courses > 0);

  const back = deserialize(serialize(w));
  const after = monumentSummary(back);
  assert.deepEqual(after.laid, summary.laid);
  assert.equal(after.courses, summary.courses);
});

test("the monument's day runs inside advanceDay, not only when a test calls it", () => {
  // The failure this project keeps having is a system that exists and is never
  // wired in. This is the test that would have caught it.
  const w = valley();
  found(w);
  const before = w.store.stone;
  advanceDay(w);
  assert.equal(before - w.store.stone >= MONUMENT.perDay.stone, true);
});

// --- the stores have a ceiling now -------------------------------------------

test("herbs and seeds stop piling up, and a building is how you hold more", () => {
  // Measured before this: 300+ herbs by year two, because foraging is what
  // every idle worker does and nothing ever capped it.
  const w = valley();
  assert.equal(BASE_STORAGE.herbs, storageCapacity(w).herbs);
  assert.equal(addResource(w, "herbs", 10_000), BASE_STORAGE.herbs, "only what fits");
  assert.equal(w.store.herbs, BASE_STORAGE.herbs);
  assert.equal(addResource(w, "herbs", 5), 0, "and then nothing");

  assert.equal(placeFinished(w, 5, 0, "infirmary").ok, true);
  assert.ok(storageCapacity(w).herbs > BASE_STORAGE.herbs, "an infirmary is where medicine is kept");
  assert.ok(addResource(w, "herbs", 50) > 0);

  assert.equal(addResource(w, "seeds", 10_000), BASE_STORAGE.seeds);
  assert.equal(placeFinished(w, 7, 0, "granary").ok, true);
  assert.ok(storageCapacity(w).seeds > BASE_STORAGE.seeds, "a granary keeps seed corn");
});

test("a surplus you already had is never destroyed by a ceiling", () => {
  // The rule everywhere else in the store: capacity pauses new supplies, it
  // does not confiscate. A cap that deleted 300 herbs on load would be a bug
  // report with a save file attached.
  const w = valley();
  w.store.herbs = 500;
  advanceDay(w);
  assert.equal(w.store.herbs, 500);
});
