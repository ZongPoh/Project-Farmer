import Caravans from "./Caravans.jsx";
import TowerShots from "./TowerShots.jsx";
import SeasonalLandscape from "./SeasonalLandscape.jsx";
import { useRef, useMemo, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import InstancedTiles, { TILE_SIZE } from "./InstancedTiles.jsx";
import Building from "./Building.jsx";
import Animals from "./Animals.jsx";
import Workers from "./Workers.jsx";
import Raiders from "./Raiders.jsx";
import RivalCamp from "./RivalCamp.jsx";
import Markers from "./Markers.jsx";
import Atmosphere from "./Atmosphere.jsx";
import NightLights from "./NightLights.jsx";
import { useVisibleTiles, clampTargetToBoard } from "./useVisibleTiles.js";
import { gridExtent } from "../game/grid.js";
import { hexToWorld } from "../game/hex.js";
import { TERRAIN } from "../game/terrain.js";
import { getTerrain } from "../game/tiles.js";
import { markedHorseIds } from "../game/horses.js";

/**
 * Camera and fog, derived from the board rather than hard-coded.
 *
 * The old numbers were tuned for a 12-unit board; a 400x200 board is 692
 * units across, so anything fixed is wrong at one size or the other.
 *
 * maxDistance is deliberately CAPPED rather than scaled to the board. Letting
 * you zoom out until the whole map is on screen would mean rendering the whole
 * map, which is exactly what the windowing exists to avoid. On a big board you
 * pan; you do not zoom out to orbit. (A minimap is the usual answer to "where
 * am I" — see the note in the README.)
 */
function useCameraSetup(grid) {
  return useMemo(() => {
    const { width, depth } = gridExtent(grid);
    const span = Math.min(Math.max(width, depth), 34); // capped, see above
    const dist = span / 2 / Math.tan((42 * Math.PI) / 180 / 2) * 0.85;
    const start = dist / Math.SQRT2;
    return {
      position: [0, start, start],
      minDistance: 7,
      maxDistance: Math.max(18, dist * 1.7),
    };
  }, [grid.width, grid.height]);
}

/** Holds the camera's look-at point over the board, every frame. */
function ClampTarget({ grid, controlsRef }) {
  useFrame(() => {
    if (controlsRef.current) clampTargetToBoard(grid, controlsRef.current.target);
  });
  return null;
}

/**
 * Everything inside the canvas. Split out because hooks like useFrame and
 * useThree only work inside <Canvas>.
 */
function Scene({ world, revision, selected, onSelect, cam, clockRef, running, secondsPerDay, onHourEnd, focusAt }) {
  const controlsRef = useRef(null);
  const { camera } = useThree();
  useEffect(() => {
    const controls = controlsRef.current;
    if (!focusAt || !controls) return;
    const at = hexToWorld(focusAt.q, focusAt.r, TILE_SIZE);
    const dx = at.x - controls.target.x;
    const dz = at.z - controls.target.z;
    camera.position.x += dx;
    camera.position.z += dz;
    controls.target.set(at.x, 0, at.z);
    controls.update();
  }, [focusAt, camera]);
  const { tiles } = useVisibleTiles(world, controlsRef, revision);

  // How lit the player's buildings should be, 0 by day and 1 at night.
  // Atmosphere writes it from the sun's elevation; NightLights reads it. A ref
  // rather than state because it changes every single frame.
  const nightRef = useRef(0);

  // Buildings and wildlife are drawn only for what is on screen. There are
  // few enough of them that a mesh each is fine — it is the 80,000 ground
  // tiles that had to be instanced, not the dozen sheds.
  //
  // `revision` MUST be in these deps. `tiles` holds LIVE references to stored
  // tile objects, and the array identity does not change when one of those
  // objects is mutated — so a memo keyed on [tiles] alone keeps a tile in
  // `built` after its building has been torn down, and Building.jsx is handed
  // a null. That is a crash, and it is why revision exists: it is the signal
  // that the contents changed even though the container did not.
  const built = useMemo(
    () => tiles.filter((t) => t.building),
    [tiles, revision]
  );
  const working = useMemo(
    () => tiles.filter((t) => t.work),
    [tiles, revision]
  );
  // Horses a catch order has picked out or a worker is chasing, so the player
  // can see which animal the order is about once it wanders off its tile.
  const marked = useMemo(() => {
    const ids = markedHorseIds(world);
    return (world.animals || [])
      .filter((a) => a.species === "horse" && !a.tamed && (a.claimedBy || ids.has(a.id)))
      .map((a) => ({ q: a.q, r: a.r, terrain: getTerrain(world, a.q, a.r) }));
  }, [world, revision]);

  return (
    <>
      {/* Sky, sun, moon, stars, lights and fog — all driven by one clock. */}
      <Atmosphere
        clockRef={clockRef}
        day={world.day}
        hour={world.hour}
        running={running}
        secondsPerDay={secondsPerDay}
        onHourEnd={onHourEnd}
        nightRef={nightRef}
        controlsRef={controlsRef}
      />

      {/* Lamps on everything the player has built, so night is atmospheric
          rather than simply unplayable. */}
      <NightLights built={built} nightRef={nightRef} />

      <InstancedTiles
        tiles={tiles}
        selected={selected}
        onSelect={onSelect}
        day={world.day}
        world={world}
        revision={revision}
      />

      <SeasonalLandscape tiles={tiles} world={world} revision={revision} />

      {built.map((tile) => {
        const { x, z } = hexToWorld(tile.q, tile.r, TILE_SIZE);
        return (
          <group key={`b${tile.q},${tile.r}`} position={[x, 0, z]}>
            <Building world={world} tile={tile} building={tile.building} y={TERRAIN[tile.terrain].height} />
          </group>
        );
      })}

      <Markers selected={selected} working={working} marked={marked} />
      <Animals world={world} tiles={tiles} revision={revision} />
      <Workers world={world} tiles={tiles} revision={revision} />
      <Caravans world={world} tiles={tiles} running={running} />
      <TowerShots world={world} tiles={tiles} running={running} />
      <Raiders world={world} tiles={tiles} revision={revision} />
      <RivalCamp world={world} tiles={tiles} revision={revision} onSelect={onSelect} />

      <OrbitControls
        ref={controlsRef}
        // Panning is essential now: on a board bigger than the screen it is
        // the only way to get anywhere.
        enablePan
        screenSpacePanning={false}
        minDistance={cam.minDistance}
        maxDistance={cam.maxDistance}
        maxPolarAngle={Math.PI / 2.35}
      />
      <ClampTarget grid={world.grid} controlsRef={controlsRef} />
    </>
  );
}

export default function Board({
  world, revision, selected, onSelect, clockRef, running, secondsPerDay, onHourEnd, focusAt,
}) {
  const cam = useCameraSetup(world.grid);

  return (
    <Canvas
      shadows
      // `far` must clear the sky dome (radius 380) or the sky is clipped away.
      camera={{ position: [cam.position[0], cam.position[1], cam.position[2]], fov: 42, far: 900 }}
      onPointerMissed={() => onSelect(null)}
    >
      <Scene
        world={world}
        revision={revision}
        selected={selected}
        onSelect={onSelect}
        cam={cam}
        clockRef={clockRef}
        running={running}
        secondsPerDay={secondsPerDay}
        onHourEnd={onHourEnd}
        focusAt={focusAt}
      />
    </Canvas>
  );
}
