import { placeFinished as place } from "../test/support.mjs";
import { createWorld, allTiles } from "../src/game/world.js";
import { canPlace } from "../src/game/buildings.js";
import { advanceHour, startClaim, canClaim } from "../src/game/tick.js";
import { makeWorker } from "../src/game/workers.js";
import { orderCatch, mount, stabledHorses } from "../src/game/horses.js";
import { frontierTiles, inTerritory } from "../src/game/territory.js";
import { getTerrain } from "../src/game/tiles.js";

for (const seed of [3, 11, 23]) {
  const world = createWorld(seed, { width: 34, height: 24 });
  place(world, world.home.q, world.home.r, "base");
  Object.assign(world.store, { wood: 600, stone: 600, food: 1500, seeds: 8 });
  while (world.workers.length < 5) makeWorker(world, world.home.q, world.home.r);
  const reasons = {}; let prev = new Map();
  let wildMin = 99, wildMax = 0; const wildSeries = [];
  for (let day = 1; day <= 400; day++) {
    for (let h = 0; h < 24; h++) {
      const ev = advanceHour(world);
      const now = new Map(world.animals.filter(a => a.species === "horse").map(a => [a.id, a]));
      for (const [id, old] of prev) {
        const cur = now.get(id);
        if (old.tamed && (!cur || !cur.tamed)) {
          const why = !cur ? "removed:" + (ev.filter(e => /starve|stole|horse|escape/i.test(e.type)).map(e => e.type).join("+") || "silent")
            + ` energy=${old.energy} terrain=${getTerrain(world, old.q, old.r)} rider=${old.riderId||0}` : "untamed:" + ev.map(e => e.type).filter(t=>/horse|leave|died|death/i.test(t)).join("+");
          reasons[why.split(" ")[0]] = (reasons[why.split(" ")[0]] || 0) + 1;
          if (Object.values(reasons).reduce((a,b)=>a+b) < 6) console.log(seed, "day", world.day, why);
        }
      }
      prev = new Map([...now].map(([k, a]) => [k, { ...a }]));
    }
    const wild = world.animals.filter(a => a.species === "horse" && !a.tamed).length;
    if (day % 40 === 0) wildSeries.push(wild);
    if (day === 3) { const inside = [...allTiles(world)].filter(t => inTerritory(world, t.q, t.r) && !t.building); const s = inside.find(t => canPlace(world, t.q, t.r, "paddock").ok); if (s) place(world, s.q, s.r, "paddock"); }
    if (day % 4 === 0) { const e = frontierTiles(world).find(t => canClaim(world, t.q, t.r).ok); if (e) startClaim(world, e.q, e.r); }
    if (day % 20 === 0) orderCatch(world);
    for (const w of world.workers) if (!w.horseId && stabledHorses(world).length) mount(world, w);
    world.store.food = Math.max(world.store.food, 300);
  }
  console.log("seed", seed, reasons, "logged:", JSON.stringify(world.livestock?.lost), "food", world.store.food, "wild horses every 40d:", wildSeries.join(","), "tamed now", world.animals.filter(a=>a.species==="horse"&&a.tamed).length);
}
