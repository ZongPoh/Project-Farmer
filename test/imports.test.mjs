/**
 * Every named import in the source tree must resolve to a real export.
 *
 * WHY THIS EXISTS. `rivals.js` imported `{ sheltered }` from `danger.js` at a
 * point when `danger.js` had not yet been given that export. Nothing caught
 * it: the game's own tests all pass, because `node --test` only ever imports
 * the modules a test names, and the browser only found it at load time —
 *
 *     Uncaught SyntaxError: The requested module '/src/game/danger.js'
 *     does not provide an export named 'sheltered'
 *
 * — which is a blank screen, after a build, with no test failure anywhere.
 *
 * The gap is specifically the `.jsx` files and any module no test happens to
 * import. Node cannot parse JSX, so those can never be checked by importing
 * them; this reads them as text instead. It is a crude parser and it is meant
 * to be: it only has to answer "is this name exported somewhere in that file",
 * and being wrong in the safe direction (a missed export shape) is a false
 * alarm a human notices immediately, not a bug that ships.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const SOURCE_ROOT = "src";

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(js|jsx)$/.test(path)) out.push(path);
  }
  return out;
}

/** Every name a module exports. Deliberately generous — see the note above. */
export function exportedNames(source) {
  const names = new Set();

  // export function foo / function* foo / async function foo / class / const
  for (const m of source.matchAll(
    /export\s+(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z0-9_$]+)/g
  )) {
    names.add(m[1]);
  }

  // export { a, b as c }  — including re-exports, `export { x } from "./y"`
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const [from, to] = piece.split(/\s+as\s+/);
      names.add((to || from).trim());
    }
  }

  if (/export\s+default/.test(source)) names.add("default");
  return names;
}

/** Every `import { a, b } from "./relative"` in a module. */
export function namedImports(source) {
  const out = [];
  for (const m of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g
  )) {
    const names = m[1]
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    out.push({ names, from: m[2] });
  }
  return out;
}

test("every named import in src/ resolves to a real export", () => {
  const files = sourceFiles(SOURCE_ROOT);
  assert.ok(files.length > 10, "found suspiciously few source files to check");

  const cache = new Map();
  const exportsFor = (path) => {
    if (!cache.has(path)) cache.set(path, exportedNames(readFileSync(path, "utf8")));
    return cache.get(path);
  };

  const broken = [];
  for (const file of files) {
    for (const { names, from } of namedImports(readFileSync(file, "utf8"))) {
      const target = resolve(dirname(file), from);
      let available;
      try {
        available = exportsFor(target);
      } catch {
        broken.push(`${file} imports from ${from}, which does not exist`);
        continue;
      }
      for (const name of names) {
        if (!available.has(name)) {
          broken.push(`${file} imports { ${name} } from ${from}, which does not export it`);
        }
      }
    }
  }

  assert.deepEqual(broken, [], `\n  ${broken.join("\n  ")}\n`);
});

// --- the parser itself, because a broken checker is worse than none ---------

test("the export scanner recognises every shape this codebase uses", () => {
  const sample = `
    export const A = 1;
    export let B = 2;
    export function C() {}
    export async function D() {}
    export function* E() {}
    export class F {}
    export { G, H as I };
    export { J } from "./elsewhere.js";
    export default function K() {}
  `;
  const names = exportedNames(sample);
  for (const want of ["A", "B", "C", "D", "E", "F", "G", "I", "J", "default"]) {
    assert.ok(names.has(want), `the scanner missed \`${want}\``);
  }
  assert.equal(names.has("H"), false, "the local name of a renamed export is not importable");
});

test("the import scanner finds names and ignores package imports", () => {
  const sample = `
    import { useState } from "react";
    import { a, b as c } from "./thing.js";
    import Whole from "./other.js";
  `;
  const found = namedImports(sample);
  assert.equal(found.length, 1, "only relative named imports are ours to check");
  assert.deepEqual(found[0].names, ["a", "b"]);
  assert.equal(found[0].from, "./thing.js");
});
