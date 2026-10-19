/**
 * What a tile looks like before anybody touched it.
 *
 * Every function here is pure: (seed, q, r) in, the same answer out, forever,
 * in any order. That property is the whole reason a 400x200 board is possible
 * — we never have to store the 80,000 untouched tiles, because we can always
 * work out what they were.
 *
 * Nothing in here reads or writes world state. It cannot: it does not take a
 * world.
 */
import { hexToWorld } from "./hex.js";
import { fbm2, hash3 } from "./noise.js";

/** Feature size of the terrain. Lower is bigger, smoother landmasses. */
export const ELEV_SCALE = 0.40;
export const WET_SCALE = 0.36;

/**
 * Thresholds. Kept as data so you can tune the mix of a map without hunting
 * through if-statements — and so a test can assert the proportions.
 */
export const THRESHOLDS = {
  water: 0.68,    // wetness above this is open water
  mountain: 0.66, // elevation above this is rock
  sand: 0.36,     // wetness below this is sand
  forest: 0.58,   // of the remaining grass, tree cover above this is woodland
};

/** Feature size of the woodland. Finer than the terrain, so woods are patchy. */
export const TREE_SCALE = 0.55;

/** The terrain a tile has if the player never changed it. */
export function baseTerrainAt(seed, q, r) {
  const { x, z } = hexToWorld(q, r, 1);
  const wet = fbm2(seed + 911, x * WET_SCALE + 10, z * WET_SCALE + 10);
  if (wet > THRESHOLDS.water) return "water";

  const elev = fbm2(seed, x * ELEV_SCALE, z * ELEV_SCALE);
  if (elev > THRESHOLDS.mountain) return "mountain";
  if (wet < THRESHOLDS.sand) return "sand";

  // Woodland sits on top of grass, on its own finer noise, so forests come in
  // patches you can walk around rather than one continuous band. Where the
  // trees are is what decides where a woodcutter can ever stand.
  const trees = fbm2(seed + 4177, x * TREE_SCALE - 30, z * TREE_SCALE + 30);
  return trees > THRESHOLDS.forest ? "forest" : "grass";
}

/**
 * How big the tile is — drives how long quarrying takes.
 *
 * Hashed from the position, NOT drawn from a sequential RNG. That is the
 * fix that lets tiles be generated on demand; see the note in noise.js.
 */
export function baseSizeAt(seed, q, r) {
  return +(0.3 + hash3(seed + 77, q, r, 1) * 0.7).toFixed(2);
}

/** A fresh, untouched tile. Not stored anywhere until someone changes it. */
export function baseTileAt(seed, q, r) {
  return {
    q, r,
    terrain: baseTerrainAt(seed, q, r),
    size: baseSizeAt(seed, q, r),
    work: null,
    building: null,
  };
}
