/**
 * The ground under a building: what is left of a stand of trees, and what is
 * left of a seam of rock.
 *
 * WHY THIS EXISTS. Measured over 288 days with the growth bot
 * (`scratch/growth.mjs`, two seeds, 60x40): the settlement finished with
 * **15,800 wood and 11,850 stone**, both still climbing in a straight line,
 * because a woodcutter and a quarry camp were taps that never ran dry. Every
 * other resource in the game is a flow — food is eaten, herbs are spent, land
 * costs food — and those two were piles. A pile with nothing to spend it on is
 * not a resource, it is a number going up, and it is the reason Town arrives
 * on day 96: the late base levels are priced in timber and stone.
 *
 * TWO DIFFERENT ANSWERS, because trees and rock are not the same thing.
 *
 * TREES ARE A CROP. A woodcutter draws down the stand it stands in, and the
 * stand grows back — faster where it is surrounded by more wood, not at all in
 * winter. Output is proportional to what is left, so it does not fall off a
 * cliff: it settles at exactly the rate the stand regrows. A woodcutter deep
 * in a wood sustains about 11 wood a day, one on an isolated copse about 5,
 * against the 24 a day it used to produce forever. Where you put it is now a
 * decision with an answer, which it never was before. terrain.js has claimed
 * in a comment since step 2 that "wood is a crop you manage rather than a
 * deposit you exhaust" — this is the first pass where that is true.
 *
 * ROCK DOES NOT GROW BACK. A seam is finite and that is the point: stone is
 * the one resource you can genuinely run out of, so a mountain is worth
 * something and breaking one down is an investment rather than a chore. Plain
 * sand holds little; sand you made by quarrying a mountain holds a great deal,
 * scaled by how big the mountain was. The last of a seam comes out slowly
 * rather than stopping dead, so the camp tells you it is going before it goes.
 *
 * AND WHAT YOU CLEAR COMES BACK. Felling a wood used to be permanent: 12 wood
 * and the trees were gone for good unless you had a seed. Cleared ground that
 * still touches a wood and that nobody has built on grows back after
 * REGROW_AFTER days. Build on it, farm it, or clear-cut so thoroughly that no
 * wood is left touching it, and it stays as it is. That is the whole rule.
 *
 * INVARIANT 16. Nothing here walks the board. Stands are read off the active
 * set — a stand only matters where something is cutting it — and regrowth
 * works from `world.regrowth`, a short list of the tiles the player actually
 * cleared. Both are O(what you did), not O(map).
 *
 * INVARIANT 4, and the softer rule beside it: terrain changes go through
 * `setTerrain`, and tick.js is the one place that calls it. So `stepGround`
 * converts nothing — it returns the tiles that are ready to be woods again and
 * lets tick.js do it, exactly as a finished job does.
 */
import { neighbors, key } from "./hex.js";
import { getTerrain, activeTiles } from "./tiles.js";
import { seasonOf } from "./calendar.js";
import { operational } from "./construction.js";

/** A stand of trees, in wood. */
export const TIMBER = {
  /** A full stand: 240 on the thinnest tile, 480 on the thickest. */
  max: (tile) => 240 + Math.round((tile && tile.size != null ? tile.size : 0.5) * 240),
  /** What any stand puts on in a day outside winter... */
  REGROW: 5,
  /** ...plus this for each neighbouring tile that is still wood. */
  REGROW_NEIGHBOUR: 1,
};

/** A seam of rock, in stone. */
export const ROCK = {
  /** Under plain sand there is not much. */
  NATURAL: 500,
  /** Sand you made by breaking a mountain down: 1,030 to 1,800. */
  fromMountain: (tile) => 700 + Math.round((tile && tile.size != null ? tile.size : 0.5) * 1100),
  /** The last of a seam comes out in proportion, so the end is visible. */
  TAPER: 200,
};

/** Days a cleared tile must be left alone before saplings take. */
export const REGROW_AFTER = 72;

/**
 * The most cleared tiles we will remember.
 *
 * A bound, not a balance number. Somebody who clears a thousand tiles should
 * not carry a thousand-entry list in every save forever, so the oldest are
 * dropped — which means the oldest clearings simply stay grass. There is no
 * way to notice that in play and it keeps the save size honest.
 */
export const REGROW_MEMORY = 400;

/**
 * What is left of the stand on this tile.
 *
 * Lazily initialised, so no old save needs migrating and an untouched wood
 * costs nothing to store until something cuts it.
 */
export function standAt(world, tile) {
  if (tile.timber == null) tile.timber = TIMBER.max(tile);
  return tile.timber;
}

/** What is left of the seam under this tile. */
export function seamAt(world, tile) {
  if (tile.rock == null) tile.rock = ROCK.NATURAL;
  return tile.rock;
}

/**
 * How well a woodcutter here is doing, 0 to 1.
 *
 * Linear in what is left, which is what makes the loop settle instead of
 * swinging: cutting slows exactly as fast as the stand thins, so output
 * converges on the regrowth rate rather than sawing between a full stand and
 * a bare one.
 */
export function timberFactor(world, tile) {
  return Math.max(0, Math.min(1, standAt(world, tile) / TIMBER.max(tile)));
}

/** How well a quarry camp here is doing, 0 to 1. Full until the seam is nearly out. */
export function rockFactor(world, tile) {
  return Math.max(0, Math.min(1, seamAt(world, tile) / ROCK.TAPER));
}

/**
 * Take what was just produced out of the ground it came from.
 *
 * The seam is snapped to nothing once less than a day's work is left in it.
 * Without that the taper is a decaying exponential that approaches zero and
 * never arrives, so the camp would trickle out hundredths of a stone forever
 * and never say it was finished — a mechanic the player cannot see is not a
 * mechanic.
 */
export function drawGround(world, tile, resource, amount) {
  if (!(amount > 0)) return;
  if (resource === "wood") {
    tile.timber = Math.max(0, standAt(world, tile) - amount);
  } else if (resource === "stone") {
    const left = Math.max(0, seamAt(world, tile) - amount);
    tile.rock = left < 1 ? 0 : left;
  }
}

/**
 * Record the seam under sand that used to be a mountain. Called by tick.js
 * when a quarry job finishes, because that is where the mountain stops being
 * a mountain.
 */
export function openSeam(world, tile) {
  tile.rock = ROCK.fromMountain(tile);
}

/** Remember that this ground was cleared, so it can grow back. */
export function noteCleared(world, q, r) {
  if (!Array.isArray(world.regrowth)) world.regrowth = [];
  world.regrowth = world.regrowth.filter((e) => e.q !== q || e.r !== r);
  world.regrowth.push({ q, r, day: world.day });
  const over = world.regrowth.length - REGROW_MEMORY;
  if (over > 0) world.regrowth.splice(0, over);
}

/** Is this cleared tile ready to be a wood again? */
function readyToRegrow(world, entry) {
  // Something is there now, or somebody is working it. Settled land stays settled.
  const tile = world.modified.get(key(entry.q, entry.r));
  if (tile && (tile.building || tile.work)) return false;
  if (getTerrain(world, entry.q, entry.r) !== "grass") return false;
  // Saplings come from somewhere. Clear-cut the lot and nothing comes back.
  return neighbors(entry.q, entry.r).some((n) => getTerrain(world, n.q, n.r) === "forest");
}

/**
 * One day of the ground doing what ground does.
 *
 * Returns `{ events, regrown }`. `regrown` lists the tiles that should become
 * forest; tick.js converts them, because tick.js owns terrain.
 */
export function stepGround(world) {
  const events = [];
  const winter = seasonOf(world.day).id === "winter";

  for (const tile of activeTiles(world)) {
    const b = tile.building;
    if (!b) continue;

    // Stands grow back. Only where something is cutting: an untouched wood is
    // always full, so there is nothing to compute and nothing to store.
    if (b.id === "woodcutter" && tile.terrain === "forest" && !winter) {
      const woods = neighbors(tile.q, tile.r).filter((n) => getTerrain(world, n.q, n.r) === "forest").length;
      const gain = TIMBER.REGROW + woods * TIMBER.REGROW_NEIGHBOUR;
      tile.timber = Math.min(TIMBER.max(tile), standAt(world, tile) + gain);
    }

    // A worked-out seam says so. Once, and only while the camp is standing:
    // a ruin is not news.
    if (b.id === "quarryCamp" && operational(b)) {
      const left = seamAt(world, tile);
      if (left <= 0 && !b.workedOut) {
        b.workedOut = true;
        events.push({
          type: "workedOut",
          q: tile.q, r: tile.r,
          text: `The rock at ${tile.q},${tile.r} is worked out. Break down another mountain, or move the camp.`,
        });
      } else if (left > 0 && b.workedOut) {
        b.workedOut = false;
      }
    }
  }

  // What you cleared comes back.
  const regrown = [];
  if (Array.isArray(world.regrowth) && world.regrowth.length) {
    const keep = [];
    for (const entry of world.regrowth) {
      if (world.day - entry.day < REGROW_AFTER) { keep.push(entry); continue; }
      if (readyToRegrow(world, entry)) {
        regrown.push({ q: entry.q, r: entry.r });
        events.push({
          type: "regrown",
          q: entry.q, r: entry.r,
          text: `The wood has taken back ${entry.q},${entry.r}.`,
        });
      }
      // Either it grew back or it never will. Stop remembering it.
    }
    world.regrowth = keep;
  }

  return { events, regrown };
}

/**
 * What the tile panel says about the ground, or null if the ground has nothing
 * to say. Only a tile something is working has an answer.
 */
export function groundSummary(world, tile) {
  const b = tile && tile.building;
  if (!b) return null;
  if (b.id === "woodcutter" && tile.terrain === "forest") {
    const max = TIMBER.max(tile);
    const left = standAt(world, tile);
    const woods = neighbors(tile.q, tile.r).filter((n) => getTerrain(world, n.q, n.r) === "forest").length;
    return {
      kind: "stand",
      left: Math.round(left),
      max,
      share: +(left / max).toFixed(2),
      perDay: TIMBER.REGROW + woods * TIMBER.REGROW_NEIGHBOUR,
      neighbours: woods,
    };
  }
  if (b.id === "quarryCamp") {
    const left = seamAt(world, tile);
    return {
      kind: "seam",
      left: Math.round(left),
      max: null,
      share: +Math.max(0, Math.min(1, left / ROCK.TAPER)).toFixed(2),
      perDay: 0,
      neighbours: 0,
    };
  }
  return null;
}

/** Every stand and seam you are working, for the economy panel. */
export function groundSummaryAll(world) {
  let standLeft = 0;
  let standMax = 0;
  let seamLeft = 0;
  let stands = 0;
  let seams = 0;
  let spent = 0;
  for (const tile of activeTiles(world)) {
    const b = tile.building;
    if (!b) continue;
    if (b.id === "woodcutter" && tile.terrain === "forest") {
      stands += 1;
      standLeft += standAt(world, tile);
      standMax += TIMBER.max(tile);
    } else if (b.id === "quarryCamp") {
      seams += 1;
      const left = seamAt(world, tile);
      seamLeft += left;
      if (left <= 0) spent += 1;
    }
  }
  return {
    stands,
    standLeft: Math.round(standLeft),
    standShare: standMax ? +(standLeft / standMax).toFixed(2) : 1,
    seams,
    seamLeft: Math.round(seamLeft),
    spentSeams: spent,
    regrowing: Array.isArray(world.regrowth) ? world.regrowth.length : 0,
  };
}
