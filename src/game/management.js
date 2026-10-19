import { activeTiles, getTile } from "./tiles.js";
import { BUILDINGS, countBuildings } from "./buildings.js";
import { optionsFor } from "./terrain.js";
import { monumentFinished } from "./monument.js";

export function jobQueue(world) {
  return [...activeTiles(world)].filter(t => t.work && !t.work.finished)
    .sort((a, b) => (b.work.priority || 0) - (a.work.priority || 0) || a.work.seq - b.work.seq);
}

export function jobLabel(world, tile) {
  if (tile.work?.claim) return "Claim ground";
  if (tile.work?.hunt) return `Hunt ${tile.work.species}`;
  return optionsFor(world, tile).find(j => j.id === tile.work?.id)?.label || tile.work?.id || "Job";
}

export function setJobPriority(world, q, r, priority) {
  const tile = getTile(world, q, r);
  if (!tile?.work || ![0, 1, 2].includes(priority)) return { ok: false, reason: "no valid job or priority" };
  tile.work.priority = priority;
  return { ok: true };
}

export function moveJob(world, q, r, direction) {
  const queue = jobQueue(world);
  const i = queue.findIndex(t => t.q === q && t.r === r);
  const other = queue[i + direction];
  if (i < 0 || ![-1, 1].includes(direction) || !other) return { ok: false, reason: "end of queue" };
  const tile = queue[i];
  if ((tile.work.priority || 0) !== (other.work.priority || 0)) return { ok: false, reason: "change priority to move between groups" };
  [queue[i], queue[i + direction]] = [other, tile];
  for (const t of queue) t.work.seq = ++world.nextJobSeq;
  return { ok: true };
}

// Optional daily programmes. No debt and no penalty when supplies run out.
export const PROGRAMS = {
  roads: { label: "Maintain roads", resource: "stone", reserve: 20, describe: "25% faster travel. Daily stone: one per two people; keeps 20 in reserve." },
  medicine: { label: "Preventive care", resource: "herbs", reserve: 10, describe: "10% faster travel and +2 health daily. One herb per four people; keeps 10 for wounds." },
};
export function programCost(world, id) {
  return Math.ceil(world.workers.length / (id === "roads" ? 2 : 4));
}
export function setProgram(world, id, enabled) {
  if (!PROGRAMS[id]) return { ok: false, reason: "unknown programme" };
  world.programs = { ...world.programs, [id]: !!enabled };
  return { ok: true };
}
export function dailyPrograms(world) {
  const events = [];
  world.programActive = {};
  for (const [id, spec] of Object.entries(PROGRAMS)) {
    if (!world.programs?.[id]) continue;
    const cost = programCost(world, id);
    if (!cost || (world.store[spec.resource] || 0) < cost + spec.reserve) {
      if (!world.programShort?.[id]) events.push({ type: "supplies", text: `${spec.label} is waiting for supplies; reserves are protected.` });
      world.programShort = { ...world.programShort, [id]: true };
      continue;
    }
    world.store[spec.resource] -= cost;
    world.programActive[id] = true;
    world.programShort = { ...world.programShort, [id]: false };
    if (id === "medicine") for (const w of world.workers) {
      if (w.health > 0 && !w.festering) w.health = Math.min(100, w.health + 2);
    }
  }
  return events;
}
export function travelBonus(world) {
  return 1 + (world.programActive?.roads ? 0.25 : 0) + (world.programActive?.medicine ? 0.1 : 0);
}

export function milestones(world) {
  const buildings = Object.fromEntries(Object.keys(BUILDINGS).map(id => [id, countBuildings(world, id)]));
  return [
    { id: "home", label: "Found a camp", done: !!buildings.base },
    { id: "food", label: "Build two farms", done: (buildings.farm || 0) >= 2 },
    { id: "wood", label: "Establish a woodcutter", done: !!buildings.woodcutter },
    { id: "land", label: "Develop 20 tiles", done: (world.owned?.size || 0) >= 20 },
    { id: "winter", label: "Reach the second spring", done: world.day >= 97 },
    { id: "trade", label: "Complete a trade", done: (world.tradesCompleted || 0) > 0 },
    { id: "town", label: "Grow into a town", done: world.baseLevel >= 5 },
    { id: "monument", label: "Raise the monument", done: monumentFinished(world) },
  ].map(m => ({ ...m, done: m.done || !!world.achievements?.[m.id] }));
}
export function recordMilestones(world) {
  world.achievements = world.achievements || {};
  const events = [];
  for (const m of milestones(world)) if (m.done && !world.achievements[m.id]) {
    world.achievements[m.id] = world.day;
    events.push({ type: "milestone", text: `Milestone reached: ${m.label}.` });
  }
  return events;
}
