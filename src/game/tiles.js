/**
 * How to read and write a tile.
 *
 * The board is no longer a Map of every tile. It is:
 *
 *   world.modified   Map<"q,r", tile>   only tiles somebody CHANGED
 *   everything else                     recomputed from the seed on demand
 *
 * A 400x200 board is 80,000 tiles and a 5.7 MB save if you store them all —
 * which is a slow download and a slow upload for a save file before the player
 * has done anything. Stored sparsely the same board saves in about 23 KB, because a
 * player only ever touches a few hundred tiles.
 *
 * THE RULES, and they are short:
 *
 *   getTerrain(w,q,r)  read-only, no allocation. Use in hot loops.
 *   getTile(w,q,r)     read-only tile object. May be a throwaway — do NOT
 *                      mutate what comes back unless it is already stored.
 *   touchTile(w,q,r)   the mutable, stored tile. Call this before writing.
 *
 * Mutating the result of getTile on an untouched tile silently does nothing,
 * because the object you changed was a temporary. touchTile is the only way
 * in. There is a test for that mistake specifically.
 */
import { key } from "./hex.js";
import { inBounds, axialToOffset, colMin, colMax, rowMin, rowMax, offsetToAxial } from "./grid.js";
import { baseTileAt, baseTerrainAt, baseSizeAt } from "./worldgen.js";

// --- reading ---------------------------------------------------------------

/**
 * Remembering what the generator said, so it is not asked twice.
 *
 * MEASURED, and it was the single biggest cost in the game on a large board.
 * A CPU profile of a 400x200 world showed `fbm2` — the fractal noise behind
 * terrain generation — taking 36% of all runtime, with `getTerrain` itself
 * another 17%. The reason is A*: one pathfinding search examines up to 3,000
 * tiles and asks about all six neighbours of each, so 18,000 terrain lookups,
 * every one of them recomputing several octaves of value noise for a tile
 * whose answer cannot change.
 *
 * It cannot change, and that is what makes this safe with no invalidation at
 * all: the cache holds only the GENERATED terrain, which is a pure function of
 * (seed, q, r). A tile the player alters goes into `world.modified`, which is
 * checked first and wins.
 *
 * The cap exists because a 400x200 board is 80,000 tiles and an unbounded
 * cache would quietly become the largest thing in memory. Clearing wholesale
 * when it fills is deliberately crude: the alternative is LRU bookkeeping on
 * the hottest path in the game, to avoid recomputing something that costs a
 * microsecond.
 */
const TERRAIN_CACHE_LIMIT = 40_000;

/**
 * The terrain at a tile, or null if it is off the board.
 * Allocates nothing on a cache hit, which is why the rules use it everywhere.
 */
export function getTerrain(world, q, r) {
  if (!inBounds(world.grid, q, r)) return null;
  const k = key(q, r);
  const stored = world.modified.get(k);
  if (stored) return stored.terrain;

  let cache = world.baseTerrain;
  if (!cache) {
    cache = new Map();
    world.baseTerrain = cache;
  }
  const hit = cache.get(k);
  if (hit !== undefined) return hit;

  const terrain = baseTerrainAt(world.seed, q, r);
  if (cache.size >= TERRAIN_CACHE_LIMIT) cache.clear();
  cache.set(k, terrain);
  return terrain;
}

/** The building on a tile, or null. Only stored tiles can have one. */
export function getBuilding(world, q, r) {
  const stored = world.modified.get(key(q, r));
  return stored ? stored.building : null;
}

/** The work in progress on a tile, or null. Only stored tiles can have any. */
export function getWork(world, q, r) {
  const stored = world.modified.get(key(q, r));
  return stored ? stored.work : null;
}

/**
 * A tile to read. If it has never been touched this builds a throwaway from
 * the seed — correct to read, pointless to write to.
 */
export function getTile(world, q, r) {
  if (!inBounds(world.grid, q, r)) return null;
  return world.modified.get(key(q, r)) || baseTileAt(world.seed, q, r);
}

/** Has this tile ever been changed? Mostly for tests and diagnostics. */
export const isStored = (world, q, r) => world.modified.has(key(q, r));

// --- writing ---------------------------------------------------------------

/**
 * Get the stored, mutable tile — promoting it out of the procedural base
 * into `world.modified` if this is the first time anyone has touched it.
 *
 * Call this before any write. It is the only way to change a tile.
 */
export function touchTile(world, q, r) {
  if (!inBounds(world.grid, q, r)) return null;
  const k = key(q, r);
  let tile = world.modified.get(k);
  if (!tile) {
    tile = baseTileAt(world.seed, q, r);
    world.modified.set(k, tile);
  }
  return tile;
}

/**
 * Change a tile's terrain, keeping the terrain histogram right.
 *
 * The histogram is why this is a function rather than `tile.terrain = x`.
 * Counting grass by walking 80,000 tiles is 0.6ms, which sounds harmless
 * until you notice the animal code asks for it once per animal per day.
 * Maintained incrementally it is free.
 */
export function setTerrain(world, q, r, terrain) {
  const tile = touchTile(world, q, r);
  if (!tile || tile.terrain === terrain) return tile;
  if (world.terrainCounts) {
    world.terrainCounts[tile.terrain] = (world.terrainCounts[tile.terrain] || 0) - 1;
    world.terrainCounts[terrain] = (world.terrainCounts[terrain] || 0) + 1;
  }
  tile.terrain = terrain;
  return tile;
}

// --- the active set --------------------------------------------------------

/**
 * Tiles that need looking at each day: anything with work in progress or a
 * building on it.
 *
 * This is the other half of making a big board cheap. advanceDay used to walk
 * every tile five times a day — 115ms at 80,000 tiles, and 14 seconds for a
 * 120-day offline catch-up. A player has maybe twenty active tiles, so
 * walking those instead is roughly ten thousand times less work, and the cost
 * stops depending on the size of the map at all.
 */
export function markActive(world, q, r) {
  world.active.add(key(q, r));
}

export function unmarkActive(world, q, r) {
  const tile = world.modified.get(key(q, r));
  // Still needed if either reason to be active remains.
  if (tile && (tile.work || tile.building)) return;
  world.active.delete(key(q, r));
}

/** The live tiles, as mutable stored objects. Safe to write to. */
export function activeTiles(world) {
  const out = [];
  for (const k of world.active) {
    const tile = world.modified.get(k);
    if (tile) out.push(tile);
    else world.active.delete(k); // stale entry, drop it
  }
  return out;
}

/** Rebuild the active set from what is stored. Used on load. */
export function rebuildActive(world) {
  world.active = new Set();
  for (const [k, tile] of world.modified) {
    if (tile.work || tile.building) world.active.add(k);
  }
  return world.active;
}

// --- terrain counts --------------------------------------------------------

/** How many tiles of this terrain are on the board. O(1). */
export function terrainCount(world, terrainId) {
  return (world.terrainCounts && world.terrainCounts[terrainId]) || 0;
}

/**
 * Count the whole board once. O(tiles) — about 70ms at 80,000 — so this runs
 * when a map is made and never again; after that `setTerrain` keeps the
 * numbers right incrementally.
 */
export function countTerrain(world) {
  const counts = { water: 0, sand: 0, grass: 0, mountain: 0 };
  const { grid, seed, modified } = world;
  for (let row = rowMin(grid); row <= rowMax(grid); row++) {
    for (let col = colMin(grid); col <= colMax(grid); col++) {
      const { q, r } = offsetToAxial(col, row);
      const stored = modified.get(key(q, r));
      const t = stored ? stored.terrain : baseTerrainAt(seed, q, r);
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  return counts;
}

// --- walking the board -----------------------------------------------------

/**
 * Every tile on the board, in row order.
 *
 * O(map size) and it allocates — deliberately a generator so at least it does
 * not build an 80,000-entry array. For tests, tools and one-off counts ONLY.
 * Nothing called per frame or per day may use this; that is the mistake this
 * whole file exists to prevent.
 */
export function* allTiles(world) {
  const { grid } = world;
  for (let row = rowMin(grid); row <= rowMax(grid); row++) {
    for (let col = colMin(grid); col <= colMax(grid); col++) {
      const { q, r } = offsetToAxial(col, row);
      yield getTile(world, q, r);
    }
  }
}

/** Tiles inside a rectangular window of offset coords. What the renderer asks for. */
export function* tilesInRect(world, col0, row0, col1, row1) {
  const { grid } = world;
  const c0 = Math.max(colMin(grid), col0), c1 = Math.min(colMax(grid), col1);
  const r0 = Math.max(rowMin(grid), row0), r1 = Math.min(rowMax(grid), row1);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const { q, r } = offsetToAxial(col, row);
      yield getTile(world, q, r);
    }
  }
}

/** A random tile on the rim, or null if none of `terrains` sits there. */
export function randomEdgeTile(world, terrains, rnd, attempts = 24) {
  const { grid } = world;
  for (let i = 0; i < attempts; i++) {
    let col, row;
    // Pick a side first, then a position along it, so corners are not favoured.
    if (rnd() < 0.5) {
      row = rnd() < 0.5 ? rowMin(grid) : rowMax(grid);
      col = colMin(grid) + ((rnd() * grid.width) | 0);
    } else {
      col = rnd() < 0.5 ? colMin(grid) : colMax(grid);
      row = rowMin(grid) + ((rnd() * grid.height) | 0);
    }
    const { q, r } = offsetToAxial(col, row);
    const terrain = getTerrain(world, q, r);
    if (terrain && terrains.includes(terrain)) return getTile(world, q, r);
  }
  return null;
}

export { axialToOffset, offsetToAxial, inBounds };
