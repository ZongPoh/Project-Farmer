/**
 * The calendar: years, seasons, and what each season does to the world.
 *
 * THE IMPORTANT PROPERTY: a season is a pure function of `world.day`.
 * Nothing is stored, so:
 *   - the save format does not change at all
 *   - offline catch-up crosses seasons correctly for free, because it just
 *     calls advanceDay and the season falls out of the new day number
 *   - a save from before seasons existed loads straight into the right season
 *
 * That is the same trick as worldgen.js: if a thing can be computed from
 * something you already have, do not store it.
 *
 * Day 1 is the first day of spring in year 1.
 */

export const DAYS_PER_SEASON = 24;
export const SEASON_IDS = ["spring", "summer", "autumn", "winter"];
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASON_IDS.length; // 96

/**
 * What each season does. Data, like TERRAIN and BUILDINGS — to retune the
 * year you edit numbers here and nothing else changes.
 *
 *   growth     multiplies what farms yield
 *   decay      multiplies how fast buildings wear out
 *   graze      multiplies the energy an animal gets from grass
 *   breeding   how readily animals breed (LOW is harder — it divides into
 *              the energy threshold, so 0.5 means twice the energy needed)
 *   wildlife   multiplies the chance new animals wander in
 *   daylight   hours between sunrise and sunset, which drives the lighting
 *   tint       how terrain colour shifts, as a multiplier per channel
 */
export const SEASONS = {
  spring: {
    label: "Spring",
    growth: 1.15,
    decay: 0.9,
    graze: 1.1,
    breeding: 1.35,
    wildlife: 1.3,
    daylight: 12.5,
    tint: { forest: [1.02, 1.14, 0.90], grass: [1.05, 1.12, 0.92], sand: [1.0, 1.0, 1.0], water: [1.0, 1.02, 1.02], mountain: [1, 1, 1] },
  },
  summer: {
    label: "Summer",
    growth: 1.3,
    decay: 1.0,
    graze: 1.15,
    breeding: 1.2,
    wildlife: 1.15,
    daylight: 15.5,
    tint: { forest: [0.92, 1.05, 0.80], grass: [0.94, 1.06, 0.78], sand: [1.06, 1.03, 0.95], water: [1.0, 1.04, 1.06], mountain: [1.02, 1.02, 1] },
  },
  autumn: {
    label: "Autumn",
    growth: 0.95,
    decay: 1.1,
    graze: 0.95,
    breeding: 0.85,
    wildlife: 0.9,
    daylight: 11.0,
    tint: { forest: [1.30, 0.92, 0.58], grass: [1.18, 0.98, 0.68], sand: [1.05, 0.98, 0.88], water: [0.96, 0.98, 1.0], mountain: [1, 0.99, 0.98] },
  },
  winter: {
    label: "Winter",
    // Winter is meant to be lean, not lethal. These numbers were tuned
    // against test/seasons.test.mjs, which runs several simulated years and
    // fails if a winter wipes out the rabbits — see the note there.
    growth: 0.35,
    decay: 1.35,
    graze: 0.85,
    breeding: 0.55,
    wildlife: 0.45,
    daylight: 8.0,
    tint: { forest: [0.82, 0.88, 0.90], grass: [0.9, 0.95, 0.95], sand: [0.95, 0.96, 1.0], water: [0.92, 0.96, 1.06], mountain: [1.04, 1.05, 1.08] },
  },
};

// --- reading the calendar --------------------------------------------------

/**
 * DAYS ARE 1-BASED, and everything below assumes it.
 *
 * Day 0 used to fall straight through: `seasonIndex(0)` is -1, so there is no
 * season, so `daylight` is undefined, so `sunHours` is NaN, so every colour,
 * light intensity and lamp value coming out of `daytime.js` is NaN and the
 * screen goes black. Nothing in the game reaches it — worlds start on day 1 —
 * but a test written against day 0 found it, and a save from a future version,
 * a fresh `{}` world or an off-by-one anywhere would find it again.
 *
 * One clamp at the entrance is cheaper than a guard in every consumer.
 */
const asDay = (day) => (Number.isFinite(day) && day >= 1 ? Math.floor(day) : 1);

/** 1-based day within the year. Day 1 and day 97 both give 1. */
export const dayOfYear = (day) => ((asDay(day) - 1) % DAYS_PER_YEAR) + 1;

/** 1-based year. Day 1 is year 1. */
export const yearOf = (day) => Math.floor((asDay(day) - 1) / DAYS_PER_YEAR) + 1;

/** 0 = spring, 3 = winter. */
export const seasonIndex = (day) => Math.floor((dayOfYear(day) - 1) / DAYS_PER_SEASON);

export const seasonIdOf = (day) => SEASON_IDS[seasonIndex(day)];

/** 1-based day within the season. */
export const dayOfSeason = (day) => ((asDay(day) - 1) % DAYS_PER_SEASON) + 1;

/** How far through the season we are, 0 at the first day, approaching 1. */
export const seasonProgress = (day) => (dayOfSeason(day) - 1) / DAYS_PER_SEASON;

/** Everything about the current date, in one object. */
export function seasonOf(day) {
  const id = seasonIdOf(day);
  return {
    id,
    ...SEASONS[id],
    index: seasonIndex(day),
    year: yearOf(day),
    dayOfYear: dayOfYear(day),
    dayOfSeason: dayOfSeason(day),
    progress: seasonProgress(day),
    next: SEASON_IDS[(seasonIndex(day) + 1) % SEASON_IDS.length],
    daysLeft: DAYS_PER_SEASON - dayOfSeason(day) + 1,
  };
}

/** "Summer, day 6 of year 2" */
export function describeDate(day) {
  const s = seasonOf(day);
  return `${s.label}, day ${s.dayOfSeason} of year ${s.year}`;
}

// --- blending between seasons ----------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * A season's numbers, eased into the next one over the last quarter of the
 * season.
 *
 * Without this the world snaps: on one day farms yield 1.3x and the next 0.35x,
 * which reads as a bug rather than as autumn. Blending only the tail end keeps
 * most of the season feeling like itself.
 */
export function seasonFactors(day) {
  const s = seasonOf(day);
  const next = SEASONS[s.next];
  const BLEND_FROM = 0.75;
  if (s.progress < BLEND_FROM) return { ...s };

  const t = (s.progress - BLEND_FROM) / (1 - BLEND_FROM);
  return {
    ...s,
    growth: lerp(s.growth, next.growth, t),
    decay: lerp(s.decay, next.decay, t),
    graze: lerp(s.graze, next.graze, t),
    breeding: lerp(s.breeding, next.breeding, t),
    wildlife: lerp(s.wildlife, next.wildlife, t),
    daylight: lerp(s.daylight, next.daylight, t),
    blendingInto: s.next,
    blend: t,
  };
}

// --- terrain colour --------------------------------------------------------

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

const rgbToHex = (rgb) =>
  "#" + rgb.map((c) => clamp255(c).toString(16).padStart(2, "0")).join("").toUpperCase();

/**
 * A terrain's colour for a given day: the base colour, tinted by the season
 * and eased into the next season's tint alongside everything else.
 *
 * Returns a hex string so it drops straight into the existing TERRAIN colours
 * and into THREE.Color.
 */
export function seasonalColor(baseHex, terrainId, day) {
  const s = seasonOf(day);
  const here = SEASONS[s.id].tint[terrainId] || [1, 1, 1];
  const there = SEASONS[s.next].tint[terrainId] || [1, 1, 1];

  const BLEND_FROM = 0.75;
  const t = s.progress < BLEND_FROM ? 0 : (s.progress - BLEND_FROM) / (1 - BLEND_FROM);
  const mul = here.map((v, i) => lerp(v, there[i], t));

  return rgbToHex(hexToRgb(baseHex).map((c, i) => c * mul[i]));
}

export { lerp };
