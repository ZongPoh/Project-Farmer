/**
 * The sun light's position and shadow frustum.
 *
 * WHY THIS EXISTS. Shadows were reported crawling and fizzing as the sun went
 * down. Three faults were behind it, listed in `sunShadow.js`, and not one of
 * them could be tested — the arithmetic lived inside a `useFrame` callback that
 * needs React and Three.js to run at all, so it had never been looked at by
 * anything except a person watching a sunset.
 *
 * Pulling it into a plain module is the same move `buildingLook.js` made. What
 * these tests assert is the shape of the motion: that nothing jumps, that
 * nothing grazes, and that the switches happen where they cannot be seen.
 * Whether it LOOKS right is still a question only a browser can answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { skyAt, sunDirection } from "../src/game/daytime.js";
import {
  shadowPlan, shadowStrength,
  SUN_DISTANCE, MIN_HEIGHT, MIN_SPAN, MAX_SPAN, SPAN_SNAP, CENTRE_SNAP,
} from "../src/scene/sunShadow.js";

const DAY = 13;
const VIEW = { x: 0, y: 0, z: 0 };

/** One frame's plan, at a given hour. */
const planAt = (hour, view = VIEW, reach = 30) => {
  const t = hour / 24;
  return shadowPlan(sunDirection(t, DAY), skyAt(t, DAY).sunIntensity, view, reach);
};

test("the light never grazes, however low the sun gets", () => {
  // FAULT 1. The floor was 0.04 of the radius — about two and a half units up
  // against a frustum thirty across, which is where the fizz came from.
  const floor = MIN_HEIGHT * SUN_DISTANCE;
  for (let i = 0; i < 24 * 4; i++) {
    const plan = planAt(i / 4);
    assert.ok(
      plan.position.y >= floor - 1e-9,
      `at ${(i / 4).toFixed(2)}h the light sat at y=${plan.position.y.toFixed(2)}, ` +
      `below the floor of ${floor.toFixed(2)} — the shadow projection will graze`
    );
  }
});

test("the light's position never jumps", () => {
  // The reported symptom, as close as a headless test can get to it: a step in
  // the light's position is a step in every shadow in the scene.
  const STEPS = 24 * 60;
  let previous = planAt(0).position;
  let worst = 0;
  for (let i = 1; i <= STEPS; i++) {
    const now = planAt((i / STEPS) * 24).position;
    const moved = Math.hypot(
      now.x - previous.x, now.y - previous.y, now.z - previous.z
    );
    if (moved > worst) worst = moved;
    assert.ok(
      moved < 0.6,
      `the light jumped ${moved.toFixed(2)} units at ${((i / STEPS) * 24).toFixed(2)}h`
    );
    previous = now;
  }
  assert.ok(worst > 0, "the light never moved at all, which cannot be right");
});

test("shadows are switched on and off only while the sun contributes nothing", () => {
  // FAULT 2. Toggling `castShadow` recompiles every material in the scene, and
  // it used to happen with the sun still at most of its strength — a pop and a
  // stall, both at the moment the player is watching.
  for (let i = 0; i < 24 * 4; i++) {
    const hour = i / 4;
    const plan = planAt(hour);
    const lit = skyAt(hour / 24, DAY).sunIntensity;
    if (!plan.castShadow) {
      assert.equal(
        lit, 0,
        `shadows were off at ${hour.toFixed(2)}h while the sun was still at ${lit.toFixed(2)}`
      );
    }
  }
});

test("the shadow has already faded out by the time it is switched off", () => {
  // The two mechanisms have to overlap, or there is a visible pop in the gap
  // between the shadow going solid-then-gone and the light actually dying.
  for (let i = 0; i < 24 * 4; i++) {
    const hour = i / 4;
    const plan = planAt(hour);
    const nextOff = !planAt(hour + 0.25).castShadow;
    if (plan.castShadow && nextOff) {
      assert.equal(
        plan.strength, 0,
        `at ${hour.toFixed(2)}h the shadow was still ${plan.strength.toFixed(2)} solid ` +
        `the frame before it was switched off`
      );
    }
  }
});

test("shadow strength is full in daylight and gone by the horizon", () => {
  assert.equal(shadowStrength(0.8), 1, "midday shadows should be solid");
  assert.equal(shadowStrength(0), 0, "a sun on the horizon should cast nothing");
  assert.equal(shadowStrength(-0.4), 0, "a set sun should cast nothing");
  assert.ok(shadowStrength(0.07) > 0 && shadowStrength(0.07) < 1, "and fade in between");

  // Monotonic, or the evening would brighten and darken as it went.
  let previous = -1;
  for (let e = -0.2; e <= 1; e += 0.01) {
    const s = shadowStrength(e);
    assert.ok(s >= previous - 1e-9, `shadow strength went backwards at elevation ${e.toFixed(2)}`);
    previous = s;
  }
});

test("the frustum follows the view instead of sitting at the origin forever", () => {
  // FAULT 3. Nothing ever set a target, so the shadow camera stayed at (0,0,0)
  // and shadows simply stopped existing once you panned off the middle of the
  // board — which on the large maps is most of the board.
  const far = planAt(12, { x: 140, y: 0, z: -86 });
  assert.ok(Math.abs(far.target.x - 140) <= CENTRE_SNAP, "the frustum did not follow x");
  assert.ok(Math.abs(far.target.z + 86) <= CENTRE_SNAP, "the frustum did not follow z");
});

test("moving the view does not change how anything is shaded", () => {
  // The claim the offset rests on: a directional light cares only about its
  // direction, so shifting position and target together must leave that
  // direction untouched. If this ever fails, panning changes the lighting.
  const here = planAt(9, { x: 0, y: 0, z: 0 });
  const there = planAt(9, { x: 96, y: 0, z: 48 });
  const dirOf = (p) => ({
    x: p.position.x - p.target.x,
    y: p.position.y - p.target.y,
    z: p.position.z - p.target.z,
  });
  const a = dirOf(here), b = dirOf(there);
  for (const axis of ["x", "y", "z"]) {
    assert.ok(
      Math.abs(a[axis] - b[axis]) < 1e-9,
      `panning changed the light direction on ${axis}: ${a[axis]} vs ${b[axis]}`
    );
  }
});

test("the frustum centre and span are quantised, so neither creeps", () => {
  // A frustum that slides continuously drags the shadow texels with it. Steps
  // are ugly once and then stable; a slide is ugly the whole time.
  for (let x = 0; x < 40; x += 0.37) {
    const plan = shadowPlan(sunDirection(0.5, DAY), 1, { x, y: 0, z: -x }, 30);
    // `Number.isInteger` of the quotient rather than a remainder check, because
    // -0 % 2 is -0 and assert.equal uses Object.is, which will not have it.
    assert.ok(
      Number.isInteger(plan.target.x / CENTRE_SNAP),
      `centre x ${plan.target.x} is off the grid`
    );
    assert.ok(
      Number.isInteger(plan.target.z / CENTRE_SNAP),
      `centre z ${plan.target.z} is off the grid`
    );
  }
  for (let reach = 5; reach < 120; reach += 1.3) {
    const plan = shadowPlan(sunDirection(0.5, DAY), 1, VIEW, reach);
    assert.ok(plan.span >= MIN_SPAN && plan.span <= MAX_SPAN, `span ${plan.span} out of range`);
    // No exceptions for the bounds any more: they are on the grid themselves.
    assert.ok(
      Number.isInteger(plan.span / SPAN_SNAP),
      `span ${plan.span} is off the grid`
    );
  }
});

test("a camera sitting on a snap boundary does not make the frustum strobe", () => {
  // Quantising was meant to stop the frustum crawling, and on its own it traded
  // that for something worse. `Math.round` is unstable on a boundary, the camera
  // is never perfectly still — orbit damping keeps nudging it — so a value
  // parked on the line flips between two answers on alternate frames. For the
  // span that rebuilds the shadow projection EVERY FRAME, and every shadow in
  // the scene strobes.
  //
  // Both boundaries are picked deliberately: 36 is halfway between two multiples
  // of SPAN_SNAP, and x=1 is halfway between two multiples of CENTRE_SNAP.
  const dir = sunDirection(0.5, DAY);
  const noise = (i) => (i % 2 === 0 ? 1 : -1) * 1e-6;

  let plan = shadowPlan(dir, 1, { x: 1, y: 0, z: 1 }, 45);
  const firstSpan = plan.span;
  const firstX = plan.target.x;
  let spanChanges = 0;
  let centreChanges = 0;

  for (let i = 0; i < 600; i++) {
    const next = shadowPlan(
      dir, 1,
      { x: 1 + noise(i), y: 0, z: 1 + noise(i + 1) },
      45 + noise(i),                       // 45 * 0.8 = 36, exactly on the line
      plan
    );
    if (next.span !== plan.span) spanChanges++;
    if (next.target.x !== plan.target.x) centreChanges++;
    plan = next;
  }

  assert.equal(spanChanges, 0, `the frustum span changed ${spanChanges} times while nothing moved`);
  assert.equal(centreChanges, 0, `the frustum centre moved ${centreChanges} times while nothing did`);
  assert.equal(plan.span, firstSpan);
  assert.equal(plan.target.x, firstX);
});

test("...but a real pan still moves it", () => {
  // The obvious way to pass the test above is to stop moving at all. This is
  // the other half: hysteresis must not turn into paralysis.
  const dir = sunDirection(0.5, DAY);
  let plan = shadowPlan(dir, 1, { x: 0, y: 0, z: 0 }, 45);
  for (let x = 0; x <= 60; x += 0.5) {
    plan = shadowPlan(dir, 1, { x, y: 0, z: 0 }, 45 + x, plan);
  }
  assert.ok(plan.target.x >= 58, `the frustum lagged the camera: ${plan.target.x} against 60`);
  assert.equal(plan.span, MAX_SPAN, "the frustum never grew as the camera pulled back");
});

test("the frustum covers what a pulled-back camera can see", () => {
  // It was fixed at thirty. On the huge board you can stand a long way back,
  // and everything past that radius was simply unshadowed.
  const close = shadowPlan(sunDirection(0.5, DAY), 1, VIEW, 12);
  const far = shadowPlan(sunDirection(0.5, DAY), 1, VIEW, 90);
  assert.ok(far.span > close.span, "the frustum did not grow as the camera pulled back");
  assert.equal(close.span, MIN_SPAN, "a close camera should get the tightest frustum");
});

test("every season's sunset is handled, not just spring's", () => {
  // Winter's sun never climbs high, so the floor is doing much more of the work
  // there — and a winter sunset is the one the player sees most, because the
  // days are short.
  for (const day of [13, 37, 61, 85]) {
    for (let i = 0; i < 24 * 4; i++) {
      const t = i / 4 / 24;
      const plan = shadowPlan(sunDirection(t, day), skyAt(t, day).sunIntensity, VIEW, 30);
      assert.ok(
        plan.position.y >= MIN_HEIGHT * SUN_DISTANCE - 1e-9,
        `day ${day} grazed at ${(i / 4).toFixed(2)}h`
      );
      assert.ok(Number.isFinite(plan.span), `day ${day} produced a non-finite span`);
    }
  }
});
