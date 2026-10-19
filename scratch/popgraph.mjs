import { createWorld } from "../src/game/world.js";
import { advanceDay } from "../src/game/tick.js";
import { capacityFor } from "../src/game/animals.js";
import { distance } from "../src/game/hex.js";
const size = process.argv[2] === "big" ? { width: 120, height: 80 } : { width: 34, height: 24 };
for (const seed of [1, 7, 42]) {
  const world = createWorld(seed, size);
  const rows = { rabbit: [], fox: [], horse: [], localR: [], localH: [] };
  for (let d = 1; d <= 288; d++) {
    advanceDay(world);
    if (d % 24 === 0) {
      for (const sp of ["rabbit", "fox", "horse"]) rows[sp].push(world.animals.filter(a => a.species === sp && !a.tamed).length);
      rows.localR.push(world.animals.filter(a => a.species === "rabbit" && distance(a, world.home) <= 12).length);
      rows.localH.push(world.animals.filter(a => a.species === "horse" && distance(a, world.home) <= 12).length);
    }
  }
  console.log(`seed ${seed} cap r/f/h ${["rabbit","fox","horse"].map(s=>capacityFor(world,s)).join("/")}`);
  for (const [k, v] of Object.entries(rows)) console.log("  ", k.padEnd(7), v.join(" "));
}
