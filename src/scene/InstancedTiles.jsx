/**
 * Every visible tile, in one draw call.
 *
 * The board used to be one React component and one Three.js mesh per tile.
 * That is fine at 37 and hopeless at any size worth calling a map: 500 tiles
 * on screen means 500 Object3Ds for Three.js to cull, sort and draw, and 500
 * components for React to reconcile whenever anything changes.
 *
 * An InstancedMesh is one geometry, one material, one draw call, and a matrix
 * per tile. The geometry is a unit-height hexagonal prism; each instance is
 * scaled on Y to its terrain's height and lifted so it sits on the ground.
 *
 * Instances are allocated once at a generous maximum and `count` is moved to
 * however many are actually visible — growing a buffer is what costs, so we
 * do not.
 */
import { useRef, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { hexToWorld } from "../game/hex.js";
import { TERRAIN } from "../game/terrain.js";
import { seasonalColor } from "../game/calendar.js";
import { inTerritory, isOwned, inRivalLand } from "../game/territory.js";

export const TILE_SIZE = 1;

/** Ceiling on instances. The view window is nowhere near this on any screen. */
const MAX_INSTANCES = 6000;

// Scratch objects, reused so the update loop allocates nothing per frame.
const _m = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _colour = new THREE.Color();

/**
 * How much of its colour a tile keeps when it is outside your border.
 *
 * THE BORDER HAS TO BE VISIBLE. Jobs and buildings are refused outside your
 * land, and a refusal the player cannot see coming reads as a bug rather than
 * a rule — "why is the button greyed out" is the single most likely reaction
 * to this whole feature. Darkening everything you do not hold answers it
 * before it is asked, with no UI at all.
 *
 * Muted rather than greyed: the terrain must stay legible out there, because
 * that is how you decide which way to expand.
 */
const OUTSIDE_TINT = 0.5;

/** Ground you have actually worked reads a touch warmer than the ring. */
const OWNED_TINT = 1.06;

/**
 * Their land, pushed toward red.
 *
 * A multiply per channel rather than a blend: the terrain must still be
 * readable — you decide which way to expand by looking at it — but there has
 * to be no doubt whose side of the valley you are on. Contested ground, where
 * the two borders overlap, ends up somewhere between the two, which is exactly
 * what it should look like.
 */
const RIVAL_TINT = [1.12, 0.74, 0.72];

export default function InstancedTiles({ tiles, selected, onSelect, day = 1, world, revision }) {
  const meshRef = useRef(null);

  // Terrain colours for TODAY: the base colour shifted by the season, so
  // grass yellows in autumn and pales in winter. Rebuilt once a day rather
  // than per tile — there are four terrains and up to a few thousand tiles.
  const colours = useMemo(() => {
    const out = {};
    for (const [id, def] of Object.entries(TERRAIN)) {
      out[id] = new THREE.Color(seasonalColor(def.color, id, day));
    }
    return out;
  }, [day]);

  // A six-sided cylinder IS a hexagonal prism, and Three.js builds it with
  // corners at 30/90/150 degrees — exactly the pointy-top orientation these
  // coordinates assume. No rotation. (Tutorials that rotate by PI/6 are for a
  // flat-top layout and would leave gaps.)
  const geometry = useMemo(
    () => new THREE.CylinderGeometry(TILE_SIZE * 0.96, TILE_SIZE * 0.96, 1, 6),
    []
  );

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const n = Math.min(tiles.length, MAX_INSTANCES);
    for (let i = 0; i < n; i++) {
      const tile = tiles[i];
      const def = TERRAIN[tile.terrain];
      const { x, z } = hexToWorld(tile.q, tile.r, TILE_SIZE);
      const lift = tile.work ? 0.06 : 0;
      const height = def.height + lift;

      // Unit prism scaled to height, raised so its base sits on y = 0.
      _pos.set(x, height / 2, z);
      _scale.set(1, height, 1);
      _m.compose(_pos, _quat, _scale);
      mesh.setMatrixAt(i, _m);

      const isSelected =
        selected && selected.q === tile.q && selected.r === tile.r;
      _colour.copy(colours[tile.terrain]);

      // Your land, the ring around it, and everything beyond.
      if (world) {
        if (!inTerritory(world, tile.q, tile.r)) _colour.multiplyScalar(OUTSIDE_TINT);
        else if (isOwned(world, tile.q, tile.r)) _colour.multiplyScalar(OWNED_TINT);
        if (inRivalLand(world, tile.q, tile.r)) {
          _colour.setRGB(
            _colour.r * RIVAL_TINT[0],
            _colour.g * RIVAL_TINT[1],
            _colour.b * RIVAL_TINT[2]
          );
        }
      }

      // Brighten the tile's OWN colour rather than washing it with gold,
      // otherwise a selected water tile reads as sand.
      if (isSelected) _colour.multiplyScalar(1.55);
      mesh.setColorAt(i, _colour);
    }

    // Draw only what is visible; the rest of the buffer keeps its old values
    // and is simply not drawn.
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // The bounding sphere is computed from instance 0 onwards; without this
    // Three.js may frustum-cull the whole batch after the camera moves.
    mesh.computeBoundingSphere();
    // `revision` for the usual reason: claiming a tile mutates the world in
    // place, so without it the border would not redraw until something else
    // happened to change.
  }, [tiles, selected, colours, day, world, revision]);

  const handleClick = (e) => {
    e.stopPropagation();
    const i = e.instanceId;
    if (i === undefined || i === null || i >= tiles.length) return;
    onSelect(tiles[i]);
  };

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, MAX_INSTANCES]}
      castShadow
      receiveShadow
      frustumCulled={false}
      onClick={handleClick}
    >
      <meshStandardMaterial roughness={0.85} metalness={0.05} />
    </instancedMesh>
  );
}
