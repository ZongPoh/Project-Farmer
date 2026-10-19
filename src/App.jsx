import CombatStatus from "./ui/CombatStatus.jsx";
import { currencyTrade, livestockTrade } from "./game/economy.js";
import { stockRabbitPen, cullRabbits, stockPen, cullPen, stockCoop } from "./game/pens.js";
import { useState, useRef, useCallback } from "react";
import Board from "./scene/Board.jsx";
import CanvasBoundary from "./ui/CanvasBoundary.jsx";
import TilePanel from "./ui/TilePanel.jsx";
import StoreBar from "./ui/StoreBar.jsx";
import Clock from "./ui/Clock.jsx";
import { createWorld, worldTileCount } from "./game/world.js";
import { getTile } from "./game/tiles.js";
import {
  advanceHour, startWork, startHunt, cancelWork, SECONDS_PER_DAY,
} from "./game/tick.js";
import { describeDate, seasonOf } from "./game/calendar.js";
import { place, demolish, repair, BUILDINGS } from "./game/buildings.js";
import { hire, train, retryJobAccess } from "./game/workers.js";
import { upgradeBase, craftTool, TOOLS, SKILLS, baseTier } from "./game/base.js";
import { respond, logMiss, adviseFarm } from "./game/assistant.js";
import { orderCatch, cancelOrder, mount, stable } from "./game/horses.js";
import ChaseStatus from "./ui/ChaseStatus.jsx";
import { payTribute } from "./game/rivals.js";
import { orderWarParty } from "./game/rivalcamp.js";
import { startClaim } from "./game/tick.js";
import { territorySize } from "./game/territory.js";
import { useSettlement, useAutosave } from "./ui/useSettlement.js";
import { BACKUP_KEY, MAX_SAVE_BYTES, encodeSave, decodeSave, writeSave } from "./game/persistence.js";
import { setJobPriority, moveJob, setProgram, jobQueue } from "./game/management.js";
import { setMonumentWork } from "./game/monument.js";
import { requestTrade } from "./game/rivalcamp.js";
import ManagementPanel from "./ui/ManagementPanel.jsx";
import Minimap from "./ui/Minimap.jsx";
import { makeVisualClock } from "./scene/visualClock.js";

/** One line of flavour when a season turns, so the change is legible. */
const SEASON_NOTE = {
  spring: "The land wakes up — good growth, and wildlife returns.",
  summer: "Long days and the best harvests of the year.",
  autumn: "Growth slows. Bank food before the cold.",
  winter: "Short days, thin grazing, and little grows. Live off your stores.",
};

/** Board sizes offered in the UI. The renderer only ever draws what fits. */
const SIZES = [
  { label: "Small", width: 24, height: 16 },
  { label: "Medium", width: 80, height: 50 },
  { label: "Large", width: 200, height: 120 },
  { label: "Huge", width: 400, height: 200 },
];

export default function App() {
  const { initial, world, setWorld, revision, act } = useSettlement();
  const seed = world.seed;
  const size = SIZES.find(s => s.width === world.grid.width && s.height === world.grid.height) || { label: "Custom", ...world.grid };
  const [saveLocked, setSaveLocked] = useState(initial.locked);
  const [offline, setOffline] = useState(initial.settings.offline);
  const [focusAt, setFocusAt] = useState(null);
  const [managementOpen, setManagementOpen] = useState(true);
  const importRef = useRef(null);
  const [selectedAt, setSelectedAt] = useState(null);
  const [log, setLog] = useState([
    `Day ${world.day} — ${describeDate(world.day)}.`,
    initial.message,
  ]);
  const [running, setRunning] = useState(initial.settings.running);
  const [input, setInput] = useState("");
  const settings = { running, secondsPerDay: SECONDS_PER_DAY, offline };
  const { status: saveStatus, flush } = useAutosave(world, settings, revision, saveLocked, act(() => {}));

  /**
   * The time of day, as a fraction from midnight to midnight.
   *
   * Deliberately a REF, not state: it moves every frame, and putting it in
   * state would re-render the whole app sixty times a second. The scene
   * mutates lights and sky uniforms from it directly; the clock read-out
   * polls it. Nothing else needs to know.
   *
   * The world starts at 07:00 so a new game opens in morning light.
   */
  // Only the fraction BETWEEN hours. The hour itself is world.hour now —
  // real simulation state, not a lighting value.
  const clockRef = useRef(makeVisualClock(world.day, world.hour));

  // Re-read the tile every render rather than holding onto the object. Most
  // tiles are generated on demand, so a tile object you kept is a snapshot
  // and will not show a building you just placed on it.
  const selected = selectedAt ? getTile(world, selectedAt.q, selectedAt.r) : null;

  const say = (line) => setLog((l) => [...l.slice(-60), line]);

  /** Report whatever a stretch of time produced, without drowning the log. */
  const report = (events, before) => {
    const after = seasonOf(world.day);
    if (after.id !== before) say(`— ${after.label} begins. ${SEASON_NOTE[after.id]}`);

    // Hourly ticks generate a lot of small events. Collapse repeats so a day
    // does not bury the one line that mattered.
    const seen = new Map();
    for (const e of events) seen.set(e.text, (seen.get(e.text) || 0) + 1);
    for (const [text, n] of seen) say(n > 1 ? `${text} (x${n})` : text);
  };

  const nextHour = () => {
    const before = seasonOf(world.day).id;
    const events = advanceHour(world);
    report(events, before);
  };

  /** The visual clock requests whole hours; all ticks publish through act. */
  const nextHourRef = useRef(nextHour);
  nextHourRef.current = act(nextHour);
  const handleHour = useCallback(() => nextHourRef.current(), []);

  const handleStart = (tile, jobId) => {
    const res = startWork(world, tile.q, tile.r, jobId);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    if (getTile(world, tile.q, tile.r)?.work?.accessBlocked) return say(`Job at ${tile.q},${tile.r} is unreachable. Restore access, then check the route to resume.`);
    say(
      res.worker
        ? `${res.worker.name} is off to ${tile.q},${tile.r} — ${res.hours} worker-hours of work.`
        : `Queued at ${tile.q},${tile.r} — ${res.hours} worker-hours. ${
            (world.workers || []).length === 0
              ? "Nobody works here yet."
              : "The next worker to come free will take it."
          }`
    );
  };

  const handleCancel = (tile) => {
    cancelWork(world, tile.q, tile.r);
    say(`Stopped work on ${tile.q},${tile.r}.`);
  };
  const handleRetryAccess = act(tile => {
    const result = retryJobAccess(world, tile.q, tile.r);
    say(result.reason);
    return result;
  });

  // --- step 3 actions ------------------------------------------------------

  const handleBuild = (tile, buildingId) => {
    const res = place(world, tile.q, tile.r, buildingId);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    say(`${BUILDINGS[buildingId].label} construction started at ${tile.q},${tile.r} — ${res.hours} game hours.`);
  };

  const handleDemolish = (tile) => {
    const res = demolish(world, tile.q, tile.r);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    say(`Cleared ${tile.q},${tile.r}${res.refund ? `, ${res.refund} wood recovered` : ""}.`);
  };

  const handleRepair = (tile) => {
    const res = repair(world, tile.q, tile.r);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    say(`Repaired ${tile.q},${tile.r} — now at ${Math.round(res.condition)}%.`);
  };

  // --- the base -----------------------------------------------------------

  const handleUpgrade = () => {
    const res = upgradeBase(world);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    say(`Upgrading to ${res.tier.label} — ${res.hours} game hours. The current base remains usable.`);
  };

  const handleHire = () => {
    const res = hire(world);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    say(`${res.worker.name} joined for ${res.cost.food} food and ${res.cost.wood} wood.`);
  };

  const handleCraft = (toolId) => {
    const res = craftTool(world, toolId);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    say(`Made a ${TOOLS[toolId].label.toLowerCase()}. ${TOOLS[toolId].describe}`);
  };

  const handleTrain = (worker, skillId) => {
    const res = train(world, worker, skillId);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    say(`${worker.name} is learning ${SKILLS[skillId].label.toLowerCase()} — level ${res.level}.`);
  };

  // --- horses and the rivals ----------------------------------------------

  // With a horse id the order is MARKED: that horse and no other. Without one
  // (the base panel, the assistant) any wild horse will do.
  const handleCatchHorse = (horseId) => {
    const marked = typeof horseId === "number";
    const res = orderCatch(world, marked ? horseId : null);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    if (marked) return say(`Horse marked. The next free worker will follow it and bring it in — it is ${res.distance} tiles from home. Track it from the strip on the map.`);
    say(
      res.distance === null
        ? "Somebody will go out after a horse."
        : `Somebody will go out after a horse — the nearest is about ${res.distance} tiles off.`
    );
  };

  const handleCancelOrder = (id) => {
    const res = cancelOrder(world, id);
    say(res.ok ? "Called off. Whoever was chasing will head home." : `Cannot: ${res.reason}`);
  };

  const handleMount = (worker) => {
    const res = mount(world, worker);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    say(`${worker.name} is on horseback and will cover twice the ground.`);
  };

  const handleStable = (worker) => {
    const res = stable(world, worker);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    say(`${worker.name} put the horse back in the paddock.`);
  };

  const handleClaim = (tile) => {
    const res = startClaim(world, tile.q, tile.r);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    say(
      res.queued
        ? `Somebody will go and take ${tile.q},${tile.r} — ${res.reason}.`
        : `Taking ${tile.q},${tile.r}. ${res.hours} worker-hours${res.food ? ` and ${res.food} food` : res.slow ? " (the slow way — not enough food to pay for it)" : ""}, and the ground beyond it opens up.`
    );
  };

  /** Were we about to attack somebody peaceful? Worth saying out loud. */
  const isSettler = (campId) => {
    const camp = (world.camps || []).find((c) => c.id === campId);
    return !!camp && camp.kind === "settler";
  };

  const handleWarParty = (campId, n) => {
    const wasSettler = isSettler(campId);
    if (wasSettler && !window.confirm("Attack these peaceful settlers? They will stop trading with you permanently, even if the attack fails.")) return;
    const res = orderWarParty(world, campId, n);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    say(
      `${res.sending} setting out for ${res.target.q},${res.target.r}. ` +
      "They will be gone some days, and they will not come back unmarked." +
      (wasSettler
        ? " These people have never raided you — the moment your party arrives, that changes for good."
        : "")
    );
  };


  const handleTribute = () => {
    const res = payTribute(world);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    say(
      `Paid ${res.cost.food} food and ${res.cost.wood} wood. They will leave you alone until day ${res.until}.`
    );
  };

  const handleHunt = (tile) => {
    const res = startHunt(world, tile.q, tile.r);
    if (!res.ok) return say(`Cannot: ${res.reason}`);
    say(
      res.worker
        ? `${res.worker.name} is off to hunt the ${res.species} at ${tile.q},${tile.r}.`
        : `A hunt is queued at ${tile.q},${tile.r} — ${res.reason}.`
    );
  };

  // --- step 5: the command box --------------------------------------------

  const handleCommand = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    say(`> ${text}`);

    const out = respond(world, text);
    // Grow the parser from real misses, not from guesses — see docs/05.
    if (/^I do not know|^Try "/.test(out.text)) logMiss(world, text);
    
    say(out.text);
  };

  const backupCurrent = () => {
    try {
      const result = writeSave(localStorage, encodeSave(world, settings), BACKUP_KEY);
      if (!result.ok) say(result.reason);
      return result.ok;
    } catch { say("Could not back up the current settlement. Save it to a file before replacing it."); return false; }
  };
  const focusTile = tile => { setSelectedAt({ q: tile.q, r: tile.r }); setFocusAt({ q: tile.q, r: tile.r }); };
  const applyLoaded = saved => {
    setWorld(saved.world);
    setRunning(false);
    setOffline(saved.settings.offline);
    setSaveLocked(false);
    setSelectedAt(null);
    setFocusAt({ ...saved.world.home });
    clockRef.current = makeVisualClock(saved.world.day, saved.world.hour);
    setLog(["Backup restored. The game is paused; press Run when ready."]);
  };
  const importSave = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > MAX_SAVE_BYTES) throw new Error("Save file is too large.");
      const saved = decodeSave(await file.text());
      if (!window.confirm(`Restore day ${saved.world.day}? This replaces the current settlement. A recovery backup will be kept.`)) return;
      if (!saveLocked && !backupCurrent()) return;
      applyLoaded(saved);
    } catch (error) { say(`Could not load that file: ${error.message}`); }
  };
  const exportSave = () => {
    const url = URL.createObjectURL(new Blob([encodeSave(world, settings)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `hex-farm-day-${world.day}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(`Saved to hex-farm-day-${world.day}.json — check your downloads folder.`);
  };
  const restoreBackup = () => {
    try {
      const text = localStorage.getItem(BACKUP_KEY);
      if (!text) return say("No recovery backup yet. One is kept before replacing a map or loading a file.");
      const saved = decodeSave(text);
      if (!window.confirm(`Restore recovery backup from day ${saved.world.day}? Your current game becomes the recovery backup.`)) return;
      if (!saveLocked && !backupCurrent()) return;
      applyLoaded(saved);
    } catch (error) { say(`Could not restore recovery backup: ${error.message}`); }
  };
  const handleTrade = (campId, sell, want, amount) => {
    const result = requestTrade(world, campId, sell, want, amount);
    say(result.ok ? `Trade requested: ${amount} ${sell} for ${result.quote.giving} ${want}. Payment is due on arrival.` : `Cannot: ${result.reason}`);
  };
  const newMap = (nextSize = size) => {
    if (!window.confirm("Start a new valley? This replaces the current settlement. A recovery backup will be kept.")) return;
    if (!saveLocked && !backupCurrent()) return;
    setSaveLocked(false);
    clockRef.current = makeVisualClock(1, 7);
    const s = (Math.random() * 100000) | 0;
    const t0 = performance.now();
    const w = createWorld(s, nextSize);
    const ms = Math.round(performance.now() - t0);
    setWorld(w);
    setFocusAt({ ...w.home });
    setSelectedAt(null);
    setLog([
      `Day 1 — ${describeDate(1)}. A new valley, ${nextSize.width} x ${nextSize.height}, ` +
        `${worldTileCount(w).toLocaleString()} tiles, built in ${ms}ms. Seed ${s}.`,
      "Place your base on a grass tile. Drag with the right mouse button to pan.",
    ]);
    setRunning(false);
  };

  return (
    <div className="app">
      <header className="topbar">
        <strong>Hex Farm</strong>
        <span className="day">Day {world.day}</span>
        <Clock clockRef={clockRef} day={world.day} hour={world.hour} running={running} />
        <button onClick={() => setRunning((r) => !r)} aria-pressed={running}>
          {running ? "Pause" : "Run"}
        </button>
        <span className="muted">{SECONDS_PER_DAY / 60} minutes / day</span>
        <button onClick={() => say(adviseFarm(world))} title="ask what to do next">
          Advise me
        </button>
        <button
          aria-pressed={world.autoRepair !== false}
          title="idle workers mend worn buildings on their own"
          onClick={act(() => {
            world.autoRepair = world.autoRepair === false;
            say(world.autoRepair ? "Idle workers will keep things mended." : "Automatic repairs paused; idle workers may forage.");
          })}
        >
          Auto-repair
        </button>
        <button aria-pressed={managementOpen} onClick={() => setManagementOpen(v => !v)}>Manage settlement</button>
        <span className="spacer" />
        <span className="muted">
          {baseTier(world.baseLevel).label} · {size.width}x{size.height} ·{" "}
          {worldTileCount(world).toLocaleString()} tiles · seed {seed}
        </span>
        <select
          value={size.label}
          aria-label="board size"
          onChange={(e) => newMap(SIZES.find((s) => s.label === e.target.value))}
        >
          {size.label === "Custom" && <option value="Custom">Custom</option>}
          {SIZES.map((s) => (
            <option key={s.label} value={s.label}>
              {s.label} ({s.width}x{s.height})
            </option>
          ))}
        </select>
        <button onClick={() => newMap()}>New map</button>
      </header>

      <div>
        <StoreBar world={world} />
        {jobQueue(world).some(t => t.work.accessBlocked) && <div className="access-banner" role="status">
          <strong>⚠ {jobQueue(world).filter(t => t.work.accessBlocked).length} unreachable jobs need your attention</strong>
          <button onClick={() => { setManagementOpen(true); focusTile(jobQueue(world).find(t => t.work.accessBlocked)); }}>Inspect blocked job</button>
        </div>}
        <div className="savebar"><span role="status">{saveStatus}</span><button onClick={exportSave} title="Download your settlement as a .json file. Keep it and you keep the farm.">Save to file</button><button onClick={() => importRef.current?.click()} title="Open a saved .json file. Replaces the current settlement; a recovery backup is kept.">Load from file</button><button onClick={flush} title="Autosave runs every few seconds; this forces one now. Browser storage can be cleared, so save to a file for anything you want to keep.">Save in browser</button><button onClick={restoreBackup}>Recover previous map</button><label><input type="checkbox" checked={offline} onChange={e => setOffline(e.target.checked)} />Progress while away (up to 120 days; only when running)</label><input hidden ref={importRef} type="file" accept=".json,application/json" onChange={importSave} /></div>
      </div>

      <main className={`stage ${managementOpen ? "with-management" : ""}`}>
        <div className="map-area">
        {/* The world lives in this component's state, not inside the canvas,
            so a rendering crash costs the picture and nothing else. */}
        <CanvasBoundary>
          <Board
            world={world}
            revision={revision}
            selected={selected}
            onSelect={(t) => { setSelectedAt(t ? { q: t.q, r: t.r } : null); }}
            clockRef={clockRef}
            running={running}
            secondsPerDay={SECONDS_PER_DAY}
            onHourEnd={handleHour}
            focusAt={focusAt}
          />
        </CanvasBoundary>
        <CombatStatus world={world} onFocus={focusTile} />
        <ChaseStatus world={world} onFocus={focusTile} onCancel={act(handleCancelOrder)} />
        <Minimap world={world} selected={selected} onFocus={focusTile} />
        </div>
        {managementOpen && <ManagementPanel world={world} onRetryAccess={handleRetryAccess} onCurrencyTrade={act((resource, side, amount) => { const result = currencyTrade(world, resource, side, amount); say(result.ok ? `${side === "buy" ? "Bought" : "Sold"} ${amount} ${resource} for ${result.price} coins.` : result.reason); })} onFocus={focusTile} onCancel={act(handleCancel)} onPriority={act((t, p) => setJobPriority(world, t.q, t.r, p))} onMove={act((t, d) => moveJob(world, t.q, t.r, d))} onProgram={act((id, enabled) => setProgram(world, id, enabled))} onMonumentWork={act((working) => setMonumentWork(world, working))} onTrade={act(handleTrade)} onLivestock={act((species, side) => { const result = livestockTrade(world, species, side); say(result.ok ? `${side === "buy" ? "Bought" : "Sold"} a ${species} for ${result.price} coins.` : result.reason); })} />}
        <TilePanel
          world={world}
          tile={selected}
          onFocus={focusTile}
          onStartWork={act(handleStart)}
          onCancelWork={act(handleCancel)}
          onRetryAccess={handleRetryAccess}
          onBuild={act(handleBuild)}
          onStockRabbits={act(t => { const result = stockRabbitPen(world, t.q, t.r); say(result.ok ? "Breeding pair added. They graze the pen for free and need feeding only in winter; each mature pair has a kit every fourth day while there is room." : result.reason); })}
          onCullRabbits={act(t => { const result = cullRabbits(world, t.q, t.r, 2); say(result.ok ? `Took ${result.rabbits} rabbits from the pen for ${result.food} food.` : result.reason); })}
          onStockGoats={act(t => { const result = stockPen(world, t.q, t.r, "goat"); say(result.ok ? "Two goats are in the enclosure. They graze what they stand on — sand included — and give milk every day of the year." : result.reason); })}
          onCullGoats={act(t => { const result = cullPen(world, t.q, t.r, 2, "goat"); say(result.ok ? `Took ${result.taken} goats from the enclosure for ${result.food} food.` : result.reason); })}
          onStockHens={act(t => { const result = stockCoop(world, t.q, t.r); say(result.ok ? "Three hens are in the coop. They eat grain and lay all year — and a fox will have them unless you fence the coop in." : result.reason); })}
          onDemolish={act(handleDemolish)}
          onClaim={act(handleClaim)}
          onRepair={act(handleRepair)}
          onHunt={act(handleHunt)}
          onUpgrade={act(handleUpgrade)}
          onHire={act(handleHire)}
          onCraft={act(handleCraft)}
          onTrain={act(handleTrain)}
          onCatchHorse={act(handleCatchHorse)}
          onCancelOrder={act(handleCancelOrder)}
          onMount={act(handleMount)}
          onStable={act(handleStable)}
          onTribute={act(handleTribute)}
          onWarParty={act(handleWarParty)}
        />
      </main>

      <footer className="logbar">
        <div className="log">
          {log.map((l, i) => (
            <div key={i} className={l.startsWith(">") ? "said" : undefined}>{l}</div>
          ))}
        </div>
        <form className="prompt" onSubmit={act(handleCommand)}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the farm, or give an order…"
            aria-label="command"
          />
          <button type="submit">Send</button>
        </form>
      </footer>
    </div>
  );
}
