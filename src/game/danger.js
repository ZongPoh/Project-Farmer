import { addResource } from "./economy.js";
import { operational } from "./construction.js";
/**
 * Danger: foxes that bite back, hunting, injury and death.
 *
 * THE ONE RULE THAT PROTECTS THE ECOSYSTEM: a fox gets NO energy from
 * attacking a worker. Predator-prey balance is tuned and tested across three
 * simulated years, and letting foxes feed on people would be a second food
 * source that quietly rewrites all of it. Attacking a worker is something a
 * cornered or bold fox does, not a meal. Hunting a fox removes it from
 * `world.animals` the same way starvation does, so the population maths is
 * untouched either way.
 *
 * The design intent, since the numbers alone will not say it: being out in
 * the field should carry a low background cost, not a coin flip on your
 * settlement. A healthy worker survives many encounters. What kills people is
 * ignoring the warnings — leaving somebody injured out in fox country.
 */
import { distance, neighbors } from "./hex.js";
import { getTerrain, getBuilding } from "./tiles.js";
import { BUILDINGS } from "./buildings.js";
import { SPECIES } from "./animals.js";
import { TOOLS, bestWeapon, toolsFree, unequip } from "./base.js";
import { releaseHorse, homeOf } from "./workers.js";

export const MAX_HEALTH = 100;

/** Damage a fox does when it gets at somebody undefended. */
export const FOX_BITE = 14;

/**
 * Chance per day that a fox NEAR a worker actually goes for them.
 *
 * THE UNIT HERE IS A WHOLE DAY, not an instant. The worker stands in one place
 * for hours and the fox roams, so "near" means within a few tiles — close
 * enough that over a day the fox had an opportunity — rather than sharing a
 * square at one particular moment.
 *
 * Arrived at by measuring. Sampling every fox-worker pair over two hundred
 * days gave: 0.3% of pairs within 2 tiles, 2% within 4, the rest further off.
 * Same-tile-only therefore fired ZERO times on every seed; reach 1 gave one
 * attack in three hundred days; reach 2 was barely better. Foxes move one
 * tile a day and workers six, so a fox can approach but never close. Reach 4
 * is what makes this an occasional cost rather than a rumour.
 *
 * Foxes DO drift toward people when they have no rabbit in sight (see
 * `curiosity` in animals.js), which is what turns a coincidence into an
 * occasional event. They still gain nothing from the encounter, and the
 * three-year ecosystem test is the guard on that change.
 *
 * Even so this stays uncommon — roughly one bite per worker per two hundred
 * days in the field. That is deliberate. This is a farming game with a fox in
 * it, not a game about foxes; the cost of being outdoors should be a thing
 * that happens sometimes, not a thing you plan around.
 */
export const FOX_ATTACK_CHANCE = 0.4;
export const FOX_REACH = 4;

/** Below this, a worker gives up and walks home to recover. */
export const RETREAT_BELOW = 45;

/** Health recovered per hour while resting at the base. */
/**
 * Health recovered per hour by plain rest, with nobody helping.
 *
 * WAS 1.5, WHICH DROWNED OUT THE ENTIRE HEALING SYSTEM. At 1.5 an hour a
 * worker went from near-death to fit in under three days by lying down at the
 * base, so an infirmary, herbs and a trained healer all measured identically
 * to having none of them — five configurations, five identical outcomes. A
 * baseline that good leaves nothing for anything else to improve.
 *
 * At 0.4 an hour, plain rest is roughly ten days from flat on your back to
 * fit. That is the "you have built nothing" number, and everything in
 * healing.js is measured against it.
 */
export const HEAL_PER_HOUR = 0.4;

/** A worker must be at least this healthy before going back out. */
export const RECOVERED_AT = 85;

export const healthOf = (worker) =>
  worker.health === undefined ? MAX_HEALTH : worker.health;

/**
 * How well someone defends themselves.
 *
 * A spear and some hunting experience turn a mauling into a scuffle. Both are
 * things the base lets you buy, which is the point: danger is the reason the
 * progression in base.js matters.
 */
export function defenceOf(world, worker) {
  let d = 0;
  const skill = (worker.skills && worker.skills.hunting) || 0;
  d += skill * 0.22;
  if (worker.tool && TOOLS[worker.tool] && TOOLS[worker.tool].combat) {
    d += TOOLS[worker.tool].combat * 0.5;
  }
  return Math.min(0.8, d);
}

/**
 * Is this worker somewhere a threat cannot reach them?
 *
 * Exported because the rivals use the same rule. One definition of "indoors"
 * for both threats, or the fox and the raider end up disagreeing about what
 * counts as safe — and the player would have no way to tell which was right.
 */
export function sheltered(world, worker) {
  const b = getBuilding(world, worker.q, worker.r);
  if (operational(b)) {
    if (b.id === "base") return true;
    const blocks = BUILDINGS[b.id].blocks || [];
    if (blocks.includes("fox")) return true;
  }
  return false;
}

// --- being attacked --------------------------------------------------------

/**
 * One day of foxes deciding whether to have a go at anybody.
 *
 * Daily, not hourly, for the same reason animals move daily: this is the
 * ecosystem's cadence, and running it twenty-four times as often would mean
 * retuning every number in it.
 */
export function foxAttacks(world, rnd) {
  const events = [];
  if (!world.workers || world.workers.length === 0) return events;

  const foxes = world.animals.filter((a) => a.species === "fox");
  if (foxes.length === 0) return events;

  const dead = [];

  for (const worker of world.workers) {
    if (sheltered(world, worker)) continue;

    // A fox within reach — its own tile or one of the six around it. A fed
    // fox is digesting and cannot be bothered, which reuses the same cooldown
    // that stops it over-hunting rabbits.
    const fox = foxes.find(
      (f) => f.cooldown === 0 && distance(f, worker) <= FOX_REACH
    );
    if (!fox) continue;
    if (rnd() >= FOX_ATTACK_CHANCE) continue;

    const defence = defenceOf(world, worker);
    const damage = Math.round(FOX_BITE * (1 - defence));
    worker.health = Math.max(0, healthOf(worker) - damage);

    // Somebody armed may drive it off, and occasionally kill it. NOTE: the
    // fox gains nothing from this exchange — see the note at the top.
    if (defence > 0 && rnd() < defence) {
      dead.push(fox.id);
      events.push({
        type: "fought",
        q: worker.q, r: worker.r,
        text: `${worker.name} drove off a fox at ${worker.q},${worker.r} and killed it.`,
      });
    } else {
      events.push({
        type: "attacked",
        q: worker.q, r: worker.r,
        text: `${worker.name} was bitten by a fox at ${worker.q},${worker.r}${
          damage >= 12 ? " — badly" : ""
        }.`,
      });
    }

    if (worker.health <= 0) dead.push(null); // marker; handled below
  }

  if (dead.length) {
    const kill = new Set(dead.filter((id) => id !== null));
    if (kill.size) world.animals = world.animals.filter((a) => !kill.has(a.id));
  }

  events.push(...reapTheFallen(world));
  return events;
}

/**
 * Remove anyone whose health reached zero.
 *
 * A rider's horse walks back to the paddock if there is room for it, and only
 * goes wild if there is not. It used to always go wild, which was one of the
 * ways horses quietly vanished — see livestock.js.
 */
export function reapTheFallen(world) {
  const events = [];
  const fallen = world.workers.filter((w) => healthOf(w) <= 0);
  if (fallen.length === 0) return events;

  for (const worker of fallen) {
    const horse = releaseHorse(world, worker, "riderDied");
    unequip(worker);
    events.push({
      type: "death",
      q: worker.q, r: worker.r,
      text: `${worker.name} died at ${worker.q},${worker.r}.` +
        (horse ? (horse.tamed ? " Their horse found its way back to the paddock." : " Their horse has gone back to the wild — there was no room in the paddocks.") : ""),
    });
  }

  const gone = new Set(fallen.map((w) => w.id));
  world.workers = world.workers.filter((w) => !gone.has(w.id));
  return events;
}

// --- hunting ---------------------------------------------------------------

/** Worker-hours a hunt takes, and what it is worth. */
export const HUNT = {
  rabbit: { hours: 4, food: 14, risk: 0.05, damage: 4 },
  fox: { hours: 8, food: 4, risk: 0.45, damage: 20 },
};

/**
 * Send somebody to kill an animal.
 *
 * Modelled as a job on the tile rather than an instant action, so it costs
 * the same thing everything else costs: a person walking there and spending
 * hours. Hunting a fox is genuinely dangerous without a spear, which is the
 * point of the risk number.
 */
export function canHunt(world, q, r) {
  const prey = world.animals.find(
    (a) => a.q === q && a.r === r && HUNT[a.species] && !a.tamed
  );
  if (!prey) return { ok: false, reason: "there is nothing to hunt there" };
  const terrain = getTerrain(world, q, r);
  if (terrain === null) return { ok: false, reason: "no such tile" };
  return { ok: true, prey, spec: HUNT[prey.species] };
}

/**
 * Resolve a hunt that a worker has finished the hours for.
 *
 * Returns events. Called from the worker step when a hunt job completes, so
 * like everything else it happens inside advanceHour and nowhere else.
 */
export function resolveHunt(world, worker, rnd) {
  const events = [];
  const target = world.animals.find(
    (a) => a.q === worker.q && a.r === worker.r && HUNT[a.species] && !a.tamed
  );
  if (!target) {
    events.push({
      type: "hunt",
      text: `${worker.name} found nothing worth hunting at ${worker.q},${worker.r}.`,
    });
    return events;
  }

  const spec = HUNT[target.species];
  const defence = defenceOf(world, worker);

  // The animal gets a go first. A spear and some experience make this a
  // formality; an unarmed farmer taking on a fox is taking a real chance.
  if (rnd() < spec.risk * (1 - defence)) {
    const damage = Math.round(spec.damage * (1 - defence));
    worker.health = Math.max(0, healthOf(worker) - damage);
    events.push({
      type: "hurt",
      q: worker.q, r: worker.r,
      text: `${worker.name} was hurt hunting the ${target.species} at ${worker.q},${worker.r}.`,
    });
  }

  world.animals = world.animals.filter((a) => a.id !== target.id);
  addResource(world, "food", spec.food);
  events.push({
    type: "hunted",
    q: worker.q, r: worker.r,
    species: target.species,
    text: `${worker.name} took a ${target.species} at ${worker.q},${worker.r} — ${spec.food} food.`,
  });

  events.push(...reapTheFallen(world));
  return events;
}

// --- looking after people --------------------------------------------------

/**
 * Should this worker stop what they are doing and go home?
 *
 * Self-preservation, automatic, for the same reason auto-repair is automatic:
 * an idle game should not punish you for looking away. Somebody badly hurt
 * walks home rather than standing in a field until a fox finishes the job.
 */
export const shouldRetreat = (worker) =>
  healthOf(worker) < RETREAT_BELOW && worker.state !== "resting";

export const isRecovered = (worker) => healthOf(worker) >= RECOVERED_AT;

/**
 * One hour of rest. Works at the base, or in an infirmary.
 *
 * Deliberately reads the building table rather than naming the two buildings:
 * anywhere with beds, or home, is somewhere you can lie up. Adding a third
 * such building should not mean editing this function.
 */
export function restHour(world, worker) {
  const b = getBuilding(world, worker.q, worker.r);
  const somewhereToRest = operational(b) &&
    (b.id === "base" || (BUILDINGS[b.id] && BUILDINGS[b.id].beds));
  if (!somewhereToRest) return false;
  worker.health = Math.min(MAX_HEALTH, healthOf(worker) + HEAL_PER_HOUR);
  return true;
}

/** For the panel and the assistant. */
export function injuredWorkers(world) {
  return (world.workers || []).filter((w) => healthOf(w) < RECOVERED_AT);
}
