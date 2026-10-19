import { useState } from "react";
import { hexToWorld } from "../game/hex.js";
import { TERRAIN } from "../game/terrain.js";
import Building from "./Building.jsx";

/** Distance from a tile centre to one of its corners, in world units. */
export const TILE_SIZE = 1;

/**
 * One hexagonal column.
 *
 * A six-sided cylinder IS a hexagonal prism. Three.js builds it with corners
 * at 30, 90, 150... degrees, which is exactly the pointy-top orientation our
 * coordinates assume — so no rotation is needed here. (Plenty of tutorials
 * rotate by PI/6; that would misalign this layout.)
 */
export default function HexTile({ tile, selected, onSelect }) {
  const [hovered, setHovered] = useState(false);
  const def = TERRAIN[tile.terrain];
  const { x, z } = hexToWorld(tile.q, tile.r, TILE_SIZE);

  // Work in progress lifts the tile slightly, so you can see it from across the board.
  const lift = tile.work ? 0.06 : 0;
  const height = def.height + lift;

  return (
    <group position={[x, 0, z]}>
      <mesh
        position={[0, height / 2, 0]}
        castShadow
        receiveShadow
        onClick={(e) => { e.stopPropagation(); onSelect(tile); }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
      >
        <cylinderGeometry args={[TILE_SIZE * 0.96, TILE_SIZE * 0.96, height, 6]} />
        <meshStandardMaterial
          color={def.color}
          // Brighten the tile's OWN colour rather than washing it with gold,
          // otherwise a selected water tile reads as sand.
          emissive={selected || hovered ? def.color : "#000000"}
          emissiveIntensity={selected ? 0.45 : hovered ? 0.2 : 0}
          roughness={0.85}
          metalness={0.05}
        />
      </mesh>

      {/* Step 3: whatever is built here sits on top of the column. */}
      {tile.building && <Building building={tile.building} y={height} />}

      {/* Selection is shown as a ring sitting on the tile, so the colour stays readable. */}
      {selected && (
        <mesh position={[0, height + 0.015, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[TILE_SIZE * 0.82, 0.045, 8, 6]} />
          <meshStandardMaterial
            color="#D9B25F"
            emissive="#D9B25F"
            emissiveIntensity={0.9}
          />
        </mesh>
      )}

      {tile.work && (
        <mesh position={[0, height + 0.22, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.26, 0.05, 8, 18]} />
          <meshStandardMaterial
            color="#D9B25F"
            emissive="#D9B25F"
            emissiveIntensity={0.5}
          />
        </mesh>
      )}
    </group>
  );
}
