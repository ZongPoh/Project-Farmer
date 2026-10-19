/**
 * Which tiles the renderer is allowed to know about.
 *
 * The board may be 400x200. The screen shows a few hundred tiles. So each
 * frame we work out a rectangle of tiles around wherever the camera is
 * looking, and hand back only those — the other 79,000 are never turned into
 * geometry, never raycast, and never reconciled by React. They still exist:
 * the simulation runs on them, animals walk over them, and a job started on
 * one finishes whether or not you are looking at it.
 *
 * THE REASON FOR CHUNKS: recomputing the visible list every frame would mean
 * rebuilding instance buffers 60 times a second while you pan. Instead the
 * window is snapped out to whole 16x16 chunks, so the set only changes when
 * you cross a chunk boundary. Panning inside a chunk costs nothing at all.
 */
import { useRef, useState, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  CHUNK, chunkSetId, chunksInView, chunkBounds, worldToOffset,
  colMin, colMax, rowMin, rowMax, offsetToAxial,
} from "../game/grid.js";
import { getTile } from "../game/tiles.js";

/**
 * How far out to render, in tiles, for a given camera distance.
 *
 * Hexes are SQ3 (~1.73) apart across a row and 1.5 apart between rows, so the
 * column and row counts are not the same for a square patch of ground.
 * The +2 is margin so tiles do not pop in at the edge of the screen.
 */
export function viewRadius(distance, aspect = 1.6) {
  const span = distance * 0.9; // roughly the ground covered at fov 42
  return {
    halfCols: Math.ceil((span * aspect) / 2 / 1.732) + 2,
    halfRows: Math.ceil(span / 2 / 1.5) + 2,
  };
}

/**
 * Keep the camera's look-at point over the board.
 *
 * Without this you can pan off the edge into empty space and lose the map,
 * which on a big board is genuinely hard to recover from.
 */
export function clampTargetToBoard(grid, target) {
  const maxX = 1.732 * (grid.width / 2 + 0.5);
  const maxZ = 1.5 * (grid.height / 2 + 0.5);
  target.x = Math.max(-maxX, Math.min(maxX, target.x));
  target.z = Math.max(-maxZ, Math.min(maxZ, target.z));
  target.y = 0;
  return target;
}

/**
 * The visible tiles, recomputed only when the set of visible chunks changes.
 *
 * Returns { tiles, centre } where `centre` is the offset cell under the
 * camera — handy for debug read-outs.
 */
export function useVisibleTiles(world, controlsRef, revision) {
  const { camera, size } = useThree();
  const [visible, setVisible] = useState(() => ({ tiles: [], centre: { col: 0, row: 0 } }));
  const lastId = useRef("");
  const lastRevision = useRef(revision);

  const rebuild = useCallback(
    (centreCol, centreRow, chunks) => {
      const tiles = [];
      for (const c of chunks) {
        const { col0, col1, row0, row1 } = chunkBounds(world.grid, c.cx, c.cy);
        for (let row = row0; row <= row1; row++) {
          for (let col = col0; col <= col1; col++) {
            const { q, r } = offsetToAxial(col, row);
            const tile = getTile(world, q, r);
            if (tile) tiles.push(tile);
          }
        }
      }
      setVisible({ tiles, centre: { col: centreCol, row: centreRow } });
    },
    [world]
  );

  useFrame(() => {
    const target = controlsRef.current ? controlsRef.current.target : { x: 0, z: 0 };
    const distance = camera.position.distanceTo(
      controlsRef.current ? controlsRef.current.target : camera.position
    ) || 20;

    const { col, row } = worldToOffset(target.x, target.z);
    const { halfCols, halfRows } = viewRadius(distance, size.width / size.height);
    const chunks = chunksInView(world.grid, col, row, halfCols, halfRows);
    const id = chunkSetId(chunks);

    // Rebuild when the camera crosses into new chunks, OR when the world
    // changed underneath us (a day passed, something was built).
    if (id !== lastId.current || revision !== lastRevision.current) {
      lastId.current = id;
      lastRevision.current = revision;
      rebuild(col, row, chunks);
    }
  });

  return visible;
}

export { CHUNK, colMin, colMax, rowMin, rowMax };
