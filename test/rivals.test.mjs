import { settleTheValley } from "../src/game/rivalcamp.js";
import { stepConstruction } from "../src/game/construction.js";
import { placeFinished as place } from "./support.mjs";
/**
 * The rival farmers.
 *
 * Most of these tests exist because the first version of this system was
 * WRONG IN A WAY THAT LOOKED RIGHT, twice over, and both failures are the same
 * failure the fox had: a system that runs, emits no errors, and does nothing.
 *
 *   1. `raidEntry` walked outward from the base starting at step six and gave
 *      up the moment it hit an unwalkable tile with nothing banked. On the
 *      default board six steps is already off the edge, so it returned null
 *      and NO RAID EVER HAPPENED. Every other test passed.
 *   2. Fights were evaluated at range 1. A raider moves three tiles a day and
 *      a worker six, so they were never in the same square when the day was
 *      scored: workers killed exactly zero raiders in 220 simulated days.
 *
 * So the tests below are deliberately weighted toward "does this actually
 * fire", not just "does it return the right shape when it does".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { own } from "./support.mjs";
import { createWorld, allTiles, serialize, deserialize } from "../src/game/world.js";
import { protectedStores, barsRaiders, barrierAt, breachBarrier } from "../src/game/buildings.js";
import { inTerritory } from "../src/game/territory.js";
import { advanceHour } from "../src/game/tick.js";
import { makeWorker, homeOf, findPath } from "../src/game/workers.js";
import {
  raidPressure, raidInterval, partySize, exposedGoods, raidEntry, spotted,
  launchRaid, scheduleRaid, canPayTribute, payTribute, tributeCost,
  activeRaiders, daysUntilRaid, raidTarget, burnTarget,
  RAID_INTERVAL_MIN, RAID_INTERVAL_MAX, MAX_PARTY, FIRST_RAID_DAY, BREACH_FORCE,
  TORCH_PRIORITY, TORCH_PARTY,
} from "../src/game/rivals.js";
import { mulberry32 } from "../src/game/noise.js";

function settled(seed = 11, { food = 400, wood = 400, stone = 300 } = {}) {
  const world = createWorld(seed);
  const grass = [...allTiles(world)].filter((t) => t.terrain === "grass");
  place(world, grass[0].q, grass[0].r, "base");
  // Only the ground these tests actually build on. Claiming the WHOLE board
  // here made every raid test fail, correctly: raiders may not enter your
  // land, so a player who owns everything cannot be raided. That is a real
  // end state (see `raidsPossible`), but it is not the premise of these tests.
  own(world, grass.slice(0, 24));
  world.store.wood = 9000;
  world.store.stone = 9000;
  world.store.food = 9000;
  const build = (n, id) => {
    for (const t of grass.slice(n, n + 1)) place(world, t.q, t.r, id);
  };
  world.store.food = food;
  world.store.wood = wood;
  world.store.stone = stone;
  if (world.workers.length === 0) makeWorker(world, grass[0].q, grass[0].r);
  settleTheValley(world);
  for (let h = 0; h < 24; h++) stepConstruction(world);
  return { world, grass, build };
}

const runDays = (world, days, collect) => {
  const seen = {};
  for (let h = 0; h < days * 24; h++) {
    for (const e of advanceHour(world)) {
      seen[e.type] = (seen[e.type] || 0) + 1;
      if (collect) collect(e, world);
    }
  }
  return seen;
};

// --- the thing actually happens --------------------------------------------

test("a raid party can find its way onto the default board", () => {
  // THE BUG. This is the whole test file's reason for existing: the first
  // implementation returned null here on every standard-sized map, so the
  // rivals never came and nothing anywhere said so.
  const { world } = settled();
  const entry = raidEntry(world, mulberry32(1));
  assert.ok(entry, "no entry point found — no raid can ever happen");
  assert.ok(
    Number.isFinite(entry.q) && Number.isFinite(entry.r),
    "the entry must be a real tile"
  );
});

test("raids actually arrive, over a realistic run", () => {
  const { world } = settled();
  const seen = runDays(world, 160);
  assert.ok((world.raidsSurvived || 0) > 0, "no raid completed in 160 days");
  assert.ok(seen.stolen || seen.raidFoiled, "raiders arrived but never did anything");
});

test("nobody comes calling in the first month", () => {
  // A new settlement gets a clear run. Being robbed on day three teaches the
  // player nothing except that the game is unfair.
  const { world } = settled();
  runDays(world, FIRST_RAID_DAY - 6);
  assert.equal(activeRaiders(world).length, 0, "too early for a raid");
});

// --- the pressure curve ----------------------------------------------------

test("pressure follows what is EXPOSED, not what you own", () => {
  // The entire design rests on this: a granary should make you less worth
  // robbing, not just cushion the blow.
  const { world, grass } = settled(11, { food: 600, wood: 0, stone: 0 });
  const before = raidPressure(world);

  world.store.wood = 4000;
  world.store.stone = 4000;
  place(world, grass[4].q, grass[4].r, "granary");
  place(world, grass[5].q, grass[5].r, "granary");
  world.store.wood = 0;
  world.store.stone = 0;

  assert.ok(raidPressure(world) < before, "granaries must lower the pressure");
});

test("a bare settlement is left alone and a fat one is not", () => {
  const poor = settled(11, { food: 0, wood: 0, stone: 0 }).world;
  const rich = settled(11, { food: 3000, wood: 3000, stone: 3000 }).world;

  assert.equal(raidPressure(poor), 0);
  assert.equal(raidPressure(rich), 1);
  assert.equal(raidInterval(poor), RAID_INTERVAL_MAX);
  assert.ok(raidInterval(rich) >= RAID_INTERVAL_MIN);
  assert.ok(raidInterval(rich) < raidInterval(poor));
  assert.ok(partySize(rich) >= partySize(poor), "small source villages limit raid size");
  assert.ok(partySize(rich) <= MAX_PARTY);
});

test("enough granaries make you genuinely not worth the walk", () => {
  // The intended end state is immunity BUILT, not immunity granted.
  const { world, grass } = settled(11, { food: 0, wood: 0, stone: 0 });
  world.store.wood = 9000;
  world.store.stone = 9000;
  for (const t of grass.slice(4, 10)) place(world, t.q, t.r, "granary");
  world.store.wood = 100;
  world.store.stone = 50;
  world.store.food = 300;

  assert.equal(exposedGoods(world), 0, "all of it should be under cover");
  assert.equal(raidPressure(world), 0);
});

// --- defences --------------------------------------------------------------

test("a granary protects a real amount, scaled by its condition", () => {
  const { world, grass } = settled();
  place(world, grass[4].q, grass[4].r, "granary");
  const full = protectedStores(world);
  assert.ok(full.food > 0 && full.wood > 0);

  // Let it fall apart. A ruin should not be a vault.
  const tile = [...allTiles(world)].find((t) => t.q === grass[4].q && t.r === grass[4].r);
  const stored = world.modified.get(`${grass[4].q},${grass[4].r}`);
  stored.building.condition = 50;
  assert.ok(protectedStores(world).food < full.food, "a half-ruined granary protects less");
});

test("a fence and a wall are the same thing, and differ only in how long they hold", () => {
  // THE CHANGE. A fence used to stop animals while raiders strolled through
  // it, which made it two mechanics — one of which did nothing against the
  // threat you built it for. Both are barriers now.
  const { world, grass } = settled();
  place(world, grass[4].q, grass[4].r, "wall");
  place(world, grass[5].q, grass[5].r, "fence");

  assert.equal(barsRaiders(world, grass[4].q, grass[4].r), true, "a wall stops them");
  assert.equal(barsRaiders(world, grass[5].q, grass[5].r), true, "and so does a fence");

  const wall = barrierAt(world, grass[4].q, grass[4].r);
  const fence = barrierAt(world, grass[5].q, grass[5].r);
  assert.ok(wall.left > fence.left * 3, "a wall must hold very much longer than a fence");
});

test("a barrier can be broken through, and a wall takes far more breaking", () => {
  // Nothing on this board should be an absolute. A defence you build once and
  // never think about again stops being interesting the day it goes up.
  const { world, grass } = settled();
  place(world, grass[4].q, grass[4].r, "fence");
  place(world, grass[5].q, grass[5].r, "wall");

  let fenceDays = 0;
  while (!breachBarrier(world, grass[4].q, grass[4].r, BREACH_FORCE) && fenceDays < 50) fenceDays++;
  let wallDays = 0;
  while (!breachBarrier(world, grass[5].q, grass[5].r, BREACH_FORCE) && wallDays < 50) wallDays++;

  assert.ok(fenceDays < 5, `a fence should fall quickly, took ${fenceDays}`);
  assert.ok(wallDays > fenceDays * 3, `a wall should hold far longer, took ${wallDays} vs ${fenceDays}`);
  assert.equal(barsRaiders(world, grass[4].q, grass[4].r), false, "a broken fence is a gap");
});

test("raiders never appear on ground the player holds", () => {
  // The rule, tested directly. Their own farm is not somewhere raiders can
  // step out of thin air.
  const { world } = settled();
  for (let seed = 1; seed <= 10; seed++) {
    const entry = raidEntry(world, mulberry32(seed));
    if (!entry) continue;
    assert.equal(
      inTerritory(world, entry.q, entry.r),
      false,
      `seed ${seed}: a raid started at ${entry.q},${entry.r}, which is the player's land`
    );
  }
});

test("a watchtower watches the whole approach, not just its own doorstep", () => {
  // Checking only the entry tile — the first version — meant a tower built
  // sensibly near the base almost never saw anything, because raiders enter
  // at the far edge of the map.
  const { world, grass } = settled();
  const home = { q: grass[0].q, r: grass[0].r };
  const entry = { q: home.q + 12, r: home.r };

  assert.equal(spotted(world, entry, home), false, "no tower, no warning");
  place(world, grass[3].q, grass[3].r, "watchtower");
  assert.equal(
    spotted(world, entry, home),
    true,
    "a tower near the base must see a party heading for the base"
  );
});

test("over a long run a tower sees them coming, and enough granaries send them home empty", () => {
  // TWO BACKLOG ITEMS, both of which turned out to be stale, and this is what
  // replaces them. The TODO recorded "watchtowers only spotted 2 raids in 25"
  // and "raidFoiled has never fired in a playthrough". MEASURED since
  // (scratch/towers.mjs, seed 11, 400 days): a single tower near the base
  // spots NINE raids out of nine, because `spotted` watches the approach
  // rather than its own doorstep; and with three granaries covering more than
  // the store holds, raiders went home empty four times.
  //
  // Neither needed a code change. Both needed a test, so that the next person
  // to read the backlog does not go and fix something that works.
  const { world, grass } = settled(11, { food: 300, wood: 300, stone: 200 });
  place(world, grass[2].q, grass[2].r, "watchtower");
  for (const t of grass.slice(4, 7)) place(world, t.q, t.r, "granary");

  let spottedRaids = 0;
  let arrived = 0;
  let foiled = 0;
  runDays(world, 300, (e, w) => {
    if (e.type === "raidSpotted") spottedRaids += 1;
    if (e.type === "raidArrived") arrived += 1;
    if (e.type === "raidFoiled") foiled += 1;
    // Hold the store at what the granaries cover. This is the premise, not a
    // cheat: the claim is about a settlement that has built enough cover for
    // what it holds, and that keeps its tower in repair.
    //
    // The repair half is not incidental. With wood merely capped rather than
    // supplied, the tower decayed from range 7 to range 0 over 180 days and
    // spotted ONE raid in five — which is very likely where the backlog's
    // "2 raids in 25" came from. A neglected tower seeing less far is
    // deliberate (buildings.js, watchtowers), and it is the difference
    // between a tower that works and a tower you built once.
    w.store.food = 300;
    w.store.wood = 300;
    w.store.stone = 200;
  });
  assert.ok(arrived > 0, "no raid arrived at all — the rest of this proves nothing");
  assert.equal(spottedRaids, arrived, `${spottedRaids} of ${arrived} raids were seen coming`);
  assert.ok(foiled > 0, "a fully covered settlement should send a raid home empty-handed");
});

// --- what they take --------------------------------------------------------

test("raiders take goods, and only what is not under cover", () => {
  const { world } = settled(11, { food: 500, wood: 0, stone: 0 });
  const before = world.store.food;
  runDays(world, 160);
  assert.ok(world.store.food !== before, "the store should have moved");
  assert.ok((world.raidsSurvived || 0) > 0);
});

test("a horse in a paddock is what they come for first", () => {
  const { world, grass } = settled();
  world.store.wood = 9000;
  world.store.stone = 9000;
  place(world, grass[2].q, grass[2].r, "paddock");
  world.store.wood = 50;
  world.store.stone = 50;
  world.animals.push({
    id: world.nextAnimalId++, species: "horse",
    q: grass[2].q, r: grass[2].r, energy: 14, tamed: true, riderId: null,
  });

  const target = raidTarget(world);
  assert.equal(target.want, "horse", "a horse outranks the storehouse");
  assert.equal(target.q, grass[2].q);
});

test("a stolen horse leaves with them and waits in their camp", () => {
  // The user asked for animals to be stealable, and the loss has to be real —
  // a horse that reappears next week is not a consequence. But since the
  // playtest it is not gone for good either: it stands in the camp that took
  // it, and burning that camp brings it home.
  const { world, grass } = settled();
  world.store.wood = 9000;
  world.store.stone = 9000;
  place(world, grass[2].q, grass[2].r, "paddock");
  world.store.wood = 30;
  world.store.stone = 20;
  world.store.food = 30;
  world.animals.push({
    id: world.nextAnimalId++, species: "horse",
    q: grass[2].q, r: grass[2].r, energy: 14, tamed: true, riderId: null,
  });
  world.nextRaidDay = world.day;

  let lost = false;
  runDays(world, 45, (e) => {
    if (e.type === "horseLost") lost = true;
  });
  assert.equal(lost, true, "they should have made off with it");
  assert.ok((world.camps || []).some((c) => (c.horses || 0) > 0), "and it should be in their camp");
  assert.equal(world.livestock.lost.stolen >= 1, true, "and the loss is recorded with its reason");
});

// --- tribute ---------------------------------------------------------------

test("tribute buys time, and cannot be paid once they are here", () => {
  const { world } = settled(11, { food: 900, wood: 900, stone: 100 });
  scheduleRaid(world);
  const due = daysUntilRaid(world);

  const res = payTribute(world);
  assert.equal(res.ok, true);
  assert.ok(daysUntilRaid(world) > due, "it should push the visit back");

  // ...but not as a last-minute get-out.
  launchRaid(world, mulberry32(3));
  assert.equal(canPayTribute(world).ok, false, "too late once they have set off");
});

test("tribute is priced so that building is the better answer", () => {
  // It exists for the settlement caught out with nothing built, not as a
  // strategy. A granary is bought once; this is bought every time.
  const { world } = settled(11, { food: 3000, wood: 3000, stone: 3000 });
  const cost = tributeCost(world);
  assert.ok(cost.food > 0 && cost.wood > 0);
  assert.ok(cost.food > cost.wood, "food is the thing they actually want");
});

// --- the promise at the top of rivals.js ------------------------------------

test("a raid costs goods, not people", () => {
  // The stated design rule, as an executable claim. If a change to the combat
  // numbers starts killing workers wholesale, this is what should object.
  const { world, grass } = settled(11, { food: 2000, wood: 2000, stone: 1000 });
  for (const t of grass.slice(2, 5)) place(world, t.q, t.r, "farm");

  let deaths = 0;
  runDays(world, 220, (e) => {
    if (e.type === "death") deaths += 1;
  });
  assert.ok(deaths <= 2, `${deaths} workers died — raids are meant to rob you, not clear you out`);
});

// --- the torch --------------------------------------------------------------

test("a torch-bearer comes for the granary, not for whatever it walks over", () => {
  const { world, grass } = settled(11, { food: 2000, wood: 2000, stone: 1000 });
  assert.equal(burnTarget(world), null, "nothing worth burning in an empty settlement");

  const farm = grass.slice(2, 3)[0];
  place(world, farm.q, farm.r, "farm");
  assert.deepEqual(
    { q: burnTarget(world).q, r: burnTarget(world).r },
    { q: farm.q, r: farm.r },
    "a farm will do if there is nothing better"
  );

  const granarySpot = grass.slice(3, 4)[0];
  place(world, granarySpot.q, granarySpot.r, "granary");
  const aim = burnTarget(world);
  assert.deepEqual({ q: aim.q, r: aim.r }, { q: granarySpot.q, r: granarySpot.r },
    "a granary is what they actually want gone");
  assert.equal(aim.want, "burn");

  // Never the base, and never a barrier: walls have the breaching rules and a
  // raid may not end the game.
  assert.ok(!TORCH_PRIORITY.includes("base"));
  for (const id of ["wall", "gate", "fence", "watchtower", "wallTower"]) {
    assert.ok(!TORCH_PRIORITY.includes(id), `${id} is a barrier, not a target`);
  }
});

test("over a long run they actually burn something down, and it stops protecting anything", () => {
  // The inert-system guard, which this file exists for: for fifteen passes
  // raiders only damaged what they happened to walk over.
  const { world, grass } = settled(11, { food: 2000, wood: 2000, stone: 1000 });
  for (const t of grass.slice(2, 5)) place(world, t.q, t.r, "farm");
  place(world, grass[6].q, grass[6].r, "granary");
  const covered = protectedStores(world).food;
  assert.ok(covered > 0, "a standing granary covers food");

  let burned = 0;
  let deaths = 0;
  runDays(world, 220, (e) => {
    if (e.type === "raidBurned") burned += 1;
    if (e.type === "death") deaths += 1;
  });
  assert.ok(burned > 0, "in 220 days a party of three should have burned something");
  assert.ok(deaths <= 2, `${deaths} died — a torch must not turn a raid into a massacre`);
});

test("a party too small to spare anybody sends nobody with a torch", () => {
  const { world, grass } = settled(11, { food: 2000, wood: 2000, stone: 1000 });
  place(world, grass[6].q, grass[6].r, "granary");
  world.raiders = [];
  launchRaid(world, mulberry32(3));
  const torches = activeRaiders(world).filter((r) => r.target.want === "burn").length;
  assert.ok(torches <= 1, "at most one of them carries a torch");
  if (activeRaiders(world).length < TORCH_PARTY) assert.equal(torches, 0);
});

test("workers can actually beat a raider", () => {
  // The inert-system guard. At the original FIGHT_RANGE of 1 this was zero on
  // every seed while workers were being injured, which is the worst of both.
  const { world, grass } = settled(11, { food: 2000, wood: 2000, stone: 1000 });
  for (const t of grass.slice(2, 5)) place(world, t.q, t.r, "farm");
  world.tools = { spear: 4 };

  let downed = 0;
  for (let h = 0; h < 220 * 24; h++) {
    for (const e of advanceHour(world)) if (e.type === "raiderDown") downed += 1;
    for (const w of world.workers) if (!w.tool) w.tool = "spear";
  }
  assert.ok(downed > 0, "armed workers never drove off a single raider");
});

test("raids keep coming over a long run — no party can block the queue", () => {
  // THE DEADLOCK, and the most valuable test in this file.
  //
  // `raidEntry` picks a tile by walking outward from the base, which can land
  // across a lake or on an island. A party that cannot reach its target never
  // loots and never leaves, so `world.raiders` never empties, so no further
  // raid is ever scheduled. A 540-day playthrough froze on day 107 and the
  // rivals were silently dead for the next four hundred days — with every
  // other test in this file passing.
  //
  // Two guards now: the entry point is checked for reachability, and any
  // raider who gets nowhere for a fortnight goes home. This asserts the
  // OUTCOME of both, so it still fails if either is removed.
  const { world, grass } = settled(11, { food: 1500, wood: 1500, stone: 800 });
  for (const t of grass.slice(2, 6)) place(world, t.q, t.r, "farm");

  runDays(world, 300);

  assert.ok(
    (world.raidsSurvived || 0) >= 3,
    `only ${world.raidsSurvived || 0} raids in 300 days — the queue has stalled`
  );
  // And the calendar must still be moving, not stuck behind a party that
  // never went home.
  assert.ok(
    world.nextRaidDay >= world.day - RAID_INTERVAL_MAX,
    `the next raid is scheduled for day ${world.nextRaidDay} and it is day ${world.day}`
  );
});

test("a raid party always starts somewhere it can walk back from", () => {
  // The cause, tested directly rather than only through its symptom.
  const { world } = settled();
  const home = homeOf(world);
  for (let seed = 1; seed <= 8; seed++) {
    const entry = raidEntry(world, mulberry32(seed));
    assert.ok(entry, `seed ${seed}: no entry point at all`);
    assert.ok(
      findPath(world, entry, home),
      `seed ${seed}: entry ${entry.q},${entry.r} cannot reach the settlement`
    );
  }
});

// --- saves -----------------------------------------------------------------

test("a raid in progress survives a save and load", () => {
  const { world } = settled();
  world.nextRaidDay = world.day;
  runDays(world, 3);

  const back = deserialize(serialize(world));
  assert.equal((back.raiders || []).length, (world.raiders || []).length);
  assert.equal(back.nextRaidDay, world.nextRaidDay);
  assert.doesNotThrow(() => advanceHour(back));
});

test("a save from before the rivals existed gets its clear run", () => {
  // `nextRaidDay` staying undefined is the signal stepRaiders uses to schedule
  // the first raid itself. An old save must not be raided on the day it loads.
  const { world } = settled();
  const data = serialize(world);
  delete data.nextRaidDay;
  delete data.raiders;

  const back = deserialize(data);
  assert.equal(daysUntilRaid(back), null, "nothing should be scheduled yet");

  // A full day, because the rivals are stepped when the date rolls over — the
  // same cadence as the animals, not every hour.
  runDays(back, 1);
  assert.equal(activeRaiders(back).length, 0, "and nobody should arrive immediately");
  assert.ok(daysUntilRaid(back) > 0, "but a raid should now be on the calendar");
});
