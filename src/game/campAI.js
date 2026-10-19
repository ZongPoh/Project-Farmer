import { BASE_LEVELS, baseTier } from "./base.js";
import { BUILDINGS, canAfford } from "./buildings.js";
import { operational, beginConstruction } from "./construction.js";
import { BASE_STORAGE, STORAGE, RESIDENT_FOOD, PRICES, MARKET_PERIOD, MARKET_STOCK, MARKET_PURSE } from "./economy.js";
import { seasonOf, seasonFactors, DAYS_PER_SEASON } from "./calendar.js";
import { activeTiles } from "./tiles.js";

export const STRATEGIES = {
  trader: { label: "Trading community", trade: 1.5, defence: 0.8, raid: 0.2 },
  defender: { label: "Fortified settlement", trade: 0.8, defence: 1.6, raid: 0.5 },
  raider: { label: "Resource raiders", trade: 0.5, defence: 1.1, raid: 1.6 },
};
export const playerBuildingId = id => ({ camp: "base", hut: "house", store: "warehouse" }[id] || id);
export const campBuildCost = id => BUILDINGS[playerBuildingId(id)]?.cost || { wood: 40, stone: 20 };

/**
 * HOW BIG A NEIGHBOUR MAY GET — the fix for "the AI camps stop growing".
 *
 * MEASURED before (scratch/campgrowth.mjs, 60x40, 2 seeds, 288 days): every
 * camp hit 12 residents and 22-24 buildings by about day 130 and never moved
 * again, while the player went on to Town and 22+ people. The caps were flat
 * constants (12 people, 24 buildings, 70 tiles), put there because unbounded
 * growth once reached 21 fields and 38,000 food of pure bookkeeping.
 *
 * The answer the user chose is a MIX:
 *   - their own ceiling rises with their headquarters level, so a camp that
 *     keeps its economy running keeps growing through the whole game;
 *   - it is also held within reach of YOUR size — never far behind you and
 *     never far ahead — so a small player is not buried and a Town is not
 *     surrounded by hamlets.
 * The catch-up half (newcomers joining a camp that has fallen well behind) is
 * in rivalcamp.js, `pullAlong`.
 */
export function playerSize(world) {
  let buildings = 0;
  for (const t of activeTiles(world)) {
    const id = t.building?.id;
    if (id && !["fence", "wall", "gate"].includes(id)) buildings++;
  }
  return { people: (world.workers || []).length, buildings };
}

export function campCeiling(world, camp, size = playerSize(world)) {
  const level = camp.level || 1;
  const own = { residents: 8 + 4 * level, buildings: 10 + 6 * level };
  const near = { residents: Math.max(10, Math.round(size.people * 1.25) + 4), buildings: Math.max(16, size.buildings + 8, size.people * 2) };
  const residents = Math.min(own.residents, near.residents);
  const buildings = Math.min(own.buildings, near.buildings);
  return { residents, buildings, claims: 30 + buildings * 3 };
}

export function initialiseCamp(camp) {
  if (!STRATEGIES[camp.strategy]) camp.strategy = camp.kind === "raider" ? (camp.id % 3 === 0 ? "defender" : "raider") : Math.floor(camp.id / 2) % 2 ? "trader" : "defender";
  camp.store = { food: 20, wood: 8, stone: 0, coins: 30, herbs: 0, seeds: 1, goods: 0, loot: 0, ...camp.store };
  camp.ai = camp.ai || { action: "WAIT", reason: "Establishing a settlement", score: 0 };
}

export function campCapacity(camp) {
  const cap = { ...BASE_STORAGE };
  for (const b of camp.buildings || []) if (operational(b)) {
    for (const [res, n] of Object.entries(STORAGE[playerBuildingId(b.id)] || {})) cap[res] += n;
  }
  return cap;
}

export function campResidents(world, camp) {
  return (camp.fighters || 0) + (camp.expedition?.people || 0) + (world.raiders || []).filter(r => r.campId === camp.id && r.reserved).length;
}
export function campBeds(camp) {
  return (camp.buildings || []).filter(operational).reduce((n, b) => n + (b.id === "camp" ? baseTier(camp.level || 1).houses : ["hut", "house"].includes(b.id) ? 4 : 0), 0);
}
export function campDefence(camp) {
  return (camp.fighters || 0) + (camp.buildings || []).filter(operational).reduce((n, b) => n + (b.id === "watchtower" ? 3 : b.id === "wall" ? 2 : 0) * b.condition / 100, 0);
}
export function creditCamp(camp, resource, amount) {
  const cap = campCapacity(camp)[resource] ?? (resource === "goods" || resource === "loot" ? 500 : Infinity);
  const accepted = Math.max(0, Math.min(amount, cap - (camp.store[resource] || 0)));
  camp.store[resource] = (camp.store[resource] || 0) + accepted;
  return accepted;
}

/** Shared player yields/costs; villagers are represented as a population count. */
export function campDailyEconomy(world, camp) {
  initialiseCamp(camp);
  const season = seasonFactors(world.day);
  for (const b of camp.buildings.filter(operational)) {
    const def = BUILDINGS[playerBuildingId(b.id)];
    for (const [res, yieldPerHour] of Object.entries(def?.yields || {})) {
      const factor = res === "food" ? (season.id === "winter" ? 0 : season.growth) : 1;
      creditCamp(camp, res, yieldPerHour * 24 * factor * b.condition / 100);
    }
    b.condition = Math.max(0, b.condition - (def?.decay || 0) * season.decay);
  }
  const owed = campResidents(world, camp) * RESIDENT_FOOD;
  const fed = camp.store.food >= owed;
  camp.store.food = Math.max(0, camp.store.food - owed);
  camp.hungryDays = fed ? 0 : (camp.hungryDays || 0) + 1;
  if (camp.hungryDays >= 3 && camp.fighters > 0) { camp.fighters--; camp.hungryDays = 0; }
  return fed;
}

/** Legal candidates are supplied by the map layer; decisions stay testable. */
export function chooseCampAction(world, camp, sites, expandable) {
  initialiseCamp(camp);
  const season = seasonOf(world.day), population = campResidents(world, camp);
  const profile = STRATEGIES[camp.strategy], cap = campCapacity(camp);
  const counts = id => camp.buildings.filter(b => playerBuildingId(b.id) === id && b.condition > 0).length;
  const meals = Math.max(1, population) * RESIDENT_FOOD;
  const reserve = meals * (season.id === "winter" ? season.daysLeft : DAYS_PER_SEASON);
  const farmIncome = camp.buildings.filter(b => b.id === "farm" && operational(b)).reduce((n,b) => n + 24 * b.condition / 100, 0);
  const actions = [{ type: "WAIT", score: 1, reason: "Current needs are met; conserving supplies." }];
  const ceiling = campCeiling(world, camp);
  const build = (id, score, reason) => {
    if (sites[id] && canAfford(camp.store, campBuildCost(id)) && !camp.buildings.some(b => b.construction?.kind === "build") && camp.buildings.filter(b => b.condition > 0).length < ceiling.buildings)
      actions.push({ type: "BUILD", id, at: sites[id], score, reason });
  };
  build("farm", farmIncome < meals * 1.8 ? 130 : camp.store.food < reserve && season.id !== "winter" ? 65 : 0, "Grow enough food for residents and winter reserves.");
  build("woodcutter", counts("woodcutter") ? 0 : 95, "Secure renewable wood for construction and repairs.");
  build("quarryCamp", counts("quarryCamp") ? 0 : 88, "Secure stone for storage and defences.");
  build("granary", cap.food < reserve * 1.3 ? 92 : 0, "Increase food storage before winter.");
  build("store", counts("warehouse") < 3 && (camp.store.wood > cap.wood * 0.75 || camp.store.stone > cap.stone * 0.75) ? 75 : 0, "Material stores are filling up.");
  build("hut", population >= campBeds(camp) && camp.store.food > reserve ? 60 : 0, "Housing is full and food reserves can support growth.");
  build("market", counts("market") ? 0 : 55 * profile.trade, "Open trade to exchange surplus for shortages.");
  build("watchtower", counts("watchtower") < 2 ? 42 * profile.defence : 0, "Protect buildings against attackers.");
  build("wall", counts("wall") < 3 ? 30 * profile.defence : 0, "Strengthen the village perimeter.");
  const damaged = camp.buildings.filter(b => !b.construction && b.condition > 0 && b.condition < 75).sort((a,b) => a.condition - b.condition)[0];
  if (damaged && camp.store.wood >= 1) actions.push({ type: "REPAIR", at: damaged, score: damaged.condition < 35 ? 115 : 80, reason: "Repair a damaged building before it stops working." });
  if (season.id !== "winter" && population < Math.min(ceiling.residents, campBeds(camp)) && farmIncome >= (population + 1) * RESIDENT_FOOD * 1.5 && camp.store.food >= (population + 1) * RESIDENT_FOOD * DAYS_PER_SEASON)
    actions.push({ type: "RECRUIT", score: 50, reason: "A spare bed and winter reserves support another resident." });
  if (expandable && (!sites.farm || !sites.woodcutter || !sites.quarryCamp || camp.buildings.length >= 5)) actions.push({ type: "EXPAND", score: (!sites.wood && camp.store.wood < 4) || (!sites.stone && camp.store.stone < 3) ? 110 : 45, reason: "Claim nearby land for useful buildings and resources." });
  if (season.id !== "winter" && camp.store.food < meals * 3) actions.push({ type: "FORAGE", score: 120, reason: "Food is critically low; gather emergency supplies." });
  if (season.id === "winter" && camp.store.food < meals * 3) actions.push({ type: "FORAGE", score: 85, reason: "Winter shortage: forage limited emergency food." });
  if (camp.store.wood < 50 && sites.wood) actions.push({ type: "GATHER", resource: "wood", score: 70, reason: "Gather building timber before investing in production." });
  if (camp.store.stone < 30 && sites.stone) actions.push({ type: "GATHER", resource: "stone", score: 65, reason: "Gather stone for essential facilities." });
  const merchant = camp.merchant?.period === Math.floor((world.day - 1) / MARKET_PERIOD) ? camp.merchant : { stock: { food: MARKET_STOCK, wood: MARKET_STOCK, stone: MARKET_STOCK }, purse: MARKET_PURSE };
  const canSell = ["wood", "stone"].some(r => camp.store[r] > 60 && merchant.purse >= PRICES[r].sell && merchant.stock[r] < MARKET_STOCK * 2);
  const canBuy = camp.store.coins >= PRICES.food.buy && merchant.stock.food > 0 && camp.store.food < cap.food;
  if (counts("market") && (canSell || canBuy)) actions.push({ type: "TRADE", score: camp.store.food < reserve ? 90 : 35 * profile.trade, reason: "Trade surplus materials to cover winter food needs." });
  const upgrade = BASE_LEVELS[camp.level || 1];
  const headquarters = camp.buildings.find(b => b.id === "camp");
  if (upgrade && headquarters && !headquarters.construction && camp.buildings.filter(b => b.condition > 0).length >= (camp.level || 1) * 4 && canAfford(camp.store, upgrade.cost) && camp.store.food - (upgrade.cost.food || 0) >= reserve)
    actions.push({ type: "UPGRADE", at: headquarters, level: upgrade.level, score: 52, reason: "Upgrade headquarters with surplus resources after protecting winter reserves." });
  if (camp.kind === "raider" && population >= 4 && camp.store.food >= meals * 3 && !camp.expedition && world.day - (camp.lastExpedition || 0) >= 12)
    actions.push({ type: "RAID", score: 45 * profile.raid, reason: "Seek a weaker neighbour's surplus; return home with supplies." });
  return actions.filter(a => a.score > 0).sort((a,b) => b.score - a.score)[0];
}

/** Same bounded local merchant rules as the player's market. */
export function campMerchant(world, camp) {
  const period = Math.floor((world.day - 1) / MARKET_PERIOD);
  if (camp.merchant?.period !== period) camp.merchant = { period, purse: MARKET_PURSE, stock: { food: MARKET_STOCK, wood: MARKET_STOCK, stone: MARKET_STOCK } };
  const m = camp.merchant;
  for (const res of ["wood", "stone"]) {
    const amount = Math.min(20, Math.floor(Math.max(0, camp.store[res] - 60)), Math.floor(m.purse / PRICES[res].sell), MARKET_STOCK * 2 - m.stock[res]);
    if (amount > 0) { camp.store[res] -= amount; camp.store.coins += amount * PRICES[res].sell; m.purse -= amount * PRICES[res].sell; m.stock[res] += amount; }
  }
  const amount = Math.min(m.stock.food, Math.floor(camp.store.coins / PRICES.food.buy), Math.floor(Math.max(0, campCapacity(camp).food - camp.store.food)));
  if (amount > 0) { camp.store.food += amount; camp.store.coins -= amount * PRICES.food.buy; m.purse += amount * PRICES.food.buy; m.stock.food -= amount; }
  return amount;
}

export function executeCampAction(world, camp, action) {
  camp.ai = { action: action.type, reason: action.reason, score: action.score, day: world.day, building: action.id || null };
  if (action.type === "REPAIR") { camp.store.wood--; action.at.condition = Math.min(100, action.at.condition + 35); }
  if (action.type === "RECRUIT") camp.fighters++;
  if (action.type === "FORAGE") creditCamp(camp, "food", Math.max(1, camp.fighters) * (seasonOf(world.day).id === "winter" ? 2 : 4));
  if (action.type === "TRADE") campMerchant(world, camp);
  if (action.type === "UPGRADE") {
    for (const [res,n] of Object.entries(BASE_LEVELS[action.level - 1].cost)) camp.store[res] -= n;
    beginConstruction(action.at, action.level, camp);
  }
  if (action.type === "BUILD") {
    for (const [res,n] of Object.entries(campBuildCost(action.id))) camp.store[res] -= n;
    // Reuse razed plots, preserving one building at each map coordinate.
    camp.buildings = camp.buildings.filter(b => b.q !== action.at.q || b.r !== action.at.r);
    const building = { id: action.id, q: action.at.q, r: action.at.r, condition: 100 };
    camp.buildings.push(building);
    beginConstruction(building, null, camp);
  }
}
