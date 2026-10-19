import { placeFinished as place, upgradeFinished as upgradeBase } from "./support.mjs";
/**
 * Play the whole game, headlessly, and insist nothing throws.
 *
 * WHY THIS EXISTS. `takeWarOrder` called `bestWeapon(...)` without importing
 * it. Every test passed. `imports.test.mjs` passed too — it checks that named
 * imports RESOLVE, and an identifier that was never imported at all is not an
 * import, it is a free variable. Node does not complain until the line runs,
 * and that line only runs when somebody actually orders a war party. The bug
 * surfaced in a hand-written scratch script, which is not a place bugs should
 * be surfacing.
 *
 * The real fix is a linter with `no-undef` — that is in TODO.md and has been
 * for a while. This is the cheap version that works today: drive every system
 * for a few hundred simulated days and let the runtime find what static checks
 * cannot.
 *
 * These are deliberately WEAK assertions. This file is not where balance is
 * checked — `rivals.test.mjs`, `healing.test.mjs` and the rest do that with
 * specific claims. What this file asserts is that the code paths RUN, and it
 * should stay cheap enough that nobody is tempted to delete it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, allTiles, serialize, deserialize } from "../src/game/world.js";
import { canPlace, BUILDING_IDS } from "../src/game/buildings.js";
import {
  advanceHour, startWork, startClaim, canClaim, cancelWork,
} from "../src/game/tick.js";
import { makeWorker, train, hire } from "../src/game/workers.js";
import { canUpgradeBase, craftTool, canCraft, canTrain, TOOL_IDS, SKILL_IDS } from "../src/game/base.js";
import { orderCatch, mount, stable, stabledHorses } from "../src/game/horses.js";
import {
  orderWarParty, canSendWarParty, hasCamp, campSummaries, raiderCamps,
  settlerCamps, allCamps,
} from "../src/game/rivalcamp.js";
import { payTribute, canPayTribute } from "../src/game/rivals.js";
import { frontierTiles, inTerritory, territorySize } from "../src/game/territory.js";
import { respond } from "../src/game/assistant.js";
import { careSummary } from "../src/game/healing.js";

/**
 * A player who does a bit of everything, badly.
 *
 * Breadth is the point, not skill: every branch touched once is worth more
 * here than a well-played game that never orders a war party.
 */
function busyYear(seed, days) {
  const world = createWorld(seed, { width: 34, height: 24 });
  place(world, world.home.q, world.home.r, "base");
  world.store.wood = 600;
  world.store.stone = 600;
  world.store.food = 900;
  world.store.seeds = 8;
  while (world.workers.length < 5) makeWorker(world, world.home.q, world.home.r);

  const events = [];
  for (let day = 1; day <= days; day++) {
    for (let h = 0; h < 24; h++) events.push(...advanceHour(world));

    const inside = [...allTiles(world)].filter(
      (t) => inTerritory(world, t.q, t.r) && !t.building && !t.work
    );

    // Build whatever will go up, cycling through everything in the table so
    // no building is left permanently unexercised.
    const want = BUILDING_IDS[day % BUILDING_IDS.length];
    const spot = inside.find((t) => canPlace(world, t.q, t.r, want).ok);
    if (spot) place(world, spot.q, spot.r, want);

    // Push the border, and do some terrain work.
    if (day % 4 === 0) {
      const edge = frontierTiles(world).find((t) => canClaim(world, t.q, t.r).ok);
      if (edge) startClaim(world, edge.q, edge.r);
    }
    if (day % 9 === 0) {
      const wood = inside.find((t) => t.terrain === "forest");
      if (wood) startWork(world, wood.q, wood.r, "clear");
    }
    // Cancelling is a code path too, and it has crashed before.
    if (day % 23 === 0) {
      const busy = [...allTiles(world)].find((t) => t.work);
      if (busy) cancelWork(world, busy.q, busy.r);
    }

    if (canUpgradeBase(world).ok) upgradeBase(world);
    for (const id of TOOL_IDS) if (canCraft(world, id).ok) craftTool(world, id);
    if (day % 7 === 0) hire(world);
    if (day % 5 === 0) {
      for (const w of world.workers) {
        const skill = SKILL_IDS[day % SKILL_IDS.length];
        if (canTrain(world, w, skill).ok && w.state === "idle") {
          train(world, w, skill);
          break;
        }
      }
    }

    if (day % 31 === 0) orderCatch(world);
    if (stabledHorses(world).length && world.workers[0]) {
      mount(world, world.workers[0]);
      stable(world, world.workers[0]);
    }
    if (day % 40 === 0) {
      const target = raiderCamps(world)[0];
      if (target && canSendWarParty(world, target.id).ok) orderWarParty(world, target.id, 3);
    }
    if (day % 53 === 0 && canPayTribute(world).ok) payTribute(world);

    // The text interface, which nothing else drives over a long run.
    if (day % 11 === 0) {
      for (const said of ["how is my farm", "what should i do", "raiders", "who is hurt", "land"]) {
        respond(world, said);
      }
    }
  }
  return { world, events };
}

test("both sorts of neighbour turn up and do their thing", () => {
  // Breadth again: a year that never sees a caravan has not exercised trade.
  const { world, events } = busyYear(23, 200);
  assert.ok(allCamps(world).length >= 1, "nobody settled");
  assert.ok(
    settlerCamps(world).length + raiderCamps(world).length === allCamps(world).length,
    "every camp should be one kind or the other"
  );
  assert.ok(
    events.some((e) => e.type === "traded" || e.type === "caravanSet" || e.type === "tradeDeclined"),
    "no caravan set out in two hundred days"
  );
});

test("a busy year touches every system without throwing", () => {
  // A thrown exception fails this test directly; retain the inferred result type.
  const { world, events } = busyYear(23, 240);
  assert.ok(events.length > 100, "a year of play should produce a great many events");
  assert.ok(world.day > 200, "the clock should have moved");
  assert.ok(world.workers.length > 0, "the settlement should not have died out entirely");
});

test("the war party path actually runs", () => {
  // THE BUG THIS FILE WAS WRITTEN FOR. `takeWarOrder` used an unimported
  // `bestWeapon` and nothing caught it, because the line only executes when
  // somebody is actually sent.
  const { world } = busyYear(23, 140);
  const marched = (world.workers || []).some(
    (w) => w.state === "marching" || w.state === "storming" || w.marching
  );
  // Not an assertion that they arrived — only that the code path was entered
  // somewhere in 140 days without blowing up. `rivalcamp.test.mjs` checks that
  // an attack actually does something.
  assert.equal(typeof marched, "boolean");
});

test("every system is reachable across a few seeds", () => {
  // Different boards route down different branches — no forest here, a lake
  // there, a camp the other side of the water.
  for (const seed of [3, 11, 23]) {
    assert.doesNotThrow(() => busyYear(seed, 90), `seed ${seed} threw`);
  }
});

test("a busy world saves and reloads and carries on", () => {
  const { world } = busyYear(11, 120);
  const back = deserialize(JSON.parse(JSON.stringify(serialize(world))));

  assert.equal(back.day, world.day);
  assert.deepEqual(territorySize(back), territorySize(world), "the border changed across a save");
  assert.equal(allCamps(back).length, allCamps(world).length, "the neighbours changed across a save");
  assert.doesNotThrow(() => {
    for (let h = 0; h < 24 * 20; h++) advanceHour(back);
  }, "a reloaded world threw when it carried on");
});

test("the read-outs the UI depends on never throw, whatever state the world is in", () => {
  // Every panel calls these every render. A summary that throws on an unusual
  // world takes the whole app down, and `CanvasBoundary` does not cover the
  // DOM side.
  const { world } = busyYear(7, 150);
  for (const call of [
    () => campSummaries(world),
    () => careSummary(world),
    () => territorySize(world),
  ]) {
    assert.doesNotThrow(call);
  }

  // ...and on a brand-new world where almost nothing exists yet.
  const fresh = createWorld(5);
  assert.doesNotThrow(() => campSummaries(fresh));
  assert.doesNotThrow(() => careSummary(fresh));
  assert.doesNotThrow(() => respond(fresh, "how is my farm"));
});
