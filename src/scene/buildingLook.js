/**
 * How each building is drawn — the data half, kept out of the .jsx file.
 *
 * Plain JavaScript with no JSX in it, for the same reason `src/game/` is:
 * Node can import it, so it can be tested in milliseconds. `lookFor` handling
 * a null is the guard that stops a torn-down building from crashing the whole
 * app, and a guard with no test is a guard waiting to be deleted.
 *
 * Shapes are deliberately primitives — cones, boxes, cylinders. Readable
 * shapes you can tell apart at a glance beat imported models at this stage,
 * and they cost nothing.
 */
export const LOOK = {
  house: { color: "#D8B18A", shape: "cone" },
  warehouse: { color: "#9B856A", shape: "box" },
  market: { color: "#B87962", shape: "box" },
  base: { color: "#E0C068", shape: "cone" },
  farm: { color: "#9BC26B", shape: "box" },
  woodcutter: { color: "#8B6F47", shape: "box" },
  quarryCamp: { color: "#A8A8B4", shape: "box" },
  well: { color: "#5A8FA8", shape: "cylinder" },
  fence: { color: "#6B5B45", shape: "ring" },
  gate: { color: "#8D8D96", shape: "wall" },
  wallTower: { color: "#9C8A6E", shape: "tower" },
  wall: { color: "#8D8D96", shape: "wall" },
  watchtower: { color: "#9C8A6E", shape: "tower" },
  granary: { color: "#C9A96A", shape: "box" },
  paddock: { color: "#7A6446", shape: "ring" },
  coop: { color: "#B08A5A", shape: "box" },
  infirmary: { color: "#D8D2C4", shape: "box" },
  // Pale dressed stone, and the only thing on the board taller than a
  // watchtower. It uses the tower shape for now; it deserves its own.
  monument: { color: "#D6CFC0", shape: "tower" },
};

/** Anything not in the table still draws, as a plain grey box. */
export const FALLBACK_LOOK = { color: "#CCCCCC", shape: "box" };

/**
 * How to draw a building, or null if there is nothing to draw.
 *
 * The null case is not hypothetical. The scene holds live references to tile
 * objects, so a tile whose building was just demolished can still be in the
 * list the renderer is working from for one render. This used to be an inline
 * `LOOK[building.id]`, which threw on exactly that and took the game down.
 */
export function lookFor(building) {
  if (!building || !building.id) return null;
  return LOOK[building.id] || FALLBACK_LOOK;
}

// --- lamps -----------------------------------------------------------------

/**
 * What each building lights up like at night. `distance` is how far the light
 * carries, which is also what stops these from all adding up into daylight.
 */
export const LAMP = {
  house: null, warehouse: null, market: null,
  base: { color: "#ffdaad", intensity: 1.8, distance: 5.5, height: 0.25, x: 0.36, z: 0.39 },
  farm: { color: "#ffdfb4", intensity: 0.75, distance: 3.2, height: 0.32, x: -0.09, z: -0.13 },
  woodcutter: { color: "#ffdab0", intensity: 0.8, distance: 3.2, height: 0.34, x: -0.03, z: 0.15 },
  quarryCamp: { color: "#ffdfbb", intensity: 0.75, distance: 3.2, height: 0.6, x: 0.25, z: -0.2 },
  well: { color: "#ffe3c0", intensity: 0.45, distance: 2.7, height: 0.57, x: 0.37, z: 0.08 },
  watchtower: { color: "#ffe0b4", intensity: 1.1, distance: 4.2, height: 1.22, x: 0.25, z: 0.25 },
  wallTower: { color: "#ffe0b4", intensity: 1.1, distance: 4.2, height: 1.78, x: 0.32, z: 0.3 },
  granary: { color: "#ffdfb4", intensity: 0.7, distance: 3.2, height: 0.51, x: 0.25, z: 0.35 },
  paddock: { color: "#ffdab0", intensity: 0.5, distance: 2.8, height: 0.28, x: -0.43, z: -0.02 },
  // Deliberately dim and low: a hen house has a lantern by the door at most.
  coop: { color: "#ffdcb2", intensity: 0.35, distance: 2.2, height: 0.22, x: 0.18, z: -0.3 },
  infirmary: { color: "#ffe8cd", intensity: 0.85, distance: 3.5, height: 0.36, x: -0.29, z: 0.37 },
  // A beacon at the top, which is half of why raiders notice it.
  monument: { color: "#ffe6c4", intensity: 1.4, distance: 5.2, height: 1.9, x: 0, z: 0 },
  gate: null, fence: null, wall: null,
};

/** The lamp for a building, or null if it does not light up. */
export function lampFor(building) {
  if (!building || !building.id) return null;
  if (building.construction?.kind === "build" || building.condition <= 0) return null;
  return LAMP[building.id] || null;
}

/** Condition as 0..1, tolerating a building that has not got one yet. */
export function healthOf(building) {
  if (!building) return 0;
  const c = building.condition;
  return Math.max(0, Math.min(1, (c === undefined || c === null ? 100 : c) / 100));
}
