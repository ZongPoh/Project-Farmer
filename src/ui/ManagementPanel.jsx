import { useState } from "react";
import { jobQueue, jobLabel, milestones, PROGRAMS, programCost } from "../game/management.js";
import { staffOn } from "../game/workers.js";
import { requestedQuote, campSummaries } from "../game/rivalcamp.js";
import { activeTiles } from "../game/tiles.js";
import { constructionLabel } from "../game/construction.js";
import { ReserveSummary, CoinMarket, RulesPanel, MonumentProgress } from "./EconomyPanel.jsx";
import JobAccess from "./JobAccess.jsx";

export default function ManagementPanel({ world, onFocus, onPriority, onMove, onCancel, onProgram, onTrade, onCurrencyTrade, onLivestock, onRetryAccess, onMonumentWork }) {
  const [tab, setTab] = useState("jobs");
  const [campId, setCampId] = useState("");
  const [sell, setSell] = useState("stone");
  const [want, setWant] = useState("food");
  const [amount, setAmount] = useState(100);
  const queue = jobQueue(world);
  const neighbours = campSummaries(world).filter(c => c.kind === "settler" && c.trades);
  const chosen = neighbours.find(c => c.id === Number(campId))?.id || neighbours[0]?.id;
  const quote = requestedQuote(world, chosen, sell, want, amount);
  return <aside className="panel management">
    <nav className="tabs" aria-label="Settlement management">{["jobs", "goals", "economy", "trade", "rules"].map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t === "goals" ? "Milestones" : t === "jobs" ? "Jobs" : t === "trade" ? "Trading" : t === "rules" ? "Rules" : "Economy"}</button>)}</nav>
    {tab === "rules" && <RulesPanel />}
    {tab === "jobs" && <>
      <h3>Construction</h3>
      <p className="small muted">Construction uses elapsed game hours. Pausing stops it; priorities below apply to worker jobs.</p>
      {activeTiles(world).filter(t => t.building?.construction).map(t => <button className="job" key={`${t.q},${t.r}`} onClick={() => onFocus(t)}><span>{t.building.id} · {t.q},{t.r}</span><em>{constructionLabel(t.building)}</em></button>)}
      <h3>Work queue · {queue.length}</h3>
      <p className="small muted">Priority applies when workers choose their next job. Within a priority, unstaffed jobs come first, then queue order. Current work continues.</p>
      {!queue.length && <p>No tile jobs queued. Select land to give an order.</p>}
      {queue.map((t, i) => <section className="queue-item" key={`${t.q},${t.r}`}>
        <button className="job" onClick={() => onFocus(t)}>{jobLabel(world, t)} · {t.q},{t.r}</button>
        <p className="small">{Math.floor(t.work.done)}/{t.work.needed} worker-hours · {staffOn(world, t.q, t.r)} assigned</p>
        <JobAccess tile={t} onRetry={onRetryAccess} onFocus={onFocus}/>
        <select aria-label={`Priority at ${t.q},${t.r}`} value={t.work.priority || 0} onChange={e => onPriority(t, Number(e.target.value))}><option value={0}>Normal</option><option value={1}>High</option><option value={2}>Urgent</option></select>
        <button aria-label={`Move ${t.q},${t.r} earlier`} disabled={i === 0 || (queue[i-1].work.priority || 0) !== (t.work.priority || 0)} onClick={() => onMove(t, -1)}>↑</button>
        <button aria-label={`Move ${t.q},${t.r} later`} disabled={i === queue.length-1 || (queue[i+1].work.priority || 0) !== (t.work.priority || 0)} onClick={() => onMove(t, 1)}>↓</button>
        <button onClick={() => onCancel(t)}>Cancel</button>
      </section>)}
      <h3>Expeditions</h3>
      {(world.orders || []).filter(o => !o.done).map(o => <p className="small" key={o.id}>{o.kind === "warparty" ? `Attack village ${o.campId}` : "Catch a horse"} · {o.takenBy ? world.workers.find(w => w.id === o.takenBy)?.state || "assigned" : "queued"}</p>)}
    </>}
    {tab === "goals" && <><h3>Build a lasting settlement</h3><p className="small muted">Completed milestones stay recorded. These are goals, not a time limit.</p>{milestones(world).map(m => <p key={m.id}>{m.done ? "✓" : "○"} {m.label}</p>)}</>}
    {tab === "economy" && <>
      <ReserveSummary world={world} />
      <MonumentProgress world={world} onMonumentWork={onMonumentWork} />
      <h3>Daily programmes</h3><p className="small muted">Supplies are purchased at midnight. Benefits last that day. Programmes wait automatically if reserves would be used.</p>
      {Object.entries(PROGRAMS).map(([id, p]) => <section className="queue-item" key={id}><label><input type="checkbox" checked={!!world.programs?.[id]} onChange={e => onProgram(id, e.target.checked)} /> {p.label}</label><p className="small">{p.describe}</p><p className="small muted">{programCost(world, id)} {p.resource}/day · {world.programActive?.[id] ? "Active today" : world.programs?.[id] ? "Waiting for midnight / supplies" : "Off"}</p></section>)}
    </>}
    {tab === "trade" && <>
      <CoinMarket world={world} onTrade={onCurrencyTrade} onLivestock={onLivestock} />
      <h3>Trading</h3>
      <p className="small muted">Keep an open route through a gate so carts can reach your base.</p>
      <h3>Request a trade</h3>
      {!neighbours.length ? <p className="small">A peaceful neighbour must build a market first.</p> : <>
        <label>Village<select value={chosen} onChange={e => setCampId(e.target.value)}>{neighbours.map(c => <option key={c.id} value={c.id}>Settlers {c.id} · {c.home.q},{c.home.r}</option>)}</select></label>
        <label>Give<select value={sell} onChange={e => setSell(e.target.value)}>{["stone", "wood", "herbs", "food", "seeds"].map(r => <option key={r}>{r}</option>)}</select></label>
        <label>Amount<input type="number" min={10} max={200} value={amount} onChange={e => setAmount(Number(e.target.value))} /></label>
        <label>Receive<select value={want} onChange={e => setWant(e.target.value)}>{["food", "herbs", "seeds", "stone", "wood"].map(r => <option key={r}>{r}</option>)}</select></label>
        <p>{quote.ok ? `${amount} ${sell} → ${quote.quote.giving} ${want}` : quote.reason}</p>
        <p className="small muted">Paid on arrival. The deal is cancelled if your reserves would be used. One incoming caravan per village; requests every three days.</p>
        <button disabled={!quote.ok} onClick={() => onTrade(chosen, sell, want, amount)}>Send trade request</button>
      </>}
      <h3>Caravans</h3>{!(world.caravans || []).length && <p className="small muted">None travelling.</p>}
      {(world.caravans || []).map(c => <p key={c.id} className="small"><button onClick={() => onFocus(c)}>Find cart</button> Village {c.campId} · {c.state === "coming" ? "on its way to you" : "returning home"}{c.requested ? ` · ${c.requested.giving} ${c.requested.want} requested` : " · automatic trade"}</p>)}
    </>}
  </aside>;
}
