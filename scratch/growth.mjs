import { placeFinished } from "../test/support.mjs";
import { place } from "../src/game/buildings.js";
import { upgradeBase } from "../src/game/base.js";
import { createWorld, allTiles } from "../src/game/world.js";
import { canPlace } from "../src/game/buildings.js";
import { advanceDay, startClaim, canClaim, startWork } from "../src/game/tick.js";
import { makeWorker, hire } from "../src/game/workers.js";
import { canUpgradeBase } from "../src/game/base.js";
import { frontierTiles, inTerritory } from "../src/game/territory.js";
import { coursesStanding } from "../src/game/monument.js";
for (const seed of [3, 11]) {
  const world = createWorld(seed, { width: 60, height: 40 });
  placeFinished(world, world.home.q, world.home.r, "base");
  while (world.workers.length < 3) makeWorker(world, world.home.q, world.home.r);
  const rows = [];
  for (let d = 1; d <= 288; d++) {
    advanceDay(world);
    const inside = [...allTiles(world)].filter(t => inTerritory(world, t.q, t.r) && !t.building && !t.work);
    const want = world.store.food < world.workers.length * 40 ? "farm" : (world.store.stone > 400 && canPlace(world, world.home.q + 2, world.home.r, "monument").ok ? "monument" : ["woodcutter", "quarryCamp", "granary", "house", "farm", "warehouse", "wall"][d % 7]);
    const spot = inside.find(t => canPlace(world, t.q, t.r, want).ok);
    if (spot) place(world, spot.q, spot.r, want);
    if (d % 2 === 0) { const e = frontierTiles(world).find(t => canClaim(world, t.q, t.r).ok); if (e) startClaim(world, e.q, e.r); }
    if (d % 5 === 0) { const f = inside.find(t => t.terrain === "forest"); if (f) startWork(world, f.q, f.r, "clear"); }
    if (canUpgradeBase(world).ok) upgradeBase(world);
    if (d % 6 === 0) hire(world);
    if (d % 48 === 0) rows.push(`d${d} L${world.baseLevel} ppl${world.workers.length} land${world.owned.size} f${Math.round(world.store.food)} w${Math.round(world.store.wood)} s${Math.round(world.store.stone)} herbs${Math.round(world.store.herbs)} seeds${Math.round(world.store.seeds)} mon${coursesStanding(world)}`);
  }
  console.log("seed", seed, "\n  " + rows.join("\n  "));
}
