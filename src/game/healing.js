import { operational } from "./construction.js";
/**
 * Getting better, and what it takes.
 *
 * WHAT WAS THERE BEFORE, and why it was not a system. A hurt worker walked
 * home and gained 1.5 health an hour until they hit 85. That is not healing,
 * it is a timer: there was nothing to build, nothing to spend, nobody who did
 * it, and no way to be better or worse at it. Being injured cost you a
 * worker's time and nothing else, and the only strategy was to wait.
 *
 * A system needs four things, and this has them:
 *
 *   SOMETHING TO BUILD   an infirmary, which is where the badly hurt go
 *   SOMETHING TO SPEND   herbs, gathered in the field
 *   SOMEBODY WHO DOES IT a worker with the medicine skill, tending the others
 *   A REASON TO BOTHER   wounds that get WORSE if nobody treats them
 *
 * That last one is the load-bearing part. Without it, healing is optional and
 * the correct play is to ignore it — exactly what was wrong with the old
 * version. A deep wound left alone festers, and a festering wound takes a
 * worker down over about a week. With a bed, a handful of herbs and somebody
 * who knows what they are doing, it does not.
 *
 * WHAT THIS DOES NOT DO: it cannot kill anybody the player was not warned
 * about. A wound only festers below `FESTER_BELOW`, the worker is already
 * walking home by then (`RETREAT_BELOW` is higher), and every stage of it
 * emits an event. Death by inattention is fair; death by surprise is not.
 */
import { activeTiles } from "./tiles.js";
import { BUILDINGS } from "./buildings.js";
import { MAX_HEALTH, RECOVERED_AT, healthOf, reapTheFallen } from "./danger.js";

/**
 * Below this, a wound can turn bad if it is left alone.
 *
 * ABOVE the retreat threshold (45) on purpose. A worker is at risk from the
 * moment they take a real beating, not from the moment they give up and walk
 * home — so being hurt in the field is the dangerous part, which is where the
 * danger ought to live.
 */
export const FESTER_BELOW = 55;

/** Chance per day that an untreated deep wound worsens. */
export const FESTER_CHANCE = 0.35;

/**
 * Health lost per day once a wound has gone bad.
 *
 * MUST EXCEED WHAT PLAIN REST RESTORES (0.4/hour, so 9.6 a day) or festering
 * is not a threat, it is a slower recovery — and the whole system goes back to
 * being optional. At 16 a day an untreated bad wound is a net loss of about
 * six a day, which takes a worker from the threshold to dead in roughly a
 * week, with a warning event every single day of it.
 */
export const FESTER_DAMAGE = 16;

/**
 * Herbs per patient per DAY, charged by the hour.
 *
 * Same accrual trick the repair chore uses for wood: fractions accumulate and
 * whole units are taken when they add up, so an hour of treatment costs an
 * hour's worth rather than a whole herb. Charging one per patient per hour —
 * the first version — would have been twenty-four a day against a forage yield
 * of about one, which is not a cost, it is a wall.
 */
export const HERBS_PER_DAY = 1;

/** Health a tended worker gains per hour, on top of ordinary rest. */
export const TREATED_BONUS = 1.2;

/** What an infirmary alone is worth, with nobody tending. */
export const INFIRMARY_BONUS = 0.6;

/** Chance per forage trip of coming back with herbs. */
export const FORAGE_HERB_CHANCE = 0.3;

/** How much better a trained healer is, per level. */
export const MEDICINE_PER_LEVEL = 0.35;

// --- where you get better --------------------------------------------------

/** Every infirmary standing, with how much of it is working. */
export function infirmaries(world) {
  const out = [];
  for (const tile of activeTiles(world)) {
    const b = tile.building;
    if (!operational(b)) continue;
    const def = BUILDINGS[b.id];
    if (!def || !def.beds) continue;
    const scale = Math.max(0, Math.min(1, (b.condition === undefined ? 100 : b.condition) / 100));
    if (scale <= 0) continue;
    out.push({ q: tile.q, r: tile.r, beds: Math.max(1, Math.round(def.beds * scale)), scale });
  }
  return out;
}

export function bedCount(world) {
  return infirmaries(world).reduce((n, i) => n + i.beds, 0);
}

/** Is this worker lying in an infirmary rather than merely at home? */
export function inABed(world, worker) {
  return infirmaries(world).some((i) => i.q === worker.q && i.r === worker.r);
}

/**
 * Where a hurt worker should go.
 *
 * An infirmary if there is one, the base otherwise. Returning the base as the
 * fallback matters: a settlement with no infirmary must still look after its
 * people, or the first injury before you can afford one is unrecoverable.
 */
export function sickbayFor(world, worker, home) {
  const beds = infirmaries(world);
  if (beds.length === 0) return home;
  let best = beds[0];
  let bestD = Infinity;
  for (const bed of beds) {
    const d = Math.abs(bed.q - worker.q) + Math.abs(bed.r - worker.r);
    if (d < bestD) {
      bestD = d;
      best = bed;
    }
  }
  return { q: best.q, r: best.r };
}

// --- who does the healing --------------------------------------------------

/** How good somebody is at looking after the hurt. */
export function healerRating(worker) {
  const skill = (worker.skills && worker.skills.medicine) || 0;
  return 1 + MEDICINE_PER_LEVEL * skill;
}

/**
 * The best person available to tend the sick, or null.
 *
 * Deliberately somebody who is NOT themselves badly hurt: a settlement where
 * the only trained healer is the one in the bed should be in trouble, and that
 * is a situation worth being able to get into.
 */
export function bestHealer(world) {
  let best = null;
  let bestRating = 0;
  for (const worker of world.workers || []) {
    if (healthOf(worker) < FESTER_BELOW) continue;
    const rating = healerRating(worker);
    // A worker with no training at all can still fetch water and change a
    // dressing; they are simply not much better than nothing.
    if (rating > bestRating) {
      bestRating = rating;
      best = worker;
    }
  }
  return best;
}

// --- the hourly and daily work ---------------------------------------------

/**
 * One hour of recovery for one resting worker.
 *
 * Returns the health gained, so `restHour` in danger.js stays the single
 * definition of ordinary rest and this only adds what the settlement's
 * medicine is worth on top.
 */
export function careHour(world, worker) {
  let bonus = 0;

  if (inABed(world, worker)) bonus += INFIRMARY_BONUS;

  // Herbs and a pair of hands.
  const herbs = world.store.herbs || 0;
  if (herbs >= 1 && healthOf(worker) < MAX_HEALTH) {
    const healer = bestHealer(world);
    if (healer) {
      world.herbDebt = (world.herbDebt || 0) + HERBS_PER_DAY / 24;
      while (world.herbDebt >= 1 && (world.store.herbs || 0) >= 1) {
        world.herbDebt -= 1;
        world.store.herbs -= 1;
      }
      bonus += TREATED_BONUS * healerRating(healer);
      // Treated wounds stop festering. This is the payoff for the whole
      // system and the reason herbs are worth gathering.
      if (worker.festering) {
        worker.festering = false;
        worker.treatedOn = world.day;
      }
    }
  }

  if (bonus > 0) {
    worker.health = Math.min(MAX_HEALTH, healthOf(worker) + bonus);
  }
  return bonus;
}

/**
 * One day of wounds getting better or worse on their own.
 *
 * Only deep wounds fester, only untreated ones, and only while the worker is
 * not in a bed — so the answer is always available and always the same:
 * get them home, and have something to treat them with.
 */
export function dailyWounds(world, rnd) {
  const events = [];

  for (const worker of world.workers || []) {
    const health = healthOf(worker);

    if (health >= FESTER_BELOW) {
      // Out of danger. A wound that has healed past the threshold is no
      // longer a wound that can turn.
      if (worker.festering) {
        worker.festering = false;
        events.push({
          type: "mended",
          q: worker.q, r: worker.r,
          text: `${worker.name}'s wound has stopped going bad.`,
        });
      }
      continue;
    }

    if (worker.festering) {
      worker.health = Math.max(0, health - FESTER_DAMAGE);
      events.push({
        type: "festering",
        q: worker.q, r: worker.r,
        text: `${worker.name}'s wound is getting worse. They need herbs and somebody to spare.`,
      });
      continue;
    }

    // A bed is shelter enough to stop it turning in the first place.
    if (inABed(world, worker)) continue;
    if (rnd() >= FESTER_CHANCE) continue;

    worker.festering = true;
    events.push({
      type: "festering",
      q: worker.q, r: worker.r,
      text: `${worker.name}'s wound has turned bad.`,
    });
  }

  // A wound CAN kill, and this is the line that makes that true.
  //
  // Without it, festering took workers to zero health and left them there —
  // alive, useless, and waiting for a fox to come along, because `foxAttacks`
  // was the only caller of `reapTheFallen` in the whole game. A threat that
  // cannot actually finish anybody is not a threat, and this one is supposed
  // to be the reason the infirmary exists.
  events.push(...reapTheFallen(world));
  return events;
}

/** For the panels: who is in trouble, and what the settlement can do about it. */
export function careSummary(world) {
  // RECOVERED_AT, not MAX_HEALTH. Workers leave the bed at 85 and then top up
  // slowly through ordinary life, so counting anyone below 100 reported the
  // whole settlement as hurt forever — a 540-day playthrough ended with
  // "22 hurt" out of 22 people, none of whom needed anything. A warning that
  // is always on is not a warning.
  const hurt = (world.workers || []).filter((w) => healthOf(w) < RECOVERED_AT);
  const healer = bestHealer(world);
  return {
    hurt: hurt.length,
    festering: hurt.filter((w) => w.festering).length,
    beds: bedCount(world),
    herbs: world.store.herbs || 0,
    healer: healer && healerRating(healer) > 1 ? healer.name : null,
    // The one number that says whether this settlement can look after itself.
    canTreat: (world.store.herbs || 0) >= 1 && !!healer,
  };
}
