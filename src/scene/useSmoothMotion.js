/**
 * Smoothing the gap between where something IS and where it is DRAWN.
 *
 * The simulation moves in whole tiles and whole hours — that is the rule the
 * whole codebase is built on, and it is not negotiable: `advanceHour` is the
 * only thing that changes the world, and offline catch-up replays it
 * thousands of times. So a worker genuinely does teleport from one tile to
 * the next. What can change is the picture.
 *
 * This is the same trick the sky already uses. `Atmosphere` keeps a fraction
 * between one simulated hour and the next so the sun slides instead of
 * stepping; this keeps a rendered position that chases the simulated one.
 * Neither is state, neither is saved, and neither can affect the game.
 *
 * NO REACT STATE AND NO ALLOCATION PER FRAME. Positions are written straight
 * onto the Object3D inside useFrame. Sixty re-renders a second is exactly
 * what the windowed renderer exists to avoid.
 */
import { useRef, useCallback } from "react";
import { useFrame } from "@react-three/fiber";

/**
 * Exponential smoothing rather than a timed tween.
 *
 * A tween needs to know where the move started, when it started and how long
 * it should take — which means bookkeeping per worker, and a decision about
 * what to do when a second move arrives mid-tween. Chasing the target with
 * `p += (target - p) * k` needs none of that: it handles a one-tile step, a
 * mounted worker covering six in an hour, and a job cancelled halfway, all
 * with the same two lines, and it can never overshoot.
 *
 * `k` is derived from the frame time so the speed is the same at 30fps and
 * 144fps. Do not replace it with a bare `* 0.1`.
 */
const rate = (smooth, delta) => 1 - Math.exp(-smooth * Math.min(delta, 0.1));

export const SNAP_BEYOND = 8;

/**
 * @param targetsRef  a ref holding Map<id, {x, y, z}> — where things should be
 * @param smooth      higher is snappier. ~7 for workers (they move hourly),
 *                    ~3 for animals (daily, so a longer glide reads better).
 * @param bob         how much to bounce while moving. 0 disables it.
 * @returns           a `register(id)` to use as a ref callback on each group
 */
export function useSmoothMotion(targetsRef, { smooth = 7, faceTravel = false, bob = 0 } = {}) {
  const nodes = useRef(new Map());
  const elapsed = useRef(0);

  const register = useCallback(
    (id) => (el) => {
      if (el) nodes.current.set(id, el);
      else nodes.current.delete(id);
    },
    []
  );

  useFrame((_state, delta) => {
    elapsed.current += delta;
    const k = rate(smooth, delta);
    const targets = targetsRef.current;
    if (!targets) return;

    for (const [id, el] of nodes.current) {
      const target = targets.get(id);
      if (!target) continue;

      // First sight of this one: put it where it belongs rather than flying
      // it in from the origin.
      if (!el.userData.placed) {
        el.position.set(target.x, target.y, target.z);
        el.userData.baseY = target.y;
        el.userData.placed = true;
        continue;
      }

      const dx = target.x - el.position.x;
      const dz = target.z - el.position.z;
      const gap = Math.hypot(dx, dz);

      // A long jump is not a walk — it is the camera window having scrolled,
      // or a save being loaded, or somebody being recruited across the map.
      // Sliding for those looks like a bug, so snap.
      if (gap > SNAP_BEYOND) {
        el.position.set(target.x, target.y, target.z);
        el.userData.baseY = target.y;
        continue;
      }

      if (faceTravel && gap > 0.04) {
        const turn = Math.atan2(dx, dz) - el.rotation.y;
        el.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * k;
      }
      el.position.x += dx * k;
      el.position.z += dz * k;

      // Height is tracked separately so the bob can be added on top without
      // the two fighting each other — smoothing a value you also add a sine
      // wave to gives a slow drift upward.
      const baseY = (el.userData.baseY ?? target.y) + (target.y - (el.userData.baseY ?? target.y)) * k;
      el.userData.baseY = baseY;

      const walking = gap > 0.04;
      el.position.y = baseY + (walking && bob
        // Two steps per cycle, so it reads as footfalls rather than floating.
        ? Math.abs(Math.sin(elapsed.current * 9 + id * 1.7)) * bob
        : 0);
    }
  });

  return register;
}
