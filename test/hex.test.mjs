import test from "node:test";
import assert from "node:assert/strict";
import {
  hexToWorld, worldToHex, distance, neighbors, ring, spiral, tileCount, round, key,
} from "../src/game/hex.js";

test("spiral(3) is the 37-tile starting board", () => {
  assert.equal(spiral(3).length, 37);
  assert.equal(tileCount(3), 37);
});

test("ring sizes are 1, 6, 12, 18", () => {
  assert.deepEqual([0, 1, 2, 3].map((n) => ring(n).length), [1, 6, 12, 18]);
});

test("no tile appears twice in a spiral", () => {
  for (const radius of [1, 3, 6, 10]) {
    const all = spiral(radius).map((t) => key(t.q, t.r));
    assert.equal(new Set(all).size, all.length, `radius ${radius} has duplicates`);
  }
});

test("every tile has exactly six neighbours, all one step away", () => {
  for (const t of spiral(3)) {
    const n = neighbors(t.q, t.r);
    assert.equal(n.length, 6);
    for (const m of n) assert.equal(distance(t, m), 1);
  }
});

test("world <-> hex round-trips at several sizes", () => {
  for (const size of [0.5, 1, 2.5]) {
    for (const t of spiral(6)) {
      const { x, z } = hexToWorld(t.q, t.r, size);
      // centre, plus points well inside the tile
      for (const [ox, oz] of [[0,0],[.4,0],[-.4,0],[0,.5],[0,-.5],[.3,.3],[-.3,-.3]]) {
        const got = worldToHex(x + ox * size, z + oz * size, size);
        assert.deepEqual(got, { q: t.q, r: t.r },
          `size ${size} tile ${t.q},${t.r} offset ${ox},${oz}`);
      }
    }
  }
});

test("neighbouring tiles are exactly flat-to-flat apart", () => {
  const size = 1;
  const a = hexToWorld(0, 0, size);
  for (const n of neighbors(0, 0)) {
    const b = hexToWorld(n.q, n.r, size);
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    assert.ok(Math.abs(d - Math.sqrt(3) * size) < 1e-9, `spacing was ${d}`);
  }
});

test("rounding keeps q + r + s === 0", () => {
  for (let i = 0; i < 500; i++) {
    const { q, r } = round(Math.random() * 20 - 10, Math.random() * 20 - 10);
    assert.equal(q + r + (-q - r), 0);
    assert.ok(Number.isInteger(q) && Number.isInteger(r));
  }
});
