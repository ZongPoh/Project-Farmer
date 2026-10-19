import { activeTiles } from "./tiles.js";

/** All factions use elapsed game hours, independent of their population model. */
export const BUILD_HOURS = {
  house: 24, warehouse: 48,
  base: 0, camp: 12, farm: 24, woodcutter: 24, quarryCamp: 36,
  well: 24, fence: 6, wall: 24, gate: 24, wallTower: 48, watchtower: 48, granary: 48,
  infirmary: 48, paddock: 24, hut: 24, store: 48, market: 48, workshop: 48,
};
export const UPGRADE_HOURS = { 2: 48, 3: 72, 4: 96, 5: 144 };
export const EXPANSION_BUILDINGS = ["farm", "woodcutter", "wall"];
/** First 19 claimed tiles: 30s. Each additional 10 tiles adds 10s, up to 4min. */
export function constructionHours(id, holding = null) {
  if (holding && EXPANSION_BUILDINGS.includes(id)) {
    const extra = Math.max(0, (holding.claims?.size || 0) - 19);
    return Math.min(48, 6 + Math.ceil(extra / 10) * 2);
  }
  return BUILD_HOURS[id] ?? 24;
}
/** Accept legacy fixed durations as well as the bounded expansion schedule. */
export const validBuildHours = (id, hours) => hours === BUILD_HOURS[id] ||
  (id === "base" && hours === 12) ||
  (EXPANSION_BUILDINGS.includes(id) && Number.isInteger(hours) && hours >= 6 && hours <= 48 && hours % 2 === 0);
export const operational = b => !!b && b.condition > 0 && (!b.construction || b.construction.kind === "upgrade");
export function beginConstruction(building, targetLevel = null, holding = null) {
  if (!targetLevel && constructionHours(building.id) === 0) {
    building.construction = null;
    return null;
  }
  building.construction = {
    kind: targetLevel ? "upgrade" : "build",
    done: 0,
    needed: targetLevel ? UPGRADE_HOURS[targetLevel] : constructionHours(building.id, holding),
    targetLevel,
  };
  return building.construction;
}
export function constructionLabel(b) {
  const job = b?.construction;
  if (!job) return null;
  const left = Math.max(0, job.needed - job.done);
  return `${job.kind === "upgrade" ? "Upgrading" : "Building"}: ${Math.ceil(left)} game hours left (${Math.floor(job.done / job.needed * 100)}%)`;
}

/** Called once per simulation hour. Existing saves without projects stay complete. */
export function stepConstruction(world) {
  const events = [];
  const advance = (b, at, camp = null) => {
    const job = b?.construction;
    if (!job || b.condition <= 0) return;
    job.done = Math.min(job.needed, job.done + 1);
    if (job.done < job.needed) return;
    if (job.targetLevel) {
      if (camp) camp.level = job.targetLevel;
      else world.baseLevel = job.targetLevel;
    }
    b.construction = null;
    b.builtOn = world.day;
    const owner = camp ? `${camp.kind === "settler" ? "Settlers" : "Raiders"} at ${camp.home.q},${camp.home.r}: ` : "";
    events.push({ type: "constructionComplete", q: at.q, r: at.r,
      text: `${owner}${b.id} ${job.kind === "upgrade" ? `upgrade to level ${job.targetLevel}` : "construction"} completed at ${at.q},${at.r}.` });
  };
  for (const tile of activeTiles(world)) advance(tile.building, tile);
  for (const camp of world.camps || []) for (const b of camp.buildings || []) advance(b, b, camp);
  return events;
}
