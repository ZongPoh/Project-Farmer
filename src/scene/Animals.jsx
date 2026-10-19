import AnimalModel from "./AnimalModel.jsx";
/**
 * Wildlife on the board. (Step 4)
 *
 * Animals are rendered from `world.animals` — they are NOT part of a tile,
 * which is why they get their own component. Like everything else in the
 * scene they are windowed: only animals standing on a currently visible tile
 * are drawn. On a large board most of the population is somewhere else, and
 * drawing a sphere for each of them would undo the point of the windowing.
 */
import { useMemo, useRef } from "react";
import { hexToWorld } from "../game/hex.js";
import { TERRAIN } from "../game/terrain.js";

import { TILE_SIZE } from "./InstancedTiles.jsx";
import { useSmoothMotion } from "./useSmoothMotion.js";



export default function Animals({ world, tiles, revision }) {
  // A lookup of what is on screen, so the filter below is O(animals) rather
  // than O(animals x tiles).
  const onScreen = useMemo(() => {
    const set = new Set();
    for (const t of tiles) set.add(`${t.q},${t.r}`);
    return set;
  }, [tiles]);

  const terrainAt = useMemo(() => {
    const map = new Map();
    for (const t of tiles) map.set(`${t.q},${t.r}`, t.terrain);
    return map;
  }, [tiles]);

  // `revision` for the same reason as in Board.jsx: taming a horse mutates
  // the animal in place without replacing world.animals, so a memo that does
  // not watch the revision would show it untamed until something else moved.
  const visible = useMemo(
    () => world.animals.filter((a) => onScreen.has(`${a.q},${a.r}`) && !(a.species === "horse" && a.riderId && world.workers?.some(w => w.id === a.riderId && w.horseId === a.id))),
    [world.animals, onScreen, world.day, revision]
  );

  /**
   * Where each animal SHOULD be. The mesh is placed by `useSmoothMotion`,
   * which chases these each frame — see `Workers.jsx` for the reasoning.
   * Animals are spread around a shared tile rather than stacked inside one
   * another.
   */
  const targets = useRef(new Map());
  targets.current = useMemo(() => {
    const map = new Map();
    const perTile = new Map();
    for (const a of visible) {
      const k = `${a.q},${a.r}`;
      const index = perTile.get(k) || 0;
      perTile.set(k, index + 1);

      const { x, z } = hexToWorld(a.q, a.r, TILE_SIZE);
      const angle = (index * 2 * Math.PI) / 6;
      const spread = index === 0 ? 0 : 0.42;
      const terrain = terrainAt.get(k) || "grass";


      map.set(a.id, {
        x: x + Math.cos(angle) * spread,
        y: TERRAIN[terrain].height + 0.02,
        z: z + Math.sin(angle) * spread,
      });
    }
    return map;
  }, [visible, terrainAt, revision]);

  // Slower than the workers on purpose. Animals move once a DAY, so a lazy
  // drift across the tile reads as grazing; at the workers' setting they dart
  // and then stand still for the rest of the day, which looks worse than the
  // teleporting did. The bob is bigger too — four-legged things bound.
  const register = useSmoothMotion(targets, { smooth: 2.5, bob: 0.035, faceTravel: true });

  return (
    <group>
      {visible.map(a => <group key={a.id} ref={register(a.id)}>
        <AnimalModel animal={a}/>
      </group>)}
    </group>
  );
}
