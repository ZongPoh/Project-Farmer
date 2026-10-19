/**
 * WHEN does a greedy settlement reach each base level, and what is it made of
 * when it gets there?
 *
 * growth.mjs samples every 48 days, which is too coarse to say anything about
 * a target of "Town nearer day 200". This records the exact day of every
 * upgrade, and what the settlement looked like on that day, so a change to the
 * ladder can be judged against people and buildings rather than only stores.
 *
 * Same bot as growth.mjs, deliberately: it builds and hires as fast as it can
 * and never stops, so it is an upper bound on greed rather than a player.
 */
import { placeFinished } from "../test/support.mjs";
import { place, canPlace } from "../src/game/buildings.js";
import { upgradeBase, canUpgradeBase, BASE_LEVELS } from "../src/game/base.js";
import { createWorld, allTiles } from "../src/game/world.js";
import { advanceDay, startClaim, canClaim, startWork } from "../src/game/tick.js";
import { makeWorker, hire } from "../src/game/workers.js";
import { frontierTiles, inTerritory } from "../src/game/territory.js";

const DAYS = Number(process.argv[2] || 288);
const SEEDS = [3, 11, 19];

for (const seed of SEEDS) {
  const world = createWorld(seed, { width: 60, height: 40 });
  placeFinished(world, world.home.q, world.home.r, "base");
  while (world.workers.length < 3) makeWorker(world, world.home.q, world.home.r);
  const reached = [];
  let level = world.baseLevel;

  for (let d = 1; d <= DAYS; d++) {
    advanceDay(world);
    const inside = [...allTiles(world)].filter((t) => inTerritory(world, t.q, t.r) && !t.building && !t.work);
    const want = world.store.food < world.workers.length * 40
      ? "farm"
      : (world.store.stone > 400 && canPlace(world, world.home.q + 2, world.home.r, "monument").ok
        ? "monument"
        : ["woodcutter", "quarryCamp", "granary", "house", "farm", "warehouse", "wall"][d % 7]);
    const spot = inside.find((t) => canPlace(world, t.q, t.r, want).ok);
    if (spot) place(world, spot.q, spot.r, want);
    if (d % 2 === 0) { const e = frontierTiles(world).find((t) => canClaim(world, t.q, t.r).ok); if (e) startClaim(world, e.q, e.r); }
    if (d % 5 === 0) { const f = inside.find((t) => t.terrain === "forest"); if (f) startWork(world, f.q, f.r, "clear"); }
    if (canUpgradeBase(world).ok) upgradeBase(world);
    if (d % 6 === 0) hire(world);

    if (world.baseLevel > level) {
      level = world.baseLevel;
      const built = [...allTiles(world)].filter((t) => t.building && t.building.condition > 0).length;
      reached.push(`${BASE_LEVELS[level - 1].label} day ${d}: ${world.workers.length} people, ${built} buildings, `
        + `w${Math.round(world.store.wood)} s${Math.round(world.store.stone)} f${Math.round(world.store.food)}`);
    }
  }
  if (level < BASE_LEVELS.length) reached.push(`never got past ${BASE_LEVELS[level - 1].label} in ${DAYS} days`);
  console.log("seed", seed, "\n  " + reached.join("\n  "));
}
