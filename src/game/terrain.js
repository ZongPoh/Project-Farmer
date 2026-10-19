import { operational } from "./construction.js";
/**
 * Terrain types and the rules for turning one into another.
 *
 * The rules are plain data. To add a new conversion you add an object to
 * CONVERSIONS — no other file needs to change. That is the pattern to
 * keep as the game grows.
 */
import { neighbors } from "./hex.js";
import { getTerrain, getBuilding } from "./tiles.js";

export const TERRAIN = {
  water:    { label: "Water",    color: "#3E6B84", height: 0.10, buildable: false, walkable: false },
  sand:     { label: "Sand",     color: "#C9B487", height: 0.26, buildable: true,  walkable: true  },
  grass:    { label: "Grass",    color: "#7B9A5F", height: 0.34, buildable: true,  walkable: true  },
  // Trees. Walkable but slow, and the only place a woodcutter can stand.
  // Grass and forest convert back and forth, which is the whole point: wood
  // is a crop you manage rather than a deposit you exhaust.
  forest:   { label: "Forest",   color: "#3F6B3C", height: 0.62, buildable: true,  walkable: true, moveCost: 2 },
  mountain: { label: "Mountain", color: "#6E7386", height: 1.05, buildable: false, walkable: false },
};

/** How many movement points it costs a worker to step onto this terrain. */
export const moveCost = (terrainId) => TERRAIN[terrainId]?.moveCost || 1;

export const TERRAIN_IDS = Object.keys(TERRAIN);

/** Does this tile touch at least one tile of the given terrain? */
export function touches(world, tile, terrainId) {
  return neighbors(tile.q, tile.r).some((n) => getTerrain(world, n.q, n.r) === terrainId);
}

/**
 * Does this tile touch a working building of the given kind?
 *
 * Deliberately written here rather than imported from buildings.js: terrain
 * rules should not depend on the building module, only on the shape of a
 * tile. A ruined building (condition 0) does not count.
 */
export function touchesBuilding(world, tile, buildingId) {
  return neighbors(tile.q, tile.r).some((n) => {
    const b = getBuilding(world, n.q, n.r);
    return operational(b) && b.id === buildingId;
  });
}

/**
 * Every conversion the player can start.
 *
 *   hours(tile, world)   WORKER-HOURS of effort, not elapsed time. One worker
 *                        on the tile contributes 1 an hour, so two workers
 *                        halve the wait. This replaced `days`, which made
 *                        every job feel like it had stalled.
 *   cost                 resources spent when the job is STARTED
 *   yields               resources gained when it FINISHES
 *   blockedBy(tile,world) null if allowed, otherwise a reason for the player
 */
export const CONVERSIONS = [
  {
    id: "quarry",
    from: "mountain",
    to: "sand",
    label: "Break down the rock",
    // A bigger mountain is more rock to move, so it takes longer.
    hours: (tile) => Math.round(16 + tile.size * 32),
    yields: { stone: 8 },
    blockedBy: () => null,
  },
  {
    id: "irrigate",
    from: "sand",
    to: "grass",
    label: "Water the sand until grass takes",
    // A well next door does the job of a lake, and does it faster.
    hours: (tile, world) => (world && touchesBuilding(world, tile, "well") ? 10 : 16),
    blockedBy: (tile, world) =>
      touches(world, tile, "water") || touchesBuilding(world, tile, "well")
        ? null
        : "needs to touch water or a well",
  },
  {
    id: "flood",
    from: "sand",
    to: "water",
    label: "Dig down to the water table",
    hours: () => 12,
    blockedBy: (tile, world) =>
      touches(world, tile, "water") ? null : "needs to touch water",
  },
  {
    id: "drain",
    from: "water",
    to: "sand",
    label: "Drain and fill in",
    hours: () => 24,
    // You cannot drain open sea — only a pool with land most of the way round.
    blockedBy: (tile, world) => {
      const wet = neighbors(tile.q, tile.r).filter((n) => {
        const t = getTerrain(world, n.q, n.r);
        // Off the edge of the board counts as open water.
        return t === null || t === "water";
      }).length;
      return wet > 2 ? "too much open water around it" : null;
    },
  },
  {
    id: "plant",
    from: "grass",
    to: "forest",
    label: "Plant saplings",
    hours: () => 8,
    // Seeds are the gate. You cannot simply decide to have a forest — you
    // have to have found the seed for it first.
    cost: { seeds: 1 },
    blockedBy: (tile, world) =>
      (world.store?.seeds || 0) >= 1 ? null : "you have no seeds",
  },
  {
    id: "clear",
    from: "forest",
    to: "grass",
    label: "Clear the trees",
    hours: () => 10,
    // Felling a wood gives you the timber, which is what makes clearing a
    // real choice rather than just undoing a mistake.
    yields: { wood: 12 },
    blockedBy: () => null,
  },
];

/** The conversions legal on this tile right now, each with its cost and blocker. */
export function optionsFor(world, tile) {
  return CONVERSIONS.filter((c) => c.from === tile.terrain).map((c) => ({
    id: c.id,
    label: c.label,
    to: c.to,
    hours: c.hours(tile, world),
    cost: c.cost || null,
    yields: c.yields || null,
    blockedBy: c.blockedBy(tile, world),
  }));
}

export function findConversion(id) {
  return CONVERSIONS.find((c) => c.id === id) || null;
}
