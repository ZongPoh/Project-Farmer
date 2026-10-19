import { findPath, canWalk } from "./workers.js";
import { distance } from "./hex.js";
import { getTerrain } from "./tiles.js";
import { moveCost } from "./terrain.js";
import { campDefence, creditCamp } from "./campAI.js";

export function startCampExpedition(world, camp) {
  if (camp.expedition || camp.fighters < 4) return false;
  const people = Math.min(8, Math.floor(camp.fighters * 0.6));
  const candidates = (world.camps || []).filter(c => c.id !== camp.id && c.store.food > 60 && campDefence(c) < people * 3)
    .sort((a,b) => distance(camp.home,a.home) - distance(camp.home,b.home));
  for (const target of candidates) {
    const path = findPath(world,camp.home,target.home);
    if (!path) continue;
    camp.expedition = { targetId: target.id, q: camp.home.q, r: camp.home.r, people, health: people * 100, state: "outbound", path, move: 0, rounds: 0, cargo: {}, hours: 0 };
    camp.fighters -= people;
    camp.lastExpedition = world.day;
    return true;
  }
  return false;
}

/** Visible, saved resource raids: villagers leave home and must return with loot. */
export function stepCampExpeditions(world) {
  const events = [];
  for (const camp of world.camps || []) {
    const trip = camp.expedition;
    if (!trip) continue;
    const target = world.camps.find(c => c.id === trip.targetId);
    trip.hours++;
    if (trip.state !== "returning" && (!target || trip.hours > 240 || trip.health < 30)) { trip.state = "returning"; trip.path = null; }
    if (trip.state === "fighting" && target) {
      trip.rounds++;
      trip.health = Math.max(0, trip.health - campDefence(target) * 1.5);
      if (trip.rounds >= 6 || trip.health < 50) {
        const capacity = Math.max(0, Math.ceil(trip.health / 100)) * 30;
        const resource = ["food","wood","stone"].sort((a,b) => (target.store[b] || 0) - (target.store[a] || 0))[0];
        const amount = Math.min(capacity, Math.floor((target.store[resource] || 0) * 0.3));
        target.store[resource] -= amount;
        trip.cargo = { [resource]: amount };
        trip.state = "returning"; trip.path = null;
        events.push({ type: "villagePlunder", q: trip.q, r: trip.r, text: `Village ${camp.id}'s raiders are returning from village ${target.id} with ${amount} ${resource}.` });
      }
    } else {
      const destination = trip.state === "returning" ? camp.home : target?.home;
      if (!destination) continue;
      if (!trip.path) trip.path = findPath(world,trip,destination);
      trip.move = Math.min(2,(trip.move || 0) + 1);
      if (trip.path?.length) {
        const next = trip.path[0];
        const cost = moveCost(getTerrain(world,next.q,next.r));
        if (!canWalk(world,next.q,next.r)) trip.path = null;
        else if (trip.move >= cost) { trip.move -= cost; trip.q = next.q; trip.r = next.r; trip.path.shift(); }
      }
      if (trip.q === destination.q && trip.r === destination.r) {
        if (trip.state === "returning") {
          camp.fighters += Math.min(trip.people, Math.ceil(trip.health / 100));
          for (const [res,amount] of Object.entries(trip.cargo)) creditCamp(camp,res,amount);
          camp.expedition = null;
        } else { trip.state = "fighting"; trip.path = null; }
      }
    }
    if (trip.health <= 0 || trip.hours > 480) camp.expedition = null;
  }
  return events;
}
