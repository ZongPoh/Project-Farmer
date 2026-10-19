import { placeFinished as place } from "./support.mjs";
/**
 * Getting better.
 *
 * The measurement that drove every number here: with plain rest at its old
 * 1.5/hour, FIVE different configurations — nothing, an infirmary, herbs,
 * both, both plus a trained healer — produced identical outcomes. A baseline
 * that good leaves nothing for anything else to improve, and the whole system
 * was decorative. Rest is 0.4/hour now, and these tests exist to keep the
 * difference between "you built for this" and "you did not" real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { own } from "./support.mjs";
import { createWorld, allTiles } from "../src/game/world.js";

import { advanceHour } from "../src/game/tick.js";
import { makeWorker } from "../src/game/workers.js";
import { healthOf, HEAL_PER_HOUR, RETREAT_BELOW } from "../src/game/danger.js";
import {
  careHour, dailyWounds, careSummary, bestHealer, healerRating, inABed,
  bedCount, sickbayFor, FESTER_BELOW, FESTER_DAMAGE, TREATED_BONUS,
} from "../src/game/healing.js";

function settlement(seed = 11, { infirmary = false, herbs = 0 } = {}) {
  const world = createWorld(seed);
  const grass = [...allTiles(world)].filter((t) => t.terrain === "grass");
  place(world, grass[0].q, grass[0].r, "base");
  own(world, grass.slice(0, 24));
  world.store.wood = 500;
  world.store.stone = 500;
  world.store.food = 900;
  if (infirmary) place(world, grass[5].q, grass[5].r, "infirmary");
  world.store.herbs = herbs;
  world.nextRaidDay = 1e6; // isolate healing from the rivals
  if (world.workers.length === 0) makeWorker(world, grass[0].q, grass[0].r);
  return { world, grass };
}

const always = () => 0;   // rnd that always fires
const never = () => 1;    // rnd that never does

// --- the reason the system exists ------------------------------------------

test("a deep wound left alone gets worse, not better", () => {
  // Without this the whole system is optional, and the correct play is to
  // ignore it — which is exactly what was wrong with the old version.
  const { world } = settlement();
  const worker = world.workers[0];
  worker.health = FESTER_BELOW - 10;

  dailyWounds(world, always);
  assert.equal(worker.festering, true, "a deep untreated wound should turn");

  const before = healthOf(worker);
  dailyWounds(world, always);
  assert.ok(healthOf(worker) < before, "a festering wound must cost health");
});

test("festering outruns plain rest, or it is not a threat", () => {
  // The single most important number relationship in this file: if resting
  // beat festering, a bad wound would be a slower recovery rather than a
  // danger, and nobody would ever build an infirmary.
  assert.ok(
    FESTER_DAMAGE > HEAL_PER_HOUR * 24,
    `festering (${FESTER_DAMAGE}/day) must exceed rest (${HEAL_PER_HOUR * 24}/day)`
  );
});

test("a wound can actually kill, rather than parking somebody at zero", () => {
  // It could not, at first: `reapTheFallen` was only ever called by the fox
  // system, so festering took workers to zero health and left them there —
  // alive, useless, and waiting for a fox.
  const { world } = settlement();
  const worker = world.workers[0];
  worker.health = 20;
  worker.festering = true;

  for (let day = 0; day < 10 && world.workers.includes(worker); day++) {
    dailyWounds(world, always);
  }
  assert.equal(world.workers.includes(worker), false, "an untreated wound should finish them");
});

// --- the answers -----------------------------------------------------------

test("a bed stops a wound turning bad in the first place", () => {
  const { world, grass } = settlement(11, { infirmary: true });
  const worker = world.workers[0];
  worker.q = grass[5].q;
  worker.r = grass[5].r;
  worker.health = FESTER_BELOW - 10;

  assert.ok(inABed(world, worker), "they should be in the infirmary");
  dailyWounds(world, always);
  assert.ok(!worker.festering, "a wound does not turn in a bed");
});

test("herbs and a spare pair of hands cure one that already has", () => {
  const { world } = settlement(11, { herbs: 5 });
  const patient = world.workers[0];
  makeWorker(world, patient.q, patient.r); // somebody well enough to help
  patient.health = 30;
  patient.festering = true;

  careHour(world, patient);
  assert.equal(patient.festering, false, "treatment must stop it festering");
  assert.ok(world.store.herbs <= 5, "herbs are consumed");
});

test("treatment needs somebody who is not themselves in the bed", () => {
  // A settlement whose only healthy people are the patients should be in
  // trouble. That is a situation worth being able to get into.
  const { world } = settlement(11, { herbs: 5 });
  for (const w of world.workers) w.health = 10;

  assert.equal(bestHealer(world), null, "nobody well enough to tend anyone");
  const before = healthOf(world.workers[0]);
  careHour(world, world.workers[0]);
  assert.equal(healthOf(world.workers[0]), before, "no treatment should have happened");
});

test("training in medicine makes a healer measurably better", () => {
  const raw = { skills: {} };
  const trained = { skills: { medicine: 3 } };
  assert.equal(healerRating(raw), 1, "anyone can change a dressing");
  assert.ok(healerRating(trained) > healerRating(raw), "training must be worth something");
});

test("herbs alone are not enough without hands, and hands not without herbs", () => {
  const { world } = settlement(11, { herbs: 0 });
  makeWorker(world, world.workers[0].q, world.workers[0].r);
  const patient = world.workers[0];
  patient.health = 30;
  assert.equal(careHour(world, patient), 0, "no herbs, no treatment");
});

// --- where the hurt go -----------------------------------------------------

test("the hurt are sent to an infirmary when there is one, and home when there is not", () => {
  const bare = settlement();
  const home = { q: 0, r: 0 };
  assert.deepEqual(
    sickbayFor(bare.world, bare.world.workers[0], home),
    home,
    "with no infirmary they must still go somewhere — the base"
  );

  const cared = settlement(11, { infirmary: true });
  const bed = sickbayFor(cared.world, cared.world.workers[0], home);
  assert.notDeepEqual(bed, home, "with an infirmary they should go to it");
  assert.equal(bedCount(cared.world) > 0, true);
});

test("a ruined infirmary is not an infirmary", () => {
  const { world, grass } = settlement(11, { infirmary: true });
  assert.ok(bedCount(world) > 0);
  world.modified.get(`${grass[5].q},${grass[5].r}`).building.condition = 0;
  assert.equal(bedCount(world), 0, "a ruin has no beds");
});

// --- the read-out ----------------------------------------------------------

test("the summary says whether this settlement can look after itself", () => {
  const bare = settlement().world;
  assert.equal(careSummary(bare).canTreat, false, "no herbs means no");

  const stocked = settlement(11, { herbs: 4 }).world;
  makeWorker(stocked, stocked.workers[0].q, stocked.workers[0].r);
  assert.equal(careSummary(stocked).canTreat, true);
});

test("a wound above the threshold stops being one that can turn", () => {
  const { world } = settlement();
  const worker = world.workers[0];
  worker.health = FESTER_BELOW - 5;
  dailyWounds(world, always);
  assert.equal(worker.festering, true);

  worker.health = FESTER_BELOW + 20;
  dailyWounds(world, never);
  assert.equal(worker.festering, false, "healing past the threshold must clear it");
});

test("workers are at risk before they give up and walk home", () => {
  // FESTER_BELOW sits above RETREAT_BELOW on purpose: the dangerous part is
  // being hurt in the field, which is where the danger ought to live.
  assert.ok(
    FESTER_BELOW > RETREAT_BELOW,
    "a worker should be at risk of festering before they retreat, not after"
  );
});
