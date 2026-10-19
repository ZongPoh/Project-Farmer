import { serialize, migrate } from "./world.js";
import { advanceHours, MAX_CATCHUP_HOURS, SECONDS_PER_DAY } from "./tick.js";
import { TERRAIN, CONVERSIONS } from "./terrain.js";
import { BUILDINGS } from "./buildings.js";
import { SPECIES } from "./animals.js";
import { TOOLS, SKILLS } from "./base.js";
import { RIVAL_BUILDINGS } from "./rivalcamp.js";
import { inBounds } from "./grid.js";
import { validBuildHours, UPGRADE_HOURS } from "./construction.js";

export const SAVE_KEY = "hexfarm.save.v1";
export const BACKUP_KEY = "hexfarm.backup.v1";
export const MAX_SAVE_BYTES = 8_000_000;
export const defaultSettings = { running: false, secondsPerDay: SECONDS_PER_DAY, offline: true };

export function encodeSave(world, settings = defaultSettings, now = Date.now()) {
  return JSON.stringify({ format: "hexfarm", version: 1, savedAt: now, settings, world: serialize(world) });
}

// Validate before migration or replacing a live game. Imported files are data.
export function decodeSave(text) {
  if (typeof text !== "string" || text.length > MAX_SAVE_BYTES) throw new Error("Save file is too large.");
  const envelope = JSON.parse(text);
  if (envelope?.format !== "hexfarm" || envelope.version !== 1) throw new Error("Choose a Hex Farm backup file.");
  const d = envelope.world;
  const integer = n => Number.isSafeInteger(n);
  const point = p => p && integer(p.q) && integer(p.r) && inBounds(d.grid, p.q, p.r);
  const known = (table, key) => Object.hasOwn(table, key);
  const validProject = b => {
    if (!b.construction) return true;
    const c = b.construction;
    return ["build", "upgrade"].includes(c.kind) && Number.isFinite(c.done) && c.done >= 0 && c.done <= c.needed &&
      (c.kind === "build" ? validBuildHours(b.id, c.needed) : ["base", "camp"].includes(b.id) && c.needed === UPGRADE_HOURS[c.targetLevel]);
  };
  if (!d || ![8, 9, 10, 11, 12].includes(d.version) || !integer(d.seed) || !integer(d.day) || d.day < 1 || !integer(d.hour) || d.hour < 0 || d.hour > 23 ||
      !integer(d.grid?.width) || !integer(d.grid?.height) || d.grid.width < 1 || d.grid.height < 1 || d.grid.width > 400 || d.grid.height > 200 ||
      !Number.isFinite(envelope.savedAt) || envelope.savedAt < 0) throw new Error("Invalid save date or map.");
  for (const field of ["modified", "workers", "animals", "orders", "raiders", "camps", "caravans", "owned", "resettle"]) {
    if (!Array.isArray(d[field])) throw new Error(`Invalid save: ${field}.`);
  }
  if (!point(d.home) || d.workers.length > 1000 || d.modified.length > d.grid.width * d.grid.height) throw new Error("Invalid settlement size or home.");
  for (const k of d.owned) {
    if (typeof k !== "string" || !/^-?\d+,-?\d+$/.test(k)) throw new Error("Invalid saved territory.");
  }
  if (!d.store || Object.values(d.store).some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0)) throw new Error("Invalid resource stores.");
  if (d.market != null && (!integer(d.market.period) || d.market.period < 0 || !Number.isFinite(d.market.purse) || d.market.purse < 0 ||
      !d.market.stock || ["food", "wood", "stone"].some(r => !integer(d.market.stock[r]) || d.market.stock[r] < 0 || d.market.stock[r] > 120))) throw new Error("Invalid market stock.");
  for (const t of d.modified) {
    if (!point(t) || !known(TERRAIN, t.terrain) || (t.building && (!known(BUILDINGS, t.building.id) || !Number.isFinite(t.building.condition) || (t.building.lastShot && (!point(t.building.lastShot) || !Number.isFinite(t.building.lastShot.at))) || !validProject(t.building))) ||
        (t.work && (!Number.isFinite(t.work.done) || !Number.isFinite(t.work.needed) || !(t.work.needed > 0) ||
        (!t.work.claim && !t.work.hunt && (!known(TERRAIN, t.work.to) || !CONVERSIONS.some(c => c.id === t.work.id)))))) throw new Error("Invalid saved tile.");
  }
  for (const a of d.animals) if (!point(a) || !known(SPECIES, a.species) || (a.pen != null && (typeof a.pen !== "string" || !/^-?\d+,-?\d+$/.test(a.pen) || !point({q:Number(a.pen.split(",")[0]), r:Number(a.pen.split(",")[1])}))) || (a.coop != null && (typeof a.coop !== "string" || !/^-?\d+,-?\d+$/.test(a.coop) || !point({q:Number(a.coop.split(",")[0]), r:Number(a.coop.split(",")[1])})))) throw new Error("Invalid saved animal.");
  for (const w of d.workers) if (!point(w) || !integer(w.id) || typeof w.name !== "string" || !Number.isFinite(w.health) ||
    (w.tool && !known(TOOLS, w.tool)) || Object.entries(w.skills || {}).some(([id, n]) => !known(SKILLS, id) || !Number.isFinite(n)) ||
    (w.state === "training" && (!w.training || !known(SKILLS, w.training.skill) || !Number.isFinite(w.training.hoursLeft))) ||
    (w.path != null && (!Array.isArray(w.path) || !w.path.every(point)))) throw new Error("Invalid saved worker.");
  for (const c of d.camps) if (!point(c.home) || !["raider", "settler"].includes(c.kind) || !Array.isArray(c.buildings) ||
    !c.buildings.every(b => point(b) && known(RIVAL_BUILDINGS, b.id) && Number.isFinite(b.condition) && validProject(b)) || !Array.isArray(c.owned)) throw new Error("Invalid saved neighbour.");
  for (const c of d.camps) {
    if (c.workers != null && (!Array.isArray(c.workers) || c.workers.some(w => !point(w) || typeof w.id !== "string" || w.campId !== c.id || !Number.isFinite(w.health) || w.health < 0 || w.health > 100 || !Number.isFinite(w.move) || w.move < 0 || !Number.isFinite(w.workHours) || w.workHours < 0 || (w.target != null && !point(w.target)) || (w.path != null && (!Array.isArray(w.path) || !w.path.every(point)))))) throw new Error("Invalid village worker.");
    if (c.buildings.some(b => b.lastShot && (!point(b.lastShot) || !Number.isFinite(b.lastShot.at)))) throw new Error("Invalid village tower shot.");
    if (!c.store || Object.values(c.store).some(n => !Number.isFinite(n) || n < 0) || !integer(c.fighters) || c.fighters < 0) throw new Error("Invalid neighbour resources.");
    if (c.strategy != null && !["trader","defender","raider"].includes(c.strategy)) throw new Error("Invalid neighbour strategy.");
    const m = c.merchant;
    if (m && (!integer(m.period) || m.period < 0 || !Number.isFinite(m.purse) || m.purse < 0 || !m.stock || ["food","wood","stone"].some(r => !integer(m.stock[r]) || m.stock[r] < 0 || m.stock[r] > 120))) throw new Error("Invalid neighbour merchant.");
    const e = c.expedition;
    if (e && (!point(e) || !integer(e.targetId) || !integer(e.people) || e.people < 1 || e.people > 8 || !Number.isFinite(e.health) || e.health < 0 || e.health > e.people*100 || !["outbound","fighting","returning"].includes(e.state) || !integer(e.hours) || e.hours < 0 || !integer(e.rounds) || e.rounds < 0 || !Number.isFinite(e.move) || e.move < 0 || !e.cargo || Object.entries(e.cargo).some(([r,n]) => !["food","wood","stone"].includes(r) || !Number.isFinite(n) || n < 0) || (e.path != null && (!Array.isArray(e.path) || !e.path.every(point))))) throw new Error("Invalid village expedition.");
  }
  const l = d.livestock;
  if (l != null && (typeof l !== "object" || !Number.isFinite(l.foalIn) || !l.lost || typeof l.lost !== "object" ||
      Object.values(l.lost).some(n => !integer(n) || n < 0))) throw new Error("Invalid livestock.");
  // Losses of everything that is not a horse, and the fractions of a food that
  // milk and eggs are still owed. Both are small maps of small numbers.
  if (l && l.lostBy != null && (typeof l.lostBy !== "object" ||
      Object.values(l.lostBy).some(by => !by || typeof by !== "object" ||
        Object.values(by).some(n => !integer(n) || n < 0)))) throw new Error("Invalid livestock losses.");
  if (l && l.carry != null && (typeof l.carry !== "object" ||
      Object.values(l.carry).some(n => !Number.isFinite(n) || n < 0 || n >= 1))) throw new Error("Invalid livestock carry.");
  for (const c of d.camps) if (c.horses != null && (!integer(c.horses) || c.horses < 0)) throw new Error("Invalid neighbour horses.");
  // The ground. `timber` and `rock` ride along on the tiles above; this is the
  // list of clearings waiting to grow back. Bounded, because an unbounded list
  // in a save file is a way to make loading expensive from the outside.
  if (d.regrowth != null && (!Array.isArray(d.regrowth) || d.regrowth.length > 4000 ||
      d.regrowth.some(e => !point(e) || !integer(e.day) || e.day < 0))) throw new Error("Invalid regrowth.");
  for (const t of d.modified) {
    if ((t.timber != null && (!Number.isFinite(t.timber) || t.timber < 0)) ||
        (t.rock != null && (!Number.isFinite(t.rock) || t.rock < 0))) throw new Error("Invalid saved ground.");
  }
  for (const c of d.caravans) if (c.trail != null && (!Array.isArray(c.trail) || c.trail.length > 4 || !c.trail.every(point))) throw new Error("Invalid caravan route.");
  for (const field of ["orders", "raiders", "caravans", "resettle"]) if (d[field].some(x => !x || typeof x !== "object")) throw new Error(`Invalid save: ${field}.`);
  const settings = { ...defaultSettings, ...envelope.settings };
  settings.secondsPerDay = SECONDS_PER_DAY;
  settings.running = settings.running === true;
  settings.offline = settings.offline !== false;
  return { world: migrate(d), settings, savedAt: envelope.savedAt };
}

export function catchUp(saved, now = Date.now()) {
  if (!saved.settings.running || !saved.settings.offline) return { hoursRun: 0, capped: false, events: [] };
  const hours = Math.max(0, Math.floor((now - saved.savedAt) / 1000 * 24 / SECONDS_PER_DAY));
  const result = advanceHours(saved.world, Math.min(hours, MAX_CATCHUP_HOURS));
  return { ...result, capped: hours > MAX_CATCHUP_HOURS };
}

export function writeSave(storage, text, key = SAVE_KEY) {
  try { storage.setItem(key, text); return { ok: true }; }
  catch { return { ok: false, reason: "Saving failed. Browser storage may be full or unavailable. Use Save to file to keep your progress." }; }
}
