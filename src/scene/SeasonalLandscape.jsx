import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { hexToWorld } from "../game/hex.js";
import { TERRAIN } from "../game/terrain.js";
import { inTerritory, inRivalLand } from "../game/territory.js";
import { decorationVariant, seasonAppearance } from "./seasonAppearance.js";

const MAX = 6000;
const noRaycast = () => null;

// Four batched meshes, restricted to the same visible window as the terrain.
// No per-frame animation, particles, or objects added to the simulation.
export default function SeasonalLandscape({ tiles, world, revision }) {
  const trunks = useRef(null), crowns = useRef(null), details = useRef(null), snow = useRef(null);
  const appearance = seasonAppearance(world.day);
  const scratch = useMemo(() => ({ object: new THREE.Object3D(), color: new THREE.Color() }), []);
  useLayoutEffect(() => {
    const counts = new Map();
    for (const ref of [trunks, crowns, details, snow]) counts.set(ref, 0);
    const put = (ref, tile, x, y, z, sx, sy, sz, color) => {
      const i = counts.get(ref);
      if (!ref.current || i >= MAX) return;
      scratch.object.position.set(x, y, z);
      scratch.object.scale.set(sx, sy, sz);
      scratch.object.updateMatrix();
      ref.current.setMatrixAt(i, scratch.object.matrix);
      scratch.color.set(color);
      if (!inTerritory(world, tile.q, tile.r)) scratch.color.multiplyScalar(0.5);
      if (inRivalLand(world, tile.q, tile.r)) scratch.color.multiply(new THREE.Color(1.12, 0.74, 0.72));
      ref.current.setColorAt(i, scratch.color);
      counts.set(ref, i + 1);
    };
    for (const tile of tiles.slice(0, MAX)) {
      const { x, z } = hexToWorld(tile.q, tile.r, 1);
      const y = TERRAIN[tile.terrain].height + (tile.work ? 0.06 : 0);
      const variant = decorationVariant(tile.q, tile.r);
      if (appearance.snow > 0 && tile.terrain !== "water") {
        const depth = 0.045 * appearance.snow;
        put(snow, tile, x, y + depth / 2 + 0.002, z, appearance.snow, depth, appearance.snow, "#E9F1F4");
      }
      if (tile.building || tile.work || inRivalLand(world, tile.q, tile.r)) continue;
      if (tile.terrain === "forest") {
        const height = 0.55 + variant / 250;
        put(trunks, tile, x, y + 0.18, z, 0.13, 0.36, 0.13, "#73553D");
        put(crowns, tile, x, y + 0.3 + height / 2, z, 0.85, height, 0.85, appearance.leaves);
      }
      if (tile.terrain === "grass" && variant % 3 === 0 && appearance.snow === 0) {
        for (const offset of [-0.25, 0.25]) {
          const autumn = appearance.id === "autumn";
          put(details, tile, x + offset, y + (autumn ? 0.035 : 0.09), z + offset / 2,
            autumn ? 0.27 : 0.12, autumn ? 0.045 : 0.14, autumn ? 0.18 : 0.12, appearance.detail);
        }
      }
    }
    for (const [ref, count] of counts) {
      if (!ref.current) continue;
      ref.current.count = count;
      ref.current.instanceMatrix.needsUpdate = true;
      if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    }
  }, [tiles, world, revision, world.day, scratch, appearance.id, appearance.snow, appearance.leaves, appearance.detail]);
  return <group>
    <instancedMesh ref={trunks} args={[undefined, undefined, MAX]} raycast={noRaycast} frustumCulled={false} castShadow receiveShadow>
      <cylinderGeometry args={[0.5, 0.6, 1, 5]} /><meshStandardMaterial roughness={1} />
    </instancedMesh>
    <instancedMesh ref={crowns} args={[undefined, undefined, MAX]} raycast={noRaycast} frustumCulled={false} castShadow receiveShadow>
      <coneGeometry args={[0.5, 1, 6]} /><meshStandardMaterial roughness={1} flatShading />
    </instancedMesh>
    <instancedMesh ref={details} args={[undefined, undefined, MAX]} raycast={noRaycast} frustumCulled={false}>
      <icosahedronGeometry args={[0.5, 0]} /><meshStandardMaterial roughness={1} />
    </instancedMesh>
    <instancedMesh ref={snow} args={[undefined, undefined, MAX]} raycast={noRaycast} frustumCulled={false} receiveShadow>
      <cylinderGeometry args={[0.95, 0.95, 1, 6]} /><meshStandardMaterial roughness={0.95} />
    </instancedMesh>
  </group>;
}
