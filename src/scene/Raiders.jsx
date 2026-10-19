import HealthBar from "./HealthBar.jsx";
import { RAIDER_HEALTH } from "../game/rivals.js";
import PersonModel from "./PersonModel.jsx";
/**
 * The rivals, on the board.
 *
 * Drawn as dark red cones so they read as hostile at a glance and cannot be
 * confused with anything else: your people are pale upright capsules, wildlife
 * are spheres, and these are the only sharp shapes that move. On a dark night
 * with the lamps lit, a red cone crossing your fields is the whole point.
 *
 * Windowed like everything else, and animated with the same hook the workers
 * use, interpolated between hourly movement turns.
 */
import { useMemo, useRef } from "react";
import { hexToWorld } from "../game/hex.js";
import { TERRAIN } from "../game/terrain.js";
import { TILE_SIZE } from "./InstancedTiles.jsx";
import { useSmoothMotion } from "./useSmoothMotion.js";

const RAIDER_COLOR = "#A83E3E";
const LOADED_COLOR = "#D96A4A";

export default function Raiders({ world, tiles, revision }) {
  const terrainAt = useMemo(() => {
    const map = new Map();
    for (const t of tiles) map.set(`${t.q},${t.r}`, t.terrain);
    return map;
  }, [tiles]);

  // `revision` for the usual reason: raiders are mutated in place every day,
  // so the array identity is not a signal that anybody moved.
  const visible = useMemo(
    () => [...(world.raiders || []), ...(world.camps || []).filter(c => c.expedition).map(c => ({...c.expedition, id: -c.id, expedition: true}))].filter((x) => terrainAt.has(`${x.q},${x.r}`)),
    [world.raiders, world.camps, terrainAt, revision, world.day]
  );

  const targets = useRef(new Map());
  targets.current = useMemo(() => {
    const map = new Map();
    const perTile = new Map();
    for (const raider of visible) {
      const k = `${raider.q},${raider.r}`;
      const index = perTile.get(k) || 0;
      perTile.set(k, index + 1);
      const { x, z } = hexToWorld(raider.q, raider.r, TILE_SIZE);
      const angle = (index * 2 * Math.PI) / 4;
      const spread = index === 0 ? 0 : 0.34;
      const terrain = terrainAt.get(k);
      map.set(raider.id, {
        x: x + Math.cos(angle) * spread,
        y: (TERRAIN[terrain] ? TERRAIN[terrain].height : 0) + 0.01,
        z: z + Math.sin(angle) * spread,
      });
    }
    return map;
  }, [visible, terrainAt, revision]);

  // Smooth the hourly tile steps while preserving the simulation positions.
  const register = useSmoothMotion(targets, { smooth: 2.5, bob: 0.04, faceTravel: true });

  return (
    <group>
      {visible.map((raider) => {
        // Somebody leaving with your goods is worth picking out of the group.
        const carrying = !!raider.carrying;
        const colour = carrying ? LOADED_COLOR : RAIDER_COLOR;
        return (
          <group key={raider.id} ref={register(raider.id)}>
            <PersonModel person={raider} color={colour} hostile/>
            <HealthBar health={raider.health ?? RAIDER_HEALTH} max={raider.expedition ? raider.people * 100 : RAIDER_HEALTH} height={0.95} hostile/>
          </group>
        );
      })}
    </group>
  );
}
