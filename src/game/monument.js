/**
 * The monument: somewhere for the pile to go.
 *
 * WHY. Stone and wood have had a source that argues back since ground.js, and
 * still had no sink worth the name. Masonry upkeep takes a stone or two a day;
 * the base upgrades take a few hundred once and then you are finished wanting
 * them. Measured on the growth bot, a three-year settlement holds thousands of
 * both with nothing left to buy. A number that only goes up is not a resource.
 *
 * WHAT IT IS. A tower raised in COURSES. You found it once, cheaply, and then
 * it takes stone and timber off you a little every day for the rest of the
 * game — capped per day, and never below a reserve, so it can never starve the
 * things that matter. Eight courses is 2,000 stone and 480 timber, which is
 * a hundred days of deliveries at the full rate.
 *
 * WHAT YOU GET. Two things, and neither of them compounds, because the point
 * of this pass is to slow a snowball rather than feed it:
 *
 *   - It is the tallest thing for miles, so it watches further than any
 *     tower — the one flat, honest benefit of building something enormous.
 *   - It can be SEEN for miles, which is the other half of the same sentence.
 *     Every course raises raid pressure. A settlement that puts its surplus
 *     into a monument is advertising that it has a surplus.
 *
 * And finishing it is the game's furthest milestone. There is deliberately no
 * production bonus: this is the thing you build when there is nothing left to
 * build, and it should cost you something for the privilege.
 *
 * WHERE THE STATE LIVES. On the building, like construction and condition —
 * `courses`, and `laid` for what has been delivered toward the next one. So it
 * rides along in `modified` and needs nothing in the save.
 */
import { activeTiles } from "./tiles.js";
import { operational } from "./construction.js";

export const MONUMENT = {
  /** Courses to a finished monument. */
  COURSES: 8,
  /** What one course takes, in the end. */
  course: { stone: 250, wood: 60 },
  /** The most that can be carried up in a day. */
  perDay: { stone: 20, wood: 5 },
  /**
   * What the masons will never touch. A monument that ate the last of the
   * stone would take the walls down with it, and unpaid masonry upkeep is
   * already a thing that wears buildings out.
   */
  reserve: { stone: 60, wood: 60 },
  /** How much more worth robbing each finished course makes you. */
  PRESSURE_PER_COURSE: 0.03,
};

/** The monument tile, or null. There is only ever one. */
export function monumentTile(world) {
  for (const tile of activeTiles(world)) {
    if (tile.building && tile.building.id === "monument") return tile;
  }
  return null;
}

/** How many courses stand. A monument still under construction has none. */
export function coursesStanding(world) {
  const tile = monumentTile(world);
  if (!tile || !operational(tile.building)) return 0;
  return tile.building.courses || 0;
}

export const monumentFinished = (world) => coursesStanding(world) >= MONUMENT.COURSES;

/** What a monument adds to how much you are worth robbing. */
export function monumentPressure(world) {
  return coursesStanding(world) * MONUMENT.PRESSURE_PER_COURSE;
}

/** Stop and start the deliveries. The player's one control over it. */
export function setMonumentWork(world, working) {
  world.monumentPaused = !working;
  return { ok: true };
}

/**
 * One day of masons carrying stone up a tower.
 *
 * Takes what it can, up to the daily rate, never below the reserve, and never
 * more than the course still needs. Short supply is not a failure state — the
 * work simply waits, the way the daily programmes do.
 */
export function stepMonument(world) {
  const events = [];
  const tile = monumentTile(world);
  if (!tile) return events;
  const b = tile.building;
  if (!operational(b)) return events;
  if ((b.courses || 0) >= MONUMENT.COURSES) return events;
  if (world.monumentPaused) return events;

  b.laid = b.laid || {};
  let carried = 0;
  for (const [res, needed] of Object.entries(MONUMENT.course)) {
    const done = b.laid[res] || 0;
    const want = Math.min(MONUMENT.perDay[res], needed - done);
    if (want <= 0) continue;
    const spare = Math.max(0, (world.store[res] || 0) - MONUMENT.reserve[res]);
    const take = Math.min(want, Math.floor(spare));
    if (take <= 0) continue;
    world.store[res] -= take;
    b.laid[res] = done + take;
    carried += take;
  }

  const complete = Object.entries(MONUMENT.course).every(([res, n]) => (b.laid[res] || 0) >= n);
  if (complete) {
    b.courses = (b.courses || 0) + 1;
    b.laid = {};
    const done = b.courses >= MONUMENT.COURSES;
    events.push({
      type: "monument",
      q: tile.q, r: tile.r,
      course: b.courses,
      text: done
        ? "The monument is finished. It can be seen from the far side of the valley."
        : `The ${ordinal(b.courses)} course of the monument is laid. ${MONUMENT.COURSES - b.courses} to go.`,
    });
  } else if (carried === 0 && !b.waiting) {
    b.waiting = true;
    events.push({
      type: "monumentWaiting",
      q: tile.q, r: tile.r,
      text: `The monument is waiting for materials. It keeps ${MONUMENT.reserve.stone} stone and ${MONUMENT.reserve.wood} timber back for everything else.`,
    });
  }
  if (carried > 0) b.waiting = false;

  return events;
}

function ordinal(n) {
  return ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][n - 1] || `${n}th`;
}

/** What the panels say about it. */
export function monumentSummary(world) {
  const tile = monumentTile(world);
  if (!tile) return null;
  const b = tile.building;
  const courses = b.courses || 0;
  const laid = b.laid || {};
  return {
    q: tile.q, r: tile.r,
    courses,
    of: MONUMENT.COURSES,
    finished: courses >= MONUMENT.COURSES,
    building: !operational(b),
    paused: !!world.monumentPaused,
    waiting: !!b.waiting,
    laid: { stone: laid.stone || 0, wood: laid.wood || 0 },
    needs: { ...MONUMENT.course },
    pressure: courses * MONUMENT.PRESSURE_PER_COURSE,
  };
}
