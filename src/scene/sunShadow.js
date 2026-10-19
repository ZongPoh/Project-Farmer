/**
 * Where the sun's light stands, and what its shadow covers.
 *
 * Plain JavaScript, no React and no Three.js — the same arrangement as
 * `buildingLook.js`, and for the same reason. This is arithmetic that decides
 * how the scene looks, it got three things wrong at once, and none of it could
 * be tested while it lived inside a `useFrame`. Now it can.
 *
 * THE BUG THIS WAS PULLED OUT FOR. Shadows were reported crawling and fizzing
 * as the sun went down. Three separate faults, all of which surface at exactly
 * that moment:
 *
 * 1. THE GRAZING ANGLE. The light's height was clamped to 0.04 of its radius —
 *    about two and a half units up, against a shadow frustum thirty across. At
 *    that angle the depth range across the board is enormous, the shadow map is
 *    stretched over all of it, and the result is acne that swims about as the
 *    sun moves. `MIN_HEIGHT` is the floor now. The cost is that shadows stop
 *    lengthening over the last dozen degrees of the evening, which is what
 *    `shadowStrength` then covers for by fading them out.
 *
 * 2. THE POP. `castShadow` was switched off the instant the sun crossed the
 *    horizon, while the light still had most of its intensity — shadows
 *    vanished in one frame under a sun that was visibly still lighting things.
 *    Worse, toggling `castShadow` changes the shader program and recompiles
 *    every material in the scene, a stall precisely when somebody is watching
 *    the sunset. It flips when the sun's own light has already reached zero,
 *    where neither the pop nor the stall can be seen.
 *
 * 3. THE FRUSTUM NEVER MOVED. A directional light's shadow camera is centred on
 *    its target, and nothing ever set one, so it sat at the origin for the whole
 *    game. Pan more than thirty units from the middle of the board — nothing at
 *    all on any map but the small one — and shadows stopped existing. It follows
 *    the view now, and both its centre and its span are SNAPPED to a grid,
 *    because a frustum that slides continuously drags the shadow texels with it,
 *    and that is its own kind of crawl.
 *
 * Perfect stability is not on offer: the sun turns all day, so the shadow map's
 * own basis turns with it. What these numbers buy is the removal of the
 * high-frequency fizz, which is the part that reads as broken.
 */

/** How far out along its direction the sun light stands. */
export const SUN_DISTANCE = 60;

/**
 * The lowest the light may sit, as a fraction of `SUN_DISTANCE`.
 *
 * Raise it for steadier shadows, lower it for longer evening ones. Below about
 * 0.1 the projection starts to graze and the fizz comes back; that is the whole
 * of fault 1 above.
 */
export const MIN_HEIGHT = 0.22;

/** Shadow map resolution. 1024 was half the texel density and twice the crawl. */
export const SHADOW_MAP = 2048;

/** World units the frustum centre is quantised to. */
export const CENTRE_SNAP = 2;

/** ...and its half-width, so zooming does not make it creep. */
export const SPAN_SNAP = 8;

// Both are multiples of SPAN_SNAP on purpose. When they were not, clamping
// produced a span that was off its own grid, and whether you got it depended on
// which happened first — the snap or the clamp.
export const MIN_SPAN = 24;
export const MAX_SPAN = 64;

/** Sun elevation at which shadows reach full strength. */
export const SHADOW_FADE_ABOVE = 0.14;

const snapTo = (n, step) => Math.round(n / step) * step;
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Snap to a grid, but STAY PUT unless the value has moved well clear of where
 * it already is.
 *
 * A bare `Math.round` is unstable on a boundary. The camera never sits
 * perfectly still — orbit damping keeps nudging it — so a target at exactly
 * 1.0, or a reach whose eightieth percent lands on 36, would flip between two
 * quantised values on alternate frames. For the frustum span that means
 * rebuilding the shadow projection every frame, and every shadow in the scene
 * flickers. Snapping was supposed to stop the crawl and instead traded it for
 * a strobe.
 *
 * The margin is three-quarters of a step: enough that float noise and damping
 * can never cross it, small enough that a real pan still tracks.
 */
function settle(value, step, current, min, max) {
  const wanted = snapTo(value, step);
  const bounded = min === undefined ? wanted : Math.min(max, Math.max(min, wanted));
  if (current === undefined || current === null) return bounded;
  if (Math.abs(value - current) < step * 0.75) return current;
  return bounded;
}

/**
 * How solid the shadow is, 0..1.
 *
 * Full above `SHADOW_FADE_ABOVE`, dissolving to nothing by the horizon, so the
 * last of the light loses its shadow gradually instead of being switched off.
 * Evening shadows genuinely do go soft, so this reads as weather rather than as
 * a dial being turned.
 */
export const shadowStrength = (elevation) => clamp01(elevation / SHADOW_FADE_ABOVE);

/**
 * Everything the renderer needs to place the sun light for one frame.
 *
 * `dir` is the unit vector from `sunDirection()`. `sunIntensity` is what
 * `skyAt()` gave for the same moment. `centre` is where the camera is looking
 * and `reach` is how far it is from there.
 *
 * Returns absolute positions: `position` and `target` are both offset by the
 * view centre, which leaves the light's DIRECTION untouched — a directional
 * light does not care where it is, only which way it faces — so none of this
 * changes how anything is shaded. The only thing moving is the shadow frustum.
 */
export function shadowPlan(dir, sunIntensity, centre, reach, previous) {
  const cx = settle(centre && centre.x ? centre.x : 0, CENTRE_SNAP, previous && previous.target.x);
  const cz = settle(centre && centre.z ? centre.z : 0, CENTRE_SNAP, previous && previous.target.z);

  const wanted = Math.min(MAX_SPAN, Math.max(MIN_SPAN, (reach || 0) * 0.8));
  const span = settle(wanted, SPAN_SNAP, previous && previous.span, MIN_SPAN, MAX_SPAN);

  return {
    target: { x: cx, y: 0, z: cz },
    position: {
      x: cx + dir[0] * SUN_DISTANCE,
      // Never below the floor, whatever the sun is actually doing.
      y: Math.max(dir[1], MIN_HEIGHT) * SUN_DISTANCE,
      // The nudge on z keeps shadows off dead-square with one axis.
      z: cz + dir[2] * SUN_DISTANCE - 10,
    },
    span,
    // Toggled only where the sun contributes nothing, so the shader recompile
    // lands on a frame in which nothing changes on screen.
    castShadow: sunIntensity > 0.001,
    strength: shadowStrength(dir[1]),
  };
}
