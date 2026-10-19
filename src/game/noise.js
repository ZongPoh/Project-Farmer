/**
 * Deterministic randomness, addressed by position rather than by call order.
 *
 * This is the change that makes a large map possible. The old generator
 * walked the board in spiral order calling rnd() once per tile, so a tile's
 * `size` depended on WHEN it was generated. That is fine when you always
 * generate the whole board at once, and fatal the moment you generate tiles
 * on demand — the same tile would get a different size depending on what the
 * camera happened to visit first.
 *
 * Everything here is a pure function of (seed, x, y). Ask for tile 300,-80
 * on its own, a year later, in any order, and you get the same answer.
 *
 * The old value noise also read from a 64x64 lookup table with `x & 63`,
 * which silently repeats every 64 cells. On the old 37-tile board you could
 * not see it; across 400 tiles you would see the same island five times.
 * Hashing has no table and therefore no period.
 */

/**
 * Small deterministic RNG, kept for sequential uses (one per game day).
 * This is Mulberry32 by Tommy Ettinger, a widely published public-domain
 * generator, reproduced as-is.
 */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Integer hash of two coordinates plus a seed, in [0, 1).
 *
 * Two rounds of xor-multiply-shift. The constants are the usual suspects
 * from MurmurHash3's finaliser (Austin Appleby, public domain), with xxHash
 * primes mixing the coordinates in; what matters is that neighbouring inputs
 * give unrelated outputs, which is what stops the terrain from streaking
 * along diagonals.
 */
export function hash2(seed, x, y) {
  let h = (seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Same, but a third input — for asking several independent questions of one tile. */
export function hash3(seed, x, y, k) {
  return hash2(seed ^ Math.imul(k | 0, 0x9e3779b1), x, y);
}

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Value noise: hash the integer lattice, smoothly interpolate between.
 * Unbounded in both axes — there is no table to run off the end of.
 */
export function valueNoise2(seed, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smooth(xf), v = smooth(yf);

  const a = hash2(seed, xi, yi);
  const b = hash2(seed, xi + 1, yi);
  const c = hash2(seed, xi, yi + 1);
  const d = hash2(seed, xi + 1, yi + 1);

  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * Several octaves of value noise, each finer and quieter than the last.
 *
 * One octave gives smooth blobs; on a big map that reads as featureless.
 * Two or three add coastline detail without breaking up the landmasses.
 * Result is normalised back into [0, 1].
 */
export function fbm2(seed, x, y, octaves = 2, lacunarity = 2.2, gain = 0.45) {
  let sum = 0, amp = 1, norm = 0, fx = x, fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(seed + o * 1013, fx, fy);
    norm += amp;
    amp *= gain;
    fx *= lacunarity;
    fy *= lacunarity;
  }
  return sum / norm;
}
