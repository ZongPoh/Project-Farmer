import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, allTiles } from "../src/game/world.js";
import { setTerrain, getTile } from "../src/game/tiles.js";
import { claimTile } from "../src/game/territory.js";
import { neighbors } from "../src/game/hex.js";
import { placeFinished as place } from "./support.mjs";
import { demolish } from "../src/game/buildings.js";
import { startWork, cancelWork } from "../src/game/tick.js";
import { makeWorker, retryJobAccess, findOpenJob, stepWorkers } from "../src/game/workers.js";
import { encodeSave, decodeSave } from "../src/game/persistence.js";
function fixture() {
  const w=createWorld(23,{width:24,height:16});
  for(const t of allTiles(w)){setTerrain(w,t.q,t.r,"grass");claimTile(w,t.q,t.r);}
  w.store={food:1000,wood:1000,stone:1000,seeds:100,herbs:0};
  place(w,0,0,"base"); w.autoRepair=false;w.autoForage=false;
  makeWorker(w,0,0);
  for(const n of neighbors(3,0))place(w,n.q,n.r,"wall");
  setTerrain(w,3,0,"forest");
  return w;
}
test("unreachable work stays paused across days and saves until access is fixed and resumed",()=>{
  const w=fixture();assert.ok(startWork(w,3,0,"clear").ok);
  const job=getTile(w,3,0).work;assert.equal(job.accessBlocked,true);
  job.done=2;w.day++;assert.equal(findOpenJob(w,w.workers[0]),null);
  assert.equal(retryJobAccess(w,3,0).ok,false);assert.equal(job.done,2);
  const restored=decodeSave(encodeSave(w)).world;
  assert.equal(getTile(restored,3,0).work.accessBlocked,true);
  demolish(w,2,0);assert.equal(findOpenJob(w,w.workers[0]),null);
  assert.equal(retryJobAccess(w,3,0).ok,true);assert.equal(job.accessBlocked,false);assert.equal(job.done,2);
  assert.equal(w.workers[0].state,"travelling");
});
test("a worker inside the enclosure can take work that outside workers cannot reach",()=>{
  const w=fixture();const inside=makeWorker(w,3,0);
  assert.ok(startWork(w,3,0,"clear").ok);
  assert.equal(inside.state,"working");assert.notEqual(getTile(w,3,0).work.accessBlocked,true);
});
test("no walkable adjacent work spot is reported and blocked jobs can be cancelled",()=>{
  const w=fixture();setTerrain(w,3,0,"mountain");
  assert.ok(startWork(w,3,0,"quarry").ok);assert.equal(getTile(w,3,0).work.accessBlocked,true);
  assert.ok(cancelWork(w,3,0).ok);assert.equal(getTile(w,3,0).work,null);
});
test("a closed route during travel pauses the job without completing it remotely",()=>{
  const w=fixture();demolish(w,2,0);startWork(w,3,0,"clear");
  place(w,2,0,"wall");stepWorkers(w,()=>0.5);
  const job=getTile(w,3,0).work;
  assert.equal(job.accessBlocked,true);assert.equal(job.done,0);
});
test("jobs awaiting the first worker are queued, not falsely labelled unreachable",()=>{
  const w=fixture();w.workers=[];startWork(w,3,0,"clear");
  assert.notEqual(getTile(w,3,0).work.accessBlocked,true);
});
