import { campById, RIVAL_BUILDINGS } from "../game/rivalcamp.js";
import { campDefence } from "../game/campAI.js";
import { RAIDER_HEALTH, ASSAULT_BASE, ASSAULT_ARMS, FIGHT_RANGE } from "../game/rivals.js";
import { healthOf, defenceOf } from "../game/danger.js";
import { distance } from "../game/hex.js";

function Meter({ label, value, max }) {
  const safe = Math.max(0, Math.min(max, value));
  return <label className="combat-meter">{label} · {Math.round(safe)}/{Math.round(max)}
    <progress aria-label={label} value={safe} max={Math.max(1, max)} />
  </label>;
}

export default function CombatStatus({ world, onFocus }) {
  const raiders = world.raiders || [];
  const campIds = [...new Set((world.orders || []).filter(o => o.kind === "warparty" && !o.done).map(o => o.campId)
    .concat(world.workers.filter(w => w.marching).map(w => w.marching.campId)))];
  const expeditions = (world.camps || []).filter(c => c.expedition);
  if (!raiders.length && !campIds.length && !expeditions.length) return null;
  return <aside className="combat-status" aria-label="Ongoing battles">
    {raiders.length > 0 && <section>
      <strong>Raid on your settlement</strong>
      <p>From village {[...new Set(raiders.map(r => r.campId))].filter(Boolean).join(", ") || "a previously saved raid"}</p>
      <p>{raiders.filter(r => r.state === "incoming").length} advancing · {raiders.filter(r => r.state === "leaving").length} retreating</p>
      <Meter label="Remaining raiders’ health" value={raiders.reduce((n,r) => n + (r.health ?? RAIDER_HEALTH), 0)} max={raiders.length * RAIDER_HEALTH} />
      <p>{raiders.some(r => r.state === "incoming" && world.workers.some(w => distance(w,r) <= FIGHT_RANGE)) ? "Fighting near your workers" : "Raid in progress"}{raiders.some(r => r.carrying) ? " · Raiders carrying stolen goods" : ""}</p>
      <button onClick={() => onFocus(raiders.find(r => r.state === "incoming") || raiders[0])}>Find raiders</button>
    </section>}
    {campIds.map(id => {
      const camp = campById(world,id); if (!camp) return null;
      const party = world.workers.filter(w => w.marching?.campId === id);
      const fighting = party.filter(w => w.state === "storming");
      const attack = fighting.reduce((n,w) => n + ASSAULT_BASE + defenceOf(world,w) * ASSAULT_ARMS, 0);
      const buildings = camp.buildings || [];
      const target = party.find(w => w.state === "storming")?.marching || party[0]?.marching;
      const targetBuilding = target && buildings.find(b => b.q === target.q && b.r === target.r);
      const queued = (world.orders || []).filter(o => o.kind === "warparty" && o.campId === id && !o.done && !o.takenBy).length;
      return <section key={id}>
        <strong>Attack on village {id}</strong>
        <p>{queued} queued · {party.filter(w => w.state === "marching").length} marching · {fighting.length} fighting</p>
        {party.length > 0 && <Meter label="Your party’s health" value={party.reduce((n,w) => n + healthOf(w),0)} max={party.length * 100} />}
        <Meter label="Village condition" value={buildings.reduce((n,b) => n + (b.condition ?? 100),0)} max={buildings.length * 100} />
        <p>{buildings.filter(b => b.condition > 0).length} buildings standing · Defence {Math.round(campDefence(camp))}{fighting.length > 0 ? ` · Your attack ${attack.toFixed(1)} — ${attack > Math.max(1,campDefence(camp)) ? "breaking through" : "defenders holding"}` : ""}</p>
        {targetBuilding && <Meter label={`Target: ${RIVAL_BUILDINGS[targetBuilding.id]?.label || targetBuilding.id}`} value={targetBuilding.condition} max={100}/>}
        <button onClick={() => onFocus(target || camp.home)}>View battle</button>
      </section>;
    })}
    {expeditions.map(c => <section key={`expedition-${c.id}`}><strong>Village {c.id} → village {c.expedition.targetId}</strong><p>Resource raid · {c.expedition.people} people · {c.expedition.state}</p><Meter label="Expedition health" value={c.expedition.health} max={c.expedition.people*100}/><button onClick={() => onFocus(c.expedition)}>View expedition</button></section>)}
    <small>Movement and combat resolve every game hour: 5 seconds at normal speed. Village headquarters are attacked last.</small>
  </aside>;
}
