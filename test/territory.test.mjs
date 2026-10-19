import { placeFinished as place } from "./support.mjs";
/**
 * Territory: the land you have taken.
 *
 * These tests build their land THE LONG WAY, on purpose. Every other test file
 * uses `own()` from support.mjs to state the premise and move on; this one
 * must not, because the thing under test is exactly the process those tests
 * are skipping.
 *
 * The danger this feature introduces is a SOFTLOCK, and most of what follows
 * is aimed at it. Gating jobs on territory means a settlement that cannot
 * expand cannot do anything at all — and it would fail silently, with every
 * button greyed out and no explanation. That is the single worst outcome
 * available here, and it is worth several tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, allTiles, serialize, deserialize } from "../src/game/world.js";
import { demolish, canPlace } from "../src/game/buildings.js";
import { startWork, startClaim, canClaim, advanceHour, CLAIM_HOURS } from "../src/game/tick.js";
import { makeWorker } from "../src/game/workers.js";
import { getTile } from "../src/game/tiles.js";
import { neighbors, distance } from "../src/game/hex.js";
import {
  inTerritory, isOwned, isFrontier, territorySize, claimTile, unclaimTile,
  claimArea, frontierTiles, outsideReason, BASE_CLAIM_RADIUS,
} from "../src/game/territory.js";

function founded(seed = 5) {
  const world = createWorld(seed);
  const home = { q: world.home.q, r: world.home.r };
  place(world, home.q, home.r, "base");
  world.store.wood = 500;
  world.store.stone = 500;
  world.store.food = 500;
  if (world.workers.length === 0) makeWorker(world, home.q, home.r);
  return { world, home };
}

const runDays = (world, days) => {
  for (let h = 0; h < days * 24; h++) advanceHour(world);
};

// --- founding --------------------------------------------------------------

test("planting the base is what creates your land", () => {
  const world = createWorld(5);
  assert.equal(territorySize(world).claimed, 0, "an unfounded world holds nothing");

  const home = { q: world.home.q, r: world.home.r };
  assert.equal(place(world, home.q, home.r, "base").ok, true);

  assert.ok(inTerritory(world, home.q, home.r), "the base tile must be yours");
  for (const n of neighbors(home.q, home.r)) {
    assert.ok(inTerritory(world, n.q, n.r), `${n.q},${n.r} should be inside the border`);
  }
  // Owned to radius 1 means CLAIMED to radius 2 — nineteen tiles, minus any
  // that fell off the edge of the board.
  assert.ok(territorySize(world).claimed >= 12, `only ${territorySize(world).claimed} tiles`);
});

test("the base is the one thing that does not need land to be placed on", () => {
  // Otherwise there is no first move.
  const world = createWorld(5);
  const home = { q: world.home.q, r: world.home.r };
  assert.equal(canPlace(world, home.q, home.r, "base").ok, true);
});

// --- the border --------------------------------------------------------------

test("you cannot build or work outside your land, and are told why", () => {
  const { world } = founded();
  const far = [...allTiles(world)]
    .filter((t) => t.terrain === "grass" && !inTerritory(world, t.q, t.r))
    .sort((a, b) => distance(world.home, b) - distance(world.home, a))[0];
  assert.ok(far, "the board should have grass outside the starting ring");

  const built = canPlace(world, far.q, far.r, "farm");
  assert.equal(built.ok, false);
  assert.match(built.reason, /land/, `unhelpful reason: ${built.reason}`);

  const worked = startWork(world, far.q, far.r, "plant");
  assert.equal(worked.ok, false);
  assert.match(worked.reason, /land/);
});

test("finishing anything opens the ring beyond it", () => {
  // The rule the player is told, as an executable claim.
  const { world } = founded();
  const edge = frontierTiles(world).find((t) => {
    const tile = getTile(world, t.q, t.r);
    return tile && tile.terrain === "grass";
  });
  assert.ok(edge, "there should be grass on the frontier");

  const beyond = neighbors(edge.q, edge.r).filter((n) => !inTerritory(world, n.q, n.r));
  assert.ok(beyond.length > 0, "the frontier should have something beyond it");

  assert.equal(startClaim(world, edge.q, edge.r).ok, true);
  runDays(world, 20);

  assert.ok(isOwned(world, edge.q, edge.r), "the claimed tile should be worked now");
  const opened = beyond.filter((n) => inTerritory(world, n.q, n.r));
  assert.ok(opened.length > 0, "nothing beyond it opened up");
});

test("a claim job can only be started on the frontier", () => {
  const { world, home } = founded();
  assert.equal(canClaim(world, home.q, home.r).ok, false, "the base is already yours");

  const far = [...allTiles(world)]
    .filter((t) => !inTerritory(world, t.q, t.r))
    .sort((a, b) => distance(home, b) - distance(home, a))[0];
  const check = canClaim(world, far.q, far.r);
  assert.equal(check.ok, false);
  assert.match(check.reason, /too far/);
});

// --- the softlock ----------------------------------------------------------

test("there is ALWAYS something to do on the frontier", () => {
  /**
   * THE SOFTLOCK GUARD, and the reason the claim job exists at all.
   *
   * The border grows when you finish a job on a tile — but plain grass has no
   * job available unless you happen to be holding a seed, and sand away from
   * water has none either. Without a job that works on bare ground, a
   * settlement whose opening nineteen tiles held no forest and no quarriable
   * rock could never expand, every button would be greyed out, and the game
   * would stop with no explanation whatsoever.
   *
   * Across many seeds, on every one, at least one frontier tile must accept
   * the claim job.
   */
  for (let seed = 1; seed <= 25; seed++) {
    const { world } = founded(seed);
    const open = frontierTiles(world).filter((t) => canClaim(world, t.q, t.r).ok);
    assert.ok(
      open.length > 0,
      `seed ${seed}: nothing on the frontier can be claimed — the game is stuck`
    );
  }
});

test("a settlement can expand from nothing but grass", () => {
  // The worst realistic opening: no forest, no rock, no seeds. It must still
  // be possible to get somewhere.
  const { world } = founded(5);
  world.store.seeds = 0;
  const before = territorySize(world).claimed;

  for (let round = 0; round < 4; round++) {
    const edge = frontierTiles(world).find((t) => canClaim(world, t.q, t.r).ok);
    if (!edge) break;
    startClaim(world, edge.q, edge.r);
    runDays(world, 25);
  }

  assert.ok(
    territorySize(world).claimed > before,
    "a settlement with only grass and a claim job could not grow"
  );
});

// --- refcounting -----------------------------------------------------------

test("demolishing between two buildings does not punch a hole in your land", () => {
  /**
   * THE REASON CLAIMS ARE REFERENCE COUNTED. Two buildings standing next to
   * each other both claim the tile between them. With a plain set, tearing
   * either one down would remove the shared tile from the territory — a hole
   * in the middle of the farm, invisible until somebody tried to build there.
   */
  const { world } = founded();
  const a = frontierTiles(world).find((t) => getTile(world, t.q, t.r).terrain === "grass");
  const b = neighbors(a.q, a.r).find(
    (n) => getTile(world, n.q, n.r) && getTile(world, n.q, n.r).terrain === "grass"
      && inTerritory(world, n.q, n.r)
  );
  if (!b) return;

  claimTile(world, a.q, a.r);
  claimTile(world, b.q, b.r);
  const between = neighbors(a.q, a.r).find((n) => distance(n, b) === 1 && inTerritory(world, n.q, n.r));
  assert.ok(between, "a and b should share a neighbour");

  unclaimTile(world, a.q, a.r);
  assert.ok(
    inTerritory(world, between.q, between.r),
    "the shared tile must still be yours — b is still vouching for it"
  );
});

test("claiming the same tile twice does not double-count it", () => {
  const { world, home } = founded();
  const size = territorySize(world);
  claimTile(world, home.q, home.r);
  claimTile(world, home.q, home.r);
  assert.deepEqual(territorySize(world), size, "claiming twice changed the territory");
});

test("a tile you worked stays yours after the building on it is torn down", () => {
  // Labour is not undone by demolition. Otherwise clearing a wood, building a
  // hut there and changing your mind would hand the land back.
  const { world } = founded();
  const spot = frontierTiles(world).find(
    (t) => getTile(world, t.q, t.r) && getTile(world, t.q, t.r).terrain === "grass"
  );
  startClaim(world, spot.q, spot.r);
  runDays(world, 20);
  assert.ok(isOwned(world, spot.q, spot.r));

  place(world, spot.q, spot.r, "farm");
  demolish(world, spot.q, spot.r);
  assert.ok(isOwned(world, spot.q, spot.r), "worked ground must stay yours");
});

// --- saves -----------------------------------------------------------------

test("the border survives a save and load", () => {
  const { world } = founded();
  claimArea(world, world.home.q, world.home.r, 2);
  const before = territorySize(world);

  const back = deserialize(JSON.parse(JSON.stringify(serialize(world))));
  assert.deepEqual(territorySize(back), before, "the territory changed across a save");
});

test("a save from before territory existed adopts what the player already built", () => {
  /**
   * If an old save loaded with no territory, every farm the player had ever
   * built would sit outside their own border and every button would be
   * refused. That is not a migration, it is a bricked save — so anything
   * stored is adopted, because touching a tile is exactly what claiming means
   * now.
   */
  const { world } = founded();
  const spot = frontierTiles(world).find(
    (t) => getTile(world, t.q, t.r) && getTile(world, t.q, t.r).terrain === "grass"
  );
  place(world, spot.q, spot.r, "farm");

  const data = serialize(world);
  delete data.owned; // as a version-5 save would be

  const back = deserialize(data);
  assert.ok(back.owned.size > 0, "an old save must not load with no land at all");
  assert.ok(inTerritory(back, spot.q, spot.r), "their farm must be inside their border");
  assert.ok(inTerritory(back, world.home.q, world.home.r), "and so must their base");
  assert.equal(canPlace(back, spot.q, spot.r, "farm").ok, false, "still occupied, but for the right reason");
});

// --- the message -----------------------------------------------------------

test("being outside your land always comes with a reason worth reading", () => {
  const world = createWorld(5);
  assert.match(outsideReason(world, 0, 0), /founded/, "before founding, say so");

  place(world, world.home.q, world.home.r, "base");
  assert.equal(outsideReason(world, world.home.q, world.home.r), null, "inside is not a reason");
  const far = { q: world.home.q + 12, r: world.home.r };
  assert.match(outsideReason(world, far.q, far.r), /closer to home/);
});
