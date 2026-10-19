import { test } from "node:test";
import assert from "node:assert/strict";
import { seasonAppearance, decorationVariant } from "../src/scene/seasonAppearance.js";

test("snow builds in late autumn, covers winter, and melts before spring", () => {
  assert.equal(seasonAppearance(49).snow, 0);
  assert.ok(seasonAppearance(72).snow > 0.8);
  assert.equal(seasonAppearance(73).snow, 1);
  assert.ok(seasonAppearance(96).snow < 0.2);
  assert.equal(seasonAppearance(97).snow, 0);
});

test("seasonal models repeat across years and never change their source of truth", () => {
  for (let day = 1; day <= 96; day++) {
    assert.deepEqual(seasonAppearance(day), seasonAppearance(day + 96));
    assert.ok(seasonAppearance(day).snow >= 0 && seasonAppearance(day).snow <= 1);
  }
  for (const [q, r] of [[0, 0], [-200, 100], [15, -12]]) {
    assert.equal(decorationVariant(q, r), decorationVariant(q, r));
    assert.ok(decorationVariant(q, r) >= 0 && decorationVariant(q, r) <= 100);
  }
});
