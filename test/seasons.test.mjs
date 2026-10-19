import { placeFinished as place } from "./support.mjs";
/**
 * The calendar, the seasons, and the sun.
 *
 * Two things are being protected here.
 *
 * 1. A season is a PURE FUNCTION OF world.day. Nothing is stored. If that
 *    ever stops being true, saves and offline catch-up quietly break, so
 *    several tests below check it directly.
 *
 * 2. Winter is meant to be lean, not lethal. Seasonal pressure on breeding,
 *    grazing and spawning is exactly the sort of change that looks harmless
 *    and empties the map two simulated years later — which is the failure
 *    DESIGN.md warns about, now with a seasonal cycle on top of it. So the
 *    ecosystem is run across multiple years, not just a few hundred days.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seasonOf, seasonIdOf, seasonFactors, seasonalColor, describeDate,
  dayOfYear, yearOf, dayOfSeason, SEASONS, SEASON_IDS,
  DAYS_PER_SEASON, DAYS_PER_YEAR,
} from "../src/game/calendar.js";
import {
  sunElevation, sunHours, skyAt, phaseOf, clockString, sunDirection, smoothstep,
  moonlight, MOON_KEY, MOON_AMBIENT,
} from "../src/game/daytime.js";
import { createWorld, serialize, deserialize, allTiles } from "../src/game/world.js";
import { advanceDay, advanceDays } from "../src/game/tick.js";

import { populationOf, capacityFor } from "../src/game/animals.js";
import { TERRAIN } from "../src/game/terrain.js";

// --- the calendar ----------------------------------------------------------

test("the year runs spring, summer, autumn, winter and repeats", () => {
  assert.equal(seasonIdOf(1), "spring");
  assert.equal(seasonIdOf(DAYS_PER_SEASON), "spring");
  assert.equal(seasonIdOf(DAYS_PER_SEASON + 1), "summer");
  assert.equal(seasonIdOf(DAYS_PER_SEASON * 2 + 1), "autumn");
  assert.equal(seasonIdOf(DAYS_PER_SEASON * 3 + 1), "winter");
  assert.equal(seasonIdOf(DAYS_PER_YEAR), "winter");
  assert.equal(seasonIdOf(DAYS_PER_YEAR + 1), "spring", "the year should roll over");
});

test("years and day-of-season count from one", () => {
  assert.equal(yearOf(1), 1);
  assert.equal(dayOfYear(1), 1);
  assert.equal(dayOfSeason(1), 1);

  assert.equal(yearOf(DAYS_PER_YEAR), 1);
  assert.equal(yearOf(DAYS_PER_YEAR + 1), 2);
  assert.equal(dayOfYear(DAYS_PER_YEAR + 1), 1);
  assert.equal(dayOfSeason(DAYS_PER_SEASON + 1), 1);

  assert.match(describeDate(1), /Spring, day 1 of year 1/);
  assert.match(describeDate(DAYS_PER_YEAR + 1), /Spring, day 1 of year 2/);
});

test("every day of several years lands in exactly one valid season", () => {
  for (let day = 1; day <= DAYS_PER_YEAR * 3; day++) {
    const s = seasonOf(day);
    assert.ok(SEASON_IDS.includes(s.id), `day ${day} gave "${s.id}"`);
    assert.ok(s.dayOfSeason >= 1 && s.dayOfSeason <= DAYS_PER_SEASON);
    assert.ok(s.daysLeft >= 1 && s.daysLeft <= DAYS_PER_SEASON);
  }
});

test("the season is derived, so it is never stored and never saved", () => {
  const world = createWorld(2);
  advanceDays(world, 30);

  const save = JSON.parse(JSON.stringify(serialize(world)));
  assert.equal(save.season, undefined, "the season must not be in the save");
  assert.equal(save.timeOfDay, undefined, "time of day must not be in the save either");

  // And it comes back right purely from the day number.
  const back = deserialize(save);
  assert.equal(seasonIdOf(back.day), seasonIdOf(world.day));
});

test("a save from before seasons existed lands in the right season anyway", () => {
  // No season field, just a day. This is the payoff for deriving it.
  const old = { version: 2, seed: 1, grid: { width: 24, height: 16 }, day: 50, modified: [] };
  const world = deserialize(old);
  assert.equal(seasonIdOf(world.day), "autumn");
  assert.equal(yearOf(world.day), 1);
});

test("seasons blend at the edges instead of snapping", () => {
  const lastOfSummer = DAYS_PER_SEASON * 2;
  const midSummer = DAYS_PER_SEASON + 12;

  const mid = seasonFactors(midSummer);
  const late = seasonFactors(lastOfSummer);
  assert.equal(mid.growth, SEASONS.summer.growth, "mid-season is unblended");
  assert.ok(
    late.growth < mid.growth,
    `late summer should be easing toward autumn: ${late.growth} vs ${mid.growth}`
  );
  assert.ok(late.growth > SEASONS.autumn.growth, "but not all the way there yet");
});

test("terrain takes on the season's colour", () => {
  const base = TERRAIN.grass.color;
  const colours = [1, 25, 49, 73].map((d) => seasonalColor(base, "grass", d));
  for (const c of colours) assert.match(c, /^#[0-9A-F]{6}$/, `bad colour ${c}`);
  assert.equal(new Set(colours).size, 4, "each season should look different");

  // Autumn grass should be warmer than summer grass: more red, less blue.
  const red = (c) => parseInt(c.slice(1, 3), 16);
  const blue = (c) => parseInt(c.slice(5, 7), 16);
  assert.ok(red(colours[2]) > red(colours[1]), "autumn should be redder than summer");
  assert.ok(blue(colours[2]) < blue(colours[3]), "winter should be bluer than autumn");
});

// --- the sun ---------------------------------------------------------------

test("winter days are short and the sun stays low; summer is the reverse", () => {
  const winter = sunHours(DAYS_PER_SEASON * 3 + 1);
  const summer = sunHours(DAYS_PER_SEASON + 1);
  assert.ok(winter.daylight < summer.daylight, "winter should have fewer daylight hours");
  assert.ok(winter.sunrise > summer.sunrise, "the winter sun should rise later");
  assert.ok(winter.sunset < summer.sunset, "and set earlier");

  const noon = 0.5;
  assert.ok(
    sunElevation(noon, DAYS_PER_SEASON * 3 + 1) < sunElevation(noon, DAYS_PER_SEASON + 1),
    "the winter sun should never climb as high as the summer sun"
  );
});

test("the sun is up between sunrise and sunset, and down otherwise", () => {
  for (const day of [1, 25, 49, 73]) {
    const { sunrise, sunset } = sunHours(day);
    const at = (hour) => sunElevation(hour / 24, day);

    assert.ok(at(sunrise + 0.5) > 0, `day ${day}: sun should be up just after sunrise`);
    assert.ok(at(sunset - 0.5) > 0, `day ${day}: still up just before sunset`);
    assert.ok(at(sunrise - 1) < 0, `day ${day}: down before sunrise`);
    assert.ok(at(sunset + 1) < 0, `day ${day}: down after sunset`);
    assert.ok(at(0) < 0, `day ${day}: midnight must be dark`);
  }
});

test("noon is the brightest moment of any day", () => {
  for (const day of [1, 25, 49, 73]) {
    const noon = sunElevation(0.5, day);
    for (let i = 0; i < 48; i++) {
      const t = i / 48;
      assert.ok(
        sunElevation(t, day) <= noon + 1e-9,
        `day ${day}: ${clockString(t)} was brighter than noon`
      );
    }
  }
});

test("the sky is continuous across midnight — no seam", () => {
  // A palette keyed to clock time would jump here. Keying it to sun elevation
  // means there is nothing to get wrong, and this proves it.
  for (const day of [1, 25, 49, 73]) {
    const before = skyAt(0.9999, day);
    const after = skyAt(0.0001, day);
    for (const ch of [0, 1, 2]) {
      assert.ok(
        Math.abs(before.top[ch] - after.top[ch]) < 0.02,
        `day ${day}: sky jumped at midnight on channel ${ch}`
      );
    }
    assert.ok(Math.abs(before.sunIntensity - after.sunIntensity) < 0.05);
  }
});

test("the sky changes smoothly all day — no jumps between keyframes", () => {
  const day = 1;
  let previous = skyAt(0, day);
  for (let i = 1; i <= 480; i++) {
    const now = skyAt(i / 480, day);
    for (const ch of [0, 1, 2]) {
      assert.ok(
        Math.abs(now.horizon[ch] - previous.horizon[ch]) < 0.06,
        `jump at ${clockString(i / 480)} on channel ${ch}`
      );
    }
    previous = now;
  }
});

// --- moonlight -------------------------------------------------------------
//
// These exist because of this project's recurring failure mode: a system that
// runs, throws nothing, and has no effect. A moonlight that is added to the
// scene but never reaches the ground would look exactly like working code, and
// the only symptom would be a player saying night is still too dark.

/** Everything lighting the world at one moment, as the renderer sees it. */
const litBy = (t, day) => {
  const s = skyAt(t, day);
  return s.sunIntensity + s.moonIntensity + s.ambientIntensity;
};

test("the moon actually lights the ground", () => {
  // The number that matters. Night sat flat at 0.39 for ten hours before this,
  // which is the complaint it was written for.
  const midnight = litBy(0, 13);
  assert.ok(
    midnight > 0.8,
    `midnight is lit by ${midnight.toFixed(2)} — the moon is not reaching the ground`
  );

  // And it is the MOON doing it, not a raised ambient pretending to be one.
  const sky = skyAt(0, 13);
  assert.ok(
    sky.moonIntensity > 0.3,
    `moon key light is ${sky.moonIntensity.toFixed(2)} — something else is doing the work`
  );
  assert.equal(sky.moonlight, 1, "the small hours should be full night");
});

test("night is lighter than it was, but still night", () => {
  const midnight = litBy(0, 13);
  const noon = litBy(0.5, 13);
  assert.ok(midnight < noon * 0.75, `night at ${midnight.toFixed(2)} is no longer dark`);
  assert.ok(midnight > 1.1, `night at ${midnight.toFixed(2)} is still too dark`);
});

test("the moon brightens nothing but night", () => {
  // A moon that leaked into dusk would wash out the one part of the day the
  // whole elevation-keyed palette exists to get right.
  for (const hour of [12, 14, 16, 17.5]) {
    const sky = skyAt(hour / 24, 13);
    assert.equal(
      sky.moonIntensity, 0,
      `the moon is contributing ${sky.moonIntensity.toFixed(2)} at ${clockString(hour / 24)}`
    );
  }
  assert.equal(moonlight(0.5), 0, "a moon at noon");
  assert.equal(moonlight(-1), 1, "no moon at the darkest hour");
});

test("the sun lights nothing from below the horizon", () => {
  // It used to: the light was flipped back above the horizon and left dim,
  // which is the fudge the moon replaced. Anything above zero here means the
  // world is being lit by a sun that has set.
  for (const hour of [20, 22, 0, 2, 4]) {
    const sky = skyAt(hour / 24, 13);
    assert.ok(sky.elevation < 0, `sanity: the sun should be down at ${hour}:00`);
    assert.equal(
      sky.sunIntensity, 0,
      `the set sun is still lighting the world at ${hour}:00`
    );
  }
});

test("moonlight arrives and leaves smoothly", () => {
  // Same reasoning as the sky-colour smoothness test above: a step in the key
  // light is a visible flicker, and elevation-keyed ramps are only continuous
  // if nobody puts a branch in one.
  //
  // Sampled once a game-minute, which is far coarser than the renderer, which
  // reads this every frame. A brighter moon must still fade gradually.
  const SAMPLES = 24 * 60;
  let previous = skyAt(0, 13);
  for (let i = 1; i <= SAMPLES; i++) {
    const now = skyAt(i / SAMPLES, 13);
    assert.ok(
      Math.abs(now.moonIntensity - previous.moonIntensity) < 0.015,
      `moonlight jumped at ${clockString(i / SAMPLES)}`
    );
    previous = now;
  }
});

test("a long winter night is moonlit for longer than a short summer one", () => {
  // Free, and the reason everything in daytime.js is keyed to sun elevation
  // rather than to the clock: nothing winter-specific is written down anywhere.
  const fullyMoonlit = (day) => {
    let hours = 0;
    for (let i = 0; i < 24 * 4; i++) if (skyAt(i / (24 * 4), day).moonlight > 0.99) hours += 0.25;
    return hours;
  };
  const summer = fullyMoonlit(DAYS_PER_SEASON + 12);
  const winter = fullyMoonlit(DAYS_PER_SEASON * 3 + 12);
  assert.ok(
    winter > summer + 1,
    `winter is moonlit for ${winter}h and summer for ${summer}h — the seasons are not reaching the moon`
  );
});

test("the moon's contribution is the constants, not a coincidence", () => {
  // Tuning these is the whole interface for "night is too dark" / "too bright",
  // so they had better be what actually reaches the scene.
  const sky = skyAt(0, 13);
  assert.equal(sky.moonIntensity, MOON_KEY, "MOON_KEY is not the dial it claims to be");
  const noMoon = skyAt(0.5, 13);
  assert.ok(
    sky.ambientIntensity - noMoon.ambientIntensity > MOON_AMBIENT - 0.31,
    "MOON_AMBIENT is not reaching the ambient light"
  );
});

test("the sun's direction sweeps all the way round without flipping", () => {
  // THE BUG THIS WAS WRITTEN FOR. The azimuth was `PI * clamp01(through)`,
  // which pinned it at 0 all night until sunrise and at PI from sunset onward.
  // At midnight `through` crosses from one end of the clamp to the other and
  // the direction flipped through 180 degrees in one frame.
  //
  // It was survivable while the far side of the sky held nothing but a dim
  // disc. It stopped being survivable the moment the moon became a real light:
  // at midnight, at full strength, every shaded face in the scene swapped
  // sides at once. The symptom reported was "the shadows seem to be jittering".
  //
  // Sampled once a game-minute, in every season, because the night is longest
  // in winter and that is where the join is under the most strain.
  const SAMPLES = 24 * 60;
  for (const day of [1, 13, 25, 37, 49, 61, 73, 85]) {
    let previous = sunDirection(0, day);
    for (let i = 1; i <= SAMPLES; i++) {
      const now = sunDirection(i / SAMPLES, day);
      const moved = Math.hypot(
        now[0] - previous[0], now[1] - previous[1], now[2] - previous[2]
      );
      assert.ok(
        moved < 0.05,
        `day ${day}: the sun swung ${moved.toFixed(3)} at ` +
        `${clockString(i / SAMPLES)} — that is a flip, not a sweep`
      );
      previous = now;
    }
  }
});

test("the sun crosses the whole sky, east to west and back under", () => {
  // The other half of the claim: continuity is easy to get by never moving.
  const day = 13;
  const xs = [];
  for (let i = 0; i < 48; i++) xs.push(sunDirection(i / 48, day)[0]);
  assert.ok(Math.max(...xs) > 0.8, "the sun never reached the eastern sky");
  assert.ok(Math.min(...xs) < -0.8, "the sun never reached the western sky");

  // At noon it is overhead, at midnight it is directly underneath — so both
  // are near zero on the horizontal, and the moon is overhead at midnight.
  assert.ok(Math.abs(sunDirection(0.5, day)[0]) < 0.2, "the sun should be high at noon");
  assert.ok(Math.abs(sunDirection(0, day)[0]) < 0.2, "the sun should be under us at midnight");
  assert.ok(sunDirection(0, day)[1] < -0.8, "...and a long way down");
});

test("stars come out at night and are gone by day", () => {
  const day = 1;
  assert.equal(skyAt(0, day).starOpacity, 1, "midnight should be full of stars");
  assert.equal(skyAt(0.5, day).starOpacity, 0, "noon should have none");
  assert.ok(skyAt(0.5, day).sunDiscOpacity > 0.9, "the sun should be visible at noon");
  assert.ok(skyAt(0, day).moonDiscOpacity > 0.9, "the moon should be out at midnight");
});

test("phases and the clock read sensibly", () => {
  assert.equal(phaseOf(0, 1), "night");
  assert.equal(phaseOf(0.5, 1), "day");
  assert.equal(clockString(0), "00:00");
  assert.equal(clockString(0.5), "12:00");
  assert.equal(clockString(0.25), "06:00");
  assert.equal(clockString(1), "00:00", "a full turn wraps back to midnight");
  assert.equal(clockString(-0.25), "18:00", "and negative times wrap too");
});

test("the sun direction is a sensible unit-ish vector that tracks elevation", () => {
  for (const day of [1, 73]) {
    for (let i = 0; i < 24; i++) {
      const t = i / 24;
      const [x, y, z] = sunDirection(t, day);
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `NaN at hour ${i}`);
      assert.ok(Math.abs(y - sunElevation(t, day)) < 1e-9, "y must be the elevation");
    }
  }
  // East in the morning, west in the afternoon.
  assert.ok(sunDirection(0.3, 1)[0] > 0, "the morning sun should be to the east");
  assert.ok(sunDirection(0.7, 1)[0] < 0, "and the afternoon sun to the west");
});

test("smoothstep behaves", () => {
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
});

// --- seasons in the simulation ---------------------------------------------

function farmWorld(seed = 1, farms = 3) {
  const world = createWorld(seed);
  const grass = [];
  for (const t of allTiles(world)) {
    if (t.terrain === "grass") grass.push(t);
    if (grass.length > farms + 2) break;
  }
  place(world, grass[0].q, grass[0].r, "base");
  world.store.wood = 400;
  for (const t of grass.slice(1, farms + 1)) place(world, t.q, t.r, "farm");
  return world;
}

test("a farm yields less in winter than in summer", () => {
  const measure = (startDay) => {
    const world = farmWorld(1, 3);
    world.day = startDay;
    world.store.food = 500; // plenty, so hunger never suppresses production
    world.animals = [];     // and no rabbits eating the difference
    const before = world.store.food;
    advanceDays(world, DAYS_PER_SEASON - 6);
    return world.store.food - before;
  };

  const summer = measure(DAYS_PER_SEASON + 1);
  const winter = measure(DAYS_PER_SEASON * 3 + 1);
  assert.ok(winter < summer, `winter ${winter} should be under summer ${summer}`);
  assert.ok(winter > 0 || summer > 0, "something should have been produced");
});

test("buildings wear out faster in winter", () => {
  // Measured on a FENCE, not a farm. Emptying world.animals does not keep the
  // map empty — stepAnimals spawns more, and it spawns more of them in summer
  // than in winter, so a farm's condition is dominated by how many rabbits
  // chewed it rather than by the weather. Only farms get raided, so a fence
  // isolates decay properly.
  const wear = (startDay) => {
    const world = farmWorld(1, 1);
    world.day = startDay;
    world.store.food = 500;
    world.autoRepair = false; // or somebody mends it while we are measuring

    const spot = [...allTiles(world)].find(
      (t) => t.terrain === "grass" && !t.building && !t.work
    );
    place(world, spot.q, spot.r, "fence");

    advanceDays(world, 10);
    const fence = [...world.modified.values()].find(
      (t) => t.building && t.building.id === "fence"
    );
    return 100 - fence.building.condition;
  };

  const winter = wear(DAYS_PER_SEASON * 3 + 1);
  const summer = wear(DAYS_PER_SEASON + 1);
  assert.ok(winter > summer, `winter ${winter} should exceed summer ${summer}`);
});

test("a well-run farm survives a winter without starving", () => {
  // The point of the growth multiplier is to make winter a squeeze the player
  // has to plan for, not an unavoidable game over.
  const world = farmWorld(1, 4);
  advanceDays(world, DAYS_PER_SEASON * 3); // through to the start of winter
  const goingIn = world.store.food;
  assert.ok(goingIn > 0, `should have banked food by winter, had ${goingIn}`);

  advanceDays(world, DAYS_PER_SEASON);
  assert.equal(seasonIdOf(world.day), "spring", "should be out the other side");
  assert.ok(world.store.food >= 0, "food must never go negative");
});

test("the ecosystem survives several winters, not just a few hundred days", () => {
  // THE regression test for this feature. Seasonal pressure on breeding and
  // grazing is exactly the kind of change that looks fine for one year and
  // empties the map by the third.
  const YEARS = 3;
  for (const seed of [1, 7, 42, 1234]) {
    const world = createWorld(seed);
    const rabbits = [];
    const winterRabbits = [];

    for (let d = 0; d < DAYS_PER_YEAR * YEARS; d++) {
      advanceDay(world);
      const n = populationOf(world, "rabbit");
      rabbits.push(n);
      if (d > 40 && seasonIdOf(world.day) === "winter") winterRabbits.push(n);
    }

    const settled = rabbits.slice(60);
    assert.ok(
      Math.min(...settled) > 0,
      `seed ${seed}: rabbits hit zero within ${YEARS} years`
    );
    assert.ok(
      Math.min(...winterRabbits) > 0,
      `seed ${seed}: a winter wiped out the rabbits`
    );
    assert.ok(
      Math.max(...settled) <= capacityFor(world, "rabbit"),
      `seed ${seed}: population exceeded capacity`
    );
  }
});

test("populations move with the seasons rather than sitting flat", () => {
  // If the seasonal modifiers were not reaching the animals at all, every
  // season would look identical. This catches them being silently ignored.
  const world = createWorld(1);
  const bySeason = { spring: [], summer: [], autumn: [], winter: [] };
  for (let d = 0; d < DAYS_PER_YEAR * 3; d++) {
    advanceDay(world);
    if (d > 100) bySeason[seasonIdOf(world.day)].push(populationOf(world, "rabbit"));
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const springMean = mean(bySeason.spring);
  const winterMean = mean(bySeason.winter);
  assert.ok(
    Math.abs(springMean - winterMean) > 1,
    `seasons should move the population: spring ${springMean.toFixed(1)} vs winter ${winterMean.toFixed(1)}`
  );
});

test("time of day never touches the world", () => {
  // Lighting is a view, not state. Asking for the sky a thousand times must
  // not advance the day or change a single tile.
  const world = createWorld(1);
  advanceDays(world, 10);
  const before = JSON.stringify(serialize(world));

  for (let i = 0; i <= 1000; i++) {
    skyAt(i / 1000, world.day);
    sunDirection(i / 1000, world.day);
    phaseOf(i / 1000, world.day);
  }

  assert.equal(JSON.stringify(serialize(world)), before, "reading the sky changed the world");
});
