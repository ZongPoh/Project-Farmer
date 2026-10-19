/**
 * The brakes on the player's snowball.
 *
 * First playtest: "the player grows very fast." Nothing had a cost that rose
 * with size — land was free, stone and food piled up with nowhere to go, and
 * a big settlement with enough granaries was never raided again. This pass
 * adds four brakes, each small and each with a way round it:
 *
 *   - land costs food once you hold a lot of it (but never refuses: invariant 11)
 *   - stone buildings cost stone a day to keep up
 *   - farmland tires over a growing season (manure and winter restore it)
 *   - a big settlement is a target even with everything under cover (camp-growth.test)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeFinished as place } from "./support.mjs";
import { createWorld, allTiles } from "../src/game/world.js";
import { setTerrain } from "../src/game/tiles.js";
import { claimTile } from "../src/game/territory.js";
import { workerCapacity } from "../src/game/workers.js";
import { dailyWear, masonryUpkeep, UPKEEP } from "../src/game/buildings.js";
import { residentFood, dailyFoodFor, RESIDENT_FOOD, UPKEEP_FREE_PEOPLE } from "../src/game/economy.js";
import {
  claimCost, startClaim, advanceDay, CLAIM_HOURS, CLAIM_FREE_UP_TO, CLAIM_SLOW_FACTOR, CLAIM_FOOD_MAX,
} from "../src/game/tick.js";

function valley() {
  const w = createWorld(23, { width: 24, height: 16 });
  for (const t of allTiles(w)) setTerrain(w, t.q, t.r, "grass");
  place(w, 0, 0, "base");
  w.store = { food: 1000, wood: 1000, stone: 1000, herbs: 0, seeds: 0 };
  w.valleySettled = true;
  w.nextRaidDay = 99999;
  return w;
}

test("land is free while small and costs food once you hold a lot of it", () => {
  const w = valley();
  assert.equal(claimCost(w).food, 0, "a new settlement claims for free");
  const tiles = [...allTiles(w)];
  for (const t of tiles.slice(0, CLAIM_FREE_UP_TO + 30)) w.owned.add(`${t.q},${t.r}`);
  const big = claimCost(w);
  assert.ok(big.food > 0, "a big holding pays for more");
  assert.ok(big.food <= CLAIM_FOOD_MAX);
  for (const t of tiles.slice(0, 300)) w.owned.add(`${t.q},${t.r}`);
  assert.equal(claimCost(w).food, CLAIM_FOOD_MAX, "and it levels off");
});

test("a player who cannot pay still claims — the slow way — so the game can never stall", () => {
  // INVARIANT 11. The cost buys speed, never permission.
  const w = valley();
  const tiles = [...allTiles(w)];
  for (const t of tiles.slice(0, 80)) { w.owned.add(`${t.q},${t.r}`); claimTile(w, t.q, t.r); }
  w.store.food = 0;
  const cost = claimCost(w);
  assert.equal(cost.slow, true);
  assert.equal(cost.food, 0);
  assert.equal(cost.hours, CLAIM_HOURS * CLAIM_SLOW_FACTOR);

  const edge = tiles.find((t) => !w.owned.has(`${t.q},${t.r}`) && w.claims.has(`${t.q},${t.r}`));
  assert.ok(edge, "fixture should leave a frontier tile");
  const res = startClaim(w, edge.q, edge.r);
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.slow, true);
  assert.equal(w.store.food, 0, "and nothing was taken that was not there");
});

test("stone buildings cost stone every day, and wear when it is not there", () => {
  const w = valley();
  for (const t of [...allTiles(w)].slice(2, 12)) claimTile(w, t.q, t.r);
  const spots = [...allTiles(w)].filter((t) => !t.building).slice(2, 12);
  for (const t of spots.slice(0, 5)) place(w, t.q, t.r, "wall");
  const due = masonryUpkeep(w);
  assert.ok(Math.abs(due - 5 * UPKEEP.wall) < 1e-9);

  const before = w.store.stone;
  for (let d = 0; d < 20; d++) dailyWear(w);
  assert.ok(before - w.store.stone >= Math.floor(due * 20) - 1, "stone should be drawn down daily");

  w.store.stone = 0;
  // A wall, because walls never decay on their own: any wear here is upkeep.
  const wall = spots.map((t) => [...allTiles(w)].find((x) => x.q === t.q && x.r === t.r)?.building).find(Boolean);
  const cond = wall.condition;
  assert.equal(cond, 100, "paid upkeep kept the wall whole");
  let told = 0;
  for (let d = 0; d < 5; d++) told += dailyWear(w).filter((e) => e.type === "upkeepShort").length;
  assert.ok(wall.condition < cond, "unpaid upkeep wears the building");
  assert.equal(told, 1, "and you are told once, not every day");
  assert.ok(wall.condition >= 1, "upkeep alone never razes anything");
});

test("a settlement cannot outgrow the base it has built, however many houses it puts up", () => {
  // MEASURED before this: the greedy bot stood 55 people in a Village and 73
  // by year three, because each house added four beds and nothing capped how
  // many houses you built. The tier is the ceiling now, and this plays a
  // hundred days with the houses and the food both deliberately excessive.
  const w = valley();
  for (const t of allTiles(w)) claimTile(w, t.q, t.r);
  const spots = [...allTiles(w)].filter((t) => !t.building);
  for (const t of spots.slice(0, 10)) place(w, t.q, t.r, "farm");
  for (const t of spots.slice(10, 22)) place(w, t.q, t.r, "house");
  for (let d = 0; d < 100; d++) {
    advanceDay(w);
    w.store.food = Math.max(w.store.food, 5000);
  }
  const { byBase, beds, tier, limitedBy } = workerCapacity(w);
  assert.ok(beds > tier, "the fixture should have more beds than the tier holds");
  assert.equal(byBase, tier, "and the tier is what counts");
  assert.equal(limitedBy, "base", "so the answer is a bigger base, not another house");
  assert.ok(w.workers.length <= tier, `${w.workers.length} people in a base that holds ${tier}`);
});

test("food per head is flat for a small settlement and rises with a large one", () => {
  // Nothing changes at twelve or fewer, so every small-settlement balance in
  // the other test files is untouched.
  assert.equal(residentFood(1), RESIDENT_FOOD);
  assert.equal(residentFood(UPKEEP_FREE_PEOPLE), RESIDENT_FOOD);
  assert.ok(residentFood(22) > RESIDENT_FOOD * 1.3);
  assert.ok(residentFood(40) > residentFood(22));
  // Which makes population a soft ceiling on the land you farm: doubling the
  // food does NOT double the people it supports once you are large.
  const feeds = (food) => { let n = 1; while (dailyFoodFor(n + 1) <= food) n++; return n; };
  assert.ok(feeds(600) < 2 * feeds(300), `${feeds(300)} people on 300 food, ${feeds(600)} on 600`);
});
