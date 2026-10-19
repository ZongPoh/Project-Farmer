/**
 * The ground runs out, and the wood comes back.
 *
 * Written for the resource rework. The measured fault (scratch/growth.mjs,
 * two seeds, 288 days): a settlement finished with 15,800 wood and 11,850
 * stone, both still climbing in a straight line, because a woodcutter and a
 * quarry camp were taps with nothing behind them. Everything here asserts a
 * system FIRES over a realistic stretch of days rather than that a function
 * returns a shape — the failure this project keeps having is a rule that runs,
 * throws nothing, and does nothing.
 *
 * The numbers these tests pin down are in scratch/ground.mjs, which prints the
 * whole three-year curve for both a woodcutter and a quarry camp.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeFinished } from "./support.mjs";
import { createWorld, allTiles, serialize, deserialize } from "../src/game/world.js";
import { setTerrain, getTerrain } from "../src/game/tiles.js";
import { claimTile } from "../src/game/territory.js";
import { advanceDay } from "../src/game/tick.js";
import { seasonOf } from "../src/game/calendar.js";
import {
  standAt, seamAt, openSeam, noteCleared, timberFactor, rockFactor,
  groundSummary, groundSummaryAll, TIMBER, ROCK, REGROW_AFTER,
} from "../src/game/ground.js";

/** A valley of one terrain, all yours, with a base on a patch of grass. */
function valley(terrain) {
  const w = createWorld(23, { width: 20, height: 14 });
  for (const t of allTiles(w)) { setTerrain(w, t.q, t.r, terrain); claimTile(w, t.q, t.r); }
  setTerrain(w, 0, 0, "grass");
  assert.equal(placeFinished(w, 0, 0, "base").ok, true);
  w.store = { food: 400, wood: 100, stone: 100, herbs: 0, seeds: 0, coins: 0 };
  w.workers = [];
  w.animals = [];
  w.valleySettled = true;
  w.nextRaidDay = 99999;
  w.autoRepair = false;
  return w;
}

const tileAt = (w, q, r) => w.modified.get(`${q},${r}`);

/**
 * Run days, emptying the store as it fills and returning what was produced.
 * The base store caps at 200 wood and 150 stone, so a running total has to be
 * taken out — otherwise this measures the warehouse, not the ground. Buildings
 * are held whole because nobody is here to mend them and a woodcutter rots in
 * about 125 days, which would measure decay instead.
 */
function harvest(w, days, resource, at) {
  let total = 0;
  const b = tileAt(w, at.q, at.r).building;
  for (let d = 0; d < days; d++) {
    b.condition = 100;
    advanceDay(w);
    total += w.store[resource];
    w.store[resource] = 0;
  }
  return total;
}

// --- trees are a crop --------------------------------------------------------

function woodcutterIn(w, wooded) {
  setTerrain(w, 4, 0, "forest");
  const ring = [[5, 0], [3, 0], [4, 1], [4, -1], [5, -1], [3, 1]].slice(0, wooded);
  for (const [q, r] of ring) setTerrain(w, q, r, "forest");
  assert.equal(placeFinished(w, 4, 0, "woodcutter").ok, true);
  return { q: 4, r: 0 };
}

test("a woodcutter thins its stand and then settles at what the stand grows back", () => {
  const w = valley("grass");
  const at = woodcutterIn(w, 6);
  const tile = tileAt(w, 4, 0);

  const firstYear = harvest(w, 96, "wood", at);
  const thirdYear = harvest(w, 192, "wood", at) / 2;

  // It used to be 24 a day whatever happened, forever.
  assert.ok(firstYear / 96 < 24, "the first year should already be below the old flat rate");
  assert.ok(thirdYear / 96 < firstYear / 96, "and the third year below the first");
  assert.ok(thirdYear / 96 > 4, `it must not stop: ${(thirdYear / 96).toFixed(1)}/day in year three`);
  // Settled, not exhausted: there is still a stand there.
  assert.ok(standAt(w, tile) > 0, "the wood is still standing");
  assert.ok(standAt(w, tile) < TIMBER.max(tile), "and it is not untouched either");
});

test("where you put a woodcutter decides what it is worth", () => {
  const deep = valley("grass");
  const deepAt = woodcutterIn(deep, 6);
  const alone = valley("grass");
  const aloneAt = woodcutterIn(alone, 0);

  // Past the first year, when both have drawn down to their own equilibrium.
  harvest(deep, 96, "wood", deepAt);
  harvest(alone, 96, "wood", aloneAt);
  const inWood = harvest(deep, 96, "wood", deepAt);
  const onCopse = harvest(alone, 96, "wood", aloneAt);

  assert.ok(inWood > onCopse * 1.3,
    `a stand with woods round it should be worth more: ${Math.round(inWood)} against ${Math.round(onCopse)}`);
});

test("a stand does not grow in winter, and does in spring", () => {
  const w = valley("grass");
  woodcutterIn(w, 6);
  const tile = tileAt(w, 4, 0);
  // Draw it down first, or the stand is simply full and growth has nowhere to go.
  harvest(w, 60, "wood", { q: 4, r: 0 });

  w.day = 76; // winter
  tile.timber = 100;
  tile.building.condition = 0; // nothing is cutting: this is purely about growth
  advanceDay(w);
  assert.equal(Math.round(standAt(w, tile)), 100, "no growth under snow");

  w.day = 10; // spring
  advanceDay(w);
  assert.ok(standAt(w, tile) > 100, "and it comes on again in spring");
});

// --- rock does not ------------------------------------------------------------

test("a quarry camp works the seam out, says so once, and then yields nothing", () => {
  const w = valley("sand");
  assert.equal(placeFinished(w, 4, 0, "quarryCamp").ok, true);
  const tile = tileAt(w, 4, 0);
  assert.equal(seamAt(w, tile), ROCK.NATURAL);

  let told = 0;
  let mined = 0;
  const b = tile.building;
  w.store.stone = 0; // the fixture's starting stone is not out of this seam
  for (let d = 0; d < 120; d++) {
    b.condition = 100;
    for (const e of advanceDay(w)) if (e.type === "workedOut") told += 1;
    mined += w.store.stone;
    w.store.stone = 0;
  }
  assert.equal(seamAt(w, tile), 0, "the seam should be out");
  assert.ok(Math.abs(mined - ROCK.NATURAL) < 20, `it should give up its seam and no more: ${Math.round(mined)}`);
  assert.equal(told, 1, "and you are told once, not every day");

  const after = harvest(w, 30, "stone", { q: 4, r: 0 });
  assert.equal(Math.round(after), 0, "worked-out rock is worked out");
});

test("breaking down a mountain leaves the richest quarry there is", () => {
  const w = valley("sand");
  const tile = tileAt(w, 4, 0);
  openSeam(w, tile);
  assert.ok(seamAt(w, tile) > ROCK.NATURAL * 2, "a mountain is worth several patches of sand");
  assert.equal(placeFinished(w, 4, 0, "quarryCamp").ok, true);
  const mined = harvest(w, 120, "stone", { q: 4, r: 0 });
  assert.ok(mined > ROCK.NATURAL, `and it pays out accordingly: ${Math.round(mined)}`);
});

test("quarrying a mountain through the job system opens the seam", () => {
  // The whole loop, not the helper: a mountain, the real conversion, the camp.
  const w = valley("grass");
  setTerrain(w, 4, 0, "mountain");
  const tile = tileAt(w, 4, 0);
  // Finish the job the way tick.js does when a worker completes it.
  tile.work = { id: "quarry", to: "sand", done: 1, needed: 1, yields: null, finished: true, seq: 1 };
  w.active?.add?.("4,0");
  advanceDay(w);
  assert.equal(getTerrain(w, 4, 0), "sand", "the mountain came down");
  assert.ok(seamAt(w, tile) > ROCK.NATURAL, "and what is under it is worth digging");
});

// --- what you clear comes back ------------------------------------------------

test("ground you cleared and left alone grows back; clear-cut ground does not", () => {
  const w = valley("grass");
  for (const [q, r] of [[5, 0], [3, 0], [4, 1]]) setTerrain(w, q, r, "forest");
  noteCleared(w, 4, 0);          // beside a wood
  noteCleared(w, 8, 2);          // nothing wooded anywhere near it

  for (let d = 0; d < REGROW_AFTER - 1; d++) advanceDay(w);
  assert.equal(getTerrain(w, 4, 0), "grass", "it takes three seasons, not a fortnight");

  let told = 0;
  for (let d = 0; d < 4; d++) for (const e of advanceDay(w)) if (e.type === "regrown") told += 1;
  assert.equal(getTerrain(w, 4, 0), "forest", "the wood took it back");
  assert.equal(told, 1);
  assert.equal(getTerrain(w, 8, 2), "grass", "with no wood touching it, nothing comes back");
  assert.equal(w.regrowth.length, 0, "and neither is remembered any more");
});

test("ground you built on stays yours", () => {
  const w = valley("grass");
  for (const [q, r] of [[5, 0], [3, 0], [4, 1]]) setTerrain(w, q, r, "forest");
  noteCleared(w, 4, 0);
  assert.equal(placeFinished(w, 4, 0, "farm").ok, true);
  for (let d = 0; d < REGROW_AFTER + 5; d++) advanceDay(w);
  assert.equal(getTerrain(w, 4, 0), "grass", "a farm is not a clearing");
  assert.equal(tileAt(w, 4, 0).building.id, "farm");
});

// --- the panels and the save --------------------------------------------------

test("the panels can say what is left in the ground", () => {
  const w = valley("grass");
  woodcutterIn(w, 6);
  setTerrain(w, 8, 2, "sand");
  assert.equal(placeFinished(w, 8, 2, "quarryCamp").ok, true);
  harvest(w, 30, "wood", { q: 4, r: 0 });

  const stand = groundSummary(w, tileAt(w, 4, 0));
  assert.equal(stand.kind, "stand");
  assert.ok(stand.share < 1 && stand.share > 0);
  assert.equal(stand.perDay, TIMBER.REGROW + 6 * TIMBER.REGROW_NEIGHBOUR);

  const seam = groundSummary(w, tileAt(w, 8, 2));
  assert.equal(seam.kind, "seam");
  assert.ok(seam.left > 0);

  assert.equal(groundSummary(w, tileAt(w, 0, 0)), null, "a base has nothing to say about the ground");

  const all = groundSummaryAll(w);
  assert.equal(all.stands, 1);
  assert.equal(all.seams, 1);
  assert.ok(all.standShare < 1);
});

test("what is left in the ground survives a save and load", () => {
  const w = valley("grass");
  woodcutterIn(w, 6);
  harvest(w, 20, "wood", { q: 4, r: 0 });
  noteCleared(w, 9, 9);
  const timber = standAt(w, tileAt(w, 4, 0));

  const back = deserialize(serialize(w));
  assert.equal(standAt(back, tileAt(back, 4, 0)), timber);
  assert.equal(back.regrowth.length, 1);
  assert.equal(back.regrowth[0].q, 9);
});

test("an old save with no ground in it loads, and the ground is full", () => {
  // Versions 8-11 knew nothing about stands or seams. Nothing should have to
  // be migrated: an untouched wood is a full wood by definition.
  const w = valley("grass");
  woodcutterIn(w, 6);
  const data = serialize(w);
  delete data.regrowth;
  for (const t of data.modified) { delete t.timber; delete t.rock; }
  data.version = 11;
  const back = deserialize(data);
  assert.deepEqual(back.regrowth, []);
  assert.equal(timberFactor(back, tileAt(back, 4, 0)), 1);
  assert.equal(rockFactor(back, tileAt(back, 4, 0)), 1);
});

test("the season a stand is in is a pure function of the day", () => {
  // INVARIANT 2, restated here because stepGround is the newest thing to read
  // the season and the temptation to cache it is real.
  assert.equal(seasonOf(76).id, "winter");
  assert.equal(seasonOf(76 + 96).id, "winter");
});
