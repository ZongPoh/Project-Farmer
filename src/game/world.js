/**
 * Building the board, and the shape of a saved game.
 *
 * The whole game state is still a plain object that can be JSON-ified. What
 * changed is how much of it there is: instead of every tile, a save holds the
 * seed plus the handful of tiles the player actually changed. Everything else
 * is recomputed by worldgen.js, which is a pure function of (seed, q, r).
 *
 *   board size    stored tiles   save size
 *   24 x 16          ~20          ~5 KB
 *   400 x 200        ~300         ~23 KB     (5.74 MB if stored densely)
 *
 * (This was first forced by Firestore's 1 MB document limit; the game has
 * since dropped Firebase and saves to a downloaded file, and the reasoning
 * still holds.) Sparse storage makes save size a function of how much you
 * have BUILT, not how big the world is.
 */
import { key } from "./hex.js";
import { DEFAULT_GRID, makeGrid, tileCountOf, gridExtent, offsetToAxial } from "./grid.js";
import { countTerrain, touchTile, setTerrain, rebuildActive, getTerrain, allTiles } from "./tiles.js";
import { startingStore } from "./buildings.js";
import { TERRAIN } from "./terrain.js";
import { neighbors } from "./hex.js";
import {
  claimTile, claimArea, rebuildTerritory, rebuildRivalTerritory, BASE_CLAIM_RADIUS,
} from "./territory.js";

export { mulberry32 } from "./noise.js";
export { DEFAULT_GRID, MAX_GRID, gridExtent, tileCountOf } from "./grid.js";

/** How much open ground a starting position must connect to. */
const MIN_HOME_REGION = 30;

/**
 * How many walkable tiles you can reach from here, giving up at `cap`.
 *
 * Only ever used to check a starting position, so the cap keeps it cheap even
 * on a board with a million tiles.
 */
function reachableFrom(world, start, cap = MIN_HOME_REGION) {
  const seen = new Set([key(start.q, start.r)]);
  const stack = [start];
  while (stack.length && seen.size < cap) {
    const cur = stack.pop();
    for (const n of neighbors(cur.q, cur.r)) {
      const k = key(n.q, n.r);
      if (seen.has(k)) continue;
      const terrain = getTerrain(world, n.q, n.r);
      if (terrain === null || !TERRAIN[terrain].walkable) continue;
      seen.add(k);
      stack.push(n);
    }
  }
  return seen.size;
}

/**
 * Find somewhere to start: the nearest grass to the middle of the board that
 * is connected to enough open ground to be worth settling.
 *
 * The connectivity check is not decoration. Terrain generation is perfectly
 * capable of putting a patch of grass in a five-tile pocket ringed by water,
 * and a player who starts there can walk nowhere and do nothing — the
 * pathfinder correctly reports that there is no route, and the game is over
 * before it began. Cheapest possible fix: do not start them there.
 */
function findHome(world) {
  const radius = Math.max(world.grid.width, world.grid.height);
  let fallback = null;

  for (let d = 0; d < radius; d++) {
    for (let dr = -d; dr <= d; dr++) {
      for (let dc = -d; dc <= d; dc++) {
        // Only the shell of this square, not its filled interior.
        if (d > 0 && Math.abs(dr) !== d && Math.abs(dc) !== d) continue;
        const { q, r } = offsetToAxial(dc, dr);
        if (getTerrain(world, q, r) !== "grass") continue;
        if (!fallback) fallback = { q, r };
        if (reachableFrom(world, { q, r }) >= MIN_HOME_REGION) return { q, r };
      }
    }
  }
  return fallback || { q: 0, r: 0 };
}

export function createWorld(seed = 1, grid = DEFAULT_GRID) {
  const world = {
    seed,
    grid: makeGrid(grid.width, grid.height),
    day: 1,
    // The hour is real simulation state now, not just a lighting value.
    hour: 7,

    // Only tiles somebody changed. Everything else comes from the seed.
    modified: new Map(),

    // Tiles needing attention each day (work in progress, or a building).
    active: new Set(),

    // Terrain histogram, kept correct incrementally by setTerrain.
    terrainCounts: null,

    store: startingStore(),
    market: null,
    animals: [],
    nextAnimalId: 1,

    // The people. Like animals, a flat array — a worker moves, a tile does not.
    workers: [],
    nextWorkerId: 1,
    nextJobSeq: 0,
    baseLevel: 1,
    // Tools are a shared pool, not personal kit — see base.js.
    tools: {},
    // Hours of use banked per tool KIND, which is how a pooled tool wears out
    // without every tool needing a record of its own.
    toolUse: {},
    autoRepair: true,
    autoForage: true,

    // Standing orders the player has issued that are not attached to a tile —
    // catching a horse. See horses.js.
    orders: [],
    nextOrderId: 0,

    // The rivals. `nextRaidDay` is left undefined on purpose: stepRaiders
    // schedules the first one itself, so a world made before raids existed and
    // one made after behave identically on their first day.
    raiders: [],
    nextRaiderId: 0,
    raidsSurvived: 0,

    // The neighbours — plural, and how many depends on the size of the board.
    // Left empty on purpose: `settleTheValley` fills it on the first day
    // either system runs, so a world made before they existed and one made
    // after behave identically. See rivalcamp.js.
    camps: [],
    nextCampId: 0,
    caravans: [],
    nextCaravanId: 0,
    resettle: [],

    // Land you have taken. `owned` is what you developed and is what gets
    // saved; `claims` is the derived border and is rebuilt on load, the same
    // way `active` is. See territory.js.
    owned: new Set(),
    claims: new Map(),

    home: { q: 0, r: 0 },
  };

  world.terrainCounts = countTerrain(world);
  world.home = findHome(world);

  // Guarantee somewhere buildable, even on a map that generated no grass.
  if (getTerrain(world, world.home.q, world.home.r) !== "grass") {
    setTerrain(world, world.home.q, world.home.r, "grass");
  }

  return world;
}

export const worldTileCount = (world) => tileCountOf(world.grid);

/**
 * Make sure the id counters are past everything that already exists.
 *
 * Animals and workers are found and removed BY ID, so two of anything sharing
 * one is a genuinely unpleasant bug: hunt a rabbit and the wrong one dies, or
 * a filter removes two. It cannot happen through normal play — spawn and
 * makeWorker are the only issuers — but a hand-edited save, or a test that
 * pushes an animal directly, will do it. One pass on load costs nothing.
 */
export function ensureFreshIds(world) {
  for (const a of world.animals || []) {
    if (a.id >= world.nextAnimalId) world.nextAnimalId = a.id + 1;
  }
  for (const w of world.workers || []) {
    if (w.id >= world.nextWorkerId) world.nextWorkerId = w.id + 1;
  }
  // Note the different convention: nextAnimalId and nextWorkerId hold the
  // NEXT id to issue, while nextJobSeq holds the LAST one issued (startWork
  // increments then uses it). Treating them alike quietly skips a number.
  for (const tile of world.modified.values()) {
    if (tile.work && tile.work.seq > (world.nextJobSeq || 0)) {
      world.nextJobSeq = tile.work.seq;
    }
  }
  // Orders and raiders follow the nextJobSeq convention — LAST issued — so
  // that an order's id and its queue position can be the same number.
  for (const order of world.orders || []) {
    if (order.id > (world.nextOrderId || 0)) world.nextOrderId = order.id;
  }
  for (const raider of world.raiders || []) {
    if (raider.id > (world.nextRaiderId || 0)) world.nextRaiderId = raider.id;
  }
  for (const camp of world.camps || []) {
    if (camp.id > (world.nextCampId || 0)) world.nextCampId = camp.id;
  }
  for (const caravan of world.caravans || []) {
    if (caravan.id > (world.nextCaravanId || 0)) world.nextCaravanId = caravan.id;
  }
  return world;
}

/**
 * Restore the border, whatever version the save came from.
 *
 * A version-6 save lists the owned tiles and this is just `rebuildTerritory`.
 * An OLDER save has no territory at all, and simply starting it empty would be
 * the worst possible outcome: every farm the player ever built would sit
 * outside their own border, every job would be refused, and the game would
 * look broken rather than changed. So an old save ADOPTS what is already
 * there — anything stored is something the player touched, and touching it is
 * exactly what claiming means now.
 */
export function adoptTerritory(world) {
  const saved = world.owned instanceof Set ? [...world.owned] : world.owned || [];
  world.owned = new Set();
  world.claims = new Map();

  if (saved.length) {
    world.owned = new Set(saved);
    return rebuildTerritory(world);
  }

  for (const tile of world.modified.values()) {
    claimTile(world, tile.q, tile.r);
    // The base reaches further than one tile, and always did.
    if (tile.building && tile.building.id === "base") {
      claimArea(world, tile.q, tile.r, BASE_CLAIM_RADIUS);
    }
  }
  return world;
}

// --- saving ----------------------------------------------------------------

/**
 * The save. Note what is NOT in here: the untouched tiles, the active set and
 * nothing else derived. `active` is rebuilt on load from the stored tiles,
 * and the terrain counts are kept because recounting an 80,000-tile board
 * costs about 70ms.
 */
export function serialize(world) {
  return {
    version: 12,
    market: world.market,
    seed: world.seed,
    grid: world.grid,
    day: world.day,
    hour: world.hour,
    modified: [...world.modified.values()],
    terrainCounts: world.terrainCounts,
    store: world.store,
    animals: world.animals,
    nextAnimalId: world.nextAnimalId,
    workers: world.workers,
    nextWorkerId: world.nextWorkerId,
    nextJobSeq: world.nextJobSeq,
    baseLevel: world.baseLevel,
    tools: world.tools,
    toolUse: world.toolUse,
    autoRepair: world.autoRepair,
    autoForage: world.autoForage,
    home: world.home,

    // --- version 5: orders and the rivals -----------------------------------
    orders: world.orders,
    nextOrderId: world.nextOrderId,
    raiders: world.raiders,
    nextRaiderId: world.nextRaiderId,
    nextRaidDay: world.nextRaidDay,
    raidsSurvived: world.raidsSurvived,
    tributesPaid: world.tributesPaid,
    raidAnnounced: world.raidAnnounced,

    // --- version 6: territory ------------------------------------------------
    // Only the OWNED tiles. The border is derived from them on load, so a save
    // cannot disagree with itself about where your land ends.
    owned: [...(world.owned || [])],

    // --- version 8: the neighbours, plural -----------------------------------
    // Each camp's claims are derived from its owned tiles exactly as yours are.
    camps: (world.camps || []).map((camp) => ({
      ...camp,
      owned: [...(camp.owned || [])],
      claims: undefined,
    })),
    nextCampId: world.nextCampId,
    caravans: world.caravans,
    nextCaravanId: world.nextCaravanId,
    resettle: world.resettle,
    valleySettled: world.valleySettled,
    campsRouted: world.campsRouted,
    programs: world.programs,
    programActive: world.programActive,
    programShort: world.programShort,
    achievements: world.achievements,
    tradesCompleted: world.tradesCompleted,
    herbDebt: world.herbDebt,
    woodDebt: world.woodDebt,
    stoneDebt: world.stoneDebt,
    upkeepShort: world.upkeepShort,

    // --- version 11: livestock ------------------------------------------------
    // Foal countdown and the log of every horse that left, by reason. Kept
    // animals themselves are still in `animals`, flagged `tamed`.
    livestock: world.livestock,

    // --- version 12: the ground -----------------------------------------------
    // What is left of a stand or a seam lives ON THE TILE (`timber`, `rock`),
    // so it is already in `modified` and needs nothing here. This is only the
    // list of ground you cleared and have not built on, which is what lets the
    // wood take it back. See ground.js.
    regrowth: world.regrowth || [],
  };
}

function restorePlayerHome(world) {
  const base = [...world.modified.values()].find(t => t.building?.id === "base");
  if (!base) return;
  world.home = { q: base.q, r: base.r };
  // Older saves timed initial founding; upgrades still retain their progress.
  if (base.building.construction?.kind === "build") base.building.construction = null;
}

export function deserialize(data) {
  // A version 1 save stored every tile under `tiles`. Convert it.
  if (!data.version && Array.isArray(data.tiles)) return fromV1(data);

  const world = {
    seed: data.seed ?? 1,
    grid: makeGrid(
      data.grid?.width ?? DEFAULT_GRID.width,
      data.grid?.height ?? DEFAULT_GRID.height
    ),
    day: data.day ?? 1,
    // A version-2 save has no hour. Morning is a kinder place to wake up
    // than whatever hour zero would imply.
    hour: data.hour ?? 7,
    modified: new Map(),
    active: new Set(),
    terrainCounts: data.terrainCounts || null,
    store: { ...startingStore(), ...(data.store || {}) },
    market: data.market || null,
    animals: data.animals || [],
    nextAnimalId: data.nextAnimalId || 1,
    workers: data.workers || [],
    nextWorkerId: data.nextWorkerId || 1,
    nextJobSeq: data.nextJobSeq || 0,
    baseLevel: data.baseLevel || 1,
    tools: data.tools || {},
    toolUse: data.toolUse || {},
    autoRepair: data.autoRepair !== false,
    autoForage: data.autoForage !== false,
    home: data.home || { q: 0, r: 0 },

    // A version-4 save has none of these. Empty lists are exactly right: the
    // orders queue starts empty, and `nextRaidDay` staying undefined is the
    // signal stepRaiders uses to schedule the first raid itself — so an old
    // save gets its clear run rather than being raided on the day it loads.
    orders: data.orders || [],
    nextOrderId: data.nextOrderId || 0,
    raiders: data.raiders || [],
    nextRaiderId: data.nextRaiderId || 0,
    nextRaidDay: data.nextRaidDay,
    raidsSurvived: data.raidsSurvived || 0,
    tributesPaid: data.tributesPaid || 0,
    raidAnnounced: !!data.raidAnnounced,

    owned: new Set(data.owned || []),
    claims: new Map(),

    // A version-7 save had exactly one camp under `rival`. Carrying it forward
    // as the first entry keeps the player's neighbours — and the war party
    // walking toward them — exactly where they were.
    camps: (data.camps
      ? data.camps
      : data.rival
      ? [{ ...data.rival, id: 1, kind: "raider" }]
      : []
    ).map((camp) => ({
      ...camp,
      owned: new Set(camp.owned || []),
      claims: new Map(),
      store: { food: 0, loot: 0, goods: 0, ...(camp.store || {}) },
    })),
    nextCampId: data.nextCampId || (data.rival ? 1 : 0),
    caravans: data.caravans || [],
    nextCaravanId: data.nextCaravanId || 0,
    resettle: data.resettle
      || (data.rivalResettleOn ? [{ on: data.rivalResettleOn, kind: "raider" }] : []),
    // A version-7 world had already settled whatever it was going to settle.
    valleySettled: data.valleySettled ?? !!(data.rival || data.rivalResettleOn),
    campsRouted: data.campsRouted || 0,
    programs: data.programs || {},
    programActive: data.programActive || {},
    programShort: data.programShort || {},
    achievements: data.achievements || {},
    tradesCompleted: data.tradesCompleted || 0,
    herbDebt: data.herbDebt || 0,
    woodDebt: data.woodDebt || 0,
    stoneDebt: data.stoneDebt || 0,
    upkeepShort: !!data.upkeepShort,
    livestock: data.livestock || null,
    regrowth: Array.isArray(data.regrowth) ? data.regrowth : [],
  };

  for (const tile of data.modified || []) world.modified.set(key(tile.q, tile.r), tile);
  restorePlayerHome(world);
  rebuildActive(world);
  adoptTerritory(world);
  rebuildRivalTerritory(world);
  ensureFreshIds(world);
  if (!world.terrainCounts) world.terrainCounts = countTerrain(world);

  return world;
}

/**
 * A radius-based, densely-stored save from before this change.
 *
 * Terrain generation changed too (hashed noise instead of a wrapping lookup
 * table), so the old map cannot be reproduced from its seed. Every tile that
 * differs from what the new generator would produce is therefore kept as a
 * modification — which is most of them. The save gets big, but the player's
 * farm survives, and it shrinks again as soon as they start a new map.
 */
function fromV1(data) {
  const radius = data.radius ?? 3;
  const side = radius * 2 + 1;
  const world = createWorld(data.seed ?? 1, { width: side, height: side });
  world.day = data.day ?? 1;
  world.store = { ...startingStore(), ...(data.store || {}) };
  world.animals = data.animals || [];
  world.nextAnimalId = data.nextAnimalId || 1;
  world.home = data.home || world.home;

  for (const old of data.tiles) {
    const q = old.q, r = old.r;
    if (getTerrain(world, q, r) === null) continue; // outside the new rect
    if (old.terrain !== getTerrain(world, q, r)) setTerrain(world, q, r, old.terrain);
    if (old.work || old.building || old.size !== undefined) {
      const tile = touchTile(world, q, r);
      tile.work = old.work ?? null;
      tile.building = old.building ?? null;
      if (old.size !== undefined) tile.size = old.size;
    }
  }
  restorePlayerHome(world);
  rebuildActive(world);
  return world;
}

/**
 * Merge a save over a fresh world, so a save missing fields this version
 * expects does not crash. Kept as a separate entry point from deserialize
 * because it is the one you want when LOADING UNTRUSTED data — see docs/06.
 */
export function migrate(data) {
  const world = deserialize(data);
  world.store = { ...startingStore(), ...world.store };
  if (!world.animals) world.animals = [];
  if (!world.workers) world.workers = [];
  if (!world.nextWorkerId) world.nextWorkerId = 1;
  if (!world.tools) world.tools = {};
  if (!world.toolUse) world.toolUse = {};
  if (!world.baseLevel) world.baseLevel = 1;
  if (!world.orders) world.orders = [];
  if (!world.raiders) world.raiders = [];
  if (!world.camps) world.camps = [];
  if (!world.caravans) world.caravans = [];
  if (!world.resettle) world.resettle = [];
  if (!world.owned) world.owned = new Set();
  // A worker saved before health and skills existed is fit and unskilled.
  for (const w of world.workers) {
    if (w.health === undefined) w.health = 100;
    if (!w.skills) w.skills = {};
    if (w.tool === undefined) w.tool = null;
  }
  if (!world.terrainCounts) world.terrainCounts = countTerrain(world);
  restorePlayerHome(world);
  rebuildActive(world);
  adoptTerritory(world);
  rebuildRivalTerritory(world);
  ensureFreshIds(world);
  return world;
}

export { allTiles };
