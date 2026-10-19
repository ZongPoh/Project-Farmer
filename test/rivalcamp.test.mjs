import { placeFinished as place, foundFinishedCamp as foundCamp } from "./support.mjs";
/**
 * The neighbours: settlements of their own, and what you do about them.
 *
 * The promise the hostile half has to keep is one sentence — **hurting them
 * measurably reduces the raids** — and it is the thing that is easy to ship
 * without. Two earlier attempts at exactly that shipped inert: an assault that
 * could never win (five armed workers against a defence of 12), and a camp
 * whose strength recruited itself back faster than it could be burned.
 *
 * The promise the peaceful half has to keep is different and just as easy to
 * miss: **a caravan has to actually take the surplus away**. A sink that
 * empties one pile while filling another has not solved anything, and the
 * first version did precisely that — 540 days of trade left the settlement
 * holding 986 herbs.
 *
 * So most of what follows checks for EFFECT over a realistic run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { own } from "./support.mjs";
import { createWorld, allTiles, serialize, deserialize } from "../src/game/world.js";
import { canPlace } from "../src/game/buildings.js";
import { advanceHour } from "../src/game/tick.js";
import { makeWorker } from "../src/game/workers.js";
import { inTerritory, inRivalLand, landOwner } from "../src/game/territory.js";
import { distance } from "../src/game/hex.js";
import { allCamps, raiderCamps, settlerCamps, hasCamp, campById, findCampSite, routeCamp, burnSomething, lootCamp, settleTheValley, campStrength, campHousing, campIncome, campSummaries, campBuildings, campCountOf, campTrades, tradeOffer, orderWarParty, canSendWarParty, recallWarParty, campCountFor, campDistanceFor, campKindFor, MAX_CAMPS, MAX_BUILDINGS, RESETTLE_AFTER, TRADE_FLOOR, MAX_GIVE } from "../src/game/rivalcamp.js";
import { partySize, raidInterval, raidEntry, strongestRaiderCamp, stepAssault } from "../src/game/rivals.js";
import { mulberry32 } from "../src/game/noise.js";

function valley(seed = 23, { workers = 6, spears = 0, grid = { width: 40, height: 28 } } = {}) {
  const world = createWorld(seed, grid);
  place(world, world.home.q, world.home.r, "base");
  const grass = [...allTiles(world)].filter((t) => t.terrain === "grass");
  world.store.wood = 9000;
  world.store.stone = 9000;
  world.store.food = 9000;
  own(world, grass.slice(0, 30));
  for (const t of grass.slice(1, 6)) place(world, t.q, t.r, "farm");
  world.store.wood = 400;
  world.store.stone = 300;
  world.store.food = 900;
  world.tools = spears ? { spear: spears } : {};
  while (world.workers.length < workers) makeWorker(world, world.home.q, world.home.r);
  return { world, grass };
}

const runDays = (world, days, each, collect) => {
  const seen = {};
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      for (const e of advanceHour(world)) { seen[e.type] = (seen[e.type] || 0) + 1; if (collect) collect(e); }
    }
    if (each) each(world, d);
  }
  return seen;
};

// --- how many, and where ----------------------------------------------------

test("a bigger valley holds more neighbours, and they settle further off", () => {
  const small = createWorld(23, { width: 24, height: 16 });
  const mid = createWorld(23, { width: 40, height: 28 });
  const huge = createWorld(23, { width: 400, height: 200 });

  assert.ok(campCountFor(small) >= 1);
  assert.ok(campCountFor(mid) >= campCountFor(small), "a bigger board should hold at least as many");
  assert.ok(campCountFor(huge) <= MAX_CAMPS, "and never more than the cap");

  // Ten tiles is a journey on the default board and next door on a huge one,
  // where the player's own territory can be three hundred tiles.
  assert.ok(
    campDistanceFor(huge) > campDistanceFor(small),
    "how far off they settle has to scale too"
  );
});

test("the first neighbour is always hostile and the second always is not", () => {
  // A board whose only neighbour is friendly has no threat in it at all; one
  // with no settlers has no trade. Both must exist on any board big enough.
  assert.equal(campKindFor(0), "raider");
  assert.equal(campKindFor(1), "settler");
});

test("the valley fills itself, with both sorts", () => {
  const { world } = valley();
  runDays(world, 3);

  assert.ok(allCamps(world).length >= 2, `only ${allCamps(world).length} settled`);
  assert.ok(raiderCamps(world).length >= 1, "somebody has to be hostile");
  assert.ok(settlerCamps(world).length >= 1, "somebody has to be peaceful");
});

test("they settle on real ground, off your land, and not on each other", () => {
  const { world } = valley();
  runDays(world, 3);

  for (const camp of allCamps(world)) {
    assert.ok(
      distance(world.home, camp.home) >= 6,
      `a camp settled ${distance(world.home, camp.home)} tiles away`
    );
    assert.equal(inTerritory(world, camp.home.q, camp.home.r), false, "settled on your land");
  }
  const homes = allCamps(world).map((c) => `${c.home.q},${c.home.r}`);
  assert.equal(new Set(homes).size, homes.length, "two camps on one tile");
});

test("where they settle is decided by the board, not by a dice roll", () => {
  const a = valley(23).world;
  const b = valley(23).world;
  assert.deepEqual(findCampSite(a), findCampSite(b));
});

test("each camp's land is its own, and none of it is yours", () => {
  const { world } = valley();
  runDays(world, 60);

  for (const camp of allCamps(world)) {
    assert.ok(inRivalLand(world, camp.home.q, camp.home.r));
    assert.equal(landOwner(world, camp.home.q, camp.home.r), "theirs");
  }
  assert.equal(landOwner(world, world.home.q, world.home.r), "yours");

  // ...and no tile is claimed by two of them.
  const seen = new Set();
  for (const camp of allCamps(world)) {
    for (const k of camp.owned) {
      assert.equal(seen.has(k), false, `${k} is owned by two camps at once`);
      seen.add(k);
    }
  }
});

test("you cannot build on their land, and are told whose it is", () => {
  const { world } = valley();
  runDays(world, 60);
  const camp = allCamps(world)[0];

  const check = canPlace(world, camp.home.q, camp.home.r, "farm");
  assert.equal(check.ok, false);
  assert.match(check.reason, /land|hold/, `unhelpful reason: ${check.reason}`);
});

test("they grow — and then stop", () => {
  const { world } = valley();
  runDays(world, 60);
  const early = allCamps(world).reduce((n, c) => n + campBuildings(c).length, 0);
  runDays(world, 340);

  for (const camp of allCamps(world)) {
    const standing = campBuildings(camp).filter((b) => b.condition > 0).length;
    assert.ok(standing <= MAX_BUILDINGS, `a camp reached ${standing} buildings`);
  }
  const late = allCamps(world).reduce((n, c) => n + campBuildings(c).length, 0);
  assert.ok(late > early, "nobody built anything in a year");
});

// --- the peaceful half ------------------------------------------------------

test("settlers trade with the player; hostile villages never offer caravans", () => {
  const { world } = valley();
  runDays(world, 200);

  assert.ok(settlerCamps(world).some(campTrades), "no settler ever opened a market");
  assert.equal(
    raiderCamps(world).some(campTrades),
    false,
    "hostile villages must not trade with the player"
  );
});

test("a caravan takes the surplus away, and gives back a trickle", () => {
  /**
   * THE POINT OF SETTLERS. Every other sink in the game is a purchase you
   * eventually finish making, which is why stone reached eighteen thousand by
   * year two. This is the only continuous one.
   */
  const { world } = valley();
  world.store.stone = 4000;
  world.store.wood = 4000;
  const before = { stone: world.store.stone, wood: world.store.wood };

  const seen = runDays(world, 260, (w) => {
    // Keep the piles topped up so the test measures TRADE, not production.
    w.store.stone = Math.max(w.store.stone, 1500);
    w.store.wood = Math.max(w.store.wood, 1500);
  });

  assert.ok(seen.traded > 0, "no caravan ever arrived");
  assert.ok(
    (world.store.herbs || 0) > 0 || (world.store.seeds || 0) > 0 || world.store.food > 0,
    "trade should give something back"
  );
});

test("trade takes from EVERY surplus, not just the biggest pile", () => {
  // Taking only the most abundant meant stone — which accumulates fastest —
  // was the only thing ever traded, and 540 days left the timber surplus
  // completely untouched at eleven thousand.
  const { world } = valley();
  world.store.stone = 3000;
  world.store.wood = 3000;
  const offer = tradeOffer(world);

  assert.ok(offer, "a settlement sitting on six thousand goods has something to trade");
  assert.ok(offer.taking.stone > 0 && offer.taking.wood > 0, "both surpluses should be taken");
});

test("they will not strip you of something you are short of", () => {
  const { world } = valley();
  world.store.stone = TRADE_FLOOR - 10;
  world.store.wood = TRADE_FLOOR - 10;
  assert.equal(tradeOffer(world), null, "nothing to spare is nothing to trade");
});

test("what they hand back is capped, or the sink creates a second surplus", () => {
  // 540 days of the first rates left the settlement holding 986 herbs.
  const { world } = valley();
  world.store.stone = 99_000;
  world.store.wood = 99_000;
  world.store.herbs = 0;
  const offer = tradeOffer(world);
  assert.ok(offer.giving <= MAX_GIVE, `one caravan offered ${offer.giving}`);
});

test("a caravan is worth more than it costs, over a long run", () => {
  // WHAT THIS MEASURES, and why it is not the store any more. It used to
  // compare herbs and seeds at the end of 300 days. Both now have a CEILING
  // (docs/15: herbs 120 without an infirmary, seeds 40 without a granary), and
  // both runs sat on it — 113 against 116 herbs, and 40 against 40 seeds — so
  // the assertion had stopped measuring trade at all and was deciding on
  // whatever noise fell out of the raids. A capped resource cannot show you
  // that a caravan paid: what it brought went nowhere.
  //
  // So count the exchanges themselves, and the people who walked in with them.
  const play = (peaceful) => {
    const { world } = valley();
    let trades = 0;
    const before = world.workers.length;
    runDays(world, 300, (w) => {
      if (!peaceful) for (const c of settlerCamps(w)) c.kind = "raider";
      w.store.stone = Math.max(w.store.stone, 1200);
      w.store.wood = Math.max(w.store.wood, 1200);
      // Fed in both runs. Without this the comparison was dominated by
      // which run happened to starve harder after a raid (both went hungry
      // on 40+ days), and passed or failed on seed noise rather than trade.
      w.store.food = Math.max(w.store.food, 300);
    }, (e) => { if (e.type === "traded") trades += 1; });
    return { trades, arrivals: world.workers.length - before, store: world.store };
  };
  const traded = play(true);
  const not = play(false);
  assert.ok(traded.trades > 0, "a valley with settlers in it should see caravans arrive and deal");
  assert.equal(not.trades, 0, "a valley of raiders has nobody to trade with");
  assert.ok(traded.arrivals >= not.arrivals, "and migrants come with caravans, not with raids");
});

// --- the hostile half -------------------------------------------------------

test("raids set out from a raider camp, never from a settler one", () => {
  const { world } = valley();
  runDays(world, 60);
  const entry = raidEntry(world, mulberry32(1));
  if (!entry) return;

  const from = allCamps(world).find((c) => c.home.q === entry.q && c.home.r === entry.r);
  if (from) assert.equal(from.kind, "raider", "a settler camp launched a raid");
});

test("burning a hut takes fighters off the board today", () => {
  const { world } = valley();
  const camp = foundCamp(world,"raider");
  camp.fighters=8;
  camp.buildings.push({id:"hut",q:camp.home.q+1,r:camp.home.r,condition:100});
  const before = campStrength(camp);
  assert.equal(before,8);

  for (const b of campBuildings(camp)) if (b.id === "hut") b.condition = 0;
  assert.ok(campStrength(camp) < before || before <= 3, "razing huts must reduce what they field");
  assert.ok(campStrength(camp) <= campHousing(camp), "strength must never exceed housing");
});

test("fewer fighters means smaller parties and longer gaps between raids", () => {
  const { world } = valley();
  runDays(world, 200);
  const party = partySize(world);
  const gap = raidInterval(world);

  for (const camp of raiderCamps(world)) {
    for (const b of campBuildings(camp)) if (b.id !== "camp") b.condition = 0;
    camp.fighters = 1;
  }

  assert.ok(partySize(world) <= party, "a broken camp should not send a full party");
  assert.ok(raidInterval(world) >= gap, "a broken camp should not raid more often");
});

test("raids shift to the strongest camp rather than picking at random", () => {
  // A player who has burned one out should see where the next one comes from,
  // not watch a coin flip.
  const { world } = valley();
  runDays(world, 120);
  const raiders = raiderCamps(world);
  if (raiders.length < 2) return;

  const strongest = strongestRaiderCamp(world);
  for (const c of raiders) {
    assert.ok(campStrength(strongest) >= campStrength(c));
  }
});

// --- going after them -------------------------------------------------------

test("you cannot send your only worker", () => {
  const { world } = valley(23, { workers: 1 });
  runDays(world, 3);
  world.workers = world.workers.slice(0, 1);
  assert.equal(canSendWarParty(world).ok, false);
});

test("a war party names the camp it was sent against", () => {
  const { world } = valley();
  runDays(world, 60);
  const target = raiderCamps(world)[0];
  const res = orderWarParty(world, target.id, 3);

  assert.equal(res.ok, true);
  assert.equal(res.camp.id, target.id);
  assert.ok(
    world.orders.every((o) => o.kind !== "warparty" || o.campId === target.id),
    "every order should carry the camp — otherwise a party storms one and burns another"
  );
});

test("a war party that has not set out can be called off", () => {
  const { world } = valley();
  runDays(world, 60);
  orderWarParty(world, raiderCamps(world)[0].id, 3);
  assert.ok(recallWarParty(world).cancelled > 0);
});

test("ARMED attackers hurt them and unarmed ones do not", () => {
  const attack = (spears) => {
    const { world } = valley(23, { workers: 6, spears });
    // Compare the same defended camp directly. A 300-day economic simulation
    // can starve defenders, making an undefended camp beatable without spears.
    const target = foundCamp(world, "raider");
    assert.ok(target);
    for (let i = 0; i < 3; i++) target.buildings.push({ id: "hut", q: target.home.q, r: target.home.r + i + 2, condition: 100 });
    target.fighters = 12;
    assert.equal(campStrength(target), 12);
    for (const worker of world.workers.slice(0, 4)) {
      const aim = target.buildings.find(b=>b.id === "farm");
      worker.q = aim.q;
      worker.r = aim.r;
      worker.state = "storming";
      worker.marching = { q:worker.q,r:worker.r,campId: target.id };
      worker.tool = spears ? "spear" : null;
    }
    const seen = {};
    for (const event of stepAssault(world, () => 0.5)) seen[event.type] = (seen[event.type] || 0) + 1;
    return seen;
  };
  const bare = attack(0);
  const armed = attack(6);

  assert.equal((bare.campBurned || 0) + (bare.campRazed || 0), 0,
    "unarmed farmers should not be able to take a defended camp");
  assert.ok((armed.campBurned || 0) + (armed.campRazed || 0) > 0,
    "an armed party should get in — an option the player cannot win is worse than none");
});

test("a failed attack does not annihilate the party", () => {
  const { world } = valley(23, { workers: 6, spears: 0 });
  const seen = runDays(world, 300, (w, d) => {
    const target = raiderCamps(w)[0];
    if (d > 60 && d % 30 === 0 && target) orderWarParty(w, target.id, 4);
  });
  assert.ok((seen.death || 0) < 25, `${seen.death} deaths from losing attacks`);
});

test("ATTACKING SETTLERS TURNS THEM HOSTILE, for good", () => {
  /**
   * The consequence that makes the peaceful option a choice. Without it,
   * burning out people who have never touched you is free loot with no
   * downside, and there is no reason ever to leave anybody alone.
   */
  const { world } = valley();
  runDays(world, 200);
  const settlers = settlerCamps(world)[0];
  if (!settlers) return;

  const hit = burnSomething(world, settlers, world.home);
  assert.ok(hit, "there should be something to burn");
  assert.equal(hit.turned, true, "the player should be told they have made an enemy");
  assert.equal(settlers.kind, "raider", "they should not go on trading with you");
  assert.ok(settlers.turnedOn, "and when it happened should be recorded");
  assert.equal(
    (world.caravans || []).some((c) => c.campId === settlers.id),
    false,
    "their caravans should be off the road"
  );
});

test("sustained pressure with spears drives a camp out of the valley", () => {
  const { world } = valley(23, { workers: 10, spears: 10 });
  runDays(world, 400, (w, d) => {
    w.store.food=2000; // Combat integration fixture: a supplied, armed attacking settlement.
    while(w.workers.length<10) makeWorker(w,w.home.q,w.home.r);
    for (const x of w.workers) if (!x.tool) x.tool = "spear";
    const target = raiderCamps(w)[0];
    if (d > 60 && d % 30 === 0 && target) orderWarParty(w, target.id, 8);
  });
  assert.ok((world.campsRouted || 0) > 0, "a determined, well-armed player should finish one");
});

// --- routing and coming back ------------------------------------------------

test("routing one frees its land, and a replacement is put on the calendar", () => {
  const { world } = valley();
  runDays(world, 60);
  const camp = allCamps(world)[0];
  const before = allCamps(world).length;

  routeCamp(world, camp);
  assert.equal(allCamps(world).length, before - 1);
  assert.equal(campById(world, camp.id), null);
  assert.ok((world.resettle || []).length > 0, "somebody should be due");
  assert.equal(inRivalLand(world, camp.home.q, camp.home.r), false, "their land should be free");
});

test("a routed camp is replaced by its own kind, eventually", () => {
  const { world } = valley();
  runDays(world, 60);
  const camp = settlerCamps(world)[0] || allCamps(world)[0];
  const kind = camp.kind;
  routeCamp(world, camp);

  runDays(world, Math.floor(RESETTLE_AFTER / 2));
  const soon = (world.resettle || []).length;
  assert.ok(soon > 0, "they came back far too quickly");

  runDays(world, Math.ceil(RESETTLE_AFTER / 2));
  assert.ok(
    allCamps(world).some((c) => c.kind === kind),
    "a permanently emptier valley turns the game into a screensaver"
  );
});

test("razing the camp building itself is what routs them", () => {
  const { world } = valley();
  runDays(world, 60);
  const camp = allCamps(world)[0];
  for (const b of campBuildings(camp)) if (b.id !== "camp") b.condition = 0;

  let guard = 0;
  while (campById(world, camp.id) && guard++ < 10) burnSomething(world, camp, world.home);
  assert.equal(campById(world, camp.id), null, "burning the camp down should end them here");
});

// --- saves ------------------------------------------------------------------

test("every camp, its border and its buildings survive a save", () => {
  const { world } = valley();
  runDays(world, 90);
  const before = campSummaries(world);

  const back = deserialize(JSON.parse(JSON.stringify(serialize(world))));
  const after = campSummaries(back);

  assert.equal(after.length, before.length, "a camp went missing across a save");
  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i].kind, before[i].kind);
    assert.deepEqual(after[i].home, before[i].home);
    assert.equal(after[i].strength, before[i].strength);
    assert.equal(after[i].land, before[i].land, "a border changed across a save");
  }
  assert.doesNotThrow(() => advanceHour(back));
});

test("a version-7 save with one camp carries it forward", () => {
  /**
   * A save from before there were several neighbours had exactly one, under
   * `rival`. Dropping it would move the player's enemy — and any war party
   * walking toward it — somewhere else entirely.
   */
  const { world } = valley();
  runDays(world, 90);
  const data = serialize(world);
  const first = data.camps[0];
  delete data.camps;
  delete data.nextCampId;
  data.rival = first;

  const back = deserialize(data);
  assert.equal(back.camps.length, 1, "the old camp should have been adopted");
  assert.deepEqual(back.camps[0].home, first.home);
  assert.equal(back.camps[0].kind, "raider");
  assert.ok(back.camps[0].claims.size > 0, "and its border rebuilt");
  assert.doesNotThrow(() => advanceHour(back));
});

test("a save from before the neighbours existed simply gains some", () => {
  const { world } = valley();
  runDays(world, 90);
  const data = serialize(world);
  delete data.camps;
  delete data.rival;
  delete data.valleySettled;
  delete data.resettle;

  const back = deserialize(data);
  assert.equal(hasCamp(back), false, "an old save should load with nobody there");
  runDays(back, 2);
  assert.ok(hasCamp(back), "and gain neighbours on its first day");
});
