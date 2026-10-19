/**
 * The rectangular board.
 *
 * The board used to be a hex of radius N. It is now a WIDTH x HEIGHT
 * rectangle centred on the origin, because a rect is what scales: you can
 * say "400 by 200" and reason about it, and a camera window over a rect is
 * simple arithmetic rather than a ring walk.
 *
 * Two coordinate systems, and it matters which is which:
 *
 *   OFFSET (col, row)  the storage/iteration shape. A rectangle. Rows are
 *                      staggered — odd rows sit half a hex to the right.
 *                      Use this for bounds, chunks, and camera windows.
 *
 *   AXIAL  (q, r)      the coordinate system everything else already speaks.
 *                      neighbors(), distance(), hexToWorld() all take axial,
 *                      and none of that code had to change.
 *
 * So this file is a translation layer, not a replacement. `q,r` is still the
 * identity of a tile and still what map keys are built from.
 *
 * Layout is pointy-top "odd-r": odd rows shift +0.5 hex in x.
 */
import { SQ3 } from "./hex.js";

/** Tiles per chunk, per axis. Chunks are the unit of render invalidation. */
export const CHUNK = 16;

export const DEFAULT_GRID = { width: 24, height: 16 };

/** A sanity ceiling. 4096 x 4096 is 16.7M tiles — far past what is sensible. */
export const MAX_GRID = { width: 4096, height: 4096 };

export const makeGrid = (width, height) => ({
  width: Math.max(1, Math.min(MAX_GRID.width, width | 0)),
  height: Math.max(1, Math.min(MAX_GRID.height, height | 0)),
});

export const tileCountOf = (grid) => grid.width * grid.height;

/**
 * Bounds, in offset space, centred on the origin.
 * A 24-wide board runs col -12..11 — the extra tile goes on the negative
 * side, which keeps col 0 on the centre line for odd and even widths alike.
 */
export const colMin = (grid) => -(grid.width >> 1);
export const colMax = (grid) => -(grid.width >> 1) + grid.width - 1;
export const rowMin = (grid) => -(grid.height >> 1);
export const rowMax = (grid) => -(grid.height >> 1) + grid.height - 1;

// --- offset <-> axial ------------------------------------------------------
// JS bitwise ops use two's complement, so (row & 1) is 1 for negative odd
// rows too (-3 & 1 === 1) and these round-trip correctly below the origin.
// There is a test for exactly that, because it is an easy thing to get wrong.

export const offsetToAxial = (col, row) => ({
  q: col - ((row - (row & 1)) >> 1),
  r: row,
});

export const axialToOffset = (q, r) => ({
  col: q + ((r - (r & 1)) >> 1),
  row: r,
});

export function inBoundsOffset(grid, col, row) {
  return (
    col >= colMin(grid) && col <= colMax(grid) &&
    row >= rowMin(grid) && row <= rowMax(grid)
  );
}

/** Is this axial tile on the board? Every accessor goes through here. */
export function inBounds(grid, q, r) {
  const { col, row } = axialToOffset(q, r);
  return inBoundsOffset(grid, col, row);
}

/** Is this tile on the outer rim? That is where wildlife wanders in. */
export function isEdge(grid, q, r) {
  const { col, row } = axialToOffset(q, r);
  return (
    col === colMin(grid) || col === colMax(grid) ||
    row === rowMin(grid) || row === rowMax(grid)
  );
}

// --- world space -----------------------------------------------------------

/**
 * How big the board is in world units.
 *
 * Hexes at size 1 are SQ3 (~1.73) apart across a row and 1.5 apart between
 * rows, so a square tile count is NOT a square board — 400x200 is 692 x 300.
 * The camera code needs the real numbers, not the tile counts.
 */
export function gridExtent(grid) {
  return {
    width: SQ3 * (grid.width + 0.5),
    depth: 1.5 * grid.height + 1,
  };
}

/** Nearest offset cell to a point on the ground plane. Inverse of hexToWorld. */
export function worldToOffset(x, z) {
  const row = Math.round(z / 1.5);
  const col = Math.round(x / SQ3 - (row & 1) / 2);
  return { col, row };
}

// --- chunks ----------------------------------------------------------------

/**
 * Chunks exist so that panning the camera does not rebuild the scene every
 * frame. The visible set only changes when you cross a chunk boundary, so
 * within a chunk the render cost of moving is zero.
 */
export const chunkKey = (cx, cy) => `${cx}:${cy}`;

export const chunkOf = (col, row) => ({
  cx: Math.floor(col / CHUNK),
  cy: Math.floor(row / CHUNK),
});

/** The offset bounds of one chunk, clipped to the board. */
export function chunkBounds(grid, cx, cy) {
  return {
    col0: Math.max(colMin(grid), cx * CHUNK),
    col1: Math.min(colMax(grid), cx * CHUNK + CHUNK - 1),
    row0: Math.max(rowMin(grid), cy * CHUNK),
    row1: Math.min(rowMax(grid), cy * CHUNK + CHUNK - 1),
  };
}

/**
 * Every chunk that overlaps a rectangular window of tiles around a centre.
 *
 * This is the whole trick for a 400x200 board: the renderer asks for the
 * chunks near the camera and never learns the other 79,000 tiles exist.
 */
export function chunksInView(grid, centreCol, centreRow, halfCols, halfRows) {
  const c0 = Math.max(colMin(grid), centreCol - halfCols);
  const c1 = Math.min(colMax(grid), centreCol + halfCols);
  const r0 = Math.max(rowMin(grid), centreRow - halfRows);
  const r1 = Math.min(rowMax(grid), centreRow + halfRows);

  const out = [];
  if (c0 > c1 || r0 > r1) return out;

  const from = chunkOf(c0, r0);
  const to = chunkOf(c1, r1);
  for (let cy = from.cy; cy <= to.cy; cy++) {
    for (let cx = from.cx; cx <= to.cx; cx++) out.push({ cx, cy, key: chunkKey(cx, cy) });
  }
  return out;
}

/** A stable string for a set of chunks, so React can tell when it changed. */
export const chunkSetId = (chunks) => chunks.map((c) => c.key).join("|");
