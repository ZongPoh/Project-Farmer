/**
 * Territory: the land you have actually taken, as opposed to the land you can see.
 *
 * WHAT THIS CHANGES. Before this, the whole board was yours from the first
 * minute — you could order a quarry on a mountain forty tiles away on day one,
 * and raiders could materialise in the middle of your farm. Neither felt like
 * anywhere. A settlement should have a BORDER, it should grow outward from
 * where you started, and the far side of the map should be somewhere you have
 * to reach rather than somewhere you already are.
 *
 * THE MODEL, and why it is this one:
 *
 *   OWNED    tiles you have developed — built on, or worked and finished.
 *   CLAIMED  every owned tile and its six neighbours. This is the territory.
 *
 * So the border sits one tile beyond the last thing you did, which is exactly
 * the rule the player is told: finish something, and the ground around it
 * opens up. It also means territory can never have holes in it, and can never
 * be disconnected from the base, without anybody having to enforce either.
 *
 * REFERENCE COUNTING, and why it is not optional. Two buildings standing next
 * to each other both claim the tile between them. If claims were a plain set,
 * demolishing either one would punch a hole in the middle of your farm — and
 * the hole would be invisible until somebody tried to build there. `claims` is
 * therefore a Map of key to how many owned tiles are vouching for it, and a
 * tile leaves the territory only when the last of them goes.
 *
 * `owned` is what gets SAVED; `claims` is rebuilt from it on load, the same way
 * `active` is. One source of truth, and a save that cannot disagree with itself.
 *
 * TWO FACTIONS HOLD LAND NOW. The rivals have a settlement of their own, with
 * its own border that grows the same way yours does. Rather than a second copy
 * of the reference counting — which is the part that is easy to get subtly
 * wrong — everything below operates on a HOLDING: a plain `{ owned, claims }`
 * pair. `playerHolding` and `rivalHolding` name the two of them, and every
 * exported player-facing function is a thin wrapper that passes the first.
 */
import { key, neighbors, distance } from "./hex.js";
import { getTerrain } from "./tiles.js";

/**
 * How far the base reaches on the day you plant it.
 *
 * Owned out to radius 1, so CLAIMED out to radius 2 — nineteen tiles. Enough
 * for two farms, a woodcutter and somewhere to put them, which is the minimum
 * for the opening not to be a puzzle about the border.
 */
export const BASE_CLAIM_RADIUS = 1;

const onBoard = (world, q, r) => getTerrain(world, q, r) !== null;

// --- holdings ---------------------------------------------------------------
//
// A holding is `{ owned: Set, claims: Map }`. The player keeps theirs on the
// world root for backwards compatibility with every save and every caller that
// predates the rivals owning anything; the rivals keep theirs under
// `world.rival`.

/** The player's land. */
export const playerHolding = (world) => {
  if (!world.owned) world.owned = new Set();
  if (!world.claims) world.claims = new Map();
  return { owned: world.owned, claims: world.claims };
};

/**
 * One neighbour's land.
 *
 * Takes the CAMP rather than the world, because there are several of them now.
 * Nothing here imports `rivalcamp.js` — territory must not depend on who is
 * holding land, only on the shape of a holding — so callers pass the camp in.
 */
export const campHolding = (camp) => {
  if (!camp) return null;
  if (!camp.owned) camp.owned = new Set();
  if (!camp.claims) camp.claims = new Map();
  return { owned: camp.owned, claims: camp.claims };
};

/** Every neighbour's land, in one list. */
export const allCampHoldings = (world) =>
  (world.camps || []).map(campHolding).filter(Boolean);

/** Is this tile inside the given holding's border? */
export function inHolding(holding, q, r) {
  return !!holding && holding.claims.has(key(q, r));
}

/** Has this holding actually developed the tile, rather than merely bordering it? */
export function ownedBy(holding, q, r) {
  return !!holding && holding.owned.has(key(q, r));
}

/** Is this tile inside your border? */
export function inTerritory(world, q, r) {
  if (!world.claims) return false;
  return world.claims.has(key(q, r));
}

/** Is it inside ANY neighbour's? */
export function inRivalLand(world, q, r) {
  const k = key(q, r);
  for (const camp of world.camps || []) {
    if (camp.claims && camp.claims.has(k)) return true;
  }
  return false;
}

/** Which neighbour holds this tile, or null. */
export function campHolding_at(world, q, r) {
  const k = key(q, r);
  for (const camp of world.camps || []) {
    if (camp.claims && camp.claims.has(k)) return camp;
  }
  return null;
}

/** Have you actually developed this tile, as opposed to merely bordering it? */
export function isOwned(world, q, r) {
  return !!world.owned && world.owned.has(key(q, r));
}

/**
 * Whose land is this? "yours", "theirs", "contested" or null for nobody's.
 *
 * Contested is possible and is not an error: both borders are rings around
 * developed tiles, and two settlements growing toward each other will overlap
 * their rings long before either can build on the same square.
 */
export function landOwner(world, q, r) {
  const mine = inTerritory(world, q, r);
  const theirs = inRivalLand(world, q, r);
  if (mine && theirs) return "contested";
  if (mine) return "yours";
  if (theirs) return "theirs";
  return null;
}

/** Every tile within `radius` steps, the board's edges respected. */
export function tilesWithin(world, q, r, radius) {
  const seen = new Set([key(q, r)]);
  const out = [{ q, r }];
  let frontier = [{ q, r }];
  for (let step = 0; step < radius; step++) {
    const next = [];
    for (const at of frontier) {
      for (const n of neighbors(at.q, at.r)) {
        const k = key(n.q, n.r);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!onBoard(world, n.q, n.r)) continue;
        out.push(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Take a tile, and with it the ring around it.
 *
 * Idempotent: claiming a tile twice does nothing the second time, which
 * matters because `place` and a finished job can both land on the same tile.
 */
export function claimFor(holding, world, q, r) {
  if (!holding) return false;
  const k = key(q, r);
  if (holding.owned.has(k)) return false;
  if (!onBoard(world, q, r)) return false;
  holding.owned.add(k);

  for (const at of [{ q, r }, ...neighbors(q, r)]) {
    if (!onBoard(world, at.q, at.r)) continue;
    const ak = key(at.q, at.r);
    holding.claims.set(ak, (holding.claims.get(ak) || 0) + 1);
  }
  return true;
}

export function claimTile(world, q, r) {
  return claimFor(playerHolding(world), world, q, r);
}

/** Give a tile up — it was demolished, or the job on it was undone. */
export function unclaimFor(holding, world, q, r) {
  if (!holding) return false;
  const k = key(q, r);
  if (!holding.owned.has(k)) return false;
  holding.owned.delete(k);

  for (const at of [{ q, r }, ...neighbors(q, r)]) {
    const ak = key(at.q, at.r);
    const n = (holding.claims.get(ak) || 0) - 1;
    if (n <= 0) holding.claims.delete(ak);
    else holding.claims.set(ak, n);
  }
  return true;
}

export function unclaimTile(world, q, r) {
  return unclaimFor(playerHolding(world), world, q, r);
}

/** Take a whole patch at once — what planting the base does. */
export function claimAreaFor(holding, world, q, r, radius = BASE_CLAIM_RADIUS) {
  let taken = 0;
  for (const at of tilesWithin(world, q, r, radius)) {
    if (claimFor(holding, world, at.q, at.r)) taken++;
  }
  return taken;
}

export function claimArea(world, q, r, radius = BASE_CLAIM_RADIUS) {
  return claimAreaFor(playerHolding(world), world, q, r, radius);
}

/**
 * Rebuild `claims` from `owned`. Called on load, exactly like `rebuildActive`.
 *
 * This is why `claims` is not saved: a derived index that is stored can drift
 * from the thing it indexes, and then the bug is a save file rather than a
 * line of code.
 */
export function rebuildHolding(holding, world, saved) {
  holding.owned = new Set();
  holding.claims = new Map();
  for (const k of saved || []) {
    const [q, r] = String(k).split(",").map(Number);
    if (Number.isFinite(q) && Number.isFinite(r)) claimFor(holding, world, q, r);
  }
  return holding;
}

export function rebuildTerritory(world) {
  const saved = world.owned instanceof Set ? [...world.owned] : world.owned || [];
  const holding = { owned: new Set(), claims: new Map() };
  rebuildHolding(holding, world, saved);
  world.owned = holding.owned;
  world.claims = holding.claims;
  return world;
}

/** Rebuild every neighbour's border from their saved owned tiles. */
export function rebuildRivalTerritory(world) {
  for (const camp of world.camps || []) {
    const saved = camp.owned instanceof Set ? [...camp.owned] : camp.owned || [];
    const holding = { owned: new Set(), claims: new Map() };
    rebuildHolding(holding, world, saved);
    camp.owned = holding.owned;
    camp.claims = holding.claims;
  }
  return world;
}

/** How much land you hold, and how much of it you have actually developed. */
export function territorySize(world) {
  return {
    claimed: world.claims ? world.claims.size : 0,
    owned: world.owned ? world.owned.size : 0,
  };
}

/**
 * The reason a tile is off limits, or null if it is not.
 *
 * One sentence, written for a disabled button — every "can I?" in this
 * codebase answers with a reason string the UI can show verbatim, and this is
 * the one the player will see most often early on.
 */
export function outsideReason(world, q, r) {
  if (inTerritory(world, q, r)) return null;
  if (!world.owned || world.owned.size === 0) return "you have not founded anything yet";
  // Naming the neighbours matters: "outside your land" on a tile that is
  // plainly next to your farm reads as a bug until you know somebody else is
  // standing on it.
  const holder = campHolding_at(world, q, r);
  if (holder) {
    return holder.kind === "settler"
      ? "the settlers hold that — they got there first"
      : "that is the raiders' land";
  }
  return "outside your land — work a tile closer to home first";
}

/**
 * Is this tile on the edge of your land, looking outward?
 *
 * Used for the one job that expands the border and for drawing it. A tile
 * qualifies if it is claimed but not owned — i.e. it is the ring, not the
 * inside.
 */
export function isFrontier(world, q, r) {
  return inTerritory(world, q, r) && !isOwned(world, q, r);
}

/** Every tile on the outward edge of the territory. */
export function frontierTiles(world) {
  const out = [];
  if (!world.claims) return out;
  for (const k of world.claims.keys()) {
    if (world.owned.has(k)) continue;
    const [q, r] = k.split(",").map(Number);
    out.push({ q, r });
  }
  return out;
}

/** The owned tile nearest to somewhere — used to point raiders at you. */
export function nearestOwned(world, from) {
  let best = null;
  let bestD = Infinity;
  for (const k of world.owned || []) {
    const [q, r] = k.split(",").map(Number);
    const d = distance(from, { q, r });
    if (d < bestD) {
      bestD = d;
      best = { q, r };
    }
  }
  return best;
}
