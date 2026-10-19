import { placeFinished as place } from "../test/support.mjs";
import { createWorld } from "../src/game/world.js";
import { advanceDay } from "../src/game/tick.js";
import { makeWorker } from "../src/game/workers.js";
import { allCamps } from "../src/game/rivalcamp.js";
import { campResidents, campBeds } from "../src/game/campAI.js";
const size = process.argv[2] === "big" ? { width: 120, height: 80 } : { width: 60, height: 40 };
for (const seed of [3, 11]) {
  const world = createWorld(seed, size);
  place(world, world.home.q, world.home.r, "base");
  while (world.workers.length < 4) makeWorker(world, world.home.q, world.home.r);
  const hist = {};
  const acts = {};
  for (let d = 1; d <= 288; d++) {
    advanceDay(world);
    world.store.food = Math.max(world.store.food, 200);
    if (process.argv[3] === 'grow' && d % 12 === 0 && world.workers.length < 24) makeWorker(world, world.home.q, world.home.r);
    for (const c of allCamps(world)) { const a = c.ai?.action; acts[c.id] = acts[c.id] || {}; acts[c.id][a] = (acts[c.id][a]||0)+1; }
    if (d % 32 === 0) for (const c of allCamps(world)) {
      (hist[c.id] = hist[c.id] || []).push(`${c.buildings.filter(b=>b.condition>0).length}b/${campResidents(world,c)}p/${campBeds(c)}bed L${c.level||1} f${Math.round(c.store.food)} w${Math.round(c.store.wood)} s${Math.round(c.store.stone)}`);
    }
  }
  console.log("seed", seed);
  for (const c of allCamps(world)) { console.log(" camp", c.id, c.kind, c.strategy, "\n   ", hist[c.id].join("\n    ")); console.log("   acts", JSON.stringify(acts[c.id]), "last:", c.ai?.reason); }
}
