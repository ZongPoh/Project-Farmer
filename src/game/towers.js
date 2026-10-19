import { addResource } from "./economy.js";
import { watchtowers } from "./buildings.js";
import { getBuilding } from "./tiles.js";
import { distance } from "./hex.js";
import { operational } from "./construction.js";

/** Lookouts spot movement; archers fire only at an active attack or stolen cargo. */
export function stepWatchtowers(world) {
  const hadRaiders=(world.raiders||[]).length>0;
  const events=[], now=world.day*24+world.hour;
  for(const tower of watchtowers(world)) {
    const b=getBuilding(world,tower.q,tower.r);
    const visible=(world.raiders||[]).filter(r=>r.health>0 && distance(tower,r)<=tower.range);
    for(const r of visible) if(!r.towerSpotted) {
      r.towerSpotted=true;
      events.push({type:"towerSpotted",q:r.q,r:r.r,text:`Lookout spotted a raider at ${r.q},${r.r}.`});
    }
    if(now-(b.lastShot?.at ?? -1000)<6) continue;
    const target=visible.filter(r=>(r.state==="incoming" || r.carrying) && distance(tower,r)<=tower.shootingRange).sort((a,c)=>distance(tower,a)-distance(tower,c))[0];
    if(!target) continue;
    target.health=Math.max(0,target.health-12);
    b.lastShot={at:now,q:target.q,r:target.r};
    events.push({type:"towerShot",q:tower.q,r:tower.r,text:`Watchtower at ${tower.q},${tower.r} fired at a raider at ${target.q},${target.r}.`});
    if(target.health===0) {
      for(const [resource,amount] of Object.entries(target.carrying?.goods||{})) addResource(world,resource,amount);
      const horse=(world.animals||[]).find(a=>a.id===target.carrying?.horseId);
      if(horse) {horse.stolen=false;horse.tamed=false;horse.q=target.q;horse.r=target.r;}
      world.raiders=world.raiders.filter(r=>r.id!==target.id);
      events.push({type:"towerDefended",q:target.q,r:target.r,text:"The watchtower brought down a raider."});
    }
  }
  if(hadRaiders && !world.raiders.length) world.raidsSurvived=(world.raidsSurvived||0)+1;
  for (const camp of world.camps || []) {
    for (const tower of camp.buildings.filter(b => b.id === "watchtower" && operational(b))) {
      if (now - (tower.lastShot?.at ?? -1000) < 6) continue;
      const targets = [];
      if (camp.kind === "raider") {
        targets.push(...(world.workers || []).map(worker => ({ worker, owner: null })));
        for (const other of world.camps || []) if (other.id !== camp.id)
          targets.push(...(other.workers || []).map(worker => ({ worker, owner: other })));
      }
      // Peaceful towers also defend against active village expeditions.
      for (const other of world.camps || []) if (other.id !== camp.id && other.expedition &&
        (camp.kind === "raider" || (other.expedition.targetId === camp.id && other.expedition.state !== "returning")))
        targets.push({ worker: other.expedition, owner: other });
      const victim = targets.filter(({ worker }) => worker.health > 0 && distance(tower, worker) <= 4)
        .sort((a, b) => distance(tower, a.worker) - distance(tower, b.worker))[0];
      if (!victim) continue;
      const { worker, owner } = victim;
      worker.health = Math.max(0, worker.health - 8);
      tower.lastShot = { at: now, q: worker.q, r: worker.r };
      events.push({ type: "towerShot", q: tower.q, r: tower.r, text: `Village ${camp.id}'s watchtower fired at ${owner ? `village ${owner.id}` : "your"} workers.` });
      if (worker.health === 0 && owner) {
        if (owner.expedition === worker) owner.expedition = null;
        else { owner.workers = owner.workers.filter(w => w !== worker); owner.fighters = Math.max(0, owner.fighters - 1); }
      }
    }
  }
  return events;
}
