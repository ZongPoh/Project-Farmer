import HealthBar from "./HealthBar.jsx";
import { healthOf } from "../game/danger.js";
import PersonModel from "./PersonModel.jsx";
import AnimalModel from "./AnimalModel.jsx";
/**
 * The people, on the board.
 *
 * People have clothing, faces and equipped tools; mounted riders share their
 * horse’s moving group.
 * Colour says what they are doing: walking, working, mending, or idle.
 *
 * Windowed like everything else: only workers standing on a visible tile are
 * drawn. There are never many of them, so a mesh each is fine.
 */
import { useMemo, useRef } from "react";
import { hexToWorld } from "../game/hex.js";
import { TERRAIN } from "../game/terrain.js";
import { TILE_SIZE } from "./InstancedTiles.jsx";
import { useSmoothMotion } from "./useSmoothMotion.js";

const STATE_COLOR = {
  idle: "#8E9AB8",
  travelling: "#D9B25F",
  travellingToChore: "#C79A6B",
  working: "#E8D58A",
  repairing: "#C79A6B",
  returning: "#8E9AB8",
};

export default function Workers({ world, tiles, revision }) {
  const terrainAt = useMemo(() => {
    const map = new Map();
    for (const t of tiles) map.set(`${t.q},${t.r}`, t.terrain);
    return map;
  }, [tiles]);

  // `revision` for the same reason as everywhere else in the scene: workers
  // are mutated in place, so the array identity is not a signal that anything
  // moved. Without it people would freeze between chunk rebuilds.
  const visible = useMemo(
    () => [...(world.workers || []), ...(world.camps || []).flatMap(c => (c.workers || []).map(w => ({ ...w, villageKind: c.kind })))].filter((w) => w.health > 0 && terrainAt.has(`${w.q},${w.r}`)),
    [world.workers, terrainAt, revision]
  );

  /**
   * Where each worker SHOULD be, recomputed whenever the world changes.
   *
   * The mesh is not placed here — `useSmoothMotion` chases these positions
   * each frame, so a worker walks between tiles instead of teleporting. The
   * simulation still moves them a whole tile at a time; this is only the
   * picture catching up.
   */
  const targets = useRef(new Map());
  targets.current = useMemo(() => {
    const map = new Map();
    // Spread people sharing a tile, and keep them clear of the animals, which
    // take the first slot.
    const perTile = new Map();
    for (const w of visible) {
      const k = `${w.q},${w.r}`;
      const index = perTile.get(k) || 0;
      perTile.set(k, index + 1);

      const { x, z } = hexToWorld(w.q, w.r, TILE_SIZE);
      const angle = Math.PI + index * 2.399963;
      const spread = 0.22 + 0.055 * Math.sqrt(index);
      const terrain = terrainAt.get(k);
      const y = TERRAIN[terrain] ? TERRAIN[terrain].height : 0;
      // Horse and rider share one moving group, keeping the rider in the saddle.

      map.set(w.id, {
        x: x + Math.cos(angle) * spread,
        y,
        z: z + Math.sin(angle) * spread,
      });
    }
    return map;
  }, [visible, terrainAt, revision]);

  // Snappy, because workers move every hour — and a small bob so they read as
  // walking rather than sliding.
  const register = useSmoothMotion(targets, { smooth: 7, bob: 0.035, faceTravel: true });

  return (
    <group>
      {visible.map((w) => {
        const colour = w.campId ? (w.villageKind === "raider" ? "#C4664F" : "#67AD91") : STATE_COLOR[w.state] || STATE_COLOR.idle;
        const horse = world.animals.find(a => a.species === "horse" && a.id === w.horseId && a.riderId === w.id);

        return (
          <group key={w.id} ref={register(w.id)}>
            {horse && <AnimalModel animal={horse}/>}
            <PersonModel person={w} color={colour} mounted={!!horse}/>
            {(healthOf(w) < 100 || w.marching || world.raiders?.length > 0) && <HealthBar health={healthOf(w)} height={horse ? 1.65 : 1.05} />}

            {/* A hungry worker gets a dull red mark, so trouble is visible
                from the camera rather than only in the log. */}
            {w.hungry && (
              <mesh position={[0, 0.85 + (horse ? 0.58 : 0), 0]}>
                <sphereGeometry args={[0.05, 8, 6]} />
                <meshStandardMaterial color="#C4664F" emissive="#C4664F" emissiveIntensity={0.8} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}
