/**
 * Hex coordinate maths — axial coordinates, pointy-top layout.
 *
 * Every tile has two coordinates, q and r. There is an implicit third,
 * s = -q - r, which is why this is sometimes called "cube" coordinates.
 * Keeping q + r + s === 0 is what makes rounding and distance easy.
 *
 * In 3D the board lies flat on the XZ plane. Y is up (height).
 */

export const SQ3 = Math.sqrt(3);

/** The six neighbours, in order: E, NE, NW, W, SW, SE */
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/** Map keys. Objects can't be Map keys by value, so we use "q,r" strings. */
export const key = (q, r) => `${q},${r}`;
export const parseKey = (k) => {
  const [q, r] = k.split(",").map(Number);
  return { q, r };
};

/** Tile centre in world space. `size` is the distance from centre to a corner. */
export function hexToWorld(q, r, size = 1) {
  return { x: size * SQ3 * (q + r / 2), z: size * 1.5 * r };
}

/** Nearest tile to a point on the ground plane. Inverse of hexToWorld. */
export function worldToHex(x, z, size = 1) {
  const q = ((SQ3 / 3) * x - z / 3) / size;
  const r = ((2 / 3) * z) / size;
  return round(q, r);
}

/**
 * Rounding to the nearest hex is not just Math.round on q and r — that
 * gives wrong answers near edges. Round all three cube coords, then fix
 * up whichever moved furthest so they sum to zero again.
 */
export function round(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  // Math.round(-0.2) is -0. It compares equal to 0, but it serialises as
  // "-0" and fails strict deep-equality, so normalise it away here.
  const noNegZero = (n) => (n === 0 ? 0 : n);
  return { q: noNegZero(rq), r: noNegZero(rr) };
}

/** Steps between two tiles, walking over neighbours. */
export function distance(a, b) {
  return (
    Math.abs(a.q - b.q) +
    Math.abs(a.q + a.r - b.q - b.r) +
    Math.abs(a.r - b.r)
  ) / 2;
}

export function neighbors(q, r) {
  return DIRS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

/** The tiles exactly `radius` steps from the centre. ring(0) is the centre. */
export function ring(radius) {
  if (radius === 0) return [{ q: 0, r: 0 }];
  const out = [];
  let q = DIRS[4][0] * radius, r = DIRS[4][1] * radius;
  for (let d = 0; d < 6; d++) {
    for (let i = 0; i < radius; i++) {
      out.push({ q, r });
      q += DIRS[d][0];
      r += DIRS[d][1];
    }
  }
  return out;
}

/** Every tile within `radius`. Count is 1 + 3*n*(n+1): 37 tiles at radius 3. */
export function spiral(radius) {
  const out = [];
  for (let k = 0; k <= radius; k++) out.push(...ring(k));
  return out;
}

/** How many tiles a map of this radius holds. */
export const tileCount = (radius) => 1 + 3 * radius * (radius + 1);
