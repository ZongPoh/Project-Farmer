/**
 * The base: levels, hiring, skills and tools.
 *
 * The base used to be a hut that did nothing but sit there being a
 * prerequisite. It is now where a food and timber surplus turns into
 * capability — which is what those piles were missing. Before this, a
 * settlement ran out of things to want by about year two.
 *
 * Four things you can spend on, in rough order of when they matter:
 *
 *   UPGRADE  raises the ceiling on how many people you can house
 *   HIRE     buys a worker now, instead of waiting for one to wander in
 *   TRAIN    makes a worker better at a kind of work
 *   CRAFT    makes a tool, which anyone can pick up
 *
 * Everything here is DATA first, the same as TERRAIN and BUILDINGS. To retune
 * the progression you edit tables; no other file has to change.
 */
import { activeTiles } from "./tiles.js";
import { beginConstruction, operational, UPGRADE_HOURS } from "./construction.js";
import { canAfford } from "./buildings.js";

// ---------------------------------------------------------------------------
// LEVELS
// ---------------------------------------------------------------------------

/**
 * `houses` is the worker ceiling the base itself imposes. Food imposes the
 * other one, and the lower always wins — see workerCapacity in workers.js.
 *
 * Costs climb steeply on purpose: a level should be several days of a good
 * settlement's output, not something you click past.
 *
 * WHY THE FOOD COSTS CAME DOWN AND THE TIMBER WENT UP. The first pass wanted
 * 400 food banked for a Village and 900 for a Town, and a two-year playthrough
 * never reached either — because food is not a pile, it is a flow. Every
 * worker eats six a day, so a settlement large enough to be worth upgrading is
 * also large enough to eat its own surplus, and the bank never fills.
 *
 * Wood and stone are the resources that genuinely accumulate (wood was past
 * three thousand by year two with nothing to spend it on). Shifting the weight
 * onto them fixed both complaints at once: the late levels are now reachable,
 * and they are the biggest timber sink in the game.
 */
export const BASE_LEVELS = [
  {
    level: 1,
    label: "Camp",
    houses: 4,
    cost: null,
    describe: "A few tents and a fire.",
    unlocks: [],
  },
  {
    level: 2,
    label: "Homestead",
    houses: 7,
    cost: { wood: 90, food: 45 },
    describe: "Room for more hands, and a bench to make tools on.",
    unlocks: ["craft"],
  },
  {
    level: 3,
    label: "Hamlet",
    houses: 11,
    cost: { wood: 260, stone: 70, food: 110 },
    describe: "Somebody who knows a trade can teach it.",
    unlocks: ["craft", "train"],
  },
  {
    level: 4,
    label: "Village",
    houses: 16,
    cost: { wood: 1400, stone: 550, food: 400 },
    describe: "A proper settlement. Spears for those who need them, and masters to teach.",
    unlocks: ["craft", "train", "master"],
  },
  {
    level: 5,
    label: "Town",
    houses: 22,
    cost: { wood: 4800, stone: 2000, food: 1200 },
    describe: "As large as this valley will hold.",
    unlocks: ["craft", "train", "master"],
  },
];

export const MAX_BASE_LEVEL = BASE_LEVELS.length;

export const baseTier = (level) =>
  BASE_LEVELS[Math.max(0, Math.min(BASE_LEVELS.length - 1, (level || 1) - 1))];

/** Does the base have this capability yet? */
export const baseUnlocks = (world, what) =>
  baseTier(world.baseLevel || 1).unlocks.includes(what);

/** Houses at the current level — the base half of the worker ceiling. */
export const baseHouses = (world) => baseTier(world.baseLevel || 1).houses;

export function nextTier(world) {
  const level = world.baseLevel || 1;
  return level >= MAX_BASE_LEVEL ? null : BASE_LEVELS[level];
}

/** Can the base be upgraded right now? { ok } or { ok: false, reason }. */
export function canUpgradeBase(world) {
  const next = nextTier(world);
  if (!next) return { ok: false, reason: "the base is as large as it gets" };

  const hasBase = activeTiles(world).some((t) => t.building && t.building.id === "base");
  if (!hasBase) return { ok: false, reason: "you have no base to upgrade" };
  const base = activeTiles(world).find(t => t.building?.id === "base").building;
  if (base.construction) return { ok: false, reason: "the base is already under construction" };
  if (!operational(base)) return { ok: false, reason: "the base is not usable" };

  if (!canAfford(world.store, next.cost)) {
    const short = Object.entries(next.cost)
      .filter(([res, n]) => (world.store[res] || 0) < n)
      .map(([res, n]) => `${n - (world.store[res] || 0)} more ${res}`)
      .join(", ");
    return { ok: false, reason: `not enough — need ${short}` };
  }
  return { ok: true, next };
}

export function upgradeBase(world) {
  const check = canUpgradeBase(world);
  if (!check.ok) return check;

  for (const [res, n] of Object.entries(check.next.cost)) world.store[res] -= n;
  const base = activeTiles(world).find(t => t.building?.id === "base").building;
  beginConstruction(base, check.next.level);
  return { ok: true, level: check.next.level, tier: check.next, hours: UPGRADE_HOURS[check.next.level] };
}

// ---------------------------------------------------------------------------
// HIRING
// ---------------------------------------------------------------------------

/**
 * Buying a worker outright.
 *
 * Workers already turn up on their own when food is plentiful, but that is
 * slow and passive — you cannot decide to grow. Hiring is the same outcome
 * bought with resources: the stores you have go into somebody arriving today
 * rather than a week from now.
 *
 * The cap is unchanged: paying does not let you exceed what the base can
 * house or what the farms can feed. Money buys speed, not physics.
 */
export const HIRE_COST = { food: 40, wood: 20 };

/** Each hire after the first costs more, so you cannot simply buy a crowd. */
export const hireCostFor = (world) => {
  const n = (world.workers || []).length;
  const scale = 1 + n * 0.35;
  return {
    food: Math.round(HIRE_COST.food * scale),
    wood: Math.round(HIRE_COST.wood * scale),
  };
};

// ---------------------------------------------------------------------------
// SKILLS
// ---------------------------------------------------------------------------

/**
 * What a worker can get good at.
 *
 *   `labour` helps with everything, a little.
 *   The rest are trades: a large bonus, but only to their own kind of work.
 *
 * `jobs` lists the conversion ids the trade applies to, so adding a job to
 * terrain.js and wanting a skill for it means editing this table and nothing
 * else.
 */
export const SKILLS = {
  labour: {
    label: "Labour",
    describe: "Everything, a little faster.",
    jobs: null, // null means "all"
    perLevel: 0.12,
  },
  forestry: {
    label: "Forestry",
    describe: "Planting and felling.",
    jobs: ["plant", "clear"],
    perLevel: 0.35,
  },
  masonry: {
    label: "Masonry",
    describe: "Breaking rock and moving earth.",
    jobs: ["quarry", "drain"],
    perLevel: 0.35,
  },
  water: {
    label: "Irrigation",
    describe: "Bringing water where it is wanted.",
    jobs: ["irrigate", "flood"],
    perLevel: 0.35,
  },
  hunting: {
    label: "Hunting",
    describe: "Standing up to a fox, and bringing something home.",
    jobs: [],
    perLevel: 0.4,
  },
  horsemanship: {
    label: "Horsemanship",
    describe: "Catching a wild horse, and getting more out of one you have.",
    jobs: [],
    perLevel: 0.4,
  },
  medicine: {
    label: "Medicine",
    describe: "Treating the hurt, and stopping a wound going bad.",
    jobs: [],
    perLevel: 0.35,
  },
};

export const SKILL_IDS = Object.keys(SKILLS);

/**
 * Three was where skill stopped, and a settlement that had trained everybody
 * to three had nothing left to want. Five is the ceiling now, but the top two
 * are MASTERY: they need a Village to teach, they cost several times what the
 * ordinary levels do, and they take three times as long to learn.
 *
 * This is deliberately a late-game sink rather than a power spike. A master is
 * about 15% better than a journeyman at the same trade — worth doing when
 * there is nothing else to spend on, not something the game waits for.
 */
export const MAX_SKILL = 5;
export const MASTERY_FROM = 4;

export const isMastery = (level) => level >= MASTERY_FROM;

/** Rising cost per level, so a specialist is a real investment. */
export const trainCostFor = (worker, skillId) => {
  const at = (worker.skills && worker.skills[skillId]) || 0;
  if (isMastery(at + 1)) {
    // Mastery is priced in stone as well, because by the time it is on offer
    // stone is what a settlement has too much of.
    const over = at + 1 - MASTERY_FROM;
    return { food: 200 + over * 140, wood: 160 + over * 120, stone: 80 + over * 60 };
  }
  return { food: 40 + at * 60, wood: 10 + at * 20 };
};

/** Hours of a worker's time spent learning rather than working. */
export const TRAIN_HOURS = 12;
export const MASTERY_HOURS = 36;

export const trainHoursFor = (worker, skillId) => {
  const at = (worker.skills && worker.skills[skillId]) || 0;
  return isMastery(at + 1) ? MASTERY_HOURS : TRAIN_HOURS;
};

export function canTrain(world, worker, skillId) {
  if (!SKILLS[skillId]) return { ok: false, reason: `no such skill "${skillId}"` };
  if (!baseUnlocks(world, "train")) {
    return { ok: false, reason: "a hamlet or better can teach a trade" };
  }
  if (!worker) return { ok: false, reason: "nobody to teach" };
  const at = (worker.skills && worker.skills[skillId]) || 0;
  if (at >= MAX_SKILL) return { ok: false, reason: `${worker.name} has mastered that already` };

  if (isMastery(at + 1) && !baseUnlocks(world, "master")) {
    return { ok: false, reason: "only a village has anyone left to teach that" };
  }

  const cost = trainCostFor(worker, skillId);
  if (!canAfford(world.store, cost)) {
    const short = Object.entries(cost)
      .filter(([res, n]) => (world.store[res] || 0) < n)
      .map(([res, n]) => `${n - (world.store[res] || 0)} more ${res}`)
      .join(", ");
    return { ok: false, reason: `not enough — need ${short}` };
  }
  return { ok: true, cost, at, hours: trainHoursFor(worker, skillId), mastery: isMastery(at + 1) };
}

// ---------------------------------------------------------------------------
// TOOLS
// ---------------------------------------------------------------------------

/**
 * Tools live in a POOL, not on a person.
 *
 * `world.tools` is a count per kind, and a worker claims the best one for
 * whatever job they are about to do, then puts it back. That is deliberate:
 * an idle game should not need you to micro-manage who is holding the axe,
 * and it means a tool you craft immediately helps whoever needs it most.
 */
export const TOOLS = {
  axe: {
    label: "Axe",
    cost: { wood: 12, stone: 8 },
    jobs: ["clear", "plant"],
    rate: 0.6,
    life: 200,
    describe: "Felling and planting go half again as fast.",
  },
  spade: {
    label: "Spade",
    cost: { wood: 14, stone: 6 },
    jobs: ["irrigate", "flood", "drain"],
    rate: 0.55,
    life: 220,
    describe: "For moving earth and water.",
  },
  pick: {
    label: "Pick",
    cost: { wood: 8, stone: 18 },
    jobs: ["quarry"],
    rate: 0.7,
    // Stone against stone. A pick is the dearest tool and the shortest-lived,
    // which is what turns a quarry into a reason to keep quarrying.
    life: 150,
    describe: "Makes a mountain a great deal less daunting. Wears fast.",
  },
  spear: {
    label: "Spear",
    cost: { wood: 10, stone: 10 },
    jobs: [],
    combat: 0.7,
    // Spears are not worn down by use, they are broken in fights — see
    // `breakWeapon`. Carrying one around costs nothing.
    life: 0,
    describe: "A fox thinks twice. So does whoever is carrying it.",
  },
};

export const TOOL_IDS = Object.keys(TOOLS);

export function canCraft(world, toolId) {
  const def = TOOLS[toolId];
  if (!def) return { ok: false, reason: `no such tool "${toolId}"` };
  if (!baseUnlocks(world, "craft")) {
    return { ok: false, reason: "a homestead or better has a bench to work on" };
  }
  if (!canAfford(world.store, def.cost)) {
    const short = Object.entries(def.cost)
      .filter(([res, n]) => (world.store[res] || 0) < n)
      .map(([res, n]) => `${n - (world.store[res] || 0)} more ${res}`)
      .join(", ");
    return { ok: false, reason: `not enough — need ${short}` };
  }
  return { ok: true, def };
}

export function craftTool(world, toolId) {
  const check = canCraft(world, toolId);
  if (!check.ok) return check;
  for (const [res, n] of Object.entries(check.def.cost)) world.store[res] -= n;
  world.tools = world.tools || {};
  world.tools[toolId] = (world.tools[toolId] || 0) + 1;
  return { ok: true, toolId, have: world.tools[toolId] };
}

// --- wear ------------------------------------------------------------------

/**
 * Tools wear out, and this is where the workshop gets a reason to keep running.
 *
 * The pool model says a tool is a COUNT, not an object — there is no `axe #3`
 * to hang a condition on, and inventing one would put a per-tool record in
 * every save for a number nobody reads. So wear is pooled too: `world.toolUse`
 * banks hours worked per KIND, and when a kind has banked a whole tool's worth
 * of life, one of them breaks.
 *
 * The effect a player sees is the right one — tools you use constantly need
 * replacing, tools sitting in the shed do not — and it costs one number per
 * kind in the save rather than one per tool.
 */
export function wearTool(world, toolId, hours = 1) {
  const def = TOOLS[toolId];
  if (!def || !def.life) return null;
  world.toolUse = world.toolUse || {};
  world.toolUse[toolId] = (world.toolUse[toolId] || 0) + hours;

  if (world.toolUse[toolId] < def.life) return null;
  world.toolUse[toolId] -= def.life;

  const owned = (world.tools && world.tools[toolId]) || 0;
  if (owned <= 0) {
    // Nothing left to break. Bank no further debt, or crafting a replacement
    // years later would see it shatter on the first swing.
    world.toolUse[toolId] = 0;
    return null;
  }
  world.tools[toolId] = owned - 1;

  // Whoever was holding it is now holding nothing.
  for (const w of world.workers || []) {
    if (w.tool === toolId) {
      w.tool = null;
      break;
    }
  }
  return { type: "toolBroke", toolId, text: `${def.label} broke and is beyond mending.` };
}

/**
 * A weapon lost in a fight, rather than worn down by work.
 *
 * Kept separate from `wearTool` because the trigger is different: a spear has
 * no `life`, it simply may not survive the day it is needed.
 */
export function breakWeapon(world, worker) {
  const id = worker && worker.tool;
  if (!id || !TOOLS[id] || !TOOLS[id].combat) return null;
  worker.tool = null;
  if (world.tools && world.tools[id] > 0) world.tools[id] -= 1;
  return { type: "toolBroke", toolId: id, text: `${worker.name}'s ${TOOLS[id].label.toLowerCase()} was broken.` };
}

/** How many of a tool are not currently in somebody's hands. */
export function toolsFree(world, toolId) {
  const owned = (world.tools && world.tools[toolId]) || 0;
  const held = (world.workers || []).filter((w) => w.tool === toolId).length;
  return owned - held;
}

/** The best free tool for this job, or null. */
export function bestToolFor(world, jobId) {
  let best = null;
  let bestRate = 0;
  for (const id of TOOL_IDS) {
    const def = TOOLS[id];
    if (!def.jobs.includes(jobId)) continue;
    if (toolsFree(world, id) <= 0) continue;
    if (def.rate > bestRate) {
      bestRate = def.rate;
      best = id;
    }
  }
  return best;
}

/** Claim a tool for a worker about to start a job. */
export function equipFor(world, worker, jobId) {
  if (worker.tool) return worker.tool; // already holding something
  const id = bestToolFor(world, jobId);
  if (id) worker.tool = id;
  return worker.tool;
}

/** Put whatever they were holding back in the store. */
export function unequip(worker) {
  worker.tool = null;
}

/** The best free weapon, for someone about to be in trouble. */
export function bestWeapon(world) {
  for (const id of TOOL_IDS) {
    if (TOOLS[id].combat && toolsFree(world, id) > 0) return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// THE RATE
// ---------------------------------------------------------------------------

/**
 * How much work one worker does in one hour on a given job.
 *
 * This is the single number every upgrade in this file eventually moves, so
 * it is worth keeping in one place:
 *
 *   base 1
 *   x hunger      (half if nobody ate)
 *   x skills      labour always, plus the trade if it matches
 *   x tool        if they managed to pick one up
 *
 * A trained, equipped worker is roughly two and a half times a raw one, which
 * is enough to feel worth the investment without making early workers useless.
 */
export function workRate(world, worker, jobId) {
  let rate = worker.hungry ? 0.5 : 1;

  const skills = worker.skills || {};
  for (const id of SKILL_IDS) {
    const level = skills[id] || 0;
    if (!level) continue;
    const def = SKILLS[id];
    const applies = def.jobs === null || def.jobs.includes(jobId);
    if (applies) rate *= 1 + def.perLevel * level;
  }

  if (worker.tool && TOOLS[worker.tool] && TOOLS[worker.tool].jobs.includes(jobId)) {
    rate *= 1 + TOOLS[worker.tool].rate;
  }

  // Injured people work slowly. Health is only ever below 100 once the fox
  // system is in play; before that this is always 1.
  const health = worker.health === undefined ? 100 : worker.health;
  if (health < 60) rate *= 0.5 + (health / 60) * 0.5;

  return rate;
}

/** A one-line read-out of what a worker is worth, for the panel. */
export function describeWorker(world, worker) {
  const skills = Object.entries(worker.skills || {})
    .filter(([id, n]) => n > 0 && SKILLS[id])
    .map(([id, n]) => `${SKILLS[id].label} ${n}${isMastery(n) ? " (master)" : ""}`);
  return {
    skills,
    tool: worker.tool ? TOOLS[worker.tool].label : null,
    health: worker.health === undefined ? 100 : Math.round(worker.health),
    rate: +workRate(world, worker, "clear").toFixed(2),
  };
}
