/**
 * Livestock: kept animals that live, eat, breed, produce and can be traded.
 *
 * Written after the first real playtest, which said: animals serve no
 * purpose, horses keep disappearing, taming makes no sense, and animals spawn
 * very slowly. Every test here asserts that a system FIRES over a realistic
 * stretch of days — the failure mode this project keeps having is a system
 * that runs, throws nothing, and does nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, allTiles, serialize, deserialize } from "../src/game/world.js";
import { setTerrain } from "../src/game/tiles.js";
import { place, demolish, fertilityOf, FERTILITY } from "../src/game/buildings.js";
import { stepConstruction } from "../src/game/construction.js";
import { neighbors, distance } from "../src/game/hex.js";
import { claimTile } from "../src/game/territory.js";
import { advanceDay, advanceHour } from "../src/game/tick.js";
import { makeWorker } from "../src/game/workers.js";
import { mount, stabledHorses, wildHorses, orderCatch } from "../src/game/horses.js";
import { rabbitPen, stockRabbitPen, cullRabbits } from "../src/game/pens.js";
import { livestockTrade, LIVESTOCK_PRICES } from "../src/game/economy.js";
import { populationOf, LOCAL_RADIUS } from "../src/game/animals.js";
import {
  stepLivestock, manuredFarms, HORSE_FEED, HORSE_PATIENCE, FOAL_EVERY,
} from "../src/game/livestock.js";

/** All grass, all yours, a base at 0,0, and nothing that would interfere. */
function valley() {
  const w = createWorld(23, { width: 24, height: 16 });
  for (const t of allTiles(w)) { setTerrain(w, t.q, t.r, "grass"); claimTile(w, t.q, t.r); }
  place(w, 0, 0, "base");
  w.store = { food: 2000, wood: 2000, stone: 2000, herbs: 100, seeds: 20, coins: 300 };
  w.valleySettled = true;
  w.nextRaidDay = 99999;
  w.autoRepair = false;
  w.autoForage = false;
  w.animals = [];
  return w;
}
function build(w, q, r, id) {
  const b = place(w, q, r, id);
  assert.ok(b.ok, b.reason);
  for (let i = 0; i < 48; i++) stepConstruction(w);
  return b.building;
}
function horse(w, q, r, extra = {}) {
  const h = { id: w.nextAnimalId++, species: "horse", q, r, energy: 14, cooldown: 0, bornOn: w.day, tamed: true, ...extra };
  w.animals.push(h);
  return h;
}
const days = (w, n) => { for (let i = 0; i < n; i++) advanceDay(w); };

// --- horses do not vanish ----------------------------------------------------

test("a horse kept in a paddock is alive a whole year later", () => {
  // The bug: 27 of 27 lost horses in a 400-day measurement had STARVED,
  // because kept horses were fed by the wild ecology and a breeding cooldown
  // stopped them eating for twenty days.
  const w = valley();
  build(w, 3, 0, "paddock");
  const h = horse(w, 3, 0, { cooldown: 20 });
  days(w, 96);
  assert.ok(w.animals.includes(h), "the horse should still exist");
  assert.equal(h.tamed, true, "and still be yours");
  assert.deepEqual(w.livestock.lost, {}, "nothing should have left");
});

test("a ridden horse eats from the store, and one that is never fed runs off — announced and counted", () => {
  const w = valley();
  build(w, 3, 0, "paddock");
  const worker = makeWorker(w, 0, 0);
  horse(w, 3, 0);
  assert.equal(mount(w, worker).ok, true);

  const before = w.store.food;
  stepLivestock(w);
  assert.equal(before - w.store.food, HORSE_FEED, "a ridden horse cannot graze");

  w.store.food = 0;
  const events = [];
  for (let d = 0; d < HORSE_PATIENCE; d++) events.push(...stepLivestock(w));
  assert.ok(events.some((e) => e.type === "horseLost" && e.reason === "hunger"));
  assert.equal(worker.horseId, null, "the rider is on foot again");
  assert.equal(w.livestock.lost.hunger, 1);
});

test("two horses in the paddocks have a foal", () => {
  const w = valley();
  build(w, 3, 0, "paddock");
  horse(w, 3, 0);
  horse(w, 3, 0);
  let foaled = false;
  for (let d = 0; d < FOAL_EVERY + 5; d++) for (const e of stepLivestock(w)) if (e.type === "foal") foaled = true;
  assert.equal(foaled, true);
  assert.equal(stabledHorses(w).length, 3);
});

test("a horse put away in a field walks back to the paddock", () => {
  const w = valley();
  build(w, 3, 0, "paddock");
  const h = horse(w, 8, 2);
  stepLivestock(w);
  assert.deepEqual({ q: h.q, r: h.r }, { q: 3, r: 0 });
});

test("you cannot catch the last few wild horses on the board", () => {
  const w = valley();
  build(w, 3, 0, "paddock");
  for (let i = 0; i < 2; i++) w.animals.push({ id: w.nextAnimalId++, species: "horse", q: 9, r: 0, energy: 14, tamed: false });
  const res = orderCatch(w);
  assert.equal(res.ok, false);
  assert.match(res.reason, /breed back/);
});

// --- rabbits earn their keep ---------------------------------------------------

function fencedPen(w) {
  // A three-tile enclosure of fences around (4,0), (5,0) and (4,1).
  const inside = [{ q: 4, r: 0 }, { q: 5, r: 0 }, { q: 4, r: 1 }];
  const k = (t) => `${t.q},${t.r}`;
  const ring = new Set();
  for (const t of inside) for (const n of neighbors(t.q, t.r)) if (!inside.some((i) => k(i) === k(n))) ring.add(k(n));
  for (const s of ring) { const [q, r] = s.split(",").map(Number); build(w, q, r, "fence"); }
}

test("a rabbit pen breeds, fills, and then feeds you, over a simulated year", () => {
  const w = valley();
  fencedPen(w);
  assert.equal(rabbitPen(w, 4, 0).capacity, 12);
  assert.equal(stockRabbitPen(w, 4, 0).ok, true);
  w.store.food = 300; // below the 600 cap, or the meat has nowhere to go

  let meat = 0;
  let born = 0;
  for (let h = 0; h < 96 * 24; h++) {
    // Nobody is here to mend fences, and a rotten fence opens the pen — which
    // is tested in fortifications.test.mjs. This test is about the rabbits.
    if (h % 24 === 0) for (const t of allTiles(w)) if (t.building?.id === "fence") t.building.condition = 100;
    for (const e of advanceHour(w)) {
      if (e.type === "penMeat") meat += e.food;
      if (e.type === "rabbitBred") born += 1;
    }
  }
  const pen = rabbitPen(w, 4, 0);
  assert.ok(born > 0, "it should breed");
  assert.equal(pen.rabbits.length, pen.capacity, "a year is plenty to fill a three-tile pen");
  assert.ok(meat >= 20, `a full pen should turn its surplus into food (got ${meat})`);
  assert.equal(cullRabbits(w, 4, 0, 2).ok, true, "and you can take some for the pot");
});

// --- manure and fertility ---------------------------------------------------

test("farms tire without manure and hold up with it", () => {
  const w = valley();
  build(w, 3, 0, "paddock");
  horse(w, 3, 0);
  const near = build(w, 4, 0, "farm");
  const spot = [...allTiles(w)].find((t) => distance(t, { q: 3, r: 0 }) >= 8 && !t.building);
  const far = build(w, spot.q, spot.r, "farm");
  near.fertility = 1;
  far.fertility = 1;
  w.day = 30; // summer, growing
  days(w, 40);
  assert.ok(manuredFarms(w).has("4,0"), "a farm beside the paddock is manured");
  assert.ok(!manuredFarms(w).has(`${spot.q},${spot.r}`), "a farm across the valley is not");
  assert.ok(fertilityOf(far) < 1, "unmanured ground tires in a growing season");
  assert.ok(fertilityOf(near) > fertilityOf(far), "manure keeps it up");
  assert.ok(fertilityOf(far) >= FERTILITY.FLOOR, "and nothing ever drops below the floor");
});

test("a manured farm out-yields an unmanured one", () => {
  const measure = (withHorse) => {
    const w = valley();
    build(w, 3, 0, "paddock");
    if (withHorse) horse(w, 3, 0);
    build(w, 4, 0, "farm");
    w.day = 30;
    w.store.food = 0;
    w.workers = [];
    days(w, 5);
    return w.store.food;
  };
  const plain = measure(false);
  const manured = measure(true);
  assert.ok(manured > plain * 1.15, `manure should lift yield: ${plain} -> ${manured}`);
});

// --- trade --------------------------------------------------------------------

test("the market buys and sells horses, with no profitable loop", () => {
  const w = valley();
  build(w, 3, 0, "paddock");
  build(w, 5, 2, "market");
  const coins = w.store.coins;
  assert.equal(livestockTrade(w, "horse", "buy").ok, true);
  assert.equal(stabledHorses(w).length, 1);
  assert.equal(livestockTrade(w, "horse", "sell").ok, true);
  assert.equal(stabledHorses(w).length, 0);
  assert.equal(w.store.coins, coins - LIVESTOCK_PRICES.horse.buy + LIVESTOCK_PRICES.horse.sell);
  assert.ok(w.store.coins < coins, "buying and selling back must lose money");
});

test("livestock state survives a save and load", () => {
  const w = valley();
  build(w, 3, 0, "paddock");
  horse(w, 3, 0);
  horse(w, 3, 0);
  for (let d = 0; d < 5; d++) stepLivestock(w);
  w.livestock.lost.stolen = 2;
  const back = deserialize(serialize(w));
  assert.equal(back.livestock.foalIn, w.livestock.foalIn);
  assert.equal(back.livestock.lost.stolen, 2);
  assert.equal(stabledHorses(back).length, 2);
});

// --- the wild ---------------------------------------------------------------

test("wild horses breed and stay on the board for three years", () => {
  // Before the grazing fix a mare starved every time she foaled; measured wild
  // horse counts were 0-4 against a capacity of ~26 on this board size.
  const w = createWorld(7, { width: 34, height: 24 });
  let min = Infinity;
  for (let d = 1; d <= 288; d++) {
    advanceDay(w);
    if (d > 60) min = Math.min(min, wildHorses(w).length);
  }
  assert.ok(min >= 4, `the wild herd fell to ${min}`);
});

test("on a big board, wildlife turns up near home rather than only at the rim", () => {
  // Measured before migration: 0 rabbits and 0 horses within 12 tiles of home
  // on every sample across three years of a 120x80 board.
  const w = createWorld(1, { width: 120, height: 80 });
  let rabbitsNear = 0;
  let horsesNear = 0;
  for (let d = 1; d <= 60; d++) {
    advanceDay(w);
    rabbitsNear = Math.max(rabbitsNear, w.animals.filter((a) => a.species === "rabbit" && distance(a, w.home) <= LOCAL_RADIUS).length);
    horsesNear = Math.max(horsesNear, w.animals.filter((a) => a.species === "horse" && distance(a, w.home) <= LOCAL_RADIUS).length);
  }
  assert.ok(rabbitsNear >= 4, `rabbits near home: ${rabbitsNear}`);
  assert.ok(horsesNear >= 2, `horses near home: ${horsesNear}`);
  assert.ok(populationOf(w, "rabbit") > 0);
});
