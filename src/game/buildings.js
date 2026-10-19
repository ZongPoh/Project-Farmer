/**
 * Buildings, the store, and production. (Step 3)
 *
 * Same pattern as terrain.js: the rules are DATA. To add a building you add
 * an entry to BUILDINGS and nothing else changes — the build panel reads this
 * table, production reads this table, and so do the tests.
 *
 * Nothing in this file mutates the world on its own schedule. `produceHour()` is
 * called by advanceHour; player placement and repair are synchronous actions.
 */
import { neighbors, key } from "./hex.js";
import { manuredFarms, MANURE_BOOST } from "./livestock.js";
import { timberFactor, rockFactor, drawGround } from "./ground.js";
import { operational, beginConstruction, constructionHours } from "./construction.js";
import {
  getTile, getTerrain, getBuilding, touchTile, activeTiles, markActive, unmarkActive,
} from "./tiles.js";
import { seasonFactors } from "./calendar.js";
import { addResource, storageCapacity } from "./economy.js";
import { claimTile, claimArea, unclaimTile, outsideReason, BASE_CLAIM_RADIUS } from "./territory.js";

/**
 * cost     resources removed from the store when you place it
 * needs    terrains it can sit on
 * yields   resources added to the store PER HOUR, scaled by condition
 * chance   things that may turn up on any given hour, as {resource: odds}
 * unique   only one may exist on the whole board
 * decay    condition lost per day (condition is 100 -> 0)
 * blocks   species that cannot walk onto this tile
 * barrier  {integrity} — see the note on barriers below
 * watch    how many tiles it keeps an eye on, for the raid warning
 * guards   defence it lends to anyone fighting near it
 * protects resources a raid cannot take, per building
 * stables  how many caught horses it can keep
 * beds     how many hurt people it can look after at once
 */
export const BUILDINGS = {
  house: { label: "House", cost: { wood: 35, stone: 10 }, needs: ["grass"], decay: 0.3, describe: "Sleeps four more residents, up to the number the base level holds — a Camp holds 4, a Town 22. Food still limits recruitment." },
  warehouse: { label: "Warehouse", cost: { wood: 45, stone: 25 }, needs: ["grass", "sand"], decay: 0.3, describe: "Adds space for 600 wood and 450 stone. Full stores pause new supplies." },
  market: { label: "Market", cost: { wood: 50, stone: 30 }, needs: ["grass"], decay: 0.3, describe: "Buy and sell resources for coins. All markets share one limited merchant stock, refreshed every seven days." },
  base: {
    label: "Base",
    cost: {},
    needs: ["grass"],
    unique: true,
    decay: 0,
    describe: "Home. Workers are recruited here and set out from here.",
  },
  farm: {
    label: "Farm",
    cost: { wood: 4 },
    needs: ["grass"],
    yields: { food: 1 },
    decay: 0.5,
    describe: "Grows up to 1 food an hour before seasonal bonuses. No harvest in winter. Rabbits will eat it if you let them.",
  },
  woodcutter: {
    label: "Woodcutter",
    cost: { wood: 2 },
    // Trees, not grass. Where the woods are is now a thing you have to find
    // on the map — or plant.
    needs: ["forest"],
    yields: { wood: 1 },
    // Working a wood turns up seeds now and then, which is the only way to
    // plant more forest. Roughly one every day and a half — a find, not a
    // stream. At one every ten hours a woodcutter produced twenty-seven in
    // its first fortnight and planting stopped being a decision.
    chance: { seeds: 0.03 },
    decay: 0.8,
    describe: "Cuts 1 wood an hour and turns up the odd seed. Must stand in forest.",
  },
  quarryCamp: {
    label: "Quarry camp",
    cost: { wood: 3 },
    needs: ["sand"],
    yields: { stone: 1 },
    decay: 0.8,
    describe: "Digs 1 stone an hour out of broken rock.",
  },
  well: {
    label: "Well",
    cost: { stone: 3 },
    needs: ["sand"],
    decay: 0,
    // A well lets you irrigate sand that does NOT touch water — see terrain.js.
    enables: "irrigate",
    describe: "Lets neighbouring sand be irrigated without touching water.",
  },
  // Completed barriers block movement. Gates admit workers and friendly trade.
  fence: {
    label: "Fence",
    cost: { wood: 2 },
    needs: ["grass", "sand"],
    decay: 1.5,
    // Foxes AND rabbits. A fence that keeps predators out but lets the pests
    // walk in would give the player no answer at all to crop raiding.
    blocks: ["fox", "rabbit"],
    barrier: { integrity: 25 },
    describe: "Stops anything crossing — fox, rabbit or raider — but not for long. Wears out.",
  },

  // --- stone, and things to do about the rivals ----------------------------
  //
  // Everything below exists for two reasons at once. Stone had exactly two
  // sinks (the base and tools), both of which you finish wanting; and the
  // rival farmers needed something to be resisted BY. One set of buildings
  // answers both, which is why they arrived together.

  wall: {
    label: "Stone wall",
    cost: { stone: 6 },
    needs: ["grass", "sand"],
    // Stone does not rot. A wall is the one thing on the board you can build
    // and then forget about, which is the point of paying in the slow resource.
    decay: 0,
    blocks: ["fox", "rabbit"],
    // Six times a fence. A raiding party needs the better part of a week to
    // get through, which on most raids means they give up and go home.
    barrier: { integrity: 150 },
    describe: "Blocks all passage. Add a gate for friendly traffic, or mount a watchtower here.",
  },
  gate: {
    label: "Gate", cost: { wood: 8, stone: 4 }, needs: ["grass", "sand"], decay: 0.3,
    barrier: { integrity: 100 }, blocks: ["fox", "rabbit", "horse"],
    describe: "Connects walls or fences. Opens for workers and friendly traders; blocks animals and raiders.",
  },
  wallTower: {
    label: "Wall watchtower", cost: { wood: 30, stone: 40 }, needs: ["grass", "sand"], decay: 0.4,
    barrier: { integrity: 150 }, watch: 9, guards: 0.5,
    describe: "A fortified lookout mounted on a wall. Spots movement within 9 tiles and shoots attackers within 5 tiles.",
  },
  watchtower: {
    label: "Watchtower",
    cost: { wood: 30, stone: 40 },
    // On a mountain as well, which is the only reason to keep one un-quarried.
    needs: ["grass", "sand", "mountain"],
    decay: 0.4,
    watch: 7,
    guards: 0.5,
    describe: "Spots rival movement within 7 tiles and shoots attacking raiders within 4 tiles. Can be mounted on a completed wall.",
  },
  granary: {
    label: "Granary",
    cost: { wood: 40, stone: 25 },
    needs: ["grass"],
    decay: 0.3,
    // What a raid cannot carry off. Deliberately generous: a player who has
    // understood the threat and built for it should be able to stop caring
    // about it, rather than being taxed forever.
    protects: { food: 150, wood: 120, stone: 80 },
    describe: "Adds 900 food storage and protects 150 food, 120 wood and 80 stone from raids.",
  },
  infirmary: {
    label: "Infirmary",
    cost: { wood: 35, stone: 20 },
    needs: ["grass"],
    decay: 0.4,
    beds: 3,
    describe: "Somewhere for the hurt to lie up. Wounds do not turn bad in a bed.",
  },
  monument: {
    label: "Monument",
    cost: { wood: 60, stone: 80 },
    needs: ["grass"],
    unique: true,
    // Stone, and the tallest stone there is. It does not rot and the masons
    // are there every day anyway.
    decay: 0,
    // The one flat benefit of building something enormous: you can see out of
    // it. Further than any watchtower, because it is taller than any of them.
    watch: 12,
    guards: 0.5,
    describe: "A tower raised course by course. Takes stone and timber every day for the rest of the game, keeping a reserve back. Watches 12 tiles — and can be seen just as far, which raiders notice.",
  },
  coop: {
    label: "Hen coop",
    cost: { wood: 18 },
    // Sand as well as grass: a coop does not care what it stands on, and dry
    // ground had exactly one use before goats and this.
    needs: ["grass", "sand"],
    decay: 0.5,
    roosts: 6,
    describe: "Roosts six hens. They eat grain — seeds — and lay all year, winter included. A fox will take them unless the coop is fenced in.",
  },
  paddock: {
    label: "Paddock",
    cost: { wood: 25, stone: 10 },
    needs: ["grass"],
    decay: 0.6,
    stables: 3,
    describe: "Somewhere to keep caught horses. Three to a paddock.",
  },
};

export const BUILDING_IDS = Object.keys(BUILDINGS);

/** A fresh store. Enough wood for one farm and a bit of slack.
 * @returns {{food:number, wood:number, stone:number, seeds:number, herbs:number, coins?:number}}
 */
export const startingStore = () => ({ food: 20, wood: 8, stone: 0, seeds: 1, herbs: 0, coins: 30 });

/** Does the store hold at least this much of everything? */
export function canAfford(store, cost = {}) {
  return Object.entries(cost).every(([res, n]) => (store[res] || 0) >= n);
}

function pay(store, cost = {}) {
  for (const [res, n] of Object.entries(cost)) store[res] = (store[res] || 0) - n;
}

/** Is there a `buildingId` on any tile next to this one? */
export function hasNeighbouringBuilding(world, tile, buildingId) {
  return neighbors(tile.q, tile.r).some((n) => {
    const b = getBuilding(world, n.q, n.r);
    return b && b.id === buildingId;
  });
}

/**
 * How many of this building exist.
 *
 * Walks the ACTIVE set, not the board. A building is by definition an active
 * tile, so this is O(things you built) rather than O(map size) — the
 * difference between instant and 80,000 iterations on a big board.
 */
export function countBuildings(world, buildingId) {
  let n = 0;
  for (const tile of activeTiles(world)) {
    if (operational(tile.building) && tile.building.id === buildingId) n++;
  }
  return n;
}

// --- what your buildings do for you ----------------------------------------
//
// All of these walk the ACTIVE set for the same reason countBuildings does:
// the cost is what you built, not how big the map is. All of them scale by
// condition too, so letting a granary rot quietly opens your stores back up
// rather than silently protecting them forever.

/** Condition as 0..1. A ruin does nothing; a half-kept building does half. */
const working = (b) => operational(b) ? Math.max(0, Math.min(1, b.condition / 100)) : 0;

/**
 * How much of each resource a raid simply cannot take.
 *
 * Granaries stack, which is the whole progression: one is a cushion, four is
 * a settlement that has stopped being worth robbing.
 */
export function protectedStores(world) {
  const total = {};
  for (const tile of activeTiles(world)) {
    const b = tile.building;
    if (!b) continue;
    const def = BUILDINGS[b.id];
    if (!def || !def.protects) continue;
    const scale = working(b);
    for (const [res, n] of Object.entries(def.protects)) {
      total[res] = (total[res] || 0) + n * scale;
    }
  }
  return total;
}

/** How many horses there is room to keep. */
export function stableCapacity(world) {
  let n = 0;
  for (const tile of activeTiles(world)) {
    const b = tile.building;
    if (!b) continue;
    const def = BUILDINGS[b.id];
    if (def && def.stables) n += Math.floor(def.stables * working(b));
  }
  return n;
}

/** Every watchtower, with where it stands and how far it sees. */
export function watchtowers(world) {
  const out = [];
  for (const tile of activeTiles(world)) {
    const b = tile.building;
    if (!b) continue;
    const def = BUILDINGS[b.id];
    if (!def || !def.watch) continue;
    const scale = working(b);
    if (scale <= 0) continue;
    out.push({
      q: tile.q,
      r: tile.r,
      // A neglected tower sees less far, which is a gentler failure than a
      // tower that either works perfectly or not at all.
      range: Math.round(def.watch * scale),
      guards: (def.guards || 0) * scale,
      shootingRange: b.id === "wallTower" ? 5 : 4,
    });
  }
  return out;
}

/**
 * Is there a barrier standing here?
 *
 * A barrier in ruins is a gap. `condition` is the wear-and-tear track that
 * repairs restore; `breach` is damage done by somebody hammering at it during
 * a raid, and it is what actually decides whether they get through.
 */
export function barrierAt(world, q, r) {
  const b = getBuilding(world, q, r);
  if (!operational(b) && !(b?.id === "wallTower" && b.condition > 0)) return null;
  const def = BUILDINGS[b.id];
  if (!def || !def.barrier) return null;
  if (b.condition <= 15) return null;
  const left = def.barrier.integrity * (b.condition / 100) - (b.breach || 0);
  return left > 0 ? { building: b, def, left } : null;
}

/** Will a raider refuse to walk onto this tile? */
export function barsRaiders(world, q, r) {
  return barrierAt(world, q, r) !== null;
}

/**
 * Somebody is hammering at the barrier here. Returns true once they are through.
 *
 * Breach damage is separate from `condition` on purpose: a barrier that has
 * been broken open should not be indistinguishable from one that is merely old,
 * and repairing a breach should cost the same as repairing anything else.
 */
export function breachBarrier(world, q, r, force = 1) {
  const at = barrierAt(world, q, r);
  if (!at) return true;
  at.building.breach = (at.building.breach || 0) + force;
  const through = at.def.barrier.integrity * (at.building.condition / 100) - at.building.breach <= 0;
  if (through) {
    // Knocked down, not merely dented. It has to be rebuilt.
    at.building.condition = Math.min(at.building.condition, 10);
  }
  return through;
}

/**
 * Can this building go here?
 *
 * Returns { ok: true } or { ok: false, reason }. Same shape as startWork in
 * tick.js — every "can I?" in this codebase answers with a reason string the
 * UI can put straight on a disabled button.
 */
export function canPlace(world, q, r, buildingId) {
  const tile = getTile(world, q, r);
  if (!tile) return { ok: false, reason: "no such tile" };

  const def = BUILDINGS[buildingId];
  if (!def) return { ok: false, reason: `unknown building "${buildingId}"` };

  const mounting = ["watchtower", "wallTower"].includes(buildingId) && tile.building?.id === "wall" && !tile.building.construction && !!barrierAt(world, q, r);
  if (buildingId === "wallTower" && !mounting) return { ok: false, reason: "requires a completed, intact wall" };
  if (tile.building && !mounting) return { ok: false, reason: `${tile.building.id} is already there` };
  if (buildingId === "gate" && !neighbors(q, r).some(n => ["wall", "fence", "gate", "wallTower"].includes(getBuilding(world, n.q, n.r)?.id))) return { ok: false, reason: "place next to a wall or fence" };
  if (tile.work) return { ok: false, reason: "that tile is being worked on" };
  if (!def.needs.includes(tile.terrain)) {
    return { ok: false, reason: `needs ${def.needs.join(" or ")}, this is ${tile.terrain}` };
  }
  if (def.unique && activeTiles(world).some(t => t.building?.id === buildingId)) {
    return { ok: false, reason: `you already have a ${def.label.toLowerCase()}` };
  }
  if (buildingId !== "base" && countBuildings(world, "base") === 0) {
    return { ok: false, reason: "finish building your base first" };
  }
  // Your land, or nothing. The base is the exception — it is the act that
  // creates the land in the first place, so it cannot require any.
  if (buildingId !== "base") {
    const outside = outsideReason(world, q, r);
    if (outside) return { ok: false, reason: outside };
  }
  if (!canAfford(world.store, def.cost)) {
    const short = Object.entries(def.cost)
      .filter(([res, n]) => (world.store[res] || 0) < n)
      .map(([res, n]) => `${n - (world.store[res] || 0)} more ${res}`)
      .join(", ");
    return { ok: false, reason: `not enough — need ${short}` };
  }
  return { ok: true };
}

export function place(world, q, r, buildingId) {
  const check = canPlace(world, q, r, buildingId);
  if (!check.ok) return check;

  // touchTile, not getTile: we are about to write, so we need the stored tile.
  const tile = touchTile(world, q, r);
  const def = BUILDINGS[buildingId];
  pay(world.store, def.cost);
  const wall = tile.building;
  const mounted = wall?.id === "wall" && ["watchtower", "wallTower"].includes(buildingId);
  tile.building = { id: mounted ? "wallTower" : buildingId, condition: mounted ? wall.condition : 100, builtOn: world.day, ...(mounted ? { breach: wall.breach || 0 } : {}) };
  beginConstruction(tile.building, null, world);
  markActive(world, q, r);

  // Building something takes the ground under it and the ring around it. The
  // base takes more, because it has to give you somewhere to start.
  if (buildingId === "base") {
    world.home = { q, r };
    claimArea(world, q, r, BASE_CLAIM_RADIUS);
  }
  else claimTile(world, q, r);

  return { ok: true, building: tile.building, hours: tile.building.construction?.needed || 0 };
}

export function demolish(world, q, r) {
  const existing = getBuilding(world, q, r);
  if (!existing) return { ok: false, reason: "nothing built there" };
  if (existing.id === "base") return { ok: false, reason: "you cannot tear down your base" };
  // Half the wood back, rounded down. Enough to undo a mistake, not enough to farm.
  const refund = Math.floor((BUILDINGS[existing.id].cost.wood || 0) / 2);
  const acceptedRefund = addResource(world, "wood", refund);
  const tile = touchTile(world, q, r);
  tile.building = null;
  unmarkActive(world, q, r);

  // Tearing a building down gives the ground back — UNLESS the terrain here
  // was worked, in which case the land is still yours. Refcounting in
  // territory.js means neighbours keep whatever they were claiming.
  if (!tile.worked) unclaimTile(world, q, r);

  return { ok: true, refund: acceptedRefund };
}

export const REPAIR_COST = { wood: 1 };

export function repair(world, q, r) {
  const existing = getBuilding(world, q, r);
  if (!existing) return { ok: false, reason: "nothing built there" };
  if (existing.construction) return { ok: false, reason: "construction is in progress" };
  if (existing.condition >= 100) return { ok: false, reason: "it is in perfect repair" };
  if (!canAfford(world.store, REPAIR_COST)) return { ok: false, reason: "not enough wood" };
  pay(world.store, REPAIR_COST);
  existing.condition = Math.min(100, existing.condition + 35);
  return { ok: true, condition: existing.condition };
}

/** The buildings you could put on this tile right now, each with its blocker. */
export function buildOptionsFor(world, tile) {
  return BUILDING_IDS.filter((id) => (tile.building?.id === "wall" ? id === "wallTower" : id !== "wallTower") && BUILDINGS[id].needs.includes(tile.terrain)).map((id) => {
    const check = canPlace(world, tile.q, tile.r, id);
    return {
      id,
      label: BUILDINGS[id].label,
      cost: BUILDINGS[id].cost,
      hours: constructionHours(id, world),
      describe: BUILDINGS[id].describe,
      blockedBy: check.ok ? null : check.reason,
    };
  });
}

/**
 * One HOUR of production. Called from advanceHour.
 *
 * Production moved from days to hours because a day per unit made the whole
 * game feel stalled — you pressed a button and watched one number change.
 * Yields in BUILDINGS are now per hour, and this runs twenty-four times as
 * often, so a woodcutter produces a visible stream instead of a daily drip.
 *
 * Wear, upkeep and anything else with a daily rhythm stayed daily; see
 * dailyWear() below. Splitting them is what keeps an hourly tick cheap.
 */
export function produceHour(world, rnd) {
  const events = [];
  const store = world.store;
  const season = seasonFactors(world.day);
  const capacity = storageCapacity(world);

  for (const tile of activeTiles(world)) {
    const b = tile.building;
    if (!operational(b)) continue;
    const def = BUILDINGS[b.id];

    if (def.yields) {
      // Condition and season both scale the yield. Only food is seasonal —
      // a woodcutter cuts the same wood in January as in June.
      const efficiency = b.condition / 100;
      for (const [res, n] of Object.entries(def.yields)) {
        if ((store[res] || 0) >= (capacity[res] ?? Infinity)) continue;
        let scale = res === "food" ? (season.id === "winter" ? 0 : season.growth) : 1;
        // Farmland: tired ground yields less, manured ground more. See
        // FERTILITY below and livestock.js.
        if (res === "food" && b.id === "farm") {
          scale *= fertilityOf(b);
          if (manuredFarms(world).has(key(tile.q, tile.r))) scale *= 1 + MANURE_BOOST;
        }
        // Woodland and rock: output is proportional to what is left in the
        // ground under the building. A stand grows back and a seam does not.
        // See ground.js for why these are the two shapes.
        if (res === "wood" && b.id === "woodcutter") scale *= timberFactor(world, tile);
        if (res === "stone" && b.id === "quarryCamp") scale *= rockFactor(world, tile);

        const produced = n * efficiency * scale;
        b.fraction = b.fraction || {};
        b.fraction[res] = (b.fraction[res] || 0) + produced;
        // Taken out of the ground it came from, continuously — not in whole
        // units. Rounding the draw would let a half-broken camp mine a seam
        // for nothing, which is exactly the class of leak this pass exists to
        // close.
        drawGround(world, tile, res, produced);
        // Only whole resources land in the store; the remainder carries over,
        // so a half-broken farm produces slowly rather than rounding to zero.
        const whole = Math.floor(b.fraction[res]);
        if (whole > 0) {
          store[res] = (store[res] || 0) + Math.min(whole, Math.max(0, (capacity[res] ?? Infinity) - (store[res] || 0)));
          b.fraction[res] -= whole;
        }
      }
    }

    // Occasional finds — seeds from a woodcutter. Rolled per hour, and only
    // while the building still works, so a ruined hut finds nothing.
    if (def.chance && b.condition > 0 && rnd) {
      for (const [res, odds] of Object.entries(def.chance)) {
        // Through the capacity check, like every other way goods arrive. This
        // wrote straight into the store, which is why forty woodcutters could
        // turn up 1,390 seeds in three years against a ceiling of 40.
        if (rnd() < odds * (b.condition / 100) && addResource(world, res, 1) > 0) {
          events.push({
            type: "find",
            q: tile.q, r: tile.r,
            text: `A ${res.replace(/s$/, "")} was found at ${tile.q},${tile.r}.`,
          });
        }
      }
    }
  }

  return events;
}

/**
 * One DAY of wear. Called from advanceHour when the day rolls over.
 *
 * Building decay has a daily rhythm and always has; running it hourly would
 * mean either twenty-four times the wear or fractions too small to read.
 */
/**
 * MASONRY UPKEEP — stone a day, per stone building. The continuous stone sink
 * the TODO has asked for since stone reached 18,000 by year two.
 *
 * Every stone building costs a little stone a day to keep pointed and sound,
 * so a big fortified settlement needs a quarry running rather than a pile it
 * never touches. Paid as fractional debt (like herbs and repair wood), whole
 * units at a time. Unpaid, those buildings lose UPKEEP_NEGLECT condition
 * each day — walls included, which otherwise never decay — and you are told
 * once, when it starts. Nothing is refused and nothing is taken that you do
 * not have.
 */
export const UPKEEP = {
  wall: 0.1, gate: 0.05, wallTower: 0.2, watchtower: 0.2,
  granary: 0.15, warehouse: 0.15, infirmary: 0.1, market: 0.1, house: 0.05,
};
/**
 * The monument is the exception, because its upkeep grows with it: a stone a
 * day per standing course. A finished one costs 8 a day forever, which is the
 * only masonry bill in the game big enough to plan around — and the point of
 * the thing is that it keeps costing you.
 */
export const MONUMENT_UPKEEP_PER_COURSE = 1;
export const UPKEEP_NEGLECT = 1;

export function masonryUpkeep(world) {
  let due = 0;
  for (const tile of activeTiles(world)) {
    const b = tile.building;
    if (!operational(b)) continue;
    if (b.id === "monument") due += MONUMENT_UPKEEP_PER_COURSE * (b.courses || 0);
    else due += UPKEEP[b.id] || 0;
  }
  return due;
}

function payUpkeep(world) {
  const events = [];
  const due = masonryUpkeep(world);
  if (!due) return events;
  world.stoneDebt = (world.stoneDebt || 0) + due;
  while (world.stoneDebt >= 1 && (world.store.stone || 0) >= 1) {
    world.stoneDebt -= 1;
    world.store.stone -= 1;
  }
  const neglected = world.stoneDebt >= 1;
  if (neglected) {
    // Do not let the debt grow without bound while the quarry is idle; a
    // single day's shortfall is what matters, not a year's arrears.
    world.stoneDebt = Math.min(world.stoneDebt, due + 1);
    for (const tile of activeTiles(world)) {
      const b = tile.building;
      if (operational(b) && (UPKEEP[b.id] || b.id === "monument")) b.condition = Math.max(1, b.condition - UPKEEP_NEGLECT);
    }
    if (!world.upkeepShort) {
      events.push({
        type: "upkeepShort",
        text: `There is no stone for upkeep — walls and stone buildings are wearing (${due.toFixed(1)} stone a day).`,
      });
    }
  }
  world.upkeepShort = neglected;
  return events;
}

export function dailyWear(world) {
  const events = payUpkeep(world);
  const season = seasonFactors(world.day);

  for (const tile of activeTiles(world)) {
    const b = tile.building;
    if (!operational(b)) continue;
    const def = BUILDINGS[b.id];
    if (!def.decay) continue;

    // A barrier mended back to full is whole again — the hole somebody
    // hammered in it during the last raid is gone. Done here, in the one
    // daily pass over everything built, rather than in each of the two places
    // that repair things.
    if (b.breach && b.condition >= 100) b.breach = 0;

    b.condition = Math.max(0, +(b.condition - def.decay * season.decay).toFixed(2));
    if (b.id === "farm") tendSoil(world, tile, b, season);

    if (b.condition <= 30 && !b.warned) {
      b.warned = true;
      events.push({
        type: "disrepair",
        q: tile.q, r: tile.r,
        text: `The ${def.label.toLowerCase()} at ${tile.q},${tile.r} is falling apart.`,
      });
    }
    if (b.condition > 60) b.warned = false;
  }

  return events;
}

/**
 * FARMLAND FERTILITY — the first continuous brake on the snowball.
 *
 * A farm used to yield the same forever, so the only limit on food was how
 * many farms you had built, and the playtest found the player growing very
 * fast. Now every growing day takes a little out of the ground, winter (when
 * nothing grows) puts some back, and manure from kept animals puts back more.
 *
 * Per year, with these numbers: 72 growing days x DRAIN = -0.29, 24 winter
 * days x REST = +0.19. So an unmanured farm dips through each summer, slides
 * about 0.1 a year overall and reaches FLOOR in its fifth; a well beside it
 * (+WELL a day) slows that, and manure from kept animals (+MANURE a day)
 * holds it at full. Nothing ever reaches zero — invariant 7, food must always
 * have a source that does not cost food.
 *
 * First tried at DRAIN 0.005 / FLOOR 0.45: in rivalcamp.test's 300-day
 * trading run — a settlement already on the edge from raids — that alone
 * turned four surviving workers into none. Too sharp for a first pass.
 */
export const FERTILITY = { DRAIN: 0.004, REST: 0.008, MANURE: 0.006, WELL: 0.002, FLOOR: 0.5 };

export const fertilityOf = (b) => (b && b.fertility != null ? b.fertility : 1);

function tendSoil(world, tile, b, season) {
  let f = fertilityOf(b);
  if (season.id === "winter") f += FERTILITY.REST;
  else f -= FERTILITY.DRAIN;
  if (manuredFarms(world).has(key(tile.q, tile.r))) f += FERTILITY.MANURE;
  if (neighbors(tile.q, tile.r).some((n) => getBuilding(world, n.q, n.r)?.id === "well")) f += FERTILITY.WELL;
  b.fertility = +Math.max(FERTILITY.FLOOR, Math.min(1, f)).toFixed(4);
}

/** Friendly gates are the only intact barriers people can cross. */
export function blocksMovement(world, q, r, actor = "friendly") {
  const barrier = barrierAt(world, q, r);
  return !!barrier && !(barrier.building.id === "gate" && actor === "friendly");
}
