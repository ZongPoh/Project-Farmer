import { operational } from "./construction.js";
/**
 * Animals and the ecosystem. (Step 4)
 *
 * Read the animal section of docs/DESIGN.md before changing any number in
 * here. The short version:
 *
 *   - animals spawn FROM HABITAT with a carrying capacity, never at random
 *   - two fixes stop the classic predator-prey collapse, and you need BOTH:
 *       1. CROWDING     breeding gets harder as a population grows
 *       2. HANDLING TIME a fed predator does not hunt for a few days
 *
 * Without those, foxes eat every rabbit, then starve, then the map is empty.
 * test/ecosystem.test.mjs runs 400 simulated days and fails if that happens,
 * so tune against the test, not against the screen.
 *
 * Animals live in `world.animals` as a flat array, NOT inside tiles. An
 * animal moves; a tile does not.
 */
import { key, neighbors, distance } from "./hex.js";
import { isEdge } from "./grid.js";
import {
  getTerrain, getBuilding, getTile, terrainCount, activeTiles, randomEdgeTile,
} from "./tiles.js";
import { BUILDINGS, blocksMovement } from "./buildings.js";
import { seasonFactors } from "./calendar.js";

/**
 * Condition a farm loses to one day's rabbit raiding. Only the first rabbit
 * to reach a farm does damage, so this is the cost per farm per day, not per
 * rabbit — which is what keeps the number small enough to play against.
 */
export const CROP_DAMAGE = 4;

export const SPECIES = {
  rabbit: {
    label: "Rabbit",
    habitat: ["grass"],
    density: 1.4, // capacity = suitable tiles x density. Several per field.
    eats: "crops",
    color: "#D8CBB4",
    maxEnergy: 14,
    startEnergy: 8,
    energyPerDay: 1, // burned each day just being alive
    grazeEnergy: 2, // gained from plain grass
    cropEnergy: 5, // gained from a farm tile, and it damages the crop
    breedEnergy: 9, // BASE threshold — crowding raises it, see breedThreshold()
    breedCooldown: 4,
    spawnChance: 0.35, // per day, scaled down as the population nears capacity
  },
  fox: {
    label: "Fox",
    habitat: ["grass", "mountain"],
    density: 0.09,
    eats: "rabbit",
    color: "#C2703D",
    maxEnergy: 26,
    startEnergy: 16,
    energyPerDay: 1,
    killEnergy: 12,
    handlingDays: 4, // FIX 2: days spent digesting, during which it will not hunt
    // FIX 3 (the optional one in DESIGN.md, and it turns out to matter):
    // a fox only notices a rabbit within this many tiles. Without it a fox
    // walks straight across the map to the last surviving rabbit and the
    // population never recovers. Eyesight is what gives prey a refuge.
    senseRange: 3,
    // How far off a fox will notice people and come and have a look. Larger
    // than senseRange because a settlement is a good deal more conspicuous
    // than one rabbit.
    curiosity: 8,
    breedEnergy: 20,
    breedCooldown: 12,
    spawnChance: 0.05,
  },
  /*
   * KEPT-ONLY SPECIES. Goats and hens are livestock and nothing else: there is
   * no wild goat and no wild hen anywhere on the board. They are here because
   * a kept animal is still an animal — it lives in `world.animals`, the save
   * validator checks its species against this table, the renderer draws it,
   * and livestock.js works out manure from it.
   *
   * `wild: false` keeps them out of the ecology proper: no spawning, no
   * migration, and no line in the census. That matters because of INVARIANT 6
   * — the predator-prey balance is tuned on the assumption that rabbits are
   * the only thing a fox eats, and a second wild species would be a second
   * thing to tune against three simulated years of measurement. A fox can
   * still kill a hen (pens.js), and it gains NO energy for it, for the same
   * reason.
   */
  goat: {
    label: "Goat",
    wild: false,
    habitat: ["grass", "sand"],
    density: 0,
    color: "#B9A88F",
    maxEnergy: 18,
    startEnergy: 12,
    energyPerDay: 0.5,
    grazeEnergy: 2,
    breedEnergy: 16,
    breedCooldown: 20,
    spawnChance: 0,
  },
  chicken: {
    label: "Hen",
    wild: false,
    habitat: ["grass", "sand"],
    density: 0,
    color: "#E2D7BE",
    maxEnergy: 10,
    startEnergy: 6,
    energyPerDay: 0.5,
    breedEnergy: 8,
    breedCooldown: 10,
    spawnChance: 0,
  },
  horse: {
    label: "Horse",
    habitat: ["grass"],
    density: 0.09,
    tameable: true,
    color: "#8C7B6B",
    maxEnergy: 20,
    startEnergy: 14,
    energyPerDay: 0.5,
    grazeEnergy: 2,
    breedEnergy: 18,
    breedCooldown: 20,
    grazesWhileRecovering: true, // see the EAT step — without it foaling starved the mare
    spawnChance: 0.03,
  },
};

export const SPECIES_IDS = Object.keys(SPECIES);

/** The species the land itself holds. Goats and hens are kept, never wild. */
export const WILD_IDS = SPECIES_IDS.filter((id) => SPECIES[id].wild !== false);

/**
 * Tiles this species could live on right now.
 *
 * Reads the cached terrain histogram, so it is O(number of terrain types) —
 * i.e. constant. It used to count by walking the board, which was invisible
 * at 37 tiles and ruinous at 80,000: capacityFor calls this, breedThreshold
 * calls capacityFor, and the breeding loop calls breedThreshold once PER
 * ANIMAL PER DAY. That is 80,000 x animals iterations a day, and it is what
 * would have turned a 120-day offline catch-up into a hung tab.
 */
export function habitatTiles(world, speciesId) {
  let n = 0;
  for (const t of SPECIES[speciesId].habitat) n += terrainCount(world, t);
  return n;
}

/**
 * How many of this species the land can support.
 *
 * This is the line that ties the ecosystem to your terrain work: turn sand
 * into grass and the rabbit capacity goes up, so rabbits appear. Pave it all
 * over and they leave.
 */
export function capacityFor(world, speciesId) {
  return Math.max(1, Math.round(habitatTiles(world, speciesId) * SPECIES[speciesId].density));
}

/**
 * WILD animals of a species. Kept animals (anything `tamed`: horses in a
 * paddock or under a rider, rabbits in a pen) are livestock, not wildlife —
 * they are fed from the store by livestock.js and must not count against the
 * land's carrying capacity, or every horse you caught would be one fewer the
 * valley could hold and a full paddock would quietly stop the wild herd
 * breeding.
 */
export function populationOf(world, speciesId) {
  return world.animals.filter((a) => a.species === speciesId && !a.tamed).length;
}

export function animalsAt(world, q, r, speciesId = null) {
  return world.animals.filter(
    (a) => a.q === q && a.r === r && (!speciesId || a.species === speciesId)
  );
}

/**
 * FIX 1 — CROWDING.
 *
 * The energy needed to breed rises with how full the land already is. At
 * zero population it is the base cost; at carrying capacity it is three
 * times that, which in practice means no more births. Take this out and
 * predators overshoot, strip the prey to zero and then starve.
 */
export function breedThreshold(world, speciesId) {
  const def = SPECIES[speciesId];
  const fullness = populationOf(world, speciesId) / capacityFor(world, speciesId);
  return def.breedEnergy * (1 + 2 * fullness);
}

function canEnter(world, animal, q, r) {
  const terrain = getTerrain(world, q, r);
  if (terrain === null) return false; // off the board
  if (!SPECIES[animal.species].habitat.includes(terrain)) return false;
  if (blocksMovement(world, q, r, "animal")) return false;
  return true;
}

/**
 * Somewhere on the rim for wildlife to wander in from.
 *
 * Samples random border positions until one is habitable, rather than
 * collecting every rim tile. On a 400x200 board the rim alone is 1,200
 * tiles and building that list every day for every species would be wasted
 * work — we only ever need one of them.
 */
function pickEdgeTile(world, speciesId, rnd) {
  return randomEdgeTile(world, SPECIES[speciesId].habitat, rnd);
}

/**
 * MIGRATION — wildlife arriving where the player can actually see it.
 *
 * The old spawn only ever put animals on the rim of the board. On a 34x24 map
 * that is fine; on 120x80 the rim is sixty tiles from home, and the first
 * playtest said the obvious thing — animals spawn very slowly — because every
 * one of them was born somewhere the camera never goes. Measured before this:
 * on a 120x80 board, zero rabbits and zero horses within 12 tiles of home on
 * every sample across three years.
 *
 * So a second, LOCAL step: when the neighbourhood of the base holds fewer of a
 * species than LOCAL_TARGET, some wander in from just beyond your border. It
 * is still gated by the board-wide carrying capacity, so it cannot overfill
 * the valley, and it counts only a disc around home (bounded work, not a
 * board walk — invariant 16).
 */
export const LOCAL_RADIUS = 14;
export const MIGRATION = {
  //        below this many near home...  ...a group this big arrives with this daily chance
  rabbit: { target: 14, group: 2, chance: 0.45 },
  fox: { target: 2, group: 1, chance: 0.05 },
  horse: { target: 5, group: 3, chance: 0.1 },
};

/** A habitable tile 6..LOCAL_RADIUS from home and outside the player's land, or null. */
function pickNearHome(world, speciesId, rnd, attempts = 16) {
  const home = world.home;
  if (!home) return null;
  const habitat = SPECIES[speciesId].habitat;
  for (let i = 0; i < attempts; i++) {
    const d = 6 + ((rnd() * (LOCAL_RADIUS - 5)) | 0);
    const angle = rnd() * Math.PI * 2;
    // Axial from a polar guess; exactness does not matter, only plausibility.
    const q = home.q + Math.round(d * Math.cos(angle));
    const r = home.r + Math.round(d * Math.sin(angle) - (d * Math.cos(angle)) / 2);
    const terrain = getTerrain(world, q, r);
    if (!terrain || !habitat.includes(terrain)) continue;
    if (world.claims && world.claims.has && world.claims.has(key(q, r))) continue;
    if (blocksMovement(world, q, r, "animal")) continue;
    return { q, r };
  }
  return null;
}

function spawn(world, speciesId, tile) {
  const def = SPECIES[speciesId];
  const animal = {
    id: world.nextAnimalId++,
    species: speciesId,
    q: tile.q,
    r: tile.r,
    energy: def.startEnergy,
    cooldown: 0,
    bornOn: world.day,
    tamed: false,
  };
  world.animals.push(animal);
  return animal;
}

/**
 * Everything the day's animal logic needs that would otherwise be recomputed
 * per animal: the farms worth raiding, the rabbits worth hunting, and each
 * species' population and capacity.
 *
 * Building this once a day is the single biggest win in this file. Every one
 * of these used to be derived inside a per-animal loop.
 */
function dayContext(world) {
  // Seasonal pressure, read once a day rather than per animal.
  const season = seasonFactors(world.day);
  const farms = [];
  for (const tile of activeTiles(world)) {
    const b = tile.building;
    if (operational(b) && b.id === "farm") farms.push(tile);
  }

  const population = {};
  const capacity = {};
  for (const id of SPECIES_IDS) {
    population[id] = 0;
    capacity[id] = capacityFor(world, id);
  }
  for (const a of world.animals) if (!a.tamed) population[a.species] = (population[a.species] || 0) + 1;

  // Penned rabbits are behind a fence a fox cannot cross; hunting them would
  // only walk foxes into the fence line all day.
  const rabbits = world.animals.filter((a) => a.species === "rabbit" && !a.tamed);
  // Workers a curious fox might wander over to look at. Read-only here: the
  // ecosystem never takes anything from them.
  const people = world.workers || [];

  return { farms, rabbits, people, population, capacity, season };
}

/**
 * The crowding threshold, from a prebuilt context.
 *
 * Same rule as breedThreshold() below — that one is the public, self-contained
 * version used by tests and the UI; this one avoids recounting the board and
 * the animal list for every animal, every day.
 */
function thresholdFrom(ctx, speciesId) {
  const def = SPECIES[speciesId];
  const fullness = ctx.population[speciesId] / ctx.capacity[speciesId];
  // Crowding, then season. Winter's 0.55 divides in, so it takes nearly twice
  // the energy to breed in the cold — lean, not lethal. The numbers here are
  // the ones test/seasons.test.mjs runs several years against.
  return (def.breedEnergy * (1 + 2 * fullness)) / ctx.season.breeding;
}

/** What this animal is heading for, or null if it has no plan today. */
function targetFor(world, animal, ctx) {
  const def = SPECIES[animal.species];

  if (def.eats === "rabbit") {
    // A fed fox is digesting and ignores rabbits entirely — FIX 2 in action.
    if (animal.cooldown > 0) return null;
    let best = null;
    let bestD = Infinity;
    for (const other of ctx.rabbits) {
      const d = distance(animal, other);
      // FIX 3: anything further away than its eyesight has not been noticed.
      if (def.senseRange != null && d > def.senseRange) continue;
      if (d < bestD) {
        bestD = d;
        best = other;
      }
    }
    if (best) return best;

    // No rabbit in sight: a fox with nothing better to do drifts toward the
    // nearest person. It gets NOTHING from this — no energy, no kill — but it
    // is what makes the danger system happen at all. With foxes wandering at
    // random, two of them on a few hundred tiles essentially never came near
    // anybody, and being bitten went from a mechanic to a rumour.
    if (def.curiosity && ctx.people.length) {
      let person = null;
      let pd = Infinity;
      for (const w of ctx.people) {
        const d = distance(animal, w);
        if (d <= def.curiosity && d < pd) {
          pd = d;
          person = w;
        }
      }
      if (person) return person;
    }
    return null;
  }

  if (def.eats === "crops") {
    // Farms are active tiles, so this walks the few tiles with buildings
    // rather than the whole board. Gathered once per day by dayContext.
    let best = null;
    let bestD = Infinity;
    for (const t of ctx.farms) {
      const d = distance(animal, t);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  return null; // horses just wander
}

function moveOneStep(world, animal, rnd, ctx) {
  const target = targetFor(world, animal, ctx);
  const options = neighbors(animal.q, animal.r).filter((n) => canEnter(world, animal, n.q, n.r));
  if (options.length === 0) return;

  if (target) {
    // Step to whichever neighbour gets closest to the target.
    let best = options[0];
    let bestD = distance(best, target);
    for (const o of options) {
      const d = distance(o, target);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    // Only move if it actually helps; otherwise stay put rather than jitter.
    if (bestD < distance(animal, target)) {
      animal.q = best.q;
      animal.r = best.r;
    }
    return;
  }

  // No plan: wander, and sometimes stay still.
  if (rnd() < 0.35) return;
  const pick = options[(rnd() * options.length) | 0];
  animal.q = pick.q;
  animal.r = pick.r;
}

/**
 * One day for every animal. Called from advanceDay, and only from there.
 *
 * Order matters: spawn, move, eat, then breed and die. Eating before breeding
 * means an animal can eat its way over the threshold on the same day, which
 * keeps populations responsive instead of laggy.
 */
export function stepAnimals(world, rnd) {
  const events = [];
  const ctx = dayContext(world);

  // --- 1. SPAWN, from habitat, under a ceiling -----------------------------
  for (const speciesId of WILD_IDS) {
    const def = SPECIES[speciesId];
    const cap = ctx.capacity[speciesId];
    const pop = ctx.population[speciesId];
    if (pop >= cap) continue;

    // Chance falls linearly to zero as the land fills up.
    const room = 1 - pop / cap;
    if (rnd() >= def.spawnChance * room * ctx.season.wildlife) continue;

    const tile = pickEdgeTile(world, speciesId, rnd);
    if (!tile) continue;
    const a = spawn(world, speciesId, tile);
    ctx.population[speciesId]++;
    if (speciesId === "rabbit") ctx.rabbits.push(a);
    events.push({
      type: "spawn",
      species: speciesId,
      q: a.q,
      r: a.r,
      text: `A ${def.label.toLowerCase()} wandered in near ${a.q},${a.r}.`,
    });
  }

  // --- 1b. MIGRATE toward the settlement ------------------------------------
  if (world.home) {
    const near = {};
    for (const id of SPECIES_IDS) near[id] = 0;
    for (const a of world.animals) {
      if (!a.tamed && distance(a, world.home) <= LOCAL_RADIUS) near[a.species]++;
    }
    for (const speciesId of SPECIES_IDS) {
      const m = MIGRATION[speciesId];
      if (!m || near[speciesId] >= m.target) continue;
      if (ctx.population[speciesId] + m.group > ctx.capacity[speciesId]) continue;
      const shortfall = 1 - near[speciesId] / m.target;
      if (rnd() >= m.chance * shortfall * ctx.season.wildlife) continue;
      const tile = pickNearHome(world, speciesId, rnd);
      if (!tile) continue;
      for (let i = 0; i < m.group; i++) {
        const a = spawn(world, speciesId, tile);
        ctx.population[speciesId]++;
        if (speciesId === "rabbit") ctx.rabbits.push(a);
      }
      events.push({
        type: "migrate",
        species: speciesId,
        q: tile.q,
        r: tile.r,
        text: m.group > 1
          ? `${m.group} ${SPECIES[speciesId].label.toLowerCase()}s wandered in near ${tile.q},${tile.r}.`
          : `A ${SPECIES[speciesId].label.toLowerCase()} wandered in near ${tile.q},${tile.r}.`,
      });
    }
  }

  // --- 2. MOVE -------------------------------------------------------------
  for (const animal of world.animals) {
    if (animal.tamed) continue; // a tamed horse stays where you put it
    moveOneStep(world, animal, rnd, ctx);
  }

  // --- 3. EAT --------------------------------------------------------------
  const eaten = new Set();
  const raided = new Set(); // one raid per farm per day, see CROP_DAMAGE

  for (const animal of world.animals) {
    const def = SPECIES[animal.species];
    // Livestock is fed from the store (livestock.js), not from the land.
    if (animal.tamed) continue;
    // `cooldown` is a fox's HANDLING TIME, but for a grazer it is the breeding
    // cooldown — and this line used to skip eating for every species during
    // it. For rabbits (4 days) that fast is part of the tuned balance: letting
    // them eat through it doubled the population in a single synchronised
    // breeding day, so it stays. For a horse it was twenty days without food
    // at 0.5 energy a day, which starved every mare that ever foaled. That is
    // why the wild herd never numbered more than a handful. Horses graze
    // through it (`grazesWhileRecovering`).
    if (animal.cooldown > 0 && !def.grazesWhileRecovering) continue;

    if (def.eats === "rabbit") {
      const prey = world.animals.find(
        (o) => o.species === "rabbit" && o.q === animal.q && o.r === animal.r && !eaten.has(o.id)
      );
      if (prey) {
        eaten.add(prey.id);
        animal.energy = Math.min(def.maxEnergy, animal.energy + def.killEnergy);
        // FIX 2 — HANDLING TIME. A fox that has just eaten spends days
        // digesting. This caps how fast a few foxes can strip the map, which
        // is what keeps the rabbits from hitting zero.
        animal.cooldown = def.handlingDays;
        events.push({
          type: "kill",
          q: animal.q,
          r: animal.r,
          text: `A fox took a rabbit at ${animal.q},${animal.r}.`,
        });
        continue;
      }
    }

    if (def.eats === "crops") {
      const building = getBuilding(world, animal.q, animal.r);
      if (operational(building) && building.id === "farm") {
        // Only the first rabbit to arrive gets at the crop each day. Without
        // this cap a mob of eight rabbits flattens a farm in a single day and
        // the food economy never gets started.
        const k = key(animal.q, animal.r);
        if (building.condition > 0 && !raided.has(k)) {
          raided.add(k);
          building.condition = Math.max(0, building.condition - CROP_DAMAGE);
          animal.energy = Math.min(def.maxEnergy, animal.energy + def.cropEnergy);
          events.push({
            type: "raid",
            q: animal.q,
            r: animal.r,
            text: `A rabbit is eating the farm at ${animal.q},${animal.r}.`,
          });
          continue;
        }
      }
    }

    // getTerrain, not getTile: a grazing check should not allocate a tile
    // object for every animal every day.
    // Grass is thinner in winter, so grazing feeds less. This is the number
    // most likely to starve a population if you lower it — an animal burns
    // energyPerDay every day regardless, so graze must stay above it.
    if (def.grazeEnergy && getTerrain(world, animal.q, animal.r) === "grass") {
      const fed = def.grazeEnergy * ctx.season.graze;
      animal.energy = Math.min(def.maxEnergy, animal.energy + fed);
    }
  }

  if (eaten.size) world.animals = world.animals.filter((a) => !eaten.has(a.id));

  // --- 4. BREED AND DIE ----------------------------------------------------
  // Deaths since the context was built have to be reflected, or crowding
  // would be computed against a population that no longer exists.
  for (const id of SPECIES_IDS) ctx.population[id] = 0;
  for (const a of world.animals) if (!a.tamed) ctx.population[a.species]++;

  const newborns = [];
  const born = {};
  for (const id of SPECIES_IDS) born[id] = 0;
  for (const animal of world.animals) {
    const def = SPECIES[animal.species];
    // Livestock neither burns energy here nor breeds here — livestock.js owns
    // both, and a kept animal must never die the wild death this loop deals.
    if (animal.tamed) continue;

    animal.energy -= def.energyPerDay;
    if (animal.cooldown > 0) animal.cooldown -= 1;

    if (animal.energy > 0 && animal.cooldown === 0) {
      // From the prebuilt context: no board walk, no animal-list scan.
      const threshold = thresholdFrom(ctx, animal.species);
      const cap = ctx.capacity[animal.species];
      const pop = ctx.population[animal.species] + born[animal.species];

      if (animal.energy >= threshold && pop < cap) {
        // Breeding costs half the parent's energy, so it cannot be free.
        animal.energy = Math.round(animal.energy / 2);
        animal.cooldown = def.breedCooldown;
        const spot = neighbors(animal.q, animal.r).find((n) =>
          canEnter(world, animal, n.q, n.r)
        ) || { q: animal.q, r: animal.r };
        newborns.push({
          id: world.nextAnimalId++,
          species: animal.species,
          q: spot.q,
          r: spot.r,
          energy: animal.energy,
          cooldown: def.breedCooldown,
          bornOn: world.day,
          tamed: false,
        });
        born[animal.species]++;
      }
    }
  }
  world.animals.push(...newborns);

  const starved = world.animals.filter((a) => !a.tamed && a.energy <= 0);
  if (starved.length) {
    world.animals = world.animals.filter((a) => a.tamed || a.energy > 0);
    // One line however many died, so the log stays readable.
    const counts = {};
    for (const a of starved) counts[a.species] = (counts[a.species] || 0) + 1;
    for (const [sp, n] of Object.entries(counts)) {
      events.push({
        type: "starve",
        species: sp,
        text: `${n} ${SPECIES[sp].label.toLowerCase()}${n > 1 ? "s" : ""} did not make it through the day.`,
      });
    }
  }

  return events;
}

/** A quick population read-out, used by the panel and the text assistant. */
export function census(world) {
  return WILD_IDS.map((id) => ({
    id,
    label: SPECIES[id].label,
    count: populationOf(world, id),
    capacity: capacityFor(world, id),
  }));
}
