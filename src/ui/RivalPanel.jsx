import { buildingAt, RIVAL_BUILDINGS, KINDS, campStrength } from "../game/rivalcamp.js";
import AttackControls from "./AttackControls.jsx";
import { STRATEGIES, campBeds, campCapacity, campResidents, campDefence } from "../game/campAI.js";
import { campHolding_at } from "../game/territory.js";
import { constructionLabel } from "../game/construction.js";

export default function RivalPanel({ world, tile, onWarParty, onFocus }) {
  const found = buildingAt(world, tile.q, tile.r);
  const camp = found?.camp || campHolding_at(world, tile.q, tile.r);
  if (!camp) return null;
  const building = found?.building;
  const def = building && RIVAL_BUILDINGS[building.id];
  const capacity = campCapacity(camp);
  const residents = campResidents(world,camp);
  const marching = world.workers.filter(w => w.marching?.campId === camp.id);
  const queued = (world.orders || []).filter(o => o.kind === "warparty" && o.campId === camp.id && !o.done && !o.takenBy).length;
  return <section className="built rival-inspection">
    <h3>{KINDS[camp.kind].label} · village {camp.id} · level {camp.level || 1}</h3>
    {building?.construction && <><p>{constructionLabel(building)}</p><div className="bar"><i style={{width: `${building.construction.done / building.construction.needed * 100}%`}} /></div><p className="small muted">New buildings provide no benefits until complete. Upgrades retain the previous level.</p></>}
    <p>{def ? def.label : "Claimed land — no building here"}</p>
    {def && <><p className="small muted">{def.describe}</p><p>Condition: {Math.round(building.condition)}%</p><div className="bar"><i style={{ width: `${building.condition}%` }} /></div></>}
    <p className="small">Village centre: {camp.home.q},{camp.home.r} · Fighters: {campStrength(camp)}</p>
    <p className="small">{(camp.workers || []).length} local workers · {camp.kind === "settler" ? "Safe passage while relations are peaceful." : "Watchtowers attack your workers and other villages’ workers."}</p>
    <p className="small">{STRATEGIES[camp.strategy]?.label || "Establishing settlement"} · {residents}/{campBeds(camp)} residents/beds · Defence {campDefence(camp).toFixed(1)}</p>
    <p className="small">Food {Math.floor(camp.store.food || 0)}/{capacity.food} · Wood {Math.floor(camp.store.wood || 0)}/{capacity.wood} · Stone {Math.floor(camp.store.stone || 0)}/{capacity.stone} · Coins {camp.store.coins || 0}</p>
    <p className="small">Stored food: {residents ? (camp.store.food / (residents * 6)).toFixed(1) : "—"} days without harvest. Winter lasts 24 days.</p>
    {camp.ai && <p className="small"><strong>Latest decision: {camp.ai.action}{camp.ai.building ? ` · ${camp.ai.building}` : ""}</strong><br/>{camp.ai.reason}</p>}
    {camp.expedition && <p className="warn">{camp.expedition.people} residents on a resource raid against village {camp.expedition.targetId}: {camp.expedition.state}.</p>}
    {camp.turnedOn && <p className="warn">They used to trade with you. Your attack on day {camp.turnedOn} made them hostile.</p>}
    <button onClick={() => onFocus(camp.home)}>Go to village centre</button>
    <h3>Village buildings</h3>
    {camp.buildings.filter(b => b.condition > 0).map(b => <button key={`${b.q},${b.r}`} className="job" onClick={() => onFocus(b)}><span>{RIVAL_BUILDINGS[b.id]?.label || b.id} · {b.q},{b.r}</span><em>{constructionLabel(b) || `${Math.round(b.condition)}%`}</em></button>)}
    {camp.kind === "settler" && <p className="warn">Attacking ends trade permanently, even if your attack fails.</p>}
    <AttackControls world={world} campId={camp.id} onWarParty={onWarParty}/>
    {(marching.length > 0 || queued > 0) && <p className="small">{queued} queued · {marching.filter(w => w.state === "marching").length} marching · {marching.filter(w => w.state === "storming").length} fighting</p>}
  </section>;
}
