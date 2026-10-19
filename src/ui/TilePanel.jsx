import { SECONDS_PER_DAY, claimCost } from "../game/tick.js";
import { penFor, coopSummary, PENNED, COOP, PEN_WINTER_FEED, PEN_MEAT } from "../game/pens.js";
import { manuredFarms, MANURE_BOOST, MANURE_RADIUS } from "../game/livestock.js";
import { groundSummary } from "../game/ground.js";
import { TERRAIN, optionsFor } from "../game/terrain.js";
import { inTerritory, isOwned, outsideReason } from "../game/territory.js";
import { barrierAt } from "../game/buildings.js";
import { BUILDINGS, buildOptionsFor, REPAIR_COST, fertilityOf } from "../game/buildings.js";
import { SPECIES } from "../game/animals.js";
import { workersOn, workerAt, findOpenJob, staffOn } from "../game/workers.js";
import { healthOf, canHunt, HUNT } from "../game/danger.js";
import { SKILLS, TOOLS } from "../game/base.js";
import BasePanel from "./BasePanel.jsx";
import RivalPanel from "./RivalPanel.jsx";
import { campHolding_at } from "../game/territory.js";
import { jobLabel } from "../game/management.js";
import { operational, constructionLabel } from "../game/construction.js";
import JobAccess from "./JobAccess.jsx";
import { orderForHorse } from "../game/horses.js";

const costLabel = (cost) => {
  const parts = Object.entries(cost || {}).map(([res, n]) => `${n} ${res}`);
  return parts.length ? parts.join(", ") : "free";
};

export default function TilePanel({
  world, tile, onStartWork, onCancelWork, onBuild, onDemolish, onRepair,
  onClaim, onCatchHorse, onCancelOrder, onMount, onStable, onTribute, onWarParty, onFocus,
  onHunt, onUpgrade, onHire, onCraft, onTrain, onStockRabbits, onCullRabbits, onRetryAccess,
  onStockGoats, onCullGoats, onStockHens,
}) {
  if (!tile) {
    return (
      <aside className="panel">
        <p className="muted">Click a tile to inspect it.</p>
        <p className="muted small">
          Or type a command below — try <em>what should I do next?</em>
        </p>
      </aside>
    );
  }

  const def = TERRAIN[tile.terrain];
  const jobs = optionsFor(world, tile);
  const builds = buildOptionsFor(world, tile);
  const pen = penFor(world, tile.q, tile.r, "rabbit");
  // The same fences asked a different question: goats will live on sand, so a
  // pen that is no good for rabbits may still be a good one for goats.
  const goatPen = penFor(world, tile.q, tile.r, "goat");
  const coop = coopSummary(world, tile.q, tile.r);
  const here = world.animals.filter((a) => a.q === tile.q && a.r === tile.r);
  const people = (world.workers || []).filter((w) => w.q === tile.q && w.r === tile.r);
  const onJob = workersOn(world, tile.q, tile.r);
  const b = tile.building;
  // What is left in the ground under this building, or null if it is not the
  // sort of building that lives off the ground.
  const ground = groundSummary(world, tile);
  const rival = campHolding_at(world, tile.q, tile.r);

  return (
    <aside className="panel">
      <h2>{tile.q},{tile.r}</h2>
      <p className="kind" style={{ color: def.color }}>{def.label}</p>
      <dl className="facts">
        <dt>size</dt><dd>{tile.size}</dd>
        <dt>buildable</dt><dd>{def.buildable ? "yes" : "no"}</dd>
      </dl>

      {rival && <RivalPanel world={world} tile={tile} onWarParty={onWarParty} onFocus={onFocus} />}

      {/* --- who is standing here ----------------------------------------- */}
      {people.length > 0 && (
        <div className="wildlife">
          {people.map((w) => {
            const hp = Math.round(healthOf(w));
            const skills = Object.entries(w.skills || {})
              .filter(([, n]) => n > 0)
              .map(([id, n]) => `${SKILLS[id].label} ${n}`)
              .join(", ");
            return (
              <span
                key={w.id}
                className={`tag person ${hp < 60 ? "hurt" : ""}`}
                title={[
                  w.state,
                  `${hp}% health`,
                  skills || null,
                  w.tool ? `carrying a ${TOOLS[w.tool].label.toLowerCase()}` : null,
                  w.horseId ? "mounted" : null,
                ].filter(Boolean).join(" · ")}
              >
                {w.name}
                {w.horseId ? " 🐴" : ""}
                {hp < 100 ? ` ${hp}%` : ""}
                {w.hungry ? " (hungry)" : ""}
              </span>
            );
          })}
        </div>
      )}

      {/* --- what is standing here --------------------------------------- */}
      {here.length > 0 && (
        <div className="wildlife">
          {here.map((a) => (
            <span key={a.id} className="tag" style={{ borderColor: SPECIES[a.species].color }}>
              {SPECIES[a.species].label}
              {a.tamed ? " (yours)" : ""}
            </span>
          ))}
          {(() => {
            const huntable = canHunt(world, tile.q, tile.r);
            if (!huntable.ok) return null;
            const spec = HUNT[huntable.prey.species];
            return (
              <button
                className="job"
                title={`${spec.hours} worker-hours, ${spec.food} food. ${
                  huntable.prey.species === "fox"
                    ? "Dangerous without a spear."
                    : "Low risk."
                }`}
                onClick={() => onHunt(tile)}
              >
                <span>Hunt the {huntable.prey.species}</span>
                <em>{spec.hours}h · {spec.food} food</em>
              </button>
            );
          })()}
          {here.filter((a) => a.species === "horse" && !a.tamed).map((horse) => {
            const order = orderForHorse(world, horse.id);
            const chaser = horse.claimedBy && (world.workers || []).find((w) => w.id === horse.claimedBy);
            if (order || chaser) {
              return (
                <div key={horse.id} className="job marked-horse">
                  <span>{chaser ? `${chaser.name} is after this horse` : "This horse is marked — waiting for a free worker"}</span>
                  {order && <button onClick={() => onCancelOrder(order.id)}>Call off</button>}
                </div>
              );
            }
            return (
              <button
                key={horse.id}
                className="job"
                title="Marks THIS horse. The next free worker follows it wherever it wanders and leads it to a paddock. Track it from the strip on the map."
                onClick={() => onCatchHorse(horse.id)}
              >
                <span>Catch this horse</span>
                <em>it will wander — the worker follows</em>
              </button>
            );
          })}
        </div>
      )}

      {/* --- the base is where progression lives -------------------------- */}
      {operational(b) && b.id === "base" && (
        <BasePanel
          world={world}
          onUpgrade={onUpgrade}
          onHire={onHire}
          onCraft={onCraft}
          onTrain={onTrain}
          onCatchHorse={onCatchHorse}
          onMount={onMount}
          onStable={onStable}
          onTribute={onTribute}
          onWarParty={onWarParty}
        />
      )}

      {/* --- the building on this tile ------------------------------------ */}
      {b && (
        <div className="built">
          <h3>{BUILDINGS[b.id].label}</h3>
          {b.construction && <div className="work"><p>{constructionLabel(b)}</p><div className="bar"><i style={{width: `${b.construction.done / b.construction.needed * 100}%`}} /></div><p className="small muted">{b.construction.kind === "upgrade" ? "The current level stays usable until the upgrade is complete." : b.id === "wallTower" ? "The wall still blocks passage while the lookout is built." : "This site provides no production, shelter, or protection until complete."}</p></div>}
          {barrierAt(world, tile.q, tile.r) && (
            <p className="muted small">
              Holding: {Math.round(barrierAt(world, tile.q, tile.r).left)} left before
              anything gets through.
              {b.breach > 0 && " Somebody has been at it."}
            </p>
          )}
          <p className="muted small">{BUILDINGS[b.id].describe}</p>
          {!b.construction && BUILDINGS[b.id].decay > 0 && (
            <>
              <p>Condition {Math.round(b.condition)}%</p>
              {b.id === "farm" && (
                <p className="small" title="Growing seasons tire the soil; winter and manure from kept animals restore it.">
                  Soil {Math.round(fertilityOf(b) * 100)}%
                  {manuredFarms(world).has(`${tile.q},${tile.r}`) ? ` · manured (+${Math.round(MANURE_BOOST * 100)}%)` : " · no manure nearby"}
                </p>
              )}
              {/* What is left in the ground under it. A woodcutter and a
                  quarry camp look identical on the board and are now worth
                  very different amounts depending on where they stand, so the
                  panel has to say which is which. */}
              {ground && ground.kind === "stand" && (
                <p className="small" title="A woodcutter cuts in proportion to what is left standing. The stand grows back, faster with more woodland around it, and not at all in winter.">
                  Stand {Math.round(ground.share * 100)}% · grows back {ground.perDay}/day
                  {ground.neighbours === 0 ? " · no woodland around it" : ` · ${ground.neighbours} wooded neighbour${ground.neighbours === 1 ? "" : "s"}`}
                </p>
              )}
              {ground && ground.kind === "seam" && (
                <p className="small" title="Rock does not grow back. Break down a mountain for a far richer seam than plain sand.">
                  {ground.left > 0
                    ? `Seam ${Math.round(ground.left)} stone left${ground.share < 1 ? " · running thin" : ""}`
                    : "Worked out — nothing left in this rock"}
                </p>
              )}
              <div className="bar">
                <i
                  style={{
                    width: `${b.condition}%`,
                    background: b.condition < 40 ? "#C4664F" : undefined,
                  }}
                />
              </div>
              <button
                className="job"
                disabled={b.condition >= 100 || world.store.wood < REPAIR_COST.wood}
                onClick={() => onRepair(tile)}
              >
                <span>Repair</span>
                <em>{costLabel(REPAIR_COST)}</em>
              </button>
            </>
          )}
          {b.id !== "base" && (
            <button className="job danger" onClick={() => onDemolish(tile)}>
              <span>Tear it down</span>
              <em>half the wood back</em>
            </button>
          )}
        </div>
      )}

      {pen && <section className="built"><h3>Rabbit breeding enclosure</h3><p>{pen.rabbits.length} / {pen.capacity} rabbits</p><p className="small">They graze the enclosure for free; in winter each eats {PEN_WINTER_FEED} food a day. Every fourth day each mature pair has a kit, and kits a full pen cannot hold become {PEN_MEAT} food each. Their manure lifts farms within {MANURE_RADIUS} tiles. Keep every fence intact.</p><button disabled={pen.rabbits.length + 2 > pen.capacity || world.store.food < 20} onClick={() => onStockRabbits(tile)}>Stock breeding pair · 20 food</button>{" "}<button disabled={pen.rabbits.length <= 2} onClick={() => onCullRabbits(tile)}>Take two for the pot · +{PEN_MEAT * 4} food</button></section>}

      {goatPen && !pen && <section className="built"><h3>Goat enclosure</h3><p>{goatPen.animals.length} / {goatPen.capacity} goats</p><p className="small">Goats graze what they stand on, sand included — this is the only use dry ground has. They give {PENNED.goat.milk} food a day each in milk, every day of the year, and eat {PENNED.goat.winterFeed} a day each in winter. One kid per mature pair every {PENNED.goat.breedEvery} days; one the pen cannot hold is {PENNED.goat.meat} food. Their manure lifts farms within {MANURE_RADIUS} tiles.</p><button disabled={goatPen.animals.length + 2 > goatPen.capacity || world.store.food < PENNED.goat.stockFood} onClick={() => onStockGoats(tile)}>Stock breeding pair · {PENNED.goat.stockFood} food</button>{" "}<button disabled={goatPen.animals.length <= 2} onClick={() => onCullGoats(tile)}>Take two for the pot · +{PENNED.goat.meat * 4} food</button></section>}

      {coop && <section className="built"><h3>Hen coop</h3><p>{coop.hens} / {coop.roosts} hens{coop.safe ? "" : " · in the open"}</p><p className="small">Hens eat grain — {coop.grain} seeds a day here — and lay {coop.eggs} food a day, winter included. Out of seeds they eat {COOP.scratch} food a day each instead. A chick every {COOP.chickEvery} days while there is room.</p>{!coop.safe && <p className="small warn">Nothing is fenced around this coop. A fox within {COOP.foxReach} tiles will take a hen.</p>}<button disabled={coop.hens + 3 > coop.roosts || world.store.food < COOP.stockFood} onClick={() => onStockHens(tile)}>Stock three hens · {COOP.stockFood} food</button></section>}

      {/* --- work in progress, or the jobs available ---------------------- */}
      {rival ? null : tile.work ? (
        <div className="work">
          <p>
            <strong>{jobLabel(world, tile)}</strong> — {Math.floor(tile.work.done)} of{" "}
            {tile.work.needed} worker-hours
          </p>
          <div className="bar">
            <i style={{ width: `${Math.min(100, (tile.work.done / tile.work.needed) * 100)}%` }} />
          </div>
          <JobAccess key={`${tile.q},${tile.r}`} tile={tile} onRetry={onRetryAccess} onFocus={onFocus}/>
          <p className="muted small">
            {tile.work.accessBlocked ? "Paused — restore access to continue." : onJob.length === 0
              ? (world.workers || []).length === 0
                ? "Waiting — nobody works here yet."
                : "Queued. The next worker to come free will take it."
              : `${onJob.map((w) => w.name).join(", ")} — ${
                  onJob.length === 1 ? "about" : "together about"
                } ${Math.ceil((tile.work.needed - tile.work.done) / onJob.length)} hours left.`}
          </p>
          <button onClick={() => onCancelWork(tile)}>Cancel</button>
        </div>
      ) : (
        <>
          {(!b || b.id === "wall") && builds.length > 0 && (
            <>
              <h3>Build</h3>
              {builds.map((opt) => (
                <button
                  key={opt.id}
                  className="job"
                  disabled={!!opt.blockedBy}
                  title={opt.blockedBy || opt.describe}
                  onClick={() => onBuild(tile, opt.id)}
                >
                  <span>{opt.label}</span>
                  <em>{opt.blockedBy || `${costLabel(opt.cost)} · ${opt.hours} game hours (${opt.hours * SECONDS_PER_DAY / 24}s)`}</em>
                </button>
              ))}
            </>
          )}

          {/* The one job that moves the border. Above the others because on
              the frontier it is usually the only thing you can do, and a
              player who cannot find it concludes the game has stalled. */}
          {inTerritory(world, tile.q, tile.r) && !isOwned(world, tile.q, tile.r) &&
            !b && !tile.work && TERRAIN[tile.terrain].walkable && (
            <>
              <h3>Your land</h3>
              {(() => {
                const cost = claimCost(world);
                return (
                  <button
                    className="job"
                    title={cost.slow
                      ? `Land this size costs ${cost.asking} food to take quickly. Without it, it can still be taken the slow way.`
                      : "Takes this tile, and opens the ring beyond it. The more land you hold, the more food it costs."}
                    onClick={() => onClaim(tile)}
                  >
                    <span>Take this ground</span>
                    <em>{cost.hours}h{cost.food ? ` · ${cost.food} food` : cost.slow ? " · the slow way" : ""}</em>
                  </button>
                );
              })()}
            </>
          )}

          {jobs.length > 0 && <h3>Jobs</h3>}
          {jobs.map((j) => (
            <button
              key={j.id}
              className="job"
              disabled={!!j.blockedBy || !!b}
              title={
                b
                  ? "clear the building first"
                  : j.blockedBy ||
                    [
                      `${j.hours} worker-hours`,
                      j.cost ? `costs ${costLabel(j.cost)}` : null,
                      j.yields ? `yields ${costLabel(j.yields)}` : null,
                    ].filter(Boolean).join(" · ")
              }
              onClick={() => onStartWork(tile, j.id)}
            >
              <span>{j.label}</span>
              <em>{j.blockedBy ? j.blockedBy : `${j.hours}h${j.cost ? ` · ${costLabel(j.cost)}` : ""}`}</em>
            </button>
          ))}

          {jobs.length === 0 && builds.length === 0 && !b && (
            <p className="muted">
              {outsideReason(world, tile.q, tile.r) || "Nothing can be done here yet."}
            </p>
          )}
        </>
      )}
    </aside>
  );
}
