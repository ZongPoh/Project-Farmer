import { placeFinished as place } from "./support.mjs";
/**
 * The data the scene is handed.
 *
 * The rendering itself needs a browser, but the shape of what gets passed
 * into it does not — and that is where the "tear it down" crash lived.
 *
 * THE BUG, because it is worth remembering: the scene keeps a list of the
 * tiles currently on screen. Those are LIVE references to stored tile
 * objects. Demolishing a building mutates one of those objects in place, so
 * the array identity never changes — and a `useMemo(..., [tiles])` that
 * filters for `t.building` therefore does not re-run. It keeps handing the
 * renderer a tile whose building is now null, and the component did
 * `LOOK[building.id]` on it.
 *
 * Two fixes, both tested below: the memo also watches `revision`, and the
 * component refuses to draw nothing rather than throwing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { own } from "./support.mjs";
import { createWorld, allTiles } from "../src/game/world.js";
import { getTile, isStored } from "../src/game/tiles.js";
import { demolish, repair, countBuildings, BUILDING_IDS } from "../src/game/buildings.js";
import { startWork, cancelWork, advanceDay } from "../src/game/tick.js";
import { lookFor, FALLBACK_LOOK, lampFor, LAMP } from "../src/scene/buildingLook.js";
import { skyAt, sunHours } from "../src/game/daytime.js";

function ready(seed = 1) {
  const world = createWorld(seed);
  const grass = [...allTiles(world)].filter((t) => t.terrain === "grass");
  place(world, grass[0].q, grass[0].r, "base");
  own(world, [...allTiles(world)]);
  world.store.wood = 100;
  world.store.stone = 100;
  return { world, grass };
}

/** What Board.jsx does to decide which buildings to draw. */
const buildingsToDraw = (tiles) => tiles.filter((t) => t.building);

// --- the component guard ---------------------------------------------------

test("a building with nothing to draw returns no look, rather than throwing", () => {
  assert.equal(lookFor(null), null, "null is what a demolished tile hands over");
  assert.equal(lookFor(undefined), null);
  assert.equal(lookFor({}), null, "an object with no id is not a building");
});

test("a known building draws itself, an unknown one still draws something", () => {
  const farm = lookFor({ id: "farm", condition: 100 });
  assert.ok(farm && farm.shape, "a farm should have a look");
  assert.equal(lookFor({ id: "nonesuch", condition: 100 }), FALLBACK_LOOK);
});

// --- the stale-list bug ----------------------------------------------------

test("tearing a building down leaves a live null on the tile the scene is holding", () => {
  // This is the exact sequence that crashed. It documents WHY the memo in
  // Board.jsx has to watch `revision`.
  const { world, grass } = ready();
  place(world, grass[1].q, grass[1].r, "farm");

  // The scene captures the visible tiles once, then keeps the array.
  const visible = [grass[0], grass[1]].map((t) => getTile(world, t.q, t.r));
  const before = buildingsToDraw(visible);
  assert.equal(before.length, 2);

  demolish(world, grass[1].q, grass[1].r);

  // The array is unchanged, and the tile object inside it is live.
  const stale = before.find((t) => t.q === grass[1].q && t.r === grass[1].r);
  assert.ok(stale, "the stale entry is still in the old filtered list");
  assert.equal(stale.building, null, "and its building is now null");

  // Which is precisely what used to be passed to the renderer.
  assert.equal(lookFor(stale.building), null, "so the component must tolerate it");

  // Re-running the filter — what watching `revision` makes happen — is correct.
  assert.equal(buildingsToDraw(visible).length, 1, "re-filtering drops it");
});

test("the same hazard for work in progress", () => {
  const { world } = ready();
  const mountain = [...allTiles(world)].find((t) => t.terrain === "mountain");
  if (!mountain) return;

  startWork(world, mountain.q, mountain.r, "quarry");
  const visible = [getTile(world, mountain.q, mountain.r)];
  const working = visible.filter((t) => t.work);
  assert.equal(working.length, 1);

  cancelWork(world, mountain.q, mountain.r);
  assert.equal(working[0].work, null, "the held reference goes null in place");
  assert.equal(visible.filter((t) => t.work).length, 0, "re-filtering drops it");
});

// --- demolish itself -------------------------------------------------------

test("demolish clears the tile, refunds, and leaves the world consistent", () => {
  const { world, grass } = ready();
  place(world, grass[1].q, grass[1].r, "farm");
  assert.equal(countBuildings(world, "farm"), 1);

  const wood = world.store.wood;
  const res = demolish(world, grass[1].q, grass[1].r);

  assert.equal(res.ok, true);
  assert.equal(res.refund, 2, "half of a farm's 4 wood, rounded down");
  assert.equal(world.store.wood, wood + 2);
  assert.equal(getTile(world, grass[1].q, grass[1].r).building, null);
  assert.equal(countBuildings(world, "farm"), 0);
});

test("a demolished tile leaves the active set, so it stops costing a day's work", () => {
  const { world, grass } = ready();
  place(world, grass[1].q, grass[1].r, "farm");
  const withFarm = world.active.size;

  demolish(world, grass[1].q, grass[1].r);
  assert.equal(world.active.size, withFarm - 1, "it should no longer be active");

  // The base is still there and still active, so the day must still work.
  assert.doesNotThrow(() => advanceDay(world));
});

test("a tile keeps its active slot if it still has a reason to be active", () => {
  // unmarkActive must not drop a tile that is doing something else.
  const { world, grass } = ready();
  const tile = getTile(world, grass[0].q, grass[0].r);
  assert.ok(tile.building, "the base is there");

  // The base cannot be demolished, so use a farm on a tile and confirm the
  // active set tracks the remaining reason rather than the count of calls.
  place(world, grass[1].q, grass[1].r, "farm");
  const size = world.active.size;
  repair(world, grass[1].q, grass[1].r); // touches the tile without clearing it
  assert.equal(world.active.size, size, "repairing must not deactivate a tile");
});

test("demolishing then rebuilding on the same tile works", () => {
  const { world, grass } = ready();
  place(world, grass[1].q, grass[1].r, "farm");
  demolish(world, grass[1].q, grass[1].r);

  // Not a woodcutter: those need forest now. A fence will do.
  const again = place(world, grass[1].q, grass[1].r, "fence");
  assert.equal(again.ok, true, again.reason);
  assert.equal(getTile(world, grass[1].q, grass[1].r).building.id, "fence");
  assert.doesNotThrow(() => advanceDay(world));
});

test("demolishing everything but the base leaves a world that still runs", () => {
  const { world, grass } = ready();
  for (const t of grass.slice(1, 5)) place(world, t.q, t.r, "farm");
  for (const t of grass.slice(1, 5)) demolish(world, t.q, t.r);

  assert.equal(countBuildings(world, "farm"), 0);
  assert.equal(countBuildings(world, "base"), 1);
  for (let i = 0; i < 20; i++) assert.doesNotThrow(() => advanceDay(world));

  // And nothing left behind claims to have a building.
  for (const tile of world.modified.values()) {
    if (tile.building) assert.ok(lookFor(tile.building), `undrawable building on ${tile.q},${tile.r}`);
  }
});

test("every building in the game has a look of its own", () => {
  // Derived from BUILDING_IDS rather than a list written out here, so adding
  // a building to buildings.js and forgetting the LOOK table fails the build
  // instead of quietly rendering a grey box.
  for (const id of BUILDING_IDS) {
    const look = lookFor({ id, condition: 100 });
    assert.ok(look, `${id} has no look at all`);
    assert.notEqual(look, FALLBACK_LOOK, `${id} is falling back to the grey box`);
  }
});

// --- lamps at night --------------------------------------------------------

test("a demolished building takes its lamp with it", () => {
  // The same stale-reference hazard as the LOOK table, and the same guard.
  assert.equal(lampFor(null), null);
  assert.equal(lampFor(undefined), null);
  assert.equal(lampFor({}), null);
});

test("only places people actually are get lit", () => {
  assert.ok(lampFor({ id: "farm" }), "a farm is somebody's workplace");
  assert.ok(lampFor({ id: "base" }), "the base most of all");
  assert.equal(lampFor({ id: "fence" }), null, "a fence line must not become a runway");
  assert.equal(lampFor({ id: "nonesuch" }), null, "an unknown building simply stays dark");
});

test("the base is the brightest thing on the board", () => {
  // It is the landmark you navigate by once it is dark. If anything ever
  // outshines it, the map stops being readable at night.
  for (const [id, lamp] of Object.entries(LAMP)) {
    if (!lamp || id === "base") continue;
    assert.ok(lamp.intensity < LAMP.base.intensity, `${id} outshines the base`);
    assert.ok(lamp.distance < LAMP.base.distance, `${id} reaches further than the base`);
  }
});

test("every building has had a decision made about its lamp", () => {
  // Same argument as the LOOK table: a new building would otherwise default to
  // darkness silently. `null` is a perfectly good answer — it just has to be
  // written down rather than forgotten.
  for (const id of BUILDING_IDS) {
    assert.ok(id in LAMP, `${id} is not in the LAMP table — lit, or deliberately not?`);
  }
});

test("lamps are out at noon and lit at midnight, every season", () => {
  // Days are 1-based — day 0 is before the calendar starts.
  for (const day of [1, 25, 50, 75]) {
    assert.equal(skyAt(0.5, day).lampGlow, 0, `day ${day}: lamps burning at noon`);
    assert.equal(skyAt(0, day).lampGlow, 1, `day ${day}: no lamps at midnight`);
  }
});

test("lamps come on at dusk, while there is still light in the sky", () => {
  // The point of lighting the board is the gloom, and the gloom starts before
  // full dark. Lamps must be well on the way up by sunset.
  const day = 1;
  const { sunset } = sunHours(day);
  const atSunset = skyAt(sunset / 24, day).lampGlow;
  assert.ok(atSunset > 0.5, `only ${atSunset.toFixed(2)} lit at sunset`);

  // And fully up by an hour after it, rather than easing in until midnight.
  assert.equal(skyAt((sunset + 1) / 24, day).lampGlow, 1);
});

test("lamp glow never goes backwards as the sun goes down", () => {
  // A non-monotonic ramp would flicker, which would be read as a bug.
  let previous = -1;
  for (let h = 12; h <= 24; h += 0.25) {
    const glow = skyAt(h / 24, 1).lampGlow;
    assert.ok(glow >= previous - 1e-9, `glow dipped at ${h}:00`);
    assert.ok(glow >= 0 && glow <= 1, `glow out of range at ${h}:00`);
    previous = glow;
  }
});

test("winter evenings are lit earlier than summer ones", () => {
  // Falls out of driving this from sun ELEVATION rather than the clock: the
  // winter sun is already low at five, so the lamps are already on.
  const summer = skyAt(17 / 24, 30).lampGlow; // long days
  const winter = skyAt(17 / 24, 80).lampGlow; // short days
  assert.ok(winter > summer, `winter ${winter.toFixed(2)} vs summer ${summer.toFixed(2)}`);
});

// --- selection ------------------------------------------------------------

test("a tile stays selectable after what was on it is torn down", () => {
  // App re-reads the selected tile by coordinates every render, so the panel
  // must cope with the building disappearing underneath it.
  const { world, grass } = ready();
  place(world, grass[1].q, grass[1].r, "farm");
  demolish(world, grass[1].q, grass[1].r);

  const tile = getTile(world, grass[1].q, grass[1].r);
  assert.ok(tile, "the tile itself is still there");
  assert.equal(tile.building, null);
  assert.ok(tile.terrain, "and still has terrain to show");
  assert.ok(isStored(world, grass[1].q, grass[1].r), "it stays stored once touched");
});
