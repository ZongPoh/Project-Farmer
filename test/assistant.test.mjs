import { placeFinished as place } from "./support.mjs";
/**
 * The text interface. (Step 5)
 *
 * The point of these tests: every sentence the assistant produces has to be
 * true of the world it was given. A parser test that only checks intents
 * would miss the thing that actually matters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { own } from "./support.mjs";
import { createWorld, allTiles } from "../src/game/world.js";
import { getTile } from "../src/game/tiles.js";
import { advanceDays, startWork } from "../src/game/tick.js";

import {
  parse, respond, describeFarm, adviseFarm, levenshtein, closestWord, tokenize,
} from "../src/game/assistant.js";
import { key } from "../src/game/hex.js";
import { describeDate } from "../src/game/calendar.js";

function ready(seed = 1) {
  const world = createWorld(seed);
  const grass = [...allTiles(world)].filter((t) => t.terrain === "grass");
  place(world, grass[0].q, grass[0].r, "base");
  // Not a test about territory — see test/support.mjs.
  own(world, [...allTiles(world)]);
  world.store.wood = 100;
  world.store.stone = 100;
  return { world, grass };
}

// --- the parser ------------------------------------------------------------

test("phrasings of the same question reach the same intent", () => {
  for (const s of [
    "how is my farm?", "how's my farm today?", "status", "give me a report",
    "how are things going?",
  ]) {
    assert.equal(parse(s).intent, "REPORT", `"${s}" should be a REPORT`);
  }
});

test("asking for advice is told apart from asking for a report", () => {
  for (const s of ["what should i do next?", "what next", "help me", "any advice?"]) {
    assert.equal(parse(s).intent, "ADVISE", `"${s}" should be ADVISE`);
  }
});

test("coordinates parse the same however they are written", () => {
  const a = parse("build a farm at 2,-1");
  const b = parse("build farm 2 -1");
  assert.deepEqual(a.coords, { q: 2, r: -1 });
  assert.deepEqual(b.coords, a.coords);
  assert.equal(a.building, "farm");
  assert.equal(b.building, "farm");
});

test("filler words do not change the outcome", () => {
  assert.deepEqual(
    parse("please can you build me a farm at 0 0").coords,
    parse("build farm 0 0").coords
  );
});

test('"quarry camp" is a building, not the quarry job', () => {
  assert.equal(parse("build a quarry camp at 1 1").intent, "BUILD");
  assert.equal(parse("quarry 1 1").intent, "JOB");
  assert.equal(parse("quarry 1 1").job, "quarry");
});

test("Levenshtein and the did-you-mean fallback", () => {
  assert.equal(levenshtein("status", "status"), 0);
  assert.equal(levenshtein("stauts", "status"), 2);
  assert.equal(closestWord("stauts"), "status");
  assert.equal(closestWord("frm"), "farm");
  assert.equal(closestWord("xyzzyplugh"), null, "nonsense should not be corrected");
});

test("a typo gets a suggestion rather than a shrug", () => {
  const { world } = ready();
  const out = respond(world, "stauts");
  assert.match(out.text, /did you mean "status"/i);
  assert.equal(out.changed, false);
});

test("tokenize strips punctuation but keeps negative numbers findable", () => {
  assert.deepEqual(tokenize("How's my farm?!"), ["how's", "my", "farm"]);
  assert.deepEqual(parse("look at -2,3").coords, { q: -2, r: 3 });
});

// --- the report, which must only say true things ---------------------------

test("the report states the real day and the real store", () => {
  const { world } = ready();
  advanceDays(world, 9);
  const text = describeFarm(world);
  assert.match(text, new RegExp(`Day ${world.day}\\b`));
  assert.match(text, new RegExp(`${world.store.food} food`));
  assert.match(text, new RegExp(`${world.store.wood} wood`));
  // The date should be there too, and it must agree with the day number.
  assert.match(text, new RegExp(describeDate(world.day)));
});

test("the report counts buildings that exist and invents none", () => {
  const { world, grass } = ready();
  const bare = describeFarm(world);
  assert.ok(!/farm/i.test(bare.replace(/my farm|the farm/gi, "")), "no farms yet");

  place(world, grass[1].q, grass[1].r, "farm");
  place(world, grass[2].q, grass[2].r, "farm");
  assert.match(describeFarm(world), /2 farms/);
});

test("the report names a job and how long is left", () => {
  const { world } = ready();
  const mountain = [...allTiles(world)].find((t) => t.terrain === "mountain");
  if (!mountain) return;
  startWork(world, mountain.q, mountain.r, "quarry");
  const text = describeFarm(world);
  assert.match(text, /1 job on the go/);
  assert.match(text, new RegExp(`${mountain.q},${mountain.r}`));
});

test("the report mentions wildlife only once there is some", () => {
  const { world } = ready();
  assert.ok(!/rabbit/i.test(describeFarm(world)), "no wildlife on day 1");

  advanceDays(world, 80);
  const text = describeFarm(world);
  const rabbits = world.animals.filter((a) => a.species === "rabbit").length;
  if (rabbits > 0) {
    assert.match(text, new RegExp(`${rabbits} rabbit`));
  }
});

// --- advice ----------------------------------------------------------------

test("advice is ordered — the most urgent thing wins", () => {
  const world = createWorld(1);
  assert.match(adviseFarm(world), /base/i, "with no base, that is the advice");

  const { world: w2 } = ready();
  w2.store.food = 1;
  assert.match(adviseFarm(w2), /food/i, "starving outranks everything else");
});

test("advice changes as the farm changes", () => {
  const { world, grass } = ready();
  const first = adviseFarm(world);
  place(world, grass[1].q, grass[1].r, "farm");
  place(world, grass[2].q, grass[2].r, "farm");
  world.store.food = 40;
  world.store.wood = 40;
  assert.notEqual(adviseFarm(world), first, "advice should not be a constant");
});

// --- actions ---------------------------------------------------------------

test('"build a farm at q,r" actually places a farm', () => {
  const { world, grass } = ready();
  const t = grass[1];
  const out = respond(world, `build a farm at ${t.q},${t.r}`);
  assert.equal(out.changed, true, out.text);
  assert.equal(getTile(world, t.q, t.r).building.id, "farm");
});

test("a refused action explains itself and changes nothing", () => {
  const { world, grass } = ready();
  world.store.wood = 0;
  const t = grass[1];
  const out = respond(world, `build a farm at ${t.q},${t.r}`);
  assert.equal(out.changed, false);
  assert.match(out.text, /not enough/);
  assert.equal(getTile(world, t.q, t.r).building, null);
});

test("a job can be started by typing it", () => {
  const { world } = ready();
  const mountain = [...allTiles(world)].find((t) => t.terrain === "mountain");
  if (!mountain) return;
  const out = respond(world, `quarry ${mountain.q} ${mountain.r}`);
  assert.equal(out.changed, true, out.text);
  assert.ok(getTile(world, mountain.q, mountain.r).work);
});

test("looking at a tile describes what is really on it", () => {
  const { world, grass } = ready();
  const t = grass[1];
  place(world, t.q, t.r, "farm");
  const out = respond(world, `what's at ${t.q},${t.r}?`);
  assert.match(out.text, /farm/i);
  assert.equal(out.changed, false);
});

test("the assistant never moves time forward", () => {
  const { world } = ready();
  const day = world.day;
  for (const s of ["how is my farm", "what next", "build a farm at 0 0", "nonsense words here"]) {
    respond(world, s);
  }
  assert.equal(world.day, day, "only advanceDay may change the day");
});

test("an empty or baffling input still gets a helpful reply", () => {
  const { world } = ready();
  const out = respond(world, "zzzz qqqq");
  assert.ok(out.text.length > 10);
  assert.equal(out.changed, false);
});
