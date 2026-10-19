/**
 * The neighbours keep growing.
 *
 * First playtest: "the AI camps stop growing — they plateau and never
 * recover." Measured: every camp reached 12 residents and ~24 buildings by
 * about day 130 and never moved again, because both were flat constants.
 *
 * The fix is the mix the user chose (campCeiling + pullAlong): their ceiling
 * rises with their own level and tracks YOUR size, and a camp that has fallen
 * far behind you gets newcomers. These tests play three simulated years and
 * assert the system fires — that growth continues after day 130 — rather
 * than that a function returns a shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeFinished as place } from "./support.mjs";
import { createWorld } from "../src/game/world.js";
import { advanceDay } from "../src/game/tick.js";
import { makeWorker } from "../src/game/workers.js";
import { allCamps, pullAlong, CATCH_UP_EVERY } from "../src/game/rivalcamp.js";
import { campResidents, campCeiling } from "../src/game/campAI.js";
import { raidPressure, sizePressure } from "../src/game/rivals.js";

/** A player who grows steadily to 24 people, fed so starvation is not the story. */
function growingValley(seed, days, { grow = true } = {}) {
  const world = createWorld(seed, { width: 60, height: 40 });
  place(world, world.home.q, world.home.r, "base");
  while (world.workers.length < 4) makeWorker(world, world.home.q, world.home.r);
  const samples = [];
  for (let d = 1; d <= days; d++) {
    advanceDay(world);
    world.store.food = Math.max(world.store.food, 200);
    if (grow && d % 12 === 0 && world.workers.length < 24) makeWorker(world, world.home.q, world.home.r);
    if (d % 24 === 0) {
      samples.push(allCamps(world).map((c) => ({
        id: c.id,
        residents: campResidents(world, c),
        buildings: c.buildings.filter((b) => b.condition > 0).length,
        level: c.level || 1,
      })));
    }
  }
  return { world, samples };
}

test("camps are still growing in the second and third years alongside a growing player", () => {
  const { samples } = growingValley(3, 288);
  const at = (i, id) => samples[i].find((c) => c.id === id);
  const early = 5; // day 144 — after the old plateau
  let grew = 0;
  for (const c of samples[early]) {
    const later = at(samples.length - 1, c.id);
    if (!later) continue; // routed and replaced
    if (later.residents > c.residents || later.buildings > c.buildings || later.level > c.level) grew++;
  }
  assert.ok(grew >= Math.ceil(samples[early].length / 2),
    `only ${grew} of ${samples[early].length} camps grew after day 144`);
  const biggest = Math.max(...samples[samples.length - 1].map((c) => c.residents));
  assert.ok(biggest > 12, `the old cap was 12 residents; the biggest camp has ${biggest}`);
});

test("a small player is not buried: camps stay within reach of your size", () => {
  const { world } = growingValley(3, 200, { grow: false });
  for (const camp of allCamps(world)) {
    const ceiling = campCeiling(world, camp);
    assert.ok(campResidents(world, camp) <= ceiling.residents + 1,
      `camp ${camp.id} has ${campResidents(world, camp)} against a ceiling of ${ceiling.residents}`);
    assert.ok(ceiling.residents <= 14, "a four-person settlement should face hamlets, not towns");
  }
});

test("a camp far behind you gets newcomers, but not while it is still burning", () => {
  const { world } = growingValley(3, 30, { grow: false });
  while (world.workers.length < 20) makeWorker(world, world.home.q, world.home.r);
  world.day = 30; // summer
  const camp = allCamps(world)[0];
  camp.fighters = 1;
  camp.store.food = 2000;
  camp.lastNewcomer = 0;
  camp.buildings.push({ id: "hut", q: camp.home.q + 1, r: camp.home.r, condition: 100 });
  assert.equal(pullAlong(world, camp), true, "a camp this far behind should gain someone");
  assert.equal(pullAlong(world, camp), false, `and then wait ${CATCH_UP_EVERY} days`);

  camp.lastNewcomer = 0;
  camp.lastBurned = world.day;
  assert.equal(pullAlong(world, camp), false, "a camp you just burned stays burned for a season");
});

test("a big settlement is worth a raid even with everything under cover", () => {
  const world = createWorld(3);
  Object.assign(world.store, { food: 0, wood: 0, stone: 0 });
  assert.equal(sizePressure(world), 0);
  while (world.workers.length < 22) makeWorker(world, 0, 0);
  assert.ok(sizePressure(world) > 0.3);
  assert.ok(raidPressure(world) > 0.3, "a town with nothing exposed is still a target");
});
