import { placeFinished as place, own } from "../test/support.mjs";
import { createWorld, allTiles } from "../src/game/world.js";
import { advanceHour } from "../src/game/tick.js";
import { makeWorker } from "../src/game/workers.js";
import { orderCatch, cancelOrder, pendingOrders, stabledHorses } from "../src/game/horses.js";
import { distance } from "../src/game/hex.js";

function ready() {
  const world = createWorld(7);
  const grass = [...allTiles(world)].filter(t => t.terrain === "grass");
  place(world, grass[0].q, grass[0].r, "base");
  own(world, [...allTiles(world)]);
  Object.assign(world.store, { wood: 4000, stone: 4000, food: 4000 });
  place(world, grass[1].q, grass[1].r, "paddock");
  if (!world.workers.length) makeWorker(world, grass[0].q, grass[0].r);
  world.animals = world.animals.filter(a => a.species !== "horse");
  const mk = t => { const h = { id: world.nextAnimalId++, species: "horse", q: t.q, r: t.r, energy: 14, tamed: false }; world.animals.push(h); return h; };
  const near = mk(grass[3]);
  const picked = mk(grass[Math.floor(grass.length / 2)]);
  const far = grass[grass.length - 1];
  for (let i = 0; i < 4; i++) mk(far);
  return { world, near, picked };
}
const until = (world, fn, max = 24 * 20) => { for (let i = 0; i < max; i++) { if (fn()) return i; advanceHour(world); } return -1; };
const chaser = world => world.workers.find(w => w.state === "catching");

// A: which horse is chased when the player clicked a different one?
{ const { world, near, picked } = ready();
  orderCatch(world); until(world, () => chaser(world));
  const w = chaser(world);
  console.log("A. clicked horse", picked.id, "| worker chases", w?.catching.horseId, "(nearest is", near.id + ")"); }

// B: the chased horse disappears (stolen / died) mid-chase
{ const { world } = ready();
  orderCatch(world); until(world, () => chaser(world));
  const w = chaser(world); const id = w.catching.horseId;
  world.animals = world.animals.filter(a => a.id !== id);
  for (let i = 0; i < 24 * 5; i++) advanceHour(world);
  const o = pendingOrders(world);
  console.log("B. horse removed -> worker", w.state, "| open orders", o.length, o.map(x => ({ takenBy: x.takenBy })));
  for (let i = 0; i < 24 * 30; i++) advanceHour(world);
  console.log("   30 days later: stabled", stabledHorses(world).length, "| open orders", pendingOrders(world).length, pendingOrders(world).map(x => x.takenBy));
  const again = orderCatch(world); console.log("   new order allowed?", again.ok, again.reason || ""); }

// C: player cancels mid-chase — does the catch still happen?
{ const { world } = ready();
  const { order } = orderCatch(world); until(world, () => chaser(world));
  const w = chaser(world);
  cancelOrder(world, order.id);
  for (let i = 0; i < 24 * 10; i++) advanceHour(world);
  console.log("C. cancelled mid-chase -> worker state", w.state, "| stabled", stabledHorses(world).length); }

// D: marked order chases the clicked horse
{ const { world, picked } = ready();
  const r = orderCatch(world, picked.id); until(world, () => chaser(world));
  console.log("D. marked", picked.id, "| worker chases", chaser(world)?.catching.horseId, "| dist", r.distance);
  until(world, () => picked.tamed, 24 * 40);
  console.log("   caught the marked horse?", picked.tamed); }

// E: marked horse vanishes mid-chase -> order closed, no substitute caught
{ const { world, picked } = ready();
  orderCatch(world, picked.id); until(world, () => chaser(world));
  world.animals = world.animals.filter(a => a.id !== picked.id);
  for (let i = 0; i < 24 * 10; i++) advanceHour(world);
  console.log("E. marked horse removed -> open orders", pendingOrders(world).length, "| stabled", stabledHorses(world).length); }

// F: a generic order does not take a horse marked by another order
{ const { world, near } = ready();
  orderCatch(world, near.id); const g = orderCatch(world);
  console.log("F. second (generic) order:", g.ok, g.reason || ""); }
