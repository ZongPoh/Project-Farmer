/**
 * The clock the sun runs on.
 *
 * WHY THIS EXISTS. Reported as "flickering". The time of day was assembled from
 * a fraction living in a ref and an hour arriving as a React prop — two halves
 * that update at different moments. On the frame the hour ticked over, the
 * fraction had already been reset while the prop had not yet arrived, and the
 * sun jumped backward by very nearly a whole hour before snapping forward
 * again. Every game hour, which on Fast is four times a second.
 *
 * The first test here is the bug itself, written against a copy of the old
 * expression, so the thing being fixed is on the record and not just in a
 * commit message. The rest guard the replacement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeVisualClock, stepVisualClock, visualTime, visualDay, absHour, HOURS_PER_DAY,
} from "../src/scene/visualClock.js";

const FRAME = 1 / 60;

/**
 * Drive the clock the way the renderer does, with React lagging behind.
 *
 * `lagFrames` is how many frames it takes a state update to come back round as
 * a prop. The point of the fix is that the answer stops mattering.
 */
function play(seconds, secondsPerDay, lagFrames, stepper) {
  const clock = makeVisualClock(1, 0);
  let world = { day: 1, hour: 0 };
  // Each pending render carries the frame it was scheduled on and lands
  // `lagFrames` later. An earlier version of this drained one entry per frame
  // only once the queue was non-trivially full, which quietly modelled a lag of
  // a whole HOUR rather than a frame — and then blamed the clock for it.
  const inFlight = [];
  let prop = { day: 1, hour: 0 };

  const times = [];
  const frames = Math.round(seconds * 60);
  for (let f = 0; f < frames; f++) {
    while (inFlight.length && inFlight[0].at + lagFrames <= f) {
      prop = inFlight.shift().world;
    }
    const ticks = stepper(clock, FRAME, secondsPerDay, prop.day, prop.hour);
    for (let i = 0; i < ticks; i++) {
      // advanceHour, in effect: the world rolls its own hour and day over.
      world = world.hour === HOURS_PER_DAY - 1
        ? { day: world.day + 1, hour: 0 }
        : { day: world.day, hour: world.hour + 1 };
      inFlight.push({ world, at: f });               // ...React will say so later
    }
    times.push(visualTime(clock));
  }
  // Let every outstanding render land, so the drift check compares settled
  // values rather than one still in flight.
  while (inFlight.length) prop = inFlight.shift().world;
  stepper(clock, 0, secondsPerDay, prop.day, prop.hour);
  return { times, clock, world };
}

/** Backward steps, ignoring the one legitimate wrap at midnight. */
function backwardSteps(times) {
  const found = [];
  for (let i = 1; i < times.length; i++) {
    let d = times[i] - times[i - 1];
    if (d < -0.5) d += 1;
    if (d < -1e-9) found.push(d * HOURS_PER_DAY);
  }
  return found;
}

test("THE BUG: the old clock jumped backwards an hour on every tick", () => {
  // A faithful copy of what used to be in `Atmosphere.jsx` and `Clock.jsx`.
  // If this ever stops failing to be broken, the note above is wrong.
  const old = (clock, delta, secondsPerDay, _propDay, propHour) => {
    let ticks = 0;
    if (secondsPerDay > 0) {
      clock.frac = (clock.frac || 0) + delta / (secondsPerDay / HOURS_PER_DAY);
      while (clock.frac >= 1 && ticks < HOURS_PER_DAY) {
        clock.frac -= 1;
        ticks += 1;
      }
    }
    // The fault: a fresh fraction bolted onto a stale hour.
    clock.hour = propHour;
    return ticks;
  };

  const { times } = play(20, 6, 1, old);
  const back = backwardSteps(times);
  assert.ok(back.length > 20, `expected the old clock to stutter; it went back ${back.length} times`);
  assert.ok(
    Math.min(...back) < -0.5,
    `expected jumps approaching a full hour, worst was ${Math.min(...back).toFixed(2)}`
  );
});

test("the clock never runs backwards, at any speed, however slow React is", () => {
  for (const secondsPerDay of [48, 24, 6]) {
    for (const lag of [0, 1, 2, 6]) {
      const { times } = play(20, secondsPerDay, lag, (c, d, s, dy, h) =>
        stepVisualClock(c, d, s, dy, h, true)
      );
      const back = backwardSteps(times);
      assert.equal(
        back.length, 0,
        `${secondsPerDay}s/day with a ${lag}-frame lag went backwards ${back.length} times ` +
        `(worst ${back.length ? Math.min(...back).toFixed(3) : 0} hours)`
      );
    }
  }
});

test("the clock moves smoothly — no forward jumps either", () => {
  // A snap forward is just as visible as a snap back, and would be the obvious
  // way to get the test above to pass while still looking broken.
  const { times } = play(20, 6, 2, (c, d, s, dy, h) => stepVisualClock(c, d, s, dy, h, true));
  for (let i = 1; i < times.length; i++) {
    let d = times[i] - times[i - 1];
    if (d < -0.5) d += 1;
    assert.ok(
      d * HOURS_PER_DAY < 0.25,
      `the clock lurched ${(d * HOURS_PER_DAY).toFixed(3)} hours in one frame`
    );
  }
});

test("it keeps step with the world it is driving", () => {
  // Drift would be the quiet failure here: a sun that looks smooth and is
  // gradually telling a different time from the simulation.
  const { clock, world } = play(30, 6, 2, (c, d, s, dy, h) =>
    stepVisualClock(c, d, s, dy, h, true)
  );
  assert.equal(
    absHour(clock.day, clock.hour), absHour(world.day, world.hour),
    "the visual clock drifted away from the world"
  );
  assert.equal(visualDay(clock), world.day, "the visual day drifted too");
});

test("a jump the player asked for is followed at once", () => {
  // "+1 hour", a loaded save, a new map, a hundred days of offline catch-up.
  // These have to snap — they are not our own tick arriving late.
  const clock = makeVisualClock(3, 5);
  stepVisualClock(clock, FRAME, 24, 3, 5, true);
  assert.equal(clock.hour, 5);

  stepVisualClock(clock, FRAME, 24, 3, 6, true);
  assert.equal(clock.hour, 6, "a manual +1 hour was ignored");
  assert.equal(clock.frac, 0, "the fraction should restart after a deliberate jump");

  stepVisualClock(clock, FRAME, 24, 3, 19, true);
  assert.equal(clock.hour, 19, "a big jump — offline catch-up — was ignored");

  // Offline catch-up crosses days, which a 0..23 comparison could not see at
  // all: hour 19 on day 3 and hour 19 on day 120 look identical to it.
  stepVisualClock(clock, FRAME, 24, 120, 19, true);
  assert.equal(clock.day, 120, "a hundred and seventeen days of catch-up were ignored");
  assert.equal(visualDay(clock), 120);

  // ...and backwards, which is what loading an older save looks like.
  stepVisualClock(clock, FRAME, 24, 2, 11, true);
  assert.equal(clock.day, 2, "loading an earlier save was ignored");
  assert.equal(clock.hour, 11);
});

test("our own tick coming back from React is not mistaken for a jump", () => {
  // The distinction the whole thing turns on. Run until the clock wraps an
  // hour by itself, then hand it the hour it just caused, late. It must not
  // restart the fraction: that would be a visible hitch once an hour, which is
  // the bug wearing a different hat.
  const clock = makeVisualClock(4, 8);
  let ticks = 0;
  for (let f = 0; f < 600 && ticks === 0; f++) {
    ticks = stepVisualClock(clock, FRAME, 6, 4, 8, true);
  }
  assert.equal(ticks, 1, "the clock never reached the next hour");
  assert.equal(clock.hour, 9);

  // Six frames of staleness first — the prop still says 8 — and then the
  // render carrying our own tick finally lands. Neither may disturb anything.
  const fracBefore = clock.frac;
  for (let f = 0; f < 6; f++) stepVisualClock(clock, FRAME, 6, 4, 8, true);
  assert.equal(clock.hour, 9, "a stale render dragged the clock back an hour");
  stepVisualClock(clock, FRAME, 6, 4, 9, true);   // React finally says "it is 9"
  assert.ok(
    clock.frac > fracBefore,
    "the late render reset the fraction — that is the original bug"
  );
  assert.equal(clock.hour, 9);
});

test("a paused game does not move the sun", () => {
  // When the world is not running the time of day is a view setting, not a
  // fact about the world, and nothing here may advance it.
  const clock = makeVisualClock(7, 14);
  for (let f = 0; f < 300; f++) {
    assert.equal(stepVisualClock(clock, FRAME, 24, 7, 14, false), 0);
  }
  assert.equal(clock.hour, 14);
  assert.equal(clock.frac, 0);
});

test("a backgrounded tab does not fast-forward the day when it comes back", () => {
  // One enormous delta must not spend the whole day in a single frame;
  // catching up is `advanceHours`' job.
  const clock = makeVisualClock(1, 0);
  const ticks = stepVisualClock(clock, 600, 6, 1, 0, true);
  assert.ok(ticks <= 1, `one frame advanced ${ticks} hours after a long pause`);
});

test("visualTime never rounds up into tomorrow", () => {
  const clock = { day: 9, hour: 23, frac: 0.9999, simAbs: absHour(9, 23), pending: 0 };
  assert.ok(visualTime(clock) < 1, "23:59 rounded into the next day");
  assert.ok(visualTime(clock) > 0.99, "...but it should still be very nearly midnight");
  assert.equal(visualTime(undefined), 0, "a clock that does not exist yet is midnight");
});
