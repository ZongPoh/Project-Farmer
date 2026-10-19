import { activeTiles } from "./tiles.js";
import { operational } from "./construction.js";
import { seasonOf, DAYS_PER_SEASON } from "./calendar.js";

/**
 * What a settlement can hold before new supplies have nowhere to go.
 *
 * Herbs and seeds were UNCAPPED until now, and that is exactly why herbs
 * reached 300+ by year two: foraging is what every idle worker does, so a
 * resource with no ceiling and one narrow use becomes a counter. Both now have
 * a modest floor and somewhere to raise it — an infirmary is where medicine is
 * kept, a granary is where seed corn is kept — so storing more is a building
 * decision like every other store in the game.
 */
export const BASE_STORAGE = { food: 600, wood: 200, stone: 150, herbs: 120, seeds: 40 };
export const RESIDENT_FOOD = 6;

/**
 * UPKEEP THAT SCALES WITH SIZE — the main brake on the snowball.
 *
 * MEASURED before this pass (scratch/growth.mjs, a player who builds and hires
 * steadily, real construction times, 60x40): Town by about day 96 and ~145
 * people by day 288, with food, wood and stone in the tens of thousands. Every
 * cost in the game was flat per head, so every farm fed four more people
 * forever and nothing ever pushed back.
 *
 * Now each resident beyond UPKEEP_FREE_PEOPLE adds a little to what EVERYONE
 * eats — the cost of running a bigger place: more mouths than hands, guards,
 * carters, waste. Nothing changes for a settlement of twelve or fewer, so the
 * opening and every existing small-settlement balance are untouched. At a
 * Town's 22 people each eats 8; at 40, about 11.6. Population becomes a soft
 * ceiling set by how much land you farm, rather than no ceiling at all.
 *
 * Neighbours keep the flat rate: their size is already bounded by campCeiling.
 */
export const UPKEEP_FREE_PEOPLE = 12;
export const UPKEEP_SCALE = 30;

export function residentFood(people) {
  return RESIDENT_FOOD * (1 + Math.max(0, people - UPKEEP_FREE_PEOPLE) / UPKEEP_SCALE);
}

/** Total food a settlement of `people` eats in a day, rounded up to whole units. */
export function dailyFoodFor(people) {
  return Math.ceil(people * residentFood(people));
}
export const STORAGE = {
  // Seed corn is kept in a granary and nowhere else. It was in the warehouse
  // too at first, and a settlement with twenty warehouses then had room for
  // 500 seeds, which is not a ceiling.
  granary: { food: 900, seeds: 20 },
  warehouse: { wood: 600, stone: 450 },
  infirmary: { herbs: 90 },
};
/**
 * An absolute ceiling on the two small stores, however much you build.
 *
 * MEASURED after the caps went in: the growth bot ended three years with 580
 * seeds against a "cap" of 40, because it had built twenty-seven granaries and
 * each one adds 20. That is the same fault the comment above describes, moved
 * one building along — a ceiling that rises with a cheap building is not a
 * ceiling, it is a slope.
 *
 * Food, wood and stone scale with what you build, because storing them IS the
 * game. Herbs and seeds are small stores with one narrow use each, so they stop
 * where the stock would spoil: a third granary's worth of seed corn, two
 * infirmaries' worth of medicine. Below those numbers nothing changes, so a
 * settlement that builds one of each sees exactly what it saw before.
 */
export const STORAGE_CEILING = { herbs: 300, seeds: 100 };
export const MARKET_PERIOD = 7;
export const MARKET_STOCK = 60;
export const MARKET_PURSE = 120;
export const PRICES = { food: { buy: 3, sell: 1 }, wood: { buy: 4, sell: 2 }, stone: { buy: 5, sell: 2 } };

export function storageCapacity(world) {
  const capacity = { ...BASE_STORAGE };
  for (const tile of activeTiles(world)) {
    if (!operational(tile.building)) continue;
    for (const [resource, amount] of Object.entries(STORAGE[tile.building.id] || {})) capacity[resource] += amount;
  }
  for (const [resource, ceiling] of Object.entries(STORAGE_CEILING)) {
    capacity[resource] = Math.min(capacity[resource], ceiling);
  }
  return capacity;
}

/** Existing surplus is retained, but no new goods fit until it is used. */
export function addResource(world, resource, amount) {
  const held = world.store[resource] || 0;
  const cap = storageCapacity(world)[resource] ?? Infinity;
  const accepted = Math.max(0, Math.min(amount, cap - held));
  world.store[resource] = held + accepted;
  return accepted;
}

export function extraHousing(world) {
  return activeTiles(world).filter(t => t.building?.id === "house" && operational(t.building)).length * 4;
}

export function foodReserves(world) {
  const season = seasonOf(world.day);
  const daily = dailyFoodFor(world.workers?.length || 0);
  const winterDays = season.id === "winter" ? season.daysLeft : DAYS_PER_SEASON;
  const required = daily * winterDays;
  return { daily, days: daily ? world.store.food / daily : Infinity, required,
    shortfall: Math.max(0, required - world.store.food), winterDays };
}

export function marketView(world) {
  const period = Math.floor((world.day - 1) / MARKET_PERIOD);
  const saved = world.market?.period === period ? world.market : null;
  return saved || { period, purse: MARKET_PURSE, stock: { food: MARKET_STOCK, wood: MARKET_STOCK, stone: MARKET_STOCK } };
}

/** Local merchants settle immediately; neighbour caravans remain separate barter. */
export function currencyTrade(world, resource, side, amount = 10) {
  if (!Object.hasOwn(PRICES, resource) || !["buy", "sell"].includes(side) || !Number.isSafeInteger(amount) || amount < 1 || amount > MARKET_STOCK)
    return { ok: false, reason: "Choose a valid resource and 1–60 units." };
  if (!activeTiles(world).some(t => t.building?.id === "market" && operational(t.building)))
    return { ok: false, reason: "Complete a market first." };
  const market = marketView(world);
  const price = PRICES[resource][side] * amount;
  if (side === "buy") {
    if ((world.store.coins || 0) < price) return { ok: false, reason: "Not enough coins." };
    if (market.stock[resource] < amount) return { ok: false, reason: "Merchant stock is too low. Wait for the weekly restock." };
    if (storageCapacity(world)[resource] - (world.store[resource] || 0) < amount) return { ok: false, reason: "Not enough storage space." };
    world.store.coins -= price;
    world.store[resource] = (world.store[resource] || 0) + amount;
    market.stock[resource] -= amount;
    market.purse += price;
  } else {
    if ((world.store[resource] || 0) < amount) return { ok: false, reason: "Not enough resources." };
    if (market.purse < price) return { ok: false, reason: "The merchant has no budget for this purchase. Wait for the weekly restock." };
    if (market.stock[resource] + amount > MARKET_STOCK * 2) return { ok: false, reason: "The merchant has enough of this resource this week." };
    world.store[resource] -= amount;
    world.store.coins = (world.store.coins || 0) + price;
    market.stock[resource] += amount;
    market.purse -= price;
  }
  world.market = market;
  return { ok: true, price };
}

/**
 * LIVESTOCK AT THE MARKET. The playtest asked to capture animals, keep them,
 * and trade them; this is the trade half.
 *
 * Deliberately NOT part of the merchant's weekly stock: an animal is a unit,
 * not a pile, and a horse is worth more than any ten units of anything. The
 * purse still bounds selling, so a stable of forty horses cannot be turned
 * into coins in one afternoon. There is no profitable loop: a horse bought is
 * worth half what was paid for it.
 */
/**
 * What the merchant pays for an animal.
 *
 * Only horses can be BOUGHT, and deliberately: everything else you have to
 * breed, which is what makes a pen worth the fences. Selling is there so a
 * full pen is worth something besides meat — and every price is under what
 * the animal earns you in a season, so selling the herd is never the clever
 * move it was in the first version of the market.
 */
export const LIVESTOCK_PRICES = {
  horse: { buy: 90, sell: 40 },
  goat: { sell: 18 },
  rabbit: { sell: 4 },
  chicken: { sell: 3 },
};

export function livestockTrade(world, species, side) {
  const price = LIVESTOCK_PRICES[species]?.[side];
  if (!price) return { ok: false, reason: `The merchant does not ${side} ${species}s.` };
  if (!activeTiles(world).some(t => t.building?.id === "market" && operational(t.building)))
    return { ok: false, reason: "Complete a market first." };
  const market = marketView(world);
  const animals = world.animals || [];
  if (side === "sell") {
    // Sell the one doing least: an unridden horse, or a penned rabbit that is
    // not one of the last breeding pair.
    let pick = null;
    if (species === "horse") pick = animals.find(a => a.species === "horse" && a.tamed && !a.riderId && !a.stolen);
    else {
      // Never the last pair: selling the breeding stock would end the thing
      // that makes the pen worth having, one click at a time.
      const byHome = new Map();
      for (const a of animals) {
        const home = a.pen || a.coop;
        if (a.species !== species || !home) continue;
        byHome.set(home, [...(byHome.get(home) || []), a]);
      }
      for (const list of byHome.values()) if (list.length > 2) { pick = list[list.length - 1]; break; }
    }
    if (!pick) return { ok: false, reason: species === "horse" ? "No horse is standing idle in a paddock." : "Nowhere you keep them has more than its breeding pair." };
    if (market.purse < price) return { ok: false, reason: "The merchant has no budget for this purchase. Wait for the weekly restock." };
    world.animals = animals.filter(a => a !== pick);
    world.store.coins = (world.store.coins || 0) + price;
    market.purse -= price;
  } else {
    const kept = animals.filter(a => a.species === "horse" && a.tamed && !a.riderId).length;
    let room = 0, at = null;
    for (const t of activeTiles(world)) {
      if (t.building?.id !== "paddock" || !operational(t.building)) continue;
      room += Math.floor(3 * t.building.condition / 100);
      at = at || t;
    }
    if (!at || kept >= room) return { ok: false, reason: "There is no room in your paddocks." };
    if ((world.store.coins || 0) < price) return { ok: false, reason: "Not enough coins." };
    world.store.coins -= price;
    market.purse += price;
    animals.push({ id: world.nextAnimalId++, species: "horse", q: at.q, r: at.r, energy: 14, cooldown: 0, bornOn: world.day, tamed: true });
  }
  world.market = market;
  return { ok: true, price };
}
