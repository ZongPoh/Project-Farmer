/**
 * What you can do at the base.
 *
 * Shown inside the tile panel when the base is selected, because that is
 * where a player will look for it. Everything here is a way of turning a
 * surplus into capability — which, before this existed, a settlement had no
 * way of doing at all: food and timber simply piled up.
 */
import AttackControls from "./AttackControls.jsx";
import {
  BASE_LEVELS, MAX_BASE_LEVEL, baseTier, nextTier, canUpgradeBase,
  baseUnlocks, SKILLS, SKILL_IDS, MAX_SKILL, trainCostFor, canTrain,
  TOOLS, TOOL_IDS, canCraft, toolsFree, hireCostFor,
} from "../game/base.js";
import { workerCapacity } from "../game/workers.js";
import { UPGRADE_HOURS } from "../game/construction.js";
import { healthOf } from "../game/danger.js";
import {
  stabledHorses, wildHorses, pendingOrders, canStableMore,
} from "../game/horses.js";
import { livestockSummary } from "../game/livestock.js";

const LOSS_LABEL = { stolen: "stolen", hunger: "unfed", riderDied: "rider died", riderLeft: "rider left", noPaddock: "no paddock" };
import { stableCapacity } from "../game/buildings.js";
import { careSummary } from "../game/healing.js";
import {
  campSummaries, pendingArrivals, KINDS,
} from "../game/rivalcamp.js";
import {
  daysUntilRaid, raidInProgress, activeRaiders, partySize, raidPressure,
  tributeCost, canPayTribute,
} from "../game/rivals.js";

const costLabel = (cost) =>
  Object.entries(cost || {})
    .map(([res, n]) => `${n} ${res}`)
    .join(", ") || "free";

export default function BasePanel({
  world, onUpgrade, onHire, onCraft, onTrain, onCatchHorse, onMount, onStable,
  onTribute, onWarParty,
}) {
  const neighbours = campSummaries(world);
  const coming = pendingArrivals(world);
  const tier = baseTier(world.baseLevel || 1);
  const next = nextTier(world);
  const upgrade = canUpgradeBase(world);
  const { cap, byFood, byBase, beds, limitedBy } = workerCapacity(world);
  const hireCost = hireCostFor(world);
  const people = world.workers || [];
  const full = people.length >= cap;

  return (
    <div className="basepanel">
      <h3>
        {tier.label} <span className="muted">· level {tier.level}</span>
      </h3>
      <p className="muted small">{tier.describe}</p>

      {/* --- capacity, and which ceiling is actually binding -------------- */}
      <dl className="facts">
        <dt>people</dt>
        <dd>
          {people.length} of {cap}
        </dd>
        <dt>housing</dt>
        <dd className={limitedBy !== "food" ? "limiting" : undefined}>
          {byBase}
          {beds > byBase ? <span className="muted"> · {beds} beds, {tier.label} holds {tier.houses}</span> : null}
        </dd>
        <dt>food supports</dt>
        <dd className={limitedBy === "food" ? "limiting" : undefined}>{byFood}</dd>
      </dl>
      <p className="muted small">
        {limitedBy === "food"
          ? "Food is the limit — more farms would let you grow."
          : limitedBy === "houses"
            ? `Housing is the limit — a house sleeps four more, up to the ${tier.houses} a ${tier.label} holds.`
            : `The ${tier.label} itself is the limit — it holds ${tier.houses}, and more houses will not change that.`}
      </p>

      {/* --- upgrade ------------------------------------------------------ */}
      {next ? (
        <button
          className="job"
          disabled={!upgrade.ok}
          title={upgrade.ok ? `Becomes a ${next.label}. ${next.describe}` : upgrade.reason}
          onClick={onUpgrade}
        >
          <span>Build up to {next.label}</span>
          <em>{upgrade.ok ? `${costLabel(next.cost)} · ${UPGRADE_HOURS[next.level]} game hours` : upgrade.reason}</em>
        </button>
      ) : (
        <p className="muted small">This is as large as the base gets.</p>
      )}

      {/* --- hiring ------------------------------------------------------- */}
      <h3>Hire</h3>
      <button
        className="job"
        disabled={full}
        title={
          full
            ? limitedBy === "food"
              ? "there is not enough food to feed another"
              : limitedBy === "houses"
                ? "no room — build a house"
                : "no room — the base itself is full"
            : "Somebody arrives today rather than in their own time."
        }
        onClick={onHire}
      >
        <span>Take somebody on</span>
        <em>{full ? "no room" : costLabel(hireCost)}</em>
      </button>
      <p className="muted small">
        People also arrive on their own when there is food to spare. Hiring
        buys the time, not the room.
      </p>

      {/* --- the hurt ----------------------------------------------------- */}
      <h3>The hurt</h3>
      {careSummary(world).hurt === 0 ? (
        <p className="muted small">Everybody is on their feet.</p>
      ) : (
        <>
          {careSummary(world).festering > 0 && (
            <p className="warn">
              {careSummary(world).festering} wound
              {careSummary(world).festering === 1 ? " has" : "s have"} turned bad.
              Untreated, that kills in about a week.
            </p>
          )}
          <dl className="facts">
            <dt>hurt</dt>
            <dd>{careSummary(world).hurt}</dd>
            <dt>beds</dt>
            <dd className={careSummary(world).beds === 0 ? "limiting" : undefined}>
              {careSummary(world).beds}
            </dd>
            <dt>herbs</dt>
            <dd className={careSummary(world).herbs === 0 ? "limiting" : undefined}>
              {careSummary(world).herbs}
            </dd>
          </dl>
        </>
      )}
      <p className="muted small">
        {careSummary(world).canTreat
          ? `Wounds are being treated${
              careSummary(world).healer ? ` by ${careSummary(world).healer}` : ""
            }. A bed stops one turning bad in the first place.`
          : careSummary(world).herbs === 0
          ? "No herbs. Foragers bring them back from grass and woodland — and without them a bad wound only gets worse."
          : "Nobody is well enough to tend the others."}
      </p>

      {/* --- the rivals --------------------------------------------------- */}
      <h3>The rivals</h3>
      {raidInProgress(world) ? (
        <p className="warn">
          {activeRaiders(world).length} raider
          {activeRaiders(world).length === 1 ? " is" : "s are"} on your land right
          now. Anyone indoors is safe; anyone in a field is not.
        </p>
      ) : (
        <p className="muted small">
          {daysUntilRaid(world) === null
            ? "Nobody has bothered you yet."
            : `Next visit expected in about ${daysUntilRaid(world)} day${
                daysUntilRaid(world) === 1 ? "" : "s"
              } — likely ${partySize(world)} of them.`}
        </p>
      )}
      {neighbours.length === 0 && (
        <p className="muted small">There is nobody out there — yet.</p>
      )}

      {neighbours.map((them) => {
        return (
          <div key={them.id} className="neighbour">
            <p className="traineeName">
              {them.label}
              <span className="muted">
                {" "}
                · {them.home.q},{them.home.r}
              </span>
              {them.turned && <span className="tag small">turned on you</span>}
            </p>
            <dl className="facts">
              <dt>fighters</dt>
              <dd className={them.strength >= 8 ? "limiting" : undefined}>
                {them.strength}
              </dd>
              <dt>fields</dt>
              <dd>{them.fields}</dd>
              {them.kind === "settler" ? (
                <>
                  <dt>trades</dt>
                  <dd>{them.trades ? "yes" : "not yet"}</dd>
                </>
              ) : (
                <>
                  <dt>your goods there</dt>
                  <dd>{them.loot}</dd>
                </>
              )}
            </dl>
            <AttackControls world={world} campId={them.id} onWarParty={onWarParty}/>
            {them.kind === "settler" && (
              <p className="muted small">
                Their caravans take stone and timber you cannot use and leave
                food, herbs or seed. Burn them out and that stops for good.
              </p>
            )}
          </div>
        );
      })}

      {coming.length > 0 && (
        <p className="muted small">
          {coming
            .map((c) => `${KINDS[c.kind].label.toLowerCase()} in about ${c.days} days`)
            .join(", ")}
          .
        </p>
      )}

      <dl className="facts">
        <dt>how tempting</dt>
        <dd className={raidPressure(world) > 0.6 ? "limiting" : undefined}>
          {Math.round(raidPressure(world) * 100)}%
        </dd>
        <dt>raids survived</dt>
        <dd>{world.raidsSurvived || 0}</dd>
      </dl>
      <p className="muted small">
        They take what is not in a granary. Walls keep them out, a watchtower
        sees them coming, and a spear in somebody's hands is what actually
        turns them around.
      </p>
      <button
        className="job"
        disabled={!canPayTribute(world).ok}
        title={
          canPayTribute(world).ok
            ? "Buys twenty days. A granary is bought once — this is bought every time."
            : canPayTribute(world).reason
        }
        onClick={onTribute}
      >
        <span>Pay them to stay away</span>
        <em>
          {canPayTribute(world).ok
            ? costLabel(tributeCost(world))
            : canPayTribute(world).reason}
        </em>
      </button>

      {/* --- horses ------------------------------------------------------- */}
      <h3>Horses</h3>
      <dl className="facts">
        <dt>in the paddock</dt>
        <dd>
          {stabledHorses(world).length} of {stableCapacity(world)}
        </dd>
        <dt>out on the hills</dt>
        <dd>{wildHorses(world).length}</dd>
        {(() => {
          const l = livestockSummary(world);
          const lost = Object.entries(l.lost).map(([why, n]) => `${n} ${LOSS_LABEL[why] || why}`).join(", ");
          return (
            <>
              <dt>feed today</dt>
              <dd title="Horses graze free in a paddock outside winter; a ridden horse, or any horse in winter, eats 2 food a day.">{l.dailyFeed} food</dd>
              {l.foalIn != null && (<><dt>next foal</dt><dd>about {l.foalIn} days</dd></>)}
              {l.dailyGrain > 0 && (<><dt>grain for the hens</dt><dd>{l.dailyGrain} seeds a day</dd></>)}
              {(l.goats > 0 || l.hens > 0) && (<><dt>other stock</dt><dd>{l.goats} goats, {l.hens} hens</dd></>)}
              <dt>farms manured</dt>
              <dd>{l.manuredFarms}</dd>
              {(() => {
                const other = Object.entries(l.lostBy)
                  .map(([species, by]) => `${species === "chicken" ? "hens" : species + "s"}: `
                    + Object.entries(by).map(([why, n]) => `${n} ${LOSS_LABEL[why] || why}`).join(", "))
                  .join(" · ");
                return other ? (<><dt>also lost</dt><dd>{other}</dd></>) : null;
              })()}
              {lost && (<><dt>horses lost</dt><dd>{lost}</dd></>)}
            </>
          );
        })()}
      </dl>
      <button
        className="job"
        disabled={!canStableMore(world) || wildHorses(world).length === 0}
        title={
          stableCapacity(world) === 0
            ? "Build a paddock first — there is nowhere to keep one."
            : "Somebody goes out and brings one back. It can take days, and it can fail."
        }
        onClick={() => onCatchHorse()}
      >
        <span>Send somebody to catch one</span>
        <em>
          {stableCapacity(world) === 0
            ? "no paddock"
            : wildHorses(world).length === 0
            ? "none left wild"
            : !canStableMore(world)
            ? "paddocks full"
            : "a few days"}
        </em>
      </button>
      {pendingOrders(world).filter((o) => o.kind === "catch").length > 0 && (
        <p className="muted small">
          {pendingOrders(world).filter((o) => o.kind === "catch").length} out
          after a horse.
        </p>
      )}

      {/* --- tools -------------------------------------------------------- */}
      {baseUnlocks(world, "craft") ? (
        <>
          <h3>Workshop</h3>
          {TOOL_IDS.map((id) => {
            const check = canCraft(world, id);
            const owned = (world.tools && world.tools[id]) || 0;
            return (
              <button
                key={id}
                className="job"
                disabled={!check.ok}
                title={check.ok ? TOOLS[id].describe : check.reason}
                onClick={() => onCraft(id)}
              >
                <span>
                  {TOOLS[id].label}
                  {owned > 0 && (
                    <em>
                      {" "}
                      · {owned} made, {toolsFree(world, id)} spare
                    </em>
                  )}
                </span>
                <em>{check.ok ? costLabel(TOOLS[id].cost) : check.reason}</em>
              </button>
            );
          })}
          <p className="muted small">
            Anyone picks up whatever suits the job in hand and puts it back after.
          </p>
        </>
      ) : (
        <p className="muted small">A homestead would have a bench to make tools on.</p>
      )}

      {/* --- training ----------------------------------------------------- */}
      {baseUnlocks(world, "train") ? (
        <>
          <h3>Training</h3>
          {people.length === 0 && <p className="muted">Nobody to teach yet.</p>}
          {people.map((w) => (
            <div key={w.id} className="trainee">
              <p className="traineeName">
                {w.name}
                {w.horseId ? " 🐴" : ""}
                <span className="muted"> · {Math.round(healthOf(w))}% </span>
                {Object.entries(w.skills || {})
                  .filter(([, n]) => n > 0)
                  .map(([id, n]) => (
                    <span key={id} className="tag small">
                      {SKILLS[id].label} {n}
                    </span>
                  ))}
              </p>
              <div className="skillrow">
                {w.horseId ? (
                  <button
                    className="skill"
                    disabled={!canStableMore(world)}
                    title={
                      canStableMore(world)
                        ? "Put the horse back in the paddock so somebody else can ride it."
                        : "No room in the paddocks to put it."
                    }
                    onClick={() => onStable(w)}
                  >
                    🐴 put away
                  </button>
                ) : (
                  <button
                    className="skill"
                    disabled={stabledHorses(world).length === 0}
                    title={
                      stabledHorses(world).length === 0
                        ? "No horse standing idle in a paddock."
                        : "Three times the distance in a day."
                    }
                    onClick={() => onMount(w)}
                  >
                    🐴 mount
                  </button>
                )}
                {SKILL_IDS.map((id) => {
                  const check = canTrain(world, w, id);
                  const at = (w.skills && w.skills[id]) || 0;
                  return (
                    <button
                      key={id}
                      className="skill"
                      disabled={!check.ok}
                      title={
                        check.ok
                          ? `${SKILLS[id].describe} Costs ${costLabel(trainCostFor(w, id))}.`
                          : check.reason
                      }
                      onClick={() => onTrain(w, id)}
                    >
                      {SKILLS[id].label} {at}/{MAX_SKILL}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      ) : (
        <p className="muted small">A hamlet could teach a trade.</p>
      )}
    </div>
  );
}
