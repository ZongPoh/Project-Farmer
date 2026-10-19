/**
 * What a stand and a seam actually do, over three simulated years.
 *
 * The evidence behind ground.js. Run: node scratch/ground.mjs
 */
import { placeFinished } from "../test/support.mjs";
import { createWorld, allTiles } from "../src/game/world.js";
import { setTerrain } from "../src/game/tiles.js";
import { claimTile } from "../src/game/territory.js";
import { advanceDay } from "../src/game/tick.js";
import { seasonOf } from "../src/game/calendar.js";
import { openSeam, standAt, seamAt, TIMBER, ROCK } from "../src/game/ground.js";

function valley(terrain) {
  const w = createWorld(23, { width: 20, height: 14 });
  for (const t of allTiles(w)) { setTerrain(w, t.q, t.r, terrain); claimTile(w, t.q, t.r); }
  setTerrain(w, 0, 0, "grass"); // a base needs grass whatever the valley is
  const based = placeFinished(w, 0, 0, "base");
  if (!based) throw new Error("no base");
  w.store = { food: 400, wood: 100, stone: 100, herbs: 0, seeds: 0, coins: 0 };
  w.workers = [];
  w.animals = [];
  w.valleySettled = true;
  w.nextRaidDay = 99999;
  w.autoRepair = false;
  return w;
}

// --- one woodcutter, deep in a wood and alone on a copse --------------------
for (const [label, neighbours] of [["in a wood", 6], ["on a copse", 0]]) {
  const w = valley("grass");
  setTerrain(w, 4, 0, "forest");
  // Give it as many wooded neighbours as the case asks for.
  const ring = [[5,0],[3,0],[4,1],[4,-1],[5,-1],[3,1]].slice(0, neighbours);
  for (const [q, r] of ring) setTerrain(w, q, r, "forest");
  placeFinished(w, 4, 0, "woodcutter");
  const tile = w.modified.get("4,0");
  const rows = [];
  // The store caps at 200 wood, so it is emptied every day and counted here.
  let total = 0;
  let season24 = 0;
  for (let d = 1; d <= 288; d++) {
    tile.building.condition = 100; // measuring the ground, not the roof
    advanceDay(w);
    total += w.store.wood;
    season24 += w.store.wood;
    w.store.wood = 0;
    if (d % 24 === 0) {
      rows.push(`d${String(d).padStart(3)} ${seasonOf(d).id.padEnd(6)} ${String(Math.round(season24)).padStart(4)}/24d  stand ${Math.round(standAt(w, tile))}/${TIMBER.max(tile)}`);
      season24 = 0;
    }
  }
  w.store.wood = total;
  console.log(`\nwoodcutter ${label} (${neighbours} wooded neighbours)`);
  console.log("  " + rows.join("\n  "));
  console.log(`  total ${Math.round(w.store.wood)} wood in 288 days = ${(w.store.wood / 288).toFixed(1)}/day (was 24/day, flat, forever)`);
}

// --- one quarry camp, on plain sand and on a broken-down mountain ----------
for (const label of ["plain sand", "a broken mountain"]) {
  const w = valley("sand");
  const tile = w.modified.get("4,0");
  if (label !== "plain sand") openSeam(w, tile);
  if (!placeFinished(w, 4, 0, "quarryCamp")) throw new Error("no quarry camp");
  let out = null;
  let total = 0;
  for (let d = 1; d <= 288; d++) {
    tile.building.condition = 100;
    advanceDay(w);
    total += w.store.stone;
    w.store.stone = 0;
    if (out === null && seamAt(w, tile) <= 0) out = d;
  }
  w.store.stone = total;
  console.log(`\nquarry camp on ${label}: ${Math.round(w.store.stone)} stone total, worked out on day ${out ?? "never"} (seam ${label === "plain sand" ? ROCK.NATURAL : ROCK.fromMountain(tile)})`);
}

// --- cleared ground coming back --------------------------------------------
{
  const w = valley("grass");
  for (const [q, r] of [[4,0],[5,0],[3,0],[4,1]]) setTerrain(w, q, r, "forest");
  // Clear 4,0 by hand, the way a finished job does.
  const { noteCleared } = await import("../src/game/ground.js");
  setTerrain(w, 4, 0, "grass");
  noteCleared(w, 4, 0);
  let back = null;
  for (let d = 1; d <= 200 && back === null; d++) {
    advanceDay(w);
    if (w.modified.get("4,0").terrain === "forest") back = d;
  }
  console.log(`\ncleared ground beside a wood came back on day ${back ?? "never"}`);

  const lone = valley("grass");
  setTerrain(lone, 4, 0, "grass");
  noteCleared(lone, 4, 0);
  let back2 = null;
  for (let d = 1; d <= 200 && back2 === null; d++) {
    advanceDay(lone);
    if (lone.modified.get("4,0").terrain === "forest") back2 = d;
  }
  console.log(`clear-cut ground with no wood touching it came back on day ${back2 ?? "never"}`);
}
