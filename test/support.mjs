/**
 * Shared fixtures for tests that are not about territory.
 *
 * Since territory landed, a tile has to be inside your border before anything
 * can be built or worked on it. That is correct, and it is also the single
 * most annoying thing to have introduced into a test suite: a test about
 * whether two workers halve a job's duration should not first have to play
 * fifteen turns of land expansion to get somewhere to put the job.
 *
 * So these helpers let a test state the premise directly — "the player has
 * settled this ground" — and then get on with what it is actually testing.
 * Using them is not cheating: they do exactly what finishing a job does, which
 * is the same thing a real settlement would have done to reach that tile.
 *
 * Tests that ARE about territory must not use these. They live in
 * `territory.test.mjs` and build their land the long way, on purpose.
 */
import { claimTile } from "../src/game/territory.js";
import { place as startBuilding } from "../src/game/buildings.js";
import { upgradeBase as startUpgrade } from "../src/game/base.js";
import { foundCamp as startCamp } from "../src/game/rivalcamp.js";

// Existing rule tests describe established buildings, not construction timing.
// Actual elapsed-time behaviour is covered separately in construction.test.mjs.
export function placeFinished(world, q, r, id) {
  const result = startBuilding(world, q, r, id);
  if (result.ok) result.building.construction = null;
  return result;
}
export function upgradeFinished(world) {
  const result = startUpgrade(world);
  if (result.ok) {
    world.baseLevel = result.level;
    for (const t of world.modified.values()) if (t.building?.id === "base") t.building.construction = null;
  }
  return result;
}
export function foundFinishedCamp(world, kind = "raider", at = null) {
  const camp = startCamp(world, kind, at);
  if (camp) for (const b of camp.buildings) b.construction = null;
  return camp;
}

/**
 * Make these specific tiles the player's.
 *
 * Prefer this over `settle` when a test uses a handful of known tiles: it says
 * precisely which ground the premise covers, so a test cannot quietly start
 * relying on land it never claimed.
 */
export function own(world, ...tiles) {
  for (const tile of tiles.flat()) {
    if (tile) claimTile(world, tile.q, tile.r);
  }
  return world;
}

/**
 * An established settlement: everything within `radius` of a point is yours.
 *
 * For tests that need room to manoeuvre rather than particular tiles.
 */
export function settle(world, q, r, radius = 6) {
  const seen = new Set();
  let frontier = [{ q, r }];
  claimTile(world, q, r);
  for (let step = 0; step < radius; step++) {
    const next = [];
    for (const at of frontier) {
      for (const n of [
        { q: at.q + 1, r: at.r }, { q: at.q - 1, r: at.r },
        { q: at.q, r: at.r + 1 }, { q: at.q, r: at.r - 1 },
        { q: at.q + 1, r: at.r - 1 }, { q: at.q - 1, r: at.r + 1 },
      ]) {
        const k = `${n.q},${n.r}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (claimTile(world, n.q, n.r)) next.push(n);
      }
    }
    frontier = next;
  }
  return world;
}
