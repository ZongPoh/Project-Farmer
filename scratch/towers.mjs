/** How often does a watchtower actually see a raid coming, and is raidFoiled reachable? */
import { createWorld, allTiles } from "../src/game/world.js";
import { placeFinished as place, own } from "../test/support.mjs";
import { makeWorker } from "../src/game/workers.js";
import { settleTheValley } from "../src/game/rivalcamp.js";
import { advanceHour } from "../src/game/tick.js";
import { protectedStores } from "../src/game/buildings.js";

const run = (label, setup) => {
  const world = createWorld(11);
  const grass = [...allTiles(world)].filter((t) => t.terrain === "grass");
  place(world, grass[0].q, grass[0].r, "base");
  own(world, grass.slice(0, 24));
  world.store.wood = 9000; world.store.stone = 9000; world.store.food = 9000;
  if (world.workers.length === 0) makeWorker(world, grass[0].q, grass[0].r);
  settleTheValley(world);
  setup(world, grass);
  world.store.food = 300; world.store.wood = 300; world.store.stone = 200;
  const seen = {};
  for (let h = 0; h < 400 * 24; h++) {
    for (const e of advanceHour(world)) seen[e.type] = (seen[e.type] || 0) + 1;
    if (h % 24 === 0) { world.store.food = 300; world.store.wood = 300; world.store.stone = 200; }
  }
  const cover = protectedStores(world);
  console.log(label, "| raids:", seen.raidArrived || 0, "spotted:", seen.raidSpotted || 0,
    "| stolen:", seen.stolen || 0, "foiled:", seen.raidFoiled || 0,
    "| cover food", Math.round(cover.food || 0), "wood", Math.round(cover.wood || 0), "stone", Math.round(cover.stone || 0));
};

run("no tower          ", () => {});
run("one tower at base ", (w, g) => place(w, g[2].q, g[2].r, "watchtower"));
run("tower + 3 granary ", (w, g) => { place(w, g[2].q, g[2].r, "watchtower"); for (const t of g.slice(4, 7)) place(w, t.q, t.r, "granary"); });
