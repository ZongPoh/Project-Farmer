/**
 * Goats and hens: the two animals added because the playtest said the ones
 * already here served no purpose.
 *
 * Each has ONE job that nothing else in the game does, and these tests are
 * mostly about those jobs being real:
 *
 *   - a goat pen works on SAND, which nothing else has ever wanted, and gives
 *     milk on days when the farms give nothing at all;
 *   - a coop eats SEEDS, which had one use before this, and lays through the
 *     winter;
 *   - and a fox will have your hens if you do not fence them in — while
 *     gaining nothing from it, because INVARIANT 6 says the predator-prey
 *     balance assumes rabbits are the only food a fox has.
 *
 * Everything here asserts a system FIRES over a stretch of days. The failure
 * this project keeps having is a system that runs, throws nothing, and does
 * nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, allTiles, serialize, deserialize } from "../src/game/world.js";
import { setTerrain } from "../src/game/tiles.js";
import { place } from "../src/game/buildings.js";
import { stepConstruction } from "../src/game/construction.js";
import { neighbors } from "../src/game/hex.js";
import { claimTile } from "../src/game/territory.js";
import { advanceDay } from "../src/game/tick.js";
import { census, SPECIES } from "../src/game/animals.js";
import {
  stepPens, stepCoops, stockPen, stockCoop, penFor, hensOf, coopSummary,
  isEnclosed, PENNED, COOP,
} from "../src/game/pens.js";

/** All yours, a base at 0,0, and nothing that would interfere. */
function valley(terrain = "grass") {
  const w = createWorld(23, { width: 24, height: 16 });
  for (const t of allTiles(w)) { setTerrain(w, t.q, t.r, terrain); claimTile(w, t.q, t.r); }
  setTerrain(w, 0, 0, "grass");
  const base = place(w, 0, 0, "base");
  assert.ok(base.ok, base.reason);
  for (let i = 0; i < 48; i++) stepConstruction(w);
  w.store = { food: 2000, wood: 2000, stone: 2000, herbs: 100, seeds: 100, coins: 300 };
  w.valleySettled = true;
  w.nextRaidDay = 99999;
  w.autoRepair = false;
  w.autoForage = false;
  w.animals = [];
  w.workers = [];
  return w;
}
function build(w, q, r, id) {
  const b = place(w, q, r, id);
  assert.ok(b.ok, `${id} at ${q},${r}: ${b.reason}`);
  for (let i = 0; i < 48; i++) stepConstruction(w);
  return b.building;
}
/** A ring of fences around the given tiles. */
function fenceRound(w, inside) {
  const k = (t) => `${t.q},${t.r}`;
  const ring = new Set();
  for (const t of inside) for (const n of neighbors(t.q, t.r)) if (!inside.some((i) => k(i) === k(n))) ring.add(k(n));
  for (const s of ring) { const [q, r] = s.split(",").map(Number); build(w, q, r, "fence"); }
}
const mend = (w) => { for (const t of allTiles(w)) if (t.building?.id === "fence") t.building.condition = 100; };

// --- goats ------------------------------------------------------------------

test("goats are kept on sand, which nothing else in the game has ever wanted", () => {
  const w = valley("sand");
  const inside = [{ q: 4, r: 0 }, { q: 5, r: 0 }, { q: 4, r: 1 }];
  fenceRound(w, inside);
  assert.equal(penFor(w, 4, 0, "rabbit"), null, "a rabbit will not live on sand");
  const pen = penFor(w, 4, 0, "goat");
  assert.ok(pen, "a goat will");
  assert.equal(pen.capacity, 3 * PENNED.goat.perTile);
  assert.equal(stockPen(w, 4, 0, "goat").ok, true);
  assert.equal(pen.cells.size, 3);
});

test("a goat gives milk every day of the year, winter included", () => {
  const w = valley();
  // Three tiles, so the breeding day inside the winter window below puts a kid
  // in the pen rather than eight food of meat on the table — which would hide
  // the very thing this test is watching.
  fenceRound(w, [{ q: 4, r: 0 }, { q: 5, r: 0 }, { q: 4, r: 1 }]);
  assert.equal(stockPen(w, 4, 0, "goat").ok, true);
  for (const a of w.animals) a.bornOn = -50; // grown

  w.day = 40; // summer
  w.store.food = 0;
  let summer = 0;
  for (let d = 0; d < 20; d++) { w.day++; for (const e of stepPens(w)) if (e.type === "milk") summer += e.food; }
  assert.ok(summer >= 10, `two goats should give about a food a day (got ${summer} in 20)`);

  w.day = 76; // deep winter, when a farm yields nothing whatever
  w.store.food = 500;
  const before = w.store.food;
  let winter = 0;
  for (let d = 0; d < 10; d++) { w.day++; for (const e of stepPens(w)) if (e.type === "milk") winter += e.food; }
  assert.ok(winter > 0, "and they still give it in winter");
  assert.ok(w.store.food < before, "though they have to be fed through it");
});

test("a goat pen fills up over a year and then turns its surplus into meat", () => {
  const w = valley();
  fenceRound(w, [{ q: 4, r: 0 }, { q: 5, r: 0 }, { q: 4, r: 1 }]);
  assert.equal(stockPen(w, 4, 0, "goat").ok, true);
  let meat = 0;
  for (let d = 0; d < 200; d++) {
    w.day++;
    mend(w);
    // Below the 600 the store holds, or the meat has nowhere to go and the
    // event reports the nothing that fitted rather than the surplus.
    w.store.food = 300;
    for (const e of stepPens(w)) if (e.type === "penMeat") meat += e.food;
  }
  const pen = penFor(w, 4, 0, "goat");
  assert.equal(pen.animals.length, pen.capacity, "a year is plenty to fill three tiles");
  assert.ok(meat > 0, "and then the surplus is food");
});

// --- hens -------------------------------------------------------------------

test("a coop turns seeds into food, all year round", () => {
  // Seeds had exactly one use before this — planting a wood — and a ceiling
  // they piled up against. A coop is what spends them.
  const w = valley();
  build(w, 3, 0, "coop");
  assert.equal(stockCoop(w, 3, 0).ok, true);
  assert.equal(hensOf(w, 3, 0).length, 3);

  w.day = 76; // winter: the farms are shut
  w.store.food = 0;
  w.store.seeds = 100;
  const seeds = w.store.seeds;
  let eggs = 0;
  for (let d = 0; d < 20; d++) { w.day++; for (const e of stepCoops(w, () => 1)) if (e.type === "eggs") eggs += e.food; }
  assert.ok(eggs >= 10, `three hens should lay about 2.4 food a day (got ${eggs} in 20)`);
  assert.ok(w.store.seeds < seeds, "and they ate grain for it");
});

test("out of grain a coop falls back on scratch feed, and out of both it loses a hen — announced", () => {
  const w = valley();
  build(w, 3, 0, "coop");
  assert.equal(stockCoop(w, 3, 0).ok, true);

  w.store.seeds = 0;
  w.store.food = 100;
  const food = w.store.food;
  stepCoops(w, () => 1);
  assert.ok(w.store.food < food, "scratch feed costs plain food");
  assert.equal(hensOf(w, 3, 0).length, 3, "and the hens are fine");

  w.store.food = 0;
  const events = [];
  for (let d = 0; d < COOP.patience; d++) { w.day++; events.push(...stepCoops(w, () => 1)); }
  assert.ok(events.some((e) => e.type === "henLost" && e.reason === "hunger"), "a starved coop says so");
  assert.equal(hensOf(w, 3, 0).length, 2);
  assert.equal(w.livestock.lostBy.chicken.hunger, 1, "and it is counted");
});

test("a chick hatches in a fed coop with room", () => {
  const w = valley();
  build(w, 3, 0, "coop");
  assert.equal(stockCoop(w, 3, 0).ok, true);
  let hatched = 0;
  for (let d = 0; d < COOP.chickEvery * 3 + 2; d++) {
    w.day++;
    w.store.seeds = 100;
    for (const e of stepCoops(w, () => 1)) if (e.type === "chick") hatched++;
  }
  assert.ok(hatched > 0, "a coop should fill itself");
  assert.ok(hensOf(w, 3, 0).length <= COOP.roosts, "but never past its roosts");
});

// --- the fox ----------------------------------------------------------------

test("a fox takes a hen from a coop standing in the open — and gains nothing by it", () => {
  // INVARIANT 6. The predator-prey balance is tuned across three simulated
  // years on the assumption that a rabbit is the only thing a fox eats. A hen
  // is a loss to you, not a meal to the fox.
  const w = valley();
  build(w, 3, 0, "coop");
  assert.equal(stockCoop(w, 3, 0).ok, true);
  w.store.seeds = 100;
  const fox = { id: w.nextAnimalId++, species: "fox", q: 4, r: 0, energy: 14, cooldown: 0, bornOn: 1 };
  w.animals.push(fox);
  const energy = fox.energy;
  const cooldown = fox.cooldown;

  assert.equal(isEnclosed(w, 3, 0), false, "the coop is in the open");
  const events = stepCoops(w, () => 0); // the fox is lucky
  assert.ok(events.some((e) => e.type === "henLost" && e.reason === "fox"));
  assert.equal(hensOf(w, 3, 0).length, 2);
  assert.equal(fox.energy, energy, "the fox is no better fed for it");
  assert.equal(fox.cooldown, cooldown, "and no more sated");
  assert.equal(w.livestock.lostBy.chicken.fox, 1);
});

test("a fence around the coop is what stops it", () => {
  const w = valley();
  build(w, 3, 0, "coop");
  fenceRound(w, [{ q: 3, r: 0 }]);
  assert.equal(stockCoop(w, 3, 0).ok, true);
  w.store.seeds = 100;
  w.animals.push({ id: w.nextAnimalId++, species: "fox", q: 5, r: 0, energy: 14, cooldown: 0, bornOn: 1 });

  assert.equal(isEnclosed(w, 3, 0), true);
  for (let d = 0; d < 20; d++) { w.day++; stepCoops(w, () => 0); }
  assert.equal(hensOf(w, 3, 0).length >= 3, true, "nothing got in");
  assert.equal(w.livestock.lostBy?.chicken?.fox, undefined);
});

// --- they are livestock, not wildlife ---------------------------------------

test("no goat and no hen is ever wild", () => {
  // They live in world.animals like everything else, but they are outside the
  // ecology: nothing spawns them, nothing migrates them, and the census that
  // reports on the valley does not have a line for them.
  assert.equal(SPECIES.goat.wild, false);
  assert.equal(SPECIES.chicken.wild, false);
  const w = createWorld(5, { width: 40, height: 28 });
  for (let d = 0; d < 120; d++) advanceDay(w);
  assert.equal(w.animals.filter((a) => a.species === "goat" || a.species === "chicken").length, 0);
  assert.ok(!census(w).some((c) => c.id === "goat" || c.id === "chicken"));
});

test("goats, hens and what they are owed survive a save and load", () => {
  const w = valley();
  fenceRound(w, [{ q: 4, r: 0 }, { q: 5, r: 0 }]);
  build(w, 8, 2, "coop");
  assert.equal(stockPen(w, 4, 0, "goat").ok, true);
  assert.equal(stockCoop(w, 8, 2).ok, true);
  for (const a of w.animals) a.bornOn = -50;
  w.store.seeds = 100;
  for (let d = 0; d < 3; d++) { w.day++; stepPens(w); stepCoops(w, () => 1); }

  const back = deserialize(serialize(w));
  assert.equal(back.animals.filter((a) => a.species === "goat").length, 2);
  assert.equal(hensOf(back, 8, 2).length, 3);
  assert.deepEqual(back.livestock.carry, w.livestock.carry, "the fraction of a food still owed comes back too");
  assert.equal(coopSummary(back, 8, 2).roosts, COOP.roosts);
});
