/**
 * The selection ring and the work-in-progress rings.
 *
 * Kept out of the instanced batch on purpose: there is one selected tile and
 * a handful of jobs, so a mesh each costs nothing, and it means the instanced
 * ground never has to change geometry just because you clicked something.
 */
import { hexToWorld } from "../game/hex.js";
import { TERRAIN } from "../game/terrain.js";
import { TILE_SIZE } from "./InstancedTiles.jsx";

const GOLD = "#D9B25F";

const MARK = "#E07B4F";

export default function Markers({ selected, working, marked = [] }) {
  return (
    <group>
      {selected && (
        <Ring
          tile={selected}
          radius={TILE_SIZE * 0.82}
          thickness={0.045}
          segments={6}
          lift={0.015}
          intensity={0.9}
        />
      )}

      {working.map((tile) => (
        <Ring
          key={`w${tile.q},${tile.r}`}
          tile={tile}
          radius={0.26}
          thickness={0.05}
          segments={18}
          lift={0.28}
          intensity={0.5}
        />
      ))}

      {marked.map((tile, i) => (
        <Ring
          key={`h${i}`}
          tile={tile}
          radius={TILE_SIZE * 0.6}
          thickness={0.04}
          segments={24}
          lift={0.03}
          intensity={1.1}
          color={MARK}
        />
      ))}
    </group>
  );
}

function Ring({ tile, radius, thickness, segments, lift, intensity, color = GOLD }) {
  const { x, z } = hexToWorld(tile.q, tile.r, TILE_SIZE);
  const height = TERRAIN[tile.terrain].height + (tile.work ? 0.06 : 0);

  return (
    <mesh position={[x, height + lift, z]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, thickness, 8, segments]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} />
    </mesh>
  );
}
