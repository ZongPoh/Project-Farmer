import {test} from "node:test";
import assert from "node:assert/strict";
import {createWorld,allTiles} from "../src/game/world.js";
import {setTerrain,getBuilding} from "../src/game/tiles.js";
import {place,demolish,barrierAt,blocksMovement,watchtowers} from "../src/game/buildings.js";
import {findPath,canWalk,makeWorker,stepWorkers} from "../src/game/workers.js";
import {stepConstruction} from "../src/game/construction.js";
import {neighbors} from "../src/game/hex.js";
import {claimTile} from "../src/game/territory.js";
import {rabbitPen,stockRabbitPen,stepRabbitPens} from "../src/game/pens.js";
import {stepAnimals} from "../src/game/animals.js";
import {stepWatchtowers} from "../src/game/towers.js";
import {stepRaiders} from "../src/game/rivals.js";
import {foundCamp,requestTrade,stepCaravans} from "../src/game/rivalcamp.js";
import {encodeSave,decodeSave} from "../src/game/persistence.js";
function valley(){const w=createWorld(23,{width:24,height:16});for(const t of allTiles(w)){setTerrain(w,t.q,t.r,"grass");claimTile(w,t.q,t.r);}place(w,0,0,"base");w.store={food:1000,wood:1000,stone:1000,herbs:100,seeds:20};w.valleySettled=true;w.nextRaidDay=9999;w.autoRepair=false;w.autoForage=false;return w;}
function build(w,q,r,id){const b=place(w,q,r,id);assert.ok(b.ok,b.reason);for(let i=0;i<48;i++)stepConstruction(w);return b.building;}
function ring(w,q,r){for(const n of neighbors(q,r))build(w,n.q,n.r,"fence");}
function raider(q,r){return {id:1,q,r,health:100,state:"incoming",home:{q:7,r:0},target:{q:0,r:0,want:"food"},path:null,stuck:0};}

test("workers detour around walls and fences; completed gates only admit friendly traffic",()=>{
 const w=valley();build(w,1,0,"wall");build(w,1,-1,"fence");
 const path=findPath(w,{q:0,r:0},{q:3,r:0});assert.ok(path);assert.ok(path.every(n=>!blocksMovement(w,n.q,n.r)));
 assert.equal(canWalk(w,1,0),false);assert.equal(canWalk(w,1,-1),false);
 build(w,2,0,"gate");assert.equal(canWalk(w,2,0),true);assert.equal(canWalk(w,2,0,"hostile"),false);assert.equal(blocksMovement(w,2,0,"animal"),true);
 assert.equal(place(w,7,3,"gate").ok,false);
});
test("sealed enclosures need a gate for workers and new barriers invalidate existing travel",()=>{
 const w=valley();const worker=makeWorker(w,0,0);worker.state="returning";worker.target={q:3,r:0};worker.path=[{q:1,r:0},{q:2,r:0},{q:3,r:0}];worker.moveBank=10;
 ring(w,0,0);stepWorkers(w,()=>0.5);assert.equal(worker.q,0);assert.equal(worker.r,0);assert.equal(findPath(w,w.home,{q:3,r:0}),null);
 demolish(w,1,0);build(w,1,0,"gate");assert.ok(findPath(w,w.home,{q:3,r:0}));assert.equal(findPath(w,{q:3,r:0},w.home,3000,"hostile"),null);
});
test("rivals route around a wall even with an outdated path",()=>{
 const w=valley();build(w,1,0,"wall");const r=raider(3,0);r.path=[{q:2,r:0},{q:1,r:0},{q:0,r:0}];w.raiders=[r];stepRaiders(w,()=>0.5);
 assert.equal(getBuilding(w,1,0).breach||0,0);assert.ok(!(r.q===1&&r.r===0));
});
test("mounting a tower preserves its wall and waits for construction before shooting",()=>{
 const w=valley();build(w,1,0,"wall");const result=place(w,1,0,"watchtower");assert.ok(result.ok);assert.equal(result.building.id,"wallTower");assert.ok(barrierAt(w,1,0));assert.equal(watchtowers(w).length,0);assert.equal(place(w,1,0,"watchtower").ok,false);
 const saved=decodeSave(encodeSave(w)).world;for(let i=0;i<48;i++)stepConstruction(saved);assert.equal(watchtowers(saved)[0].range,9);assert.ok(barrierAt(saved,1,0));
});
test("lookouts detect distant movement, fire only in range and preserve cooldown through saving",()=>{
 const w=valley();build(w,1,0,"watchtower");const r=raider(7,0);w.raiders=[r];assert.ok(stepWatchtowers(w).some(e=>e.type==="towerSpotted"));assert.equal(r.health,100);
 r.q=4;assert.ok(stepWatchtowers(w).some(e=>e.type==="towerShot"));assert.equal(r.health,88);stepWatchtowers(w);assert.equal(r.health,88);
 const loaded=decodeSave(encodeSave(w)).world;stepWatchtowers(loaded);assert.equal(loaded.raiders[0].health,88);loaded.hour+=6;stepWatchtowers(loaded);assert.equal(loaded.raiders[0].health,76);
 loaded.hour+=6;loaded.raiders[0].state="leaving";stepWatchtowers(loaded);assert.equal(loaded.raiders[0].health,76);
});
test("tower kills recover stolen goods and count a defended raid",()=>{
 const w=valley();build(w,1,0,"watchtower");const r=raider(3,0);r.health=12;r.carrying={goods:{wood:7}};w.raiders=[r];w.store.wood=100;const before=w.store.wood;stepWatchtowers(w);assert.equal(w.raiders.length,0);assert.equal(w.store.wood,before+7);assert.equal(w.raidsSurvived,1);
});
test("rabbit pens require a closed fence, consume feed, breed to local capacity and release on breach",()=>{
 const w=valley();assert.equal(stockRabbitPen(w,3,0).ok,false);ring(w,3,0);assert.equal(rabbitPen(w,3,0).capacity,4);assert.ok(stockRabbitPen(w,3,0).ok);assert.equal(w.store.food,980);
 for(let day=2;day<=20;day++){w.day=day;stepRabbitPens(w);stepAnimals(w,()=>1);}
 const pen=rabbitPen(w,3,0);assert.equal(pen.rabbits.filter(a=>a.pen).length,4);assert.ok(pen.rabbits.every(a=>a.q===3&&a.r===0));assert.equal(stockRabbitPen(w,3,0).ok,false);
 const restored=decodeSave(encodeSave(w)).world;assert.equal(rabbitPen(restored,3,0).rabbits.length,4);getBuilding(restored,4,0).condition=10;assert.ok(stepRabbitPens(restored).some(e=>e.type==="penOpened"));assert.ok(restored.animals.filter(a=>a.q===3&&a.r===0).every(a=>!a.pen&&!a.tamed));
});
test("unfed breeding pairs do not create rabbits in winter, when the pen has nothing to graze",()=>{const w=valley();ring(w,3,0);stockRabbitPen(w,3,0);w.day=76;w.store.food=0;stepRabbitPens(w);assert.equal(rabbitPen(w,3,0).rabbits.length,2);});
test("traders use the gate and carry a route animation without crossing a wall",()=>{
 const w=valley();w.store.food=100;ring(w,0,0);demolish(w,1,0);build(w,1,0,"gate");const camp=foundCamp(w,"settler",{q:7,r:0});assert.ok(camp);for(const b of camp.buildings)b.construction=null;camp.buildings.push({id:"market",q:7,r:1,condition:100});
 assert.ok(requestTrade(w,camp.id,"stone","food",100).ok);let entered=false;
 for(let i=0;i<8 && !w.tradesCompleted;i++){stepCaravans(w,()=>1);for(const cart of w.caravans){assert.ok((cart.trail||[]).every(n=>!blocksMovement(w,n.q,n.r)));if((cart.trail||[]).some(n=>n.q===1&&n.r===0))entered=true;}}
 assert.equal(w.tradesCompleted,1);assert.ok(entered);
});

test("malformed saved enclosure anchors and cart routes are rejected",()=>{
 const w=valley();w.animals=[{id:1,q:0,r:0,species:"rabbit",pen:{}}];assert.throws(()=>decodeSave(encodeSave(w)),/animal/);
 w.animals=[];w.caravans=[{id:1,q:0,r:0,trail:[{q:NaN,r:0}]}];assert.throws(()=>decodeSave(encodeSave(w)),/route/);
});
