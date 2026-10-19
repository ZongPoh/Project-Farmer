import { findPath, canWalk, workSpotFor } from "./workers.js";
import { getTerrain } from "./tiles.js";
import { moveCost } from "./terrain.js";

/** The residents counted by fighters also work locally; expeditions reserve them. */
export function stepCampWorkers(world) {
  for (const camp of world.camps || []) {
    camp.workers = (camp.workers || []).filter(w => w.health > 0).slice(0, camp.fighters);
    while (camp.workers.length < camp.fighters) {
      camp.nextWorkerId = (camp.nextWorkerId || 0) + 1;
      camp.workers.push({ id: `village-${camp.id}-${camp.nextWorkerId}`, campId: camp.id,
        ...camp.home, health: 100, state: "idle", move: 0, path: null, workHours: 0 });
    }
    const jobs = camp.buildings.filter(b => b.condition > 0 && b.id !== "camp");
    for (const [index, worker] of camp.workers.entries()) {
      if (worker.workHours > 0) { worker.workHours--; continue; }
      const job = jobs[index % jobs.length];
      const destination = worker.state === "working" || !job ? camp.home : workSpotFor(world, job.q, job.r, worker);
      if (!destination) continue;
      if (!worker.target || worker.target.q !== destination.q || worker.target.r !== destination.r) worker.path = null;
      worker.target = destination;
      if (!worker.path) worker.path = findPath(world, worker, destination);
      worker.move = Math.min(4, worker.move + 1);
      const next = worker.path?.[0];
      if (next) {
        if (!canWalk(world, next.q, next.r)) { worker.path = null; continue; }
        const cost = moveCost(getTerrain(world, next.q, next.r));
        if (worker.move >= cost) { worker.move -= cost; worker.q = next.q; worker.r = next.r; worker.path.shift(); }
      }
      if (worker.q === destination.q && worker.r === destination.r) {
        worker.state = destination === camp.home ? "idle" : "working";
        worker.workHours = 4;
        worker.path = null;
      }
    }
  }
}
