/**
 * Time of day: where the sun is, and what colour the sky is.
 *
 * TIME OF DAY IS NOT SIMULATION STATE. The day is still the atomic unit of
 * the game — `advanceDay` remains the only thing that changes the world, and
 * nothing in here is saved or ever touches a tile. What this file provides is
 * a continuous value between one day and the next, for lighting and for the
 * clock in the corner. Break that rule and offline progress breaks with it:
 * you cannot replay 120 days of sunlight.
 *
 * Everything is driven by SUN ELEVATION rather than by the clock directly.
 * That is what ties the seasons to the light for nothing: winter has eight
 * hours of daylight, so the sun never climbs high, so winter is permanently
 * low and golden without a single winter-specific colour being written down.
 *
 * All pure functions of numbers, so all of it is testable in Node — which
 * matters, because this is the part of the feature a browser would otherwise
 * be the only way to check.
 */
import { seasonFactors } from "./calendar.js";

export const HOURS_PER_DAY = 24;

/** Colours as [r,g,b] in 0..1, so they interpolate without conversion. */
const rgb = (r, g, b) => [r / 255, g / 255, b / 255];

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
export const mixRgb = (a, b, t) => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

/** Smooth 0->1 ramp between two edges. The workhorse of every blend below. */
export function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export const toHex = (c) =>
  "#" +
  c
    .map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

// --- where the sun is ------------------------------------------------------

/** Sunrise and sunset, in hours, for the season of this day. */
export function sunHours(day) {
  const { daylight } = seasonFactors(day);
  return { sunrise: 12 - daylight / 2, sunset: 12 + daylight / 2, daylight };
}

/**
 * Sun elevation for a time of day, as -1 (deepest night) to 1 (directly
 * overhead at midsummer noon).
 *
 * `t` is the fraction through the day, 0 = midnight, 0.5 = noon.
 *
 * Daytime is half a sine between sunrise and sunset, scaled by how long the
 * day is — so a short winter day peaks lower, not just shorter. Night is the
 * matching curve on the other side.
 */
export function sunElevation(t, day) {
  const hour = (((t % 1) + 1) % 1) * HOURS_PER_DAY;
  const { sunrise, sunset, daylight } = sunHours(day);

  if (hour >= sunrise && hour <= sunset) {
    const through = (hour - sunrise) / (sunset - sunrise);
    // A long summer day lifts the sun higher; a short winter one keeps it low.
    const peak = 0.45 + 0.55 * clamp01((daylight - 7) / 9);
    return Math.sin(through * Math.PI) * peak;
  }

  const nightLength = HOURS_PER_DAY - daylight;
  const sinceSunset = hour > sunset ? hour - sunset : hour + (HOURS_PER_DAY - sunset);
  const through = sinceSunset / nightLength;
  return -Math.sin(through * Math.PI) * 0.9;
}

/**
 * A unit vector pointing at the sun, for positioning the light and the disc.
 * The sun rises in the east (+x) and sets in the west (-x), tilted a little
 * on z so the shadows are not dead flat along one axis.
 */
export function sunDirection(t, day) {
  const hour = (((t % 1) + 1) % 1) * HOURS_PER_DAY;
  const { sunrise, sunset, daylight } = sunHours(day);
  const elevation = sunElevation(t, day);

  // Sweep from east to west across the WHOLE day, not just daylight, so the
  // moon — which is drawn and lit as the anti-sun — travels sensibly too.
  //
  // This used to be `Math.PI * clamp01(through)`, which pinned the azimuth at
  // 0 all night until sunrise and at PI from sunset onwards. The comment above
  // has always said what it was supposed to do; the clamp did the opposite.
  // At midnight `through` crosses from one end of the clamp to the other and
  // the direction FLIPS THROUGH 180 DEGREES in a single frame.
  //
  // That was survivable while the only thing on that side of the sky was a dim
  // disc, and it stopped being survivable the moment the moon became a real
  // light: at midnight, with the moon at full strength, every shadow and every
  // shaded face in the scene swapped sides at once.
  //
  // Daylight runs 0..PI, night carries on PI..2PI, using exactly the same
  // `sinceSunset / nightLength` that `sunElevation` uses, so the two stay in
  // step. Both joins are continuous: sunset reaches PI from either side, and
  // sunrise reaches 2PI, which is 0.
  const nightLength = HOURS_PER_DAY - daylight;
  let azimuth;
  if (hour >= sunrise && hour <= sunset) {
    azimuth = Math.PI * ((hour - sunrise) / (sunset - sunrise));
  } else {
    const sinceSunset = hour > sunset ? hour - sunset : hour + (HOURS_PER_DAY - sunset);
    azimuth = Math.PI + Math.PI * (sinceSunset / nightLength);
  }

  const horizontal = Math.cos(Math.asin(clamp01(Math.abs(elevation))));
  return [
    Math.cos(azimuth) * horizontal,
    elevation,
    Math.sin(azimuth) * horizontal * 0.35 - 0.25,
  ];
}

// --- what it looks like ----------------------------------------------------

/** Named phase, for the clock read-out and for anything that wants to branch. */
export function phaseOf(t, day) {
  const e = sunElevation(t, day);
  const hour = (((t % 1) + 1) % 1) * HOURS_PER_DAY;
  const { sunrise } = sunHours(day);
  const rising = hour >= sunrise - 2 && hour < 12;

  if (e > 0.35) return "day";
  if (e > 0.06) return rising ? "morning" : "afternoon";
  if (e > -0.12) return rising ? "dawn" : "dusk";
  return "night";
}

/** "07:30" */
export function clockString(t) {
  const total = Math.floor((((t % 1) + 1) % 1) * HOURS_PER_DAY * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// --- the moon --------------------------------------------------------------

/**
 * Night used to be one flat, very dark value for ten hours: a key light of
 * 0.11 and an ambient of 0.28, and the key was the SUN, positioned below the
 * horizon and flipped back up so it did not light the world from underneath.
 * That flip was a fudge covering a missing light. This is the missing light.
 *
 * WHY THE MOON HAS NO PHASE CYCLE. It is drawn as the anti-sun — opposite
 * side of the sky, so it rises as the sun sets for free — which means it is
 * geometrically always full, and a phase in the lighting would contradict the
 * disc in the sky. It could be given an orbit of its own, and then a new moon
 * would be a night you cannot see in. This exists precisely so that you can.
 * Every night gets a moon. That is a game decision, not an oversight.
 *
 * Cool moonlight and a brighter sky fill keep unlit terrain readable.
 * Dusk and daylight still use the same continuous elevation-based transitions.
 */
export const MOON_KEY = 0.72;
export const MOON_AMBIENT = 0.25;

/** A cold blue-white. Moonlight is sunlight, but the eye at night is not. */
export const MOON_COLOUR = rgb(188, 205, 230);

/**
 * How much of full night this moment is: 0 while there is still dusk in the
 * sky, 1 in the small hours.
 *
 * Keyed to sun elevation like everything else in this file, which is what
 * makes it continuous across midnight and automatically longer in winter
 * without a single winter-specific number.
 */
export const moonlight = (elevation) => 1 - smoothstep(-0.5, -0.06, elevation);

// Keyframes, each anchored to a sun elevation rather than to a clock time.
const NIGHT = {
  top: rgb(14, 19, 40),
  horizon: rgb(34, 42, 72),
  ground: rgb(10, 13, 26),
  sun: rgb(150, 170, 220),
  // Nearly nothing. The sun is under the world; the moon does this job now.
  sunIntensity: 0.03,
  ambient: rgb(157, 175, 204),
  ambientIntensity: 0.5,
};

const TWILIGHT = {
  top: rgb(38, 48, 96),
  horizon: rgb(190, 108, 92),
  ground: rgb(28, 26, 42),
  sun: rgb(255, 150, 96),
  sunIntensity: 0.5,
  ambient: rgb(140, 130, 170),
  ambientIntensity: 0.45,
};

const GOLDEN = {
  top: rgb(96, 146, 200),
  horizon: rgb(248, 186, 128),
  ground: rgb(70, 68, 72),
  sun: rgb(255, 202, 140),
  sunIntensity: 1.15,
  ambient: rgb(180, 180, 190),
  ambientIntensity: 0.5,
};

const DAY = {
  top: rgb(74, 138, 214),
  horizon: rgb(178, 214, 240),
  ground: rgb(96, 100, 104),
  sun: rgb(255, 248, 232),
  sunIntensity: 1.6,
  ambient: rgb(200, 214, 240),
  ambientIntensity: 0.6,
};

function mixStop(a, b, t) {
  return {
    top: mixRgb(a.top, b.top, t),
    horizon: mixRgb(a.horizon, b.horizon, t),
    ground: mixRgb(a.ground, b.ground, t),
    sun: mixRgb(a.sun, b.sun, t),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
    ambient: mixRgb(a.ambient, b.ambient, t),
    ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, t),
  };
}

/**
 * The whole look of the sky and the lighting, for one moment.
 *
 * Four keyframes blended by sun elevation. Because the input is elevation and
 * not the clock, this is automatically continuous across midnight — there is
 * no seam to get wrong, which a time-keyed version would have.
 */
export function skyAt(t, day) {
  const e = sunElevation(t, day);

  let stop;
  if (e >= 0.35) stop = DAY;
  else if (e >= 0.08) stop = mixStop(GOLDEN, DAY, smoothstep(0.08, 0.35, e));
  else if (e >= -0.06) stop = mixStop(TWILIGHT, GOLDEN, smoothstep(-0.06, 0.08, e));
  else stop = mixStop(NIGHT, TWILIGHT, smoothstep(-0.35, -0.06, e));

  // Winter light is thinner and bluer even at noon.
  const { daylight } = sunHours(day);
  const winteriness = 1 - clamp01((daylight - 7.5) / 8);
  const cool = [0.93, 0.96, 1.06];
  const chill = (c) => [
    c[0] * lerp(1, cool[0], winteriness * 0.6),
    c[1] * lerp(1, cool[1], winteriness * 0.6),
    c[2] * lerp(1, cool[2], winteriness * 0.6),
  ];

  const moon = moonlight(e);

  return {
    elevation: e,
    phase: phaseOf(t, day),
    top: chill(stop.top),
    horizon: chill(stop.horizon),
    ground: stop.ground,
    sunColor: chill(stop.sun),
    // The sun's own light is faded out as it sets rather than being flipped
    // back above the horizon at low intensity. Below the horizon it lights
    // nothing, which is both correct and what lets the moon be a real light
    // instead of a name for the same one.
    sunIntensity: stop.sunIntensity * lerp(1, 0.82, winteriness) * smoothstep(-0.14, -0.02, e),
    ambientColor: chill(stop.ambient),
    ambientIntensity: stop.ambientIntensity + MOON_AMBIENT * moon,
    // The moon: its own light, from its own side of the sky. Zero by dusk, so
    // nothing here can brighten a sunset.
    moonColor: MOON_COLOUR,
    moonIntensity: MOON_KEY * moon,
    moonlight: moon,
    // Fog takes the horizon colour, so the board dissolves into the sky
    // instead of ending at a visible line.
    fog: chill(stop.horizon),
    // How lit the player's own buildings are. Lamps come on at DUSK, while
    // there is still colour in the sky, and not at full dark — that is when
    // real ones come on, and waiting until midnight would leave the worst of
    // the gloom unlit, which is the whole problem this solves.
    lampGlow: 1 - smoothstep(-0.04, 0.16, e),
    starOpacity: 1 - smoothstep(-0.18, 0.02, e),
    sunDiscOpacity: smoothstep(-0.10, 0.02, e),
    moonDiscOpacity: 1 - smoothstep(-0.06, 0.10, e),
  };
}
