/**
 * The neighbours — plural, and not all of them want to fight you.
 *
 * WHAT THIS IS. Other people live in the valley. Some are raiders, whose camp
 * is where raiding parties set out from; some are settlers, who farm, trade
 * with you and leave you alone unless you give them a reason not to. Both grow
 * on their own, both hold land, and how many of them there are depends on how
 * much valley there is.
 *
 * WHY SETTLERS EXIST, beyond "not everyone is hostile". They are the answer to
 * a problem that had been on the TODO for three passes: stone and timber run
 * away. A working settlement reaches eighteen thousand stone by year two with
 * nothing whatsoever to spend it on, because every sink in the game is a
 * one-off purchase. A caravan that turns up every fortnight and takes two
 * hundred stone off your hands in exchange for food and seed is a CONTINUOUS
 * sink, which is the shape the problem always needed.
 *
 * Settlements evaluate legal utility-scored actions daily. Costs, production,
 * construction, housing, storage and winter rules come from shared player tables.
 * Residents have local worker routes; production remains building-based.
 *
 * WHY THEIR BUILDINGS ARE NOT ON TILES. The obvious implementation is
 * `tile.building` with a faction marker. It is also a trap: `produceHour`,
 * `dailyWear`, `countBuildings`, `protectedStores`, `findRepairChore` and the
 * auto-repair chore all walk the active set and would need a faction check
 * added to each — and the day somebody forgets one, the player's farms start
 * paying out for a settler's fields, or their workers stroll across the valley
 * to mend a raider's hut. Every camp's buildings live on the camp.
 */
import { key, neighbors, distance } from "./hex.js";
import { storageCapacity } from "./economy.js";
import { getTerrain, setTerrain } from "./tiles.js";
import { BUILDINGS } from "./buildings.js";
import { initialiseCamp, campDailyEconomy, chooseCampAction, executeCampAction, playerBuildingId, creditCamp, campResidents, campCapacity, campBeds, campCeiling } from "./campAI.js";
import { seasonOf } from "./calendar.js";
import { startCampExpedition } from "./campExpeditions.js";
import { TERRAIN } from "./terrain.js";
import { findPath, canWalk } from "./workers.js";
import { beginConstruction, operational } from "./construction.js";
import {
  campHolding, claimFor, claimAreaFor, inTerritory, inRivalLand, ownedBy,
} from "./territory.js";

// ---------------------------------------------------------------------------
// HOW MANY, AND HOW FAR
// ---------------------------------------------------------------------------

/**
 * The most neighbours a board will ever hold.
 *
 * Six is a lot of moving parts on screen and in the panel; past that the map
 * stops reading as "a valley with people in it" and starts reading as a
 * strategy game's minimap.
 */
export const MAX_CAMPS = 6;

/**
 * How many settle, given the size of the board.
 *
 * Square-rooted because what matters is how far apart they can be, not how
 * many tiles there are: area grows as the square of distance, so a board four
 * times the size supports twice the neighbours, not four times.
 *
 *   24 x 16   (384)      2
 *   40 x 28   (1,120)    3
 *   120 x 80  (9,600)    6   (capped)
 *   400 x 200 (80,000)   6   (capped)
 */
export function campCountFor(world) {
  const tiles = (world.grid.width || 1) * (world.grid.height || 1);
  return Math.max(1, Math.min(MAX_CAMPS, Math.round(Math.sqrt(tiles) / 13)));
}

/**
 * How far off they settle, also scaled.
 *
 * A fixed ten tiles is a journey on the default board and literally next door
 * on a 400x200 one, where your own territory alone can be three hundred tiles.
 */
export function campDistanceFor(world) {
  const tiles = (world.grid.width || 1) * (world.grid.height || 1);
  return Math.max(8, Math.min(40, Math.round(Math.sqrt(tiles) / 4)));
}

/** ...and how far apart they settle from EACH OTHER. */
export const campSpacingFor = (world) => Math.max(6, Math.round(campDistanceFor(world) * 0.7));

/**
 * Who settles where in the running order.
 *
 * The first is always a raider, because the game needs its pressure and a
 * board whose only neighbour is friendly has no threat in it at all. The
 * second is always a settler, so that trade exists on every board big enough
 * to hold two. After that they alternate.
 */
export const campKindFor = (index) => (index === 0 ? "raider" : index % 2 === 1 ? "settler" : "raider");

// ---------------------------------------------------------------------------
// THE DIALS
// ---------------------------------------------------------------------------

export const CAMP_CLAIM_RADIUS = 1;
export const BUILD_EVERY = 12;
export const EXPAND_EVERY = 7;

export const RIVAL_FARM_YIELD = 14;
export const RIVAL_UPKEEP = 4;
export const RECRUIT_AT = 90;

export const START_STRENGTH = 2;
/**
 * Hard ceiling on fighters. Was 12, and was one of the three flat caps behind
 * the plateau. The real ceiling now comes from `campCeiling` (level and your
 * size); this only stops something absurd.
 */
export const MAX_STRENGTH = 28;
/** Strength at which a camp counts as fully prosperous. What 12 used to mean. */
export const PROSPEROUS_AT = 12;

/** Condition a rival building loses to a torch. Two hits razes one. */
export const BURN_DAMAGE = 55;

/**
 * Days before a routed settlement is replaced by a new one.
 *
 * Driving them out has to MEAN something — that is the whole point of being
 * allowed to attack — but a permanently empty valley turns an idle game into a
 * screensaver. Word gets around that this valley is rich.
 */
export const RESETTLE_AFTER = 110;

/**
 * How large one of them was allowed to get — now only the fallback for code
 * that has no world to hand. The live ceiling is `campCeiling` in campAI.js,
 * which rises with their level and tracks your size. Original note:
 *
 * MEASURED: without a ceiling a camp reached 21 fields, 8 huts and 38,000 food
 * by day 400 and was still building. None of it did anything — prosperity pins
 * at 1 by about day 100 — so the growth was pure bookkeeping, and the only
 * effect was that burning them out took twenty-one torches.
 */
export const MAX_BUILDINGS = 24;
export const MAX_CLAIMS = 70;

export const FOOD_CEILING = 400;
export const STORE_HOLDS = 250;

// --- trade -----------------------------------------------------------------

/**
 * Days between one settler caravan and the next, per camp.
 *
 * MEASURED over 540 days with one settler camp: trade cut the stone surplus
 * from 19,600 to 15,700 and the timber from 11,100 to 7,700 — a real dent
 * rather than a complete answer, and it scales with how many settlers the
 * board holds. Eleven days rather than fourteen buys another quarter of that
 * without caravans becoming constant traffic across the valley.
 */
export const TRADE_EVERY = 11;

/**
 * How much a caravan carries away.
 *
 * SIZED AGAINST THE PROBLEM, not picked. A developed settlement accumulates
 * roughly 33 stone a day with every sink in the game already bought. One
 * caravan every fortnight taking 200 is about 14 a day per settler camp, so
 * two or three of them genuinely bite. Anything much smaller would be a
 * gesture rather than a sink.
 */
export const CARAVAN_CAPACITY = 200;

/** Tiles a caravan covers in a day. They are not in a hurry. */
export const CARAVAN_SPEED = 3;

/** Days a caravan will wait around before giving up and going home. */
export const CARAVAN_PATIENCE = 30;

/**
 * What they give for what they take.
 *
 * Deliberately poor value per unit: this is a way of turning a pile you cannot
 * use into a trickle of something you can, not an exchange rate to optimise.
 * A player who is short of stone should never want to sell it.
 *
 * MEASURED. The first rates (2.5 stone per food, 4 per herb, 9 per seed) were
 * far too kind — 540 days of caravans left the settlement holding 986 herbs
 * and 978 seeds, hundreds of times more than anything could use. A sink that
 * creates a second, worse surplus has not solved anything.
 */
export const TRADE_RATES = { food: 5, herbs: 10, seeds: 20 };

/**
 * The most of one thing a single caravan will hand over.
 *
 * The cap matters more than the rates: without it, a settlement sitting on
 * twenty thousand stone could empty a caravan's entire stock in one visit.
 */
export const MAX_GIVE = 40;

/** What they will take off your hands. */
export const TRADEABLE = ["stone", "wood"];

/** Never strip you below this — they are traders, not bailiffs. */
export const TRADE_FLOOR = 80;

/** Requested caravans carry an exact quote; automatic caravans still take surplus. */
export const REQUEST_VALUE = { stone: 1, wood: 1, herbs: 3, food: 1, seeds: 4 };
export function requestedQuote(world, campId, sell, want, amount) {
  const camp = campById(world, campId);
  if (!camp || camp.kind !== "settler" || !campTrades(camp)) return { ok: false, reason: "a peaceful neighbour needs a market" };
  if (!REQUEST_VALUE[sell] || !REQUEST_VALUE[want] || sell === want || !Number.isInteger(amount) || amount < 10 || amount > 200) return { ok: false, reason: "choose different goods and 10–200 units" };
  const reserve = sell === "herbs" ? 10 : sell === "food" ? Math.max(30, world.workers.length * 12) : 20;
  if ((world.store[sell] || 0) < amount + reserve) return { ok: false, reason: `keep ${reserve} ${sell} in reserve` };
  if ((world.caravans || []).some(c => c.campId === campId && c.state === "coming")) return { ok: false, reason: "a caravan is already coming from there" };
  if (camp.lastRequest != null && world.day - camp.lastRequest < 3) return { ok: false, reason: "requests are available every three days" };
  const giving = Math.min(MAX_GIVE, Math.floor(amount * REQUEST_VALUE[sell] / (REQUEST_VALUE[want] * 5)));
  if (giving < 1) return { ok: false, reason: "offer more goods for this exchange" };
  return { ok: true, quote: { taking: { [sell]: amount }, total: amount, want, giving, reserve } };
}
export function requestTrade(world, campId, sell, want, amount) {
  const check = requestedQuote(world, campId, sell, want, amount);
  if (!check.ok) return check;
  const camp = campById(world, campId);
  camp.lastRequest = world.day;
  camp.lastTrade = world.day;
  world.caravans = world.caravans || [];
  world.nextCaravanId = (world.nextCaravanId || 0) + 1;
  world.caravans.push({ id: world.nextCaravanId, campId, ...camp.home, state: "coming", days: 0, path: null, carrying: null, requested: check.quote });
  return { ok: true, quote: check.quote };
}

/** Chance a caravan brings somebody looking for work. */
export const MIGRANT_CHANCE = 0.25;

// ---------------------------------------------------------------------------
// WHAT THEY BUILD
// ---------------------------------------------------------------------------

/**
 * `houses` is the load-bearing one.
 *
 * Strength is `min(fighters, housing)` rather than a number of its own — the
 * same rule the player lives under, where the base caps the population. That
 * makes burning a hut show up as fewer raiders IMMEDIATELY, which is the
 * feedback the whole counter-raid depends on.
 *
 * MEASURED: with strength driven by a stored `fighters` count that recruited
 * itself back whenever there was food, 400 days of expeditions razed ten
 * buildings and their strength never moved off 12 — so the raids never got
 * smaller and attacking them achieved nothing a player could see.
 */
export const RIVAL_BUILDINGS = {
  camp: { label: "Camp", houses: 4, describe: "Four starter beds. The final target after other buildings fall." },
  farm: { label: "Field", food: 24, describe: "Seasonal food production. No winter harvest." },
  hut: { label: "House", houses: 4, describe: "Four beds for residents." },
  woodcutter: { label: "Woodcutter", describe: "Produces wood for building and repairs." },
  quarryCamp: { label: "Quarry camp", describe: "Produces stone for storage and defences." },
  granary: { label: "Granary", describe: "Adds 900 food capacity for winter reserves." },
  watchtower: { label: "Watchtower", describe: "Shoots within 4 tiles every 6 hours. Peaceful villages allow passage; rivals fire on foreign workers. Must be destroyed before the headquarters." },
  wall: { label: "Fortification", describe: "A defended perimeter position. Attackers breach this first." },
  store: { label: "Warehouse", holds: STORE_HOLDS, describe: "Adds 600 wood and 450 stone storage when complete." },
  market: { label: "Market", trades: true, describe: "Caravans set out from here." },
  workshop: { label: "Workshop", goods: 8, describe: "Makes what their caravans carry." },
};

export const KINDS = {
  raider: {
    label: "Raiders",
    describe: "They will come for whatever is not under a granary roof.",
  },
  settler: {
    label: "Settlers",
    describe: "They farm, and they will trade what you cannot use for what you can.",
  },
};

// ---------------------------------------------------------------------------
// READING THEM
// ---------------------------------------------------------------------------

export const allCamps = (world) => world.camps || [];
export const raiderCamps = (world) => allCamps(world).filter((c) => c.kind === "raider");
export const settlerCamps = (world) => allCamps(world).filter((c) => c.kind === "settler");

/** Any camp at all. Kept because half the codebase asks this question. */
export const hasCamp = (world) => allCamps(world).length > 0;
export const hasRaiders = (world) => raiderCamps(world).length > 0;

export const campById = (world, id) => allCamps(world).find((c) => c.id === id) || null;

/** The camp whose building stands on this tile, with the building. */
export function buildingAt(world, q, r) {
  for (const camp of allCamps(world)) {
    const b = (camp.buildings || []).find((x) => x.q === q && x.r === r && x.condition > 0);
    if (b) return { camp, building: b };
  }
  return null;
}

export const campBuildings = (camp) => (camp && camp.buildings) || [];

export const campCountOf = (camp, id) =>
  campBuildings(camp).filter((b) => b.id === id && operational(b)).length;

const workingSum = (camp, field) => {
  let n = 0;
  for (const b of campBuildings(camp)) {
    if (!operational(b)) continue;
    const def = RIVAL_BUILDINGS[b.id];
    if (def && def[field]) n += def[field] * (b.condition / 100) * (field === "goods" ? 1 + ((camp.level || 1) - 1) * 0.1 : 1);
  }
  return n;
};

/** How many fighters they have room for. Burn a hut and this falls at once. */
export const campHousing = (camp) =>
  camp ? Math.min(MAX_STRENGTH, campBeds(camp)) : 0;

/** What they can field: the lower of who is there and where they can sleep. */
export const campStrength = (camp) =>
  camp ? Math.max(0, Math.min(MAX_STRENGTH, camp.fighters || 0, campHousing(camp))) : 0;

export const campIncome = (camp) => workingSum(camp, "food");
export const campGoods = (camp) => workingSum(camp, "goods");
export const campTrades = (camp) => camp.kind === "settler" && campCountOf(camp, "market") > 0;

/** How well they are doing, 0 to 1. What sizes a raiding party. */
export function campProsperity(camp) {
  if (!camp) return 0;
  const strength = Math.min(1, campStrength(camp) / PROSPEROUS_AT);
  const fields = Math.min(1, campCountOf(camp, "farm") / 5);
  return Math.max(0, Math.min(1, strength * 0.6 + fields * 0.4));
}

/** One line per neighbour, for the panels and the assistant. */
export function campSummaries(world) {
  return allCamps(world).map((camp) => ({
    id: camp.id,
    kind: camp.kind,
    label: KINDS[camp.kind].label,
    home: camp.home,
    level: camp.level || 1,
    strength: campStrength(camp),
    fields: campCountOf(camp, "farm"),
    huts: campCountOf(camp, "hut"),
    land: camp.claims ? camp.claims.size : 0,
    food: Math.round(camp.store.food || 0),
    loot: Math.round(camp.store.loot || 0),
    goods: Math.round(camp.store.goods || 0),
    trades: campTrades(camp),
    turned: !!camp.turnedOn,
    prosperity: campProsperity(camp),
  }));
}

/** Neighbours due to arrive, for the panel. */
export const pendingArrivals = (world) =>
  (world.resettle || []).map((r) => ({ kind: r.kind, days: Math.max(0, r.on - world.day) }));

// ---------------------------------------------------------------------------
// FOUNDING
// ---------------------------------------------------------------------------

const roomAt = (world, q, r) =>
  neighbors(q, r).filter((n) => {
    const t = getTerrain(world, n.q, n.r);
    return t !== null && TERRAIN[t].walkable;
  }).length;

/**
 * Somewhere to settle: grass, off everybody's land, and not on top of another
 * camp.
 *
 * Walks outward in rings from the player's home so the result is deterministic
 * from the board rather than from a random draw — two loads of the same save
 * must put the neighbours in the same places.
 */
export function findCampSite(world, opts = {}) {
  const origin = opts.from || world.home || { q: 0, r: 0 };
  const minAway = opts.minDistance ?? campDistanceFor(world);
  const spacing = opts.spacing ?? campSpacingFor(world);
  const reach = Math.max(world.grid.width, world.grid.height);
  const taken = allCamps(world).map((c) => c.home);
  let fallback = null;

  for (let radius = minAway; radius < reach; radius++) {
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const at = { q: origin.q + dq, r: origin.r + dr };
        if (distance(origin, at) !== radius) continue;
        if (getTerrain(world, at.q, at.r) !== "grass") continue;
        if (inTerritory(world, at.q, at.r)) continue;
        if (inRivalLand(world, at.q, at.r)) continue;
        if (taken.some((h) => distance(h, at) < spacing)) continue;
        if (roomAt(world, at.q, at.r) >= 4) return at;
        if (!fallback) fallback = at;
      }
    }
  }
  return fallback;
}

/** Plant one settlement. Returns the camp, or null if the board has no room. */
export function foundCamp(world, kind = "raider", at = null) {
  const site = at || findCampSite(world);
  if (!site) return null;

  world.camps = world.camps || [];
  world.nextCampId = (world.nextCampId || 0) + 1;

  const camp = {
    id: world.nextCampId,
    kind,
    home: { q: site.q, r: site.r },
    foundedOn: world.day,
    owned: new Set(),
    claims: new Map(),
    buildings: [{ id: "camp", q: site.q, r: site.r, condition: 100 }],
    // Enough to live on until the first field is in. A camp founded with forty
    // food and no crop starved its own fighters to zero inside ten days and
    // then routed itself, which is not a neighbour, it is a bug with a plot.
    store: { food: 20, wood: 4, stone: 0, coins: 30, seeds: 1, herbs: 0, loot: 0, goods: 0 },
    fighters: START_STRENGTH,
    lastBuilt: world.day,
    lastExpanded: world.day,
    lastTrade: world.day,
    turnedOn: null,
  };
  world.camps.push(camp);
  initialiseCamp(camp);
  camp.level = 1;
  beginConstruction(camp.buildings[0]);

  const holding = campHolding(camp);
  claimAreaFor(holding, world, site.q, site.r, CAMP_CLAIM_RADIUS);

  // They arrive with one field already broken. People who travel to settle
  // somewhere bring seed, and without it the first fortnight is a slow
  // starvation before anything can grow.
  const field = neighbors(site.q, site.r).find(
    (n) =>
      getTerrain(world, n.q, n.r) === "grass" &&
      !inTerritory(world, n.q, n.r) &&
      !allCamps(world).some(other => other.id !== camp.id && other.claims?.has(key(n.q, n.r)))
  );
  if (field) {
    camp.buildings.push({ id: "farm", q: field.q, r: field.r, condition: 100 });
    beginConstruction(camp.buildings[camp.buildings.length - 1], null, camp);
    claimFor(holding, world, field.q, field.r);
  }
  return camp;
}

/**
 * They are finished here.
 *
 * Their land is released so the player can take it, and a replacement of the
 * same kind is put on the calendar — see RESETTLE_AFTER.
 */
export function routeCamp(world, camp) {
  if (!camp) return null;
  const where = camp.home;
  world.camps = allCamps(world).filter((c) => c.id !== camp.id);
  world.caravans = (world.caravans || []).filter((c) => c.campId !== camp.id);
  world.resettle = world.resettle || [];
  world.resettle.push({ on: world.day + RESETTLE_AFTER, kind: camp.kind });
  world.campsRouted = (world.campsRouted || 0) + 1;
  return where;
}

/**
 * Settle the board on the first day it runs.
 *
 * Lazily, like the raid schedule, so a world made before the neighbours
 * existed and one made after behave identically on their first day.
 */
export function settleTheValley(world) {
  const events = [];
  const wanted = campCountFor(world);
  for (let i = allCamps(world).length; i < wanted; i++) {
    const camp = foundCamp(world, campKindFor(i));
    if (!camp) break; // no room left on this board
    events.push({
      type: "neighboursSettled",
      q: camp.home.q,
      r: camp.home.r,
      text: `${KINDS[camp.kind].label} at ${camp.home.q},${camp.home.r}. ${KINDS[camp.kind].describe}`,
    });
  }
  world.valleySettled = true;
  return events;
}

// ---------------------------------------------------------------------------
// ONE DAY OF BEING THEM
// ---------------------------------------------------------------------------

/** Somewhere they could put something: their land, nobody else's, nothing on it. */
function buildSpot(world, camp) {
  const holding = campHolding(camp);
  for (const k of holding.claims.keys()) {
    const [q, r] = k.split(",").map(Number);
    if (buildingAt(world, q, r)) continue;
    if (inTerritory(world, q, r)) continue; // contested; they do not push in
    if (getTerrain(world, q, r) !== "grass") continue;
    return { q, r };
  }
  return null;
}

/** The next tile their border would take. */
function expandSpot(world, camp) {
  const holding = campHolding(camp);
  for (const k of holding.claims.keys()) {
    const [q, r] = k.split(",").map(Number);
    if (ownedBy(holding, q, r)) continue;
    if (inTerritory(world, q, r)) continue; // they stop at your fence line
    // ...and at each other's. Two camps growing into one square would put the
    // same tile in two holdings, which nothing downstream expects.
    if (allCamps(world).some(other => other.id !== camp.id && other.claims?.has(k))) continue;
    const t = getTerrain(world, q, r);
    if (t === null || !TERRAIN[t].walkable) continue;
    return { q, r };
  }
  return null;
}

/** One camp's day. */
function stepOneCamp(world, camp, rnd) {
  const events = [];
  const fed = campDailyEconomy(world, camp);
  if (!fed) events.push({ type: "rivalHungry", q: camp.home.q, r: camp.home.r, text: `Village ${camp.id} is short of food; residents are living on reserves.` });
  if (campResidents(world, camp) === 0 && camp.store.food === 0) {
    const where = routeCamp(world, camp);
    return [{ type: "rivalsRouted", ...where, text: `Village ${camp.id} was abandoned after its food ran out.` }];
  }
  const sites = {};
  for (const id of ["farm", "woodcutter", "quarryCamp", "granary", "store", "hut", "market", "watchtower", "wall"]) {
    const needs = BUILDINGS[playerBuildingId(id)]?.needs || ["grass"];
    for (const k of campHolding(camp).claims.keys()) {
      const [q,r] = k.split(",").map(Number);
      if (inTerritory(world,q,r) || buildingAt(world,q,r)) continue;
      if (allCamps(world).some(other => other.id !== camp.id && other.claims?.has(k))) continue;
      if (needs.includes(getTerrain(world,q,r)) && findPath(world,camp.home,{q,r})) { sites[id] = {q,r}; break; }
    }
  }
  for (const resource of ["wood", "stone"]) {
    for (const k of campHolding(camp).claims.keys()) {
      const [q,r] = k.split(",").map(Number);
      if (inTerritory(world,q,r) || buildingAt(world,q,r) || allCamps(world).some(other => other.id !== camp.id && other.claims?.has(k))) continue;
      const terrain = getTerrain(world,q,r);
      if ((resource === "wood" && terrain === "forest") || (resource === "stone" && ["sand","mountain"].includes(terrain))) {
        if (neighbors(q,r).some(n => findPath(world,camp.home,n))) { sites[resource] = {q,r}; break; }
      }
    }
  }
  const expansion = campHolding(camp).claims.size < campCeiling(world, camp).claims ? expandSpot(world,camp) : null;
  const action = chooseCampAction(world,camp,sites,!!expansion);
  executeCampAction(world,camp,action);
  if (action.type === "BUILD") {
    claimFor(campHolding(camp),world,action.at.q,action.at.r);
    camp.lastBuilt = world.day;
  }
  if (action.type === "EXPAND" && expansion) {
    claimFor(campHolding(camp),world,expansion.q,expansion.r);
    camp.lastExpanded = world.day;
  }
  if (action.type === "GATHER") {
    const at = sites[action.resource];
    if (at) {
      creditCamp(camp,action.resource,action.resource === "wood" ? 12 : 8);
      if (getTerrain(world,at.q,at.r) === "forest") setTerrain(world,at.q,at.r,"grass");
      if (getTerrain(world,at.q,at.r) === "mountain") setTerrain(world,at.q,at.r,"sand");
      claimFor(campHolding(camp),world,at.q,at.r);
    }
  }
  pullAlong(world, camp);
  if (action.type === "RAID") {
    const started = startCampExpedition(world,camp);
    if (!started) camp.ai = { ...camp.ai, action: "WAIT", reason: "No reachable, weaker neighbour with useful resources." };
    else events.push({ type: "villageRaid", ...camp.home, text: `Village ${camp.id} sent ${camp.expedition.people} raiders to village ${camp.expedition.targetId} for supplies.` });
  }
  return events;
}

/**
 * The catch-up half of the growth mix. A camp that has fallen far behind the
 * player — under CATCH_UP_SHARE of your headcount — gets a newcomer every
 * CATCH_UP_EVERY days, if it has a bed and a few days of food. Word gets round
 * that the valley is prospering, and people come to all of it, not only to you.
 *
 * Deliberately NOT for a camp you have just burned: `lastBurned` holds it off
 * for a season, or wrecking them would undo itself inside a month.
 */
export const CATCH_UP_SHARE = 0.6;
export const CATCH_UP_EVERY = 6;

export function pullAlong(world, camp) {
  if (seasonOf(world.day).id === "winter") return false;
  const people = (world.workers || []).length;
  const residents = campResidents(world, camp);
  if (residents >= Math.floor(people * CATCH_UP_SHARE)) return false;
  if (residents >= Math.min(campBeds(camp), campCeiling(world, camp).residents)) return false;
  if ((camp.store.food || 0) < (residents + 1) * 6 * 3) return false;
  if (world.day - (camp.lastNewcomer || 0) < CATCH_UP_EVERY) return false;
  if (camp.lastBurned && world.day - camp.lastBurned < 24) return false;
  camp.fighters = (camp.fighters || 0) + 1;
  camp.lastNewcomer = world.day;
  return true;
}

/** One day of every neighbour. Called from advanceHour when the date rolls over. */
export function stepCamps(world, rnd) {
  const events = [];

  if (!world.valleySettled) events.push(...settleTheValley(world));

  // Anybody due back?
  if (world.resettle && world.resettle.length) {
    const due = world.resettle.filter((r) => world.day >= r.on);
    for (const entry of due) {
      const camp = foundCamp(world, entry.kind);
      if (camp) {
        world.resettle = world.resettle.filter((r) => r !== entry);
        events.push({
          type: "neighboursSettled",
          q: camp.home.q, r: camp.home.r,
          text: `${KINDS[camp.kind].label} have settled at ${camp.home.q},${camp.home.r}.`,
        });
      } else {
        entry.on = world.day + 20; // no room; look again later
      }
    }
  }

  // A copy, because a camp can rout itself mid-loop.
  for (const camp of [...allCamps(world)]) {
    events.push(...stepOneCamp(world, camp, rnd));
  }

  events.push(...stepCaravans(world, rnd));
  return events;
}

// ---------------------------------------------------------------------------
// TRADE
// ---------------------------------------------------------------------------

const walkableFor = (world, q, r) => {
  const t = getTerrain(world, q, r);
  return t !== null && TERRAIN[t].walkable;
};

/** What the player has too much of, and what they are shortest of. */
export function tradeOffer(world, capacity = CARAVAN_CAPACITY, camp = null) {
  const store = world.store || {};

  // EVERYTHING you have a surplus of, not just the biggest pile. Taking only
  // the most abundant meant stone — which accumulates fastest — was the only
  // thing ever traded, and 540 days of caravans left the timber surplus
  // completely untouched at eleven thousand.
  const spare = {};
  for (const res of TRADEABLE) {
    const over = (store[res] || 0) - TRADE_FLOOR;
    if (over > 0) spare[res] = over;
  }
  const kinds = Object.keys(spare);
  if (kinds.length === 0) return null;

  const each = Math.floor(capacity / kinds.length);
  const taking = {};
  let total = 0;
  for (const res of kinds) {
    const n = Math.min(spare[res], each);
    if (n <= 0) continue;
    taking[res] = n;
    total += n;
  }
  // Not worth a caravan's walk.
  if (total < capacity / 4) return null;

  // In exchange, whatever they are shortest of.
  let want = null;
  let least = Infinity;
  for (const res of Object.keys(TRADE_RATES)) {
    const have = store[res] || 0;
    if (camp && (camp.store[res] || 0) < Math.min(MAX_GIVE, Math.floor(total / TRADE_RATES[res]))) continue;
    if (have < least) {
      least = have;
      want = res;
    }
  }

  if (!want) return null;
  const giving = Math.max(1, Math.min(MAX_GIVE, Math.floor(total / TRADE_RATES[want])));
  return { taking, total, want, giving };
}

/** Send a caravan if this camp is due one and there is a deal to be had. */
function maybeSendCaravan(world, camp) {
  if (camp.kind !== "settler" || !campTrades(camp)) return null;
  if (world.day - (camp.lastTrade || 0) < TRADE_EVERY) return null;
  if (!world.home) return null;
  if ((world.caravans || []).some(c => c.campId === camp.id && c.state === "coming")) return null;

  const offer = tradeOffer(world, CARAVAN_CAPACITY, camp);
  camp.lastTrade = world.day;
  if (!offer) return null;

  world.caravans = world.caravans || [];
  world.nextCaravanId = (world.nextCaravanId || 0) + 1;
  const caravan = {
    id: world.nextCaravanId,
    campId: camp.id,
    q: camp.home.q,
    r: camp.home.r,
    state: "coming",
    days: 0,
    path: null,
    carrying: null,
  };
  world.caravans.push(caravan);
  return caravan;
}

/** Cache a real route: greedy walking could oscillate beside a lake forever. */
function walkCaravan(world, caravan, to) {
  if (caravan.q === to.q && caravan.r === to.r) return true;
  if (!caravan.path?.length || caravan.pathTarget?.q !== to.q || caravan.pathTarget?.r !== to.r) {
    caravan.path = findPath(world, caravan, to);
    caravan.pathTarget = { ...to };
  }
  if (!caravan.path) return false;
  caravan.trail = [{ q: caravan.q, r: caravan.r }];
  for (let i = 0; i < CARAVAN_SPEED && caravan.path.length; i++) {
    const step = caravan.path[0];
    if (!canWalk(world, step.q, step.r)) { caravan.path = null; return false; }
    caravan.path.shift();
    caravan.q = step.q; caravan.r = step.r;
    caravan.trail.push({ q: step.q, r: step.r });
  }
  return caravan.q === to.q && caravan.r === to.r;
}

/**
 * One day of every caravan on the road.
 *
 * THE STONE SINK. This is the only thing in the game that takes a resource
 * away continuously in exchange for something else, which is what a surplus
 * needs — every other sink is a purchase you eventually finish making.
 */
export function stepCaravans(world, rnd) {
  const events = [];

  for (const camp of settlerCamps(world)) {
    const sent = maybeSendCaravan(world, camp);
    if (sent) {
      events.push({
        type: "caravanSet",
        q: camp.home.q, r: camp.home.r,
        text: `A caravan has set out from ${camp.home.q},${camp.home.r}.`,
      });
    }
  }

  if (!world.caravans || world.caravans.length === 0) return events;

  const home = world.home || { q: 0, r: 0 };
  for (const caravan of [...world.caravans]) {
    const camp = campById(world, caravan.campId);
    caravan.days = (caravan.days || 0) + 1;

    // Their camp is gone, or they have been on the road far too long.
    if (!camp || camp.kind !== "settler" || caravan.days > CARAVAN_PATIENCE) {
      world.caravans = world.caravans.filter((c) => c.id !== caravan.id);
      continue;
    }

    if (caravan.state === "coming") {
      if (walkCaravan(world, caravan, home)) {
        // Re-priced on arrival rather than on departure: a fortnight is long
        // enough for a raid to have emptied the stores they came for.
        const quoted = caravan.requested;
        const affordable = quoted && Object.entries(quoted.taking).every(([res, n]) => (world.store[res] || 0) >= n + quoted.reserve);
        let offer = quoted ? (affordable ? quoted : null) : tradeOffer(world, CARAVAN_CAPACITY, camp);
        if (offer && ((camp.store[offer.want] || 0) < offer.giving || Object.entries(offer.taking).some(([res,n]) => (camp.store[res] || 0) + n > (campCapacity(camp)[res] ?? Infinity)))) offer = null;
        if (offer && (world.store[offer.want] || 0) + offer.giving > (storageCapacity(world)[offer.want] ?? Infinity)) offer = null;
        if (offer) {
          for (const [res, n] of Object.entries(offer.taking)) {
            world.store[res] = Math.max(0, (world.store[res] || 0) - n);
          }
          world.store[offer.want] = (world.store[offer.want] || 0) + offer.giving;
          camp.store[offer.want] -= offer.giving;
          for (const [res,n] of Object.entries(offer.taking)) creditCamp(camp,res,n);
          events.push({
            type: "traded",
            q: caravan.q, r: caravan.r,
            text:
              `Traded ${Object.entries(offer.taking)
                .map(([res, n]) => `${n} ${res}`)
                .join(" and ")} for ${offer.giving} ${offer.want}.`,
          });
          caravan.carrying = offer.total;
          world.tradesCompleted = (world.tradesCompleted || 0) + 1;

          // Sometimes somebody walks back with them the other way.
          if (rnd && rnd() < MIGRANT_CHANCE) caravan.migrant = true;
        } else {
          events.push({
            type: "tradeDeclined",
            q: caravan.q, r: caravan.r,
            text: "A caravan left without trading: insufficient stock, surplus or storage at either village.",
          });
        }
        caravan.state = "going";
        caravan.days = 0;
      }
    } else if (walkCaravan(world, caravan, camp.home)) {
      world.caravans = world.caravans.filter((c) => c.id !== caravan.id);
    }
  }

  return events;
}

/** Did a caravan bring somebody looking for work? Consumed by the tick. */
export function takeMigrant(world) {
  const caravan = (world.caravans || []).find((c) => c.migrant);
  if (!caravan) return false;
  caravan.migrant = false;
  return true;
}

// ---------------------------------------------------------------------------
// GOING AFTER THEM
// ---------------------------------------------------------------------------

/**
 * How many people you can send.
 *
 * Deliberately expensive in the only currency that binds: PEOPLE. A war party
 * is workers who are not farming, walking for days, coming back hurt. There is
 * no resource cost at all.
 */
export const MAX_PARTY_SENT = 12;

export function canSendWarParty(world, campId = null, n = 3) {
  const target = campId === null ? raiderCamps(world)[0] : campById(world, campId);
  if (!target) return { ok: false, reason: "there is nobody to attack" };

  if (!Number.isInteger(n) || n < 1) return { ok: false, reason: "choose at least one person" };
  const people = (world.workers || []).length;
  const committed = (world.orders || []).filter(o => o.kind === "warparty" && !o.done).length;
  const spare = Math.max(0, Math.min(people - 1 - committed, MAX_PARTY_SENT - committed));
  if (spare <= 0) return { ok: false, reason: committed ? "the available war party is already committed" : "you cannot send your only worker" };
  return { ok: true, most: Math.min(MAX_PARTY_SENT, spare, n), camp: target };
}

/**
 * Order a war party. One order per person, reusing the standing-order queue
 * that catching a horse already uses — so it queues when everybody is busy,
 * exactly like every other instruction in the game.
 */
export function orderWarParty(world, campId = null, n = 3) {
  const check = canSendWarParty(world, campId, n);
  if (!check.ok) return check;

  world.orders = world.orders || [];
  const already = world.orders.filter((o) => o.kind === "warparty" && !o.done).length;
  if (already >= MAX_PARTY_SENT) {
    return { ok: false, reason: `${already} are already on their way` };
  }

  const sending = Math.min(check.most, MAX_PARTY_SENT - already);
  for (let i = 0; i < sending; i++) {
    world.nextOrderId = (world.nextOrderId || 0) + 1;
    world.orders.push({
      id: world.nextOrderId,
      kind: "warparty",
      campId: check.camp.id,
      seq: world.nextOrderId,
      issuedOn: world.day,
      done: false,
    });
  }
  return { ok: true, sending, camp: check.camp, target: check.camp.home };
}

/** Call off an attack nobody has set out on yet. */
export function recallWarParty(world) {
  let cancelled = 0;
  for (const order of world.orders || []) {
    if (order.kind === "warparty" && !order.done && !order.takenBy) {
      order.done = true;
      cancelled++;
    }
  }
  return { ok: true, cancelled };
}

/**
 * Set fire to one of their buildings. Returns what was hit, or null.
 *
 * DEFENCES FIRST. Burning the barracks is both the effective move and the
 * intuitive one — it takes fighters off the board today rather than starving
 * them off over a month — and putting the camp last makes razing it the finale
 * rather than something that happens by accident on the first night.
 */
export function assaultTarget(camp, at = camp?.home) {
  const standing = (camp?.buildings || []).filter(b => b.condition > 0);
  const priority = b => ["wall", "watchtower"].includes(b.id) ? 0 : b.id === "camp" ? 2 : 1;
  return standing.sort((a,b) => priority(a) - priority(b) || distance(at,a) - distance(at,b) || a.q - b.q || a.r - b.r)[0] || null;
}

export function burnSomething(world, camp, at, damage = BURN_DAMAGE) {
  if (!camp) return null;
  const standing = campBuildings(camp).filter((b) => b.condition > 0);
  if (standing.length === 0) return null;
  camp.lastBurned = world.day;

  const order = ["wall", "watchtower", "hut", "market", "workshop", "woodcutter", "quarryCamp", "farm", "granary", "store", "camp"];
  let target = null;
  for (const id of order) {
    const near = standing
      .filter((b) => b.id === id)
      .sort((a, b) => distance(at, a) - distance(at, b))[0];
    if (near) {
      target = near;
      break;
    }
  }
  if (!target) return null;

  // ATTACKING PEACEFUL PEOPLE HAS A CONSEQUENCE. Settlers who have been burned
  // out once do not go on trading with you — they become raiders, permanently.
  // Without this, attacking a settler camp is free loot with no downside, and
  // the peaceful option stops being a choice at all.
  let turned = false;
  if (camp.kind === "settler") {
    camp.kind = "raider";
    camp.turnedOn = world.day;
    world.caravans = (world.caravans || []).filter((c) => c.campId !== camp.id);
    turned = true;
  }

  const reached = standing.find(b => b.q === at.q && b.r === at.r);
  if (reached && (reached.id !== "camp" || standing.every(b => b.id === "camp"))) target = reached;
  target.condition = Math.max(0, target.condition - damage);
  target.lastAttacked = (world.day - 1) * 24 + world.hour;
  const def = RIVAL_BUILDINGS[target.id];
  const razed = target.condition <= 0;

  if (razed && target.id === "camp") {
    routeCamp(world, camp);
    return { id: target.id, razed: true, routed: true, turned, label: def.label };
  }
  return {
    id: target.id, razed, routed: false, turned,
    label: def.label, q: target.q, r: target.r,
  };
}

/** Take back some of what they took. Returns what was carried off. */
export function lootCamp(camp, capacity) {
  if (!camp) return {};
  const store = camp.store;
  const took = {};
  let left = capacity;

  for (const res of ["loot", "goods", "food", "wood", "stone"]) {
    if (left <= 0) break;
    const have = Math.max(0, Math.round(store[res] || 0));
    if (have <= 0) continue;
    const n = Math.min(have, left);
    store[res] = have - n;
    // Their piles come home as food: a sack of your own grain, or whatever
    // they were going to trade with.
    const resource = ["loot", "goods"].includes(res) ? "food" : res;
    took[resource] = (took[resource] || 0) + n;
    left -= n;
  }
  return took;
}
