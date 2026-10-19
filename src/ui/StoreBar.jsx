/**
 * The resource read-out and a live census of the wildlife. (Steps 3 and 4)
 *
 * The census is here rather than buried in a menu because it is the feedback
 * loop for the terrain system: irrigate sand into grass, watch the rabbit
 * capacity climb, watch rabbits arrive. If the player cannot see that
 * happening, the whole ecosystem may as well not exist.
 */
import { census } from "../game/animals.js";
import { storageCapacity, foodReserves } from "../game/economy.js";
import { workerSummary, staffOn } from "../game/workers.js";
import { activeTiles } from "../game/tiles.js";
import { TOOLS, TOOL_IDS, toolsFree } from "../game/base.js";
import { injuredWorkers } from "../game/danger.js";
import { activeRaiders, daysUntilRaid, raidPressure } from "../game/rivals.js";
import { stabledHorses } from "../game/horses.js";
import { territorySize } from "../game/territory.js";
import { careSummary } from "../game/healing.js";
import { campSummaries } from "../game/rivalcamp.js";

export default function StoreBar({ world }) {
  const { food, wood, stone, seeds } = world.store;
  const animals = census(world);
  const people = workerSummary(world);
  const capacity = storageCapacity(world), reserve = foodReserves(world);

  // Jobs nobody has picked up yet. Worth showing: a queue you cannot see is
  // indistinguishable from a game that has stopped working.
  let queued = 0;
  let running = 0;
  for (const tile of activeTiles(world)) {
    if (!tile.work) continue;
    if (staffOn(world, tile.q, tile.r) > 0) running++;
    else queued++;
  }

  return (
    <div className="storebar">
      <span className={`res ${food <= 2 ? "low" : ""}`} title="food">
        🌾 {food}/{capacity.food}
      </span>
      <span className={`res ${wood <= 2 ? "low" : ""}`} title="wood">
        🪵 {wood}/{capacity.wood}
      </span>
      <span className="res" title="stone">
        🪨 {stone}/{capacity.stone}
      </span>
      <span className={`res ${seeds ? "" : "muted"}`} title="seeds — plant these to grow forest">
        🌱 {seeds || 0}
      </span>
      <span
        className={`res ${world.store.herbs ? "" : "muted"}`}
        title="herbs — what the hurt are treated with. Foragers bring them back."
      >
        🌿 {world.store.herbs || 0}
      </span>

      <span className="divider" />
      <span className="res" title="Coins — trade at a completed market">Coins {world.store.coins || 0}</span>
      <span className={reserve.shortfall ? "low" : "muted"} title="Resident food reserve only; rabbit pens and spending need extra. See Economy.">{Number.isFinite(reserve.days) ? `${reserve.days.toFixed(1)} food days` : "No resident food use"} · {reserve.shortfall ? `winter short ${Math.ceil(reserve.shortfall)}` : "winter covered"}</span>

      <span
        className="res"
        title={`${territorySize(world).claimed} tiles of land, ${
          territorySize(world).owned
        } of them worked. Finish a job to push the border outward.`}
      >
        🗺 {territorySize(world).claimed}
      </span>

      <span className="divider" />

      <span
        className="res"
        title={`${people.idle} idle, ${people.busy} busy. Room for ${people.cap}, limited by ${people.limitedBy} (${people.foodPerDay} food a day).`}
      >
        👤 {people.total}
        <em>/{people.cap}</em>
        {people.idle > 0 && <em> · {people.idle} free</em>}
        {people.mounted > 0 && <em> · {people.mounted} 🐴</em>}
      </span>

      {TOOL_IDS.some((id) => (world.tools || {})[id]) && (
        <span
          className="res"
          title={TOOL_IDS
            .filter((id) => (world.tools || {})[id])
            .map((id) => `${world.tools[id]} ${TOOLS[id].label.toLowerCase()} (${toolsFree(world, id)} spare)`)
            .join(", ")}
        >
          🛠 {TOOL_IDS.reduce((n, id) => n + ((world.tools || {})[id] || 0), 0)}
        </span>
      )}

      {stabledHorses(world).length > 0 && (
        <span className="res" title="horses standing in your paddocks, ready to ride">
          🐴 {stabledHorses(world).length}
        </span>
      )}

      {/* A raid in progress is the one thing that must never need a panel
          opened to notice. */}
      {activeRaiders(world).length > 0 ? (
        <span
          className="res low"
          title="Raiders are on your land. Anyone indoors is safe; call the rest in."
        >
          ⚔ {activeRaiders(world).length} raiders
        </span>
      ) : (
        daysUntilRaid(world) !== null && daysUntilRaid(world) <= 5 && (
          <span
            className="res"
            title={`Raiders are due. They take whatever is not in a granary — you look ${Math.round(
              raidPressure(world) * 100
            )}% worth robbing.`}
          >
            ⚔ {daysUntilRaid(world)}d
          </span>
        )
      )}

      {(world.workers || []).some((w) => w.state === "marching" || w.state === "storming") && (
        <span
          className="res"
          title="A war party is out. They are fighting at the neighbours' camp."
        >
          ⚔{" "}
          {(world.workers || []).filter(
            (w) => w.state === "marching" || w.state === "storming"
          ).length}{" "}
          away
        </span>
      )}

      {injuredWorkers(world).length > 0 && (
        <span
          className={`res ${careSummary(world).festering > 0 ? "low" : ""}`}
          title={
            careSummary(world).festering > 0
              ? "A wound has turned bad. It needs herbs and somebody free, or they will die of it."
              : "somebody is hurt and recovering"
          }
        >
          ❤ {injuredWorkers(world).length} hurt
          {careSummary(world).festering > 0 && (
            <em> · {careSummary(world).festering} bad</em>
          )}
        </span>
      )}

      {(running > 0 || queued > 0) && (
        <span
          className="res"
          title={`${running} job${running === 1 ? "" : "s"} under way, ${queued} waiting for a free worker`}
        >
          🔨 {running}
          {queued > 0 && <em> · {queued} queued</em>}
        </span>
      )}

      <span className="divider" />

      {animals.map((a) => (
        <span
          key={a.id}
          className={`res ${a.count === 0 ? "muted" : ""}`}
          title={`${a.label}: ${a.count} of a possible ${a.capacity} — capacity comes from how much habitat there is`}
        >
          {a.label} {a.count}
          <em>/{a.capacity}</em>
        </span>
      ))}
    </div>
  );
}
