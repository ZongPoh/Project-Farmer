import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, allTiles } from "../src/game/world.js";
import { setTerrain, getTerrain } from "../src/game/tiles.js";
import { foundFinishedCamp as foundCamp } from "./support.mjs";
import { makeWorker, workSpotFor, findPath } from "../src/game/workers.js";
import { stepCampWorkers } from "../src/game/campWorkers.js";
import { stepWatchtowers } from "../src/game/towers.js";
import { stepAssault } from "../src/game/rivals.js";
import { encodeSave, decodeSave } from "../src/game/persistence.js";
import { moveCost } from "../src/game/terrain.js";
function setup() {
  const w = createWorld(23, {width:24,height:16});
  for (const t of allTiles(w)) setTerrain(w,t.q,t.r,"grass");
  const c = foundCamp(w,"settler",{q:5,r:0});
  c.buildings.push({id:"watchtower",q:4,r:0,condition:100});
  return {w,c};
}
test("peaceful towers permit passage; even a failed attack cancels trade and enables fire", () => {
  const {w,c} = setup(), p = makeWorker(w,3,0);
  stepWatchtowers(w); assert.equal(p.health,100);
  w.caravans = [{id:1,campId:c.id}];
  p.state="storming"; p.marching={campId:c.id,q:4,r:0}; p.q=4;
  stepAssault(w,()=>0.5,1);
  assert.equal(c.kind,"raider"); assert.equal(w.caravans.length,0);
  const before=p.health; stepWatchtowers(w); assert.equal(p.health,before-8);
  stepWatchtowers(w); assert.equal(p.health,before-8);
});
test("rival towers hit other village workers, spare their own, and respect construction", () => {
  const {w,c}=setup(); c.kind="raider";
  const other=foundCamp(w,"settler",{q:7,r:0}); stepCampWorkers(w);
  for(const p of c.workers){p.q=4;p.r=0;}
  for(const p of other.workers){p.q=5;p.r=0;}
  const tower=c.buildings.find(b=>b.id==="watchtower");
  tower.construction={kind:"build",needed:48,progress:0};
  stepWatchtowers(w);assert.ok(other.workers.every(p=>p.health===100));
  tower.construction=null;
  other.workers[0].health=8;const count=other.fighters;
  stepWatchtowers(w);assert.equal(other.fighters,count-1);
  assert.ok(c.workers.every(p=>p.health===100));
  stepCampWorkers(w);assert.equal(other.workers.length,count-1);
});
test("village workers travel, survive saves and keep tower cooldown", () => {
  const {w,c}=setup(); stepCampWorkers(w);
  assert.equal(c.workers.length,c.fighters);
  assert.ok(c.workers.some(p=>p.q!==c.home.q||p.r!==c.home.r));
  c.kind="raider";const p=makeWorker(w,3,0);stepWatchtowers(w);
  const restored=decodeSave(encodeSave(w)).world;
  assert.deepEqual(restored.camps[0].workers,c.workers);
  stepWatchtowers(restored);assert.equal(restored.workers[0].health,p.health);
});
test("blocked job tiles choose the cheapest reachable neighbouring work spot", () => {
  const {w}=setup();setTerrain(w,0,0,"mountain");
  assert.deepEqual(workSpotFor(w,0,0,{q:-1,r:0}),{q:-1,r:0});
});
test("paths minimize travel cost rather than straight-line tile count", () => {
  const {w}=setup(); for(let q=1;q<=3;q++)setTerrain(w,q,0,"forest");
  const path=findPath(w,{q:0,r:0},{q:4,r:0});
  assert.equal(path.reduce((s,n)=>s+moveCost(getTerrain(w,n.q,n.r)),0),5);
});
