/**
 * The clock the SUN runs on, as opposed to the one the world runs on.
 *
 * Plain JavaScript, no React and no Three.js — the same arrangement as
 * `buildingLook.js` and `sunShadow.js`, and for the same reason: this decides
 * what the screen does sixty times a second and it was wrong for months, and
 * nothing could see it while it lived inside a `useFrame`.
 *
 * THE BUG THIS WAS PULLED OUT FOR — reported as "flickering". The time of day
 * used to be assembled out of two halves that did not belong to each other:
 *
 *     const t = ((hour || 0) + Math.min(clock.frac || 0, 0.999)) / 24;
 *
 * `clock.frac` is a ref, reset to ~0 the instant it fills. `hour` is a React
 * PROP, and it only arrives on the next render. So on the frame the hour ticks
 * over, `frac` has already gone back to zero while `hour` is still the old one,
 * and `t` jumps BACKWARD by very nearly a whole hour — then forward again once
 * React catches up.
 *
 * Every game hour. Measured at 79 backward jumps in twenty seconds on Fast, of
 * up to 0.93 of an hour each. The sun, every shadow in the scene, the lamps and
 * the clock read-out all snapped back and forth together.
 *
 * THE FIX is that the visual clock keeps its OWN hour and advances it itself,
 * so it never depends on React having caught up. It still has to follow the
 * simulation — the player can press "+1 hour", load a save, or come back to a
 * hundred days of offline catch-up — and the trick there is to compare the
 * incoming hour against WHAT WE EXPECTED IT TO BE rather than against what we
 * are showing. A change we caused ourselves is already accounted for; a change
 * we did not cause is a real jump and we adopt it.
 *
 * `advanceHour` remains the only thing that changes the world. Nothing in here
 * is saved, and none of it is simulation state — it is the same rule the rest
 * of `daytime.js` follows, which is what keeps offline catch-up honest.
 */

export const HOURS_PER_DAY = 24;

/**
 * Absolute hours since the beginning, which is what makes the reconciliation
 * below decidable.
 *
 * A bare 0..23 hour cannot tell "the render carrying my own tick has not landed
 * yet" apart from "the world jumped" — both show up as a mismatch, and the
 * first version of this snapped backwards on every one of them whenever React
 * took more than a single frame. Day and hour arrive in the same React batch,
 * so they are always consistent with each other, and together they count.
 */
export const absHour = (day, hour) => (day | 0) * HOURS_PER_DAY + (hour | 0);

/** A fresh clock, sitting wherever the simulation is. */
export function makeVisualClock(day = 1, hour = 0) {
  return {
    day: day | 0,
    hour: hour | 0,
    frac: 0,
    // What we believe the simulation reads, and how many of our own ticks have
    // not yet come back to us as props.
    simAbs: absHour(day, hour),
    pending: 0,
  };
}

/**
 * The time of day as a fraction of the whole day, for `skyAt` and friends.
 *
 * `frac` is capped just below 1 so that a clock sitting at 23:59.9 never
 * rounds up into the next day and briefly draws tomorrow's sky.
 */
export const visualTime = (clock) =>
  (((clock && clock.hour) || 0) + Math.min((clock && clock.frac) || 0, 0.999)) / HOURS_PER_DAY;

/**
 * The day the sky should be drawn for.
 *
 * Carried here rather than taken from the React prop so that it turns over in
 * the same frame as the hour does. The step across a day boundary is only
 * 0.00016 either way, so this is tidiness rather than a fix — but a visual
 * clock that owns its hour and borrows its day is the kind of split that
 * caused the flicker in the first place.
 */
export const visualDay = (clock) => (clock && clock.day) || 1;

/**
 * Move the clock on by one frame. Returns how many hours it crossed, which is
 * how many times the caller should advance the world.
 *
 * Mutates `clock` rather than returning a new one: this runs every frame and
 * allocating here is exactly the sort of thing the windowed renderer exists to
 * avoid.
 */
export function stepVisualClock(clock, deltaSeconds, secondsPerDay, simDay, simHour, running) {
  const incoming = absHour(simDay, simHour);

  if (clock.simAbs === undefined) {
    Object.assign(clock, makeVisualClock(simDay, simHour));
    return 0;
  }

  // Is this render telling us something we did not already know?
  //
  // Anything at or behind what we believe, by no more than the number of our
  // own ticks still in flight, is simply a render that has not caught up —
  // ignore it. Anything else is the world genuinely moving without us: the
  // player pressing "+1 hour", a save loading, a new map, or a hundred days of
  // offline catch-up. Those we adopt on the spot.
  //
  // Comparing whole hours rather than 0..23 is what makes this decidable at
  // all. With a bare hour, a stale render and a real jump look identical, and
  // the clock snapped backwards on every tick whenever React took more than one
  // frame to come back.
  const behindBy = clock.simAbs - incoming;
  if (behindBy === 0) {
    clock.pending = 0;
  } else if (!(behindBy > 0 && behindBy <= clock.pending)) {
    clock.day = Math.floor(incoming / HOURS_PER_DAY);
    clock.hour = incoming % HOURS_PER_DAY;
    clock.frac = 0;
    clock.simAbs = incoming;
    clock.pending = 0;
    return 0;
  }

  if (!running || !(secondsPerDay > 0)) return 0;

  const secondsPerHour = secondsPerDay / HOURS_PER_DAY;
  // Capped so a backgrounded tab does not fast-forward a week on its first
  // frame back; catching up is `advanceHours`' job, not the sun's.
  clock.frac += Math.min(deltaSeconds, 0.25) / secondsPerHour;

  let ticks = 0;
  while (clock.frac >= 1 && ticks < HOURS_PER_DAY) {
    clock.frac -= 1;
    ticks += 1;
    clock.hour += 1;
    if (clock.hour >= HOURS_PER_DAY) {
      clock.hour = 0;
      clock.day += 1;
    }
    // Counted in advance, so the render that eventually brings this back to us
    // is recognised as our own doing however late it is.
    clock.simAbs += 1;
    clock.pending += 1;
  }
  return ticks;
}
