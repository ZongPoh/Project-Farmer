import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, allTiles } from "../src/game/world.js";
import { place, demolish } from "../src/game/buildings.js";
import { setTerrain, getBuilding } from "../src/game/tiles.js";
import { stepConstruction } from "../src/game/construction.js";
import { advanceHour } from "../src/game/tick.js";
import { storageCapacity } from "../src/game/economy.js";
import { foundFinishedCamp, placeFinished } from "./support.mjs";
import { campCapacity, campBeds, campResidents, campDailyEconomy, campBuildCost, chooseCampAction, executeCampAction, campMerchant } from "../src/game/campAI.js";
import { assaultTarget, orderWarParty, MAX_BUILDINGS, requestTrade, stepCaravans } from "../src/game/rivalcamp.js";
import { raidEntry, launchRaid, stepRaiders, stepAssault } from "../src/game/rivals.js";
import { makeWorker, takeWarOrder, stepWorkers } from "../src/game/workers.js";
import { startCampExpedition, stepCampExpeditions } from "../src/game/campExpeditions.js";
import { encodeSave, decodeSave } from "../src/game/persistence.js";
import { distance } from "../src/game/hex.js";

function valley() {
  const w = createWorld(23, {width:40,height:28});
  for (const t of allTiles(w)) setTerrain(w,t.q,t.r,"grass");
  placeFinished(w,0,0,"base");
  w.valleySettled=true;w.nextRaidDay=999999;w.animals=[];
  w.autoForage=false;w.autoRepair=false;
  w.store={food:500,wood:200,stone:150,coins:30,herbs:0,seeds:1};
  return w;
}
const camp = (w,kind="raider",q=8) => foundFinishedCamp(w,kind,{q,r:0});
const building = (c,id,q,r=1) => { const b={id,q,r,condition:100};c.buildings.push(b);return b; };

test("warehouse placement, 48-hour completion, save reload, stacking and demolition update capacity",()=>{
  let w=valley();
  const result=place(w,1,0,"warehouse");
  assert.ok(result.ok);assert.equal(result.hours,48);
  for(let h=0;h<47;h++)advanceHour(w);
  // herbs and seeds are capped too since the resource pass; a warehouse holds
  // neither, so those two numbers stay at the base throughout.
  assert.deepEqual(storageCapacity(w),{food:600,wood:200,stone:150,herbs:120,seeds:40});
  w=decodeSave(encodeSave(w)).world;
  advanceHour(w);
  assert.deepEqual(storageCapacity(w),{food:600,wood:800,stone:600,herbs:120,seeds:40});
  assert.ok(place(w,2,0,"warehouse").ok);
  for(let h=0;h<48;h++)advanceHour(w);
  assert.deepEqual(storageCapacity(w),{food:600,wood:1400,stone:1050,herbs:120,seeds:40});
  assert.ok(demolish(w,2,0).ok);
  assert.equal(storageCapacity(w).wood,800);
  getBuilding(w,1,0).condition=0;
  assert.equal(storageCapacity(w).wood,200);
});

test("no village means no edge-spawned raid; outgoing residents are reserved and return",()=>{
  const w=valley();makeWorker(w,0,0);
  assert.equal(raidEntry(w,()=>0.5),null);
  assert.deepEqual(launchRaid(w,()=>0.5),[]);
  const c=camp(w);c.store.food=200;
  const before=c.fighters;
  assert.equal(raidEntry(w,()=>0.5).campId,c.id);
  launchRaid(w,()=>0.5);
  assert.ok(w.raiders.length);
  assert.ok(w.raiders.every(r=>r.q===c.home.q&&r.r===c.home.r&&r.campId===c.id));
  assert.equal(c.fighters+w.raiders.length,before);
  assert.equal(campResidents(w,c),before);
  const r=w.raiders[0],start={q:r.q,r:r.r};
  stepRaiders(w,()=>0.5,1);
  assert.equal(distance(start,r),1,"one hourly raider movement turn");
  for(let h=0;h<100&&w.raiders.length;h++)stepRaiders(w,()=>0.5,1);
  assert.equal(w.raiders.length,0);assert.equal(c.fighters,before);
  assert.equal(c.store.loot,0,"real stolen resources must not also be credited as duplicate abstract loot");
});

test("attack selection reserves one worker and targets defences before buildings and base",()=>{
  const w=valley(),c=camp(w);
  const tower=building(c,"watchtower",7),hut=building(c,"hut",8);
  for(let n=0;n<14;n++)makeWorker(w,0,0);
  assert.equal(orderWarParty(w,c.id,5).sending,5);
  assert.equal(w.orders.length,5);
  assert.ok(takeWarOrder(w,w.workers[0]));
  assert.deepEqual(w.workers[0].marching,{q:tower.q,r:tower.r,campId:c.id});
  assert.equal(orderWarParty(w,c.id,12).sending,7,"total party ceiling is twelve");
  assert.equal(orderWarParty(w,c.id,1).ok,false);
  tower.condition=0;
  assert.notEqual(assaultTarget(c).id,"camp");
  for(const b of c.buildings)if(b.id!=="camp")b.condition=0;
  assert.equal(assaultTarget(c).id,"camp");
  assert.ok(hut.condition===0);
});

test("headquarters cannot take damage while an outlying building stands; troops retarget it",()=>{
  const w=valley(),c=camp(w);
  const worker=makeWorker(w,c.home.q,c.home.r);
  worker.state="storming";worker.marching={...c.home,campId:c.id};worker.tool="spear";
  const headquarters=c.buildings[0],farm=c.buildings.find(b=>b.id==="farm");
  stepAssault(w,()=>0.5,1);
  assert.equal(headquarters.condition,100);assert.equal(farm.condition,100);
  stepWorkers(w,()=>0.5);
  assert.equal(worker.marching.q,farm.q);assert.equal(worker.marching.r,farm.r);
  assert.equal(worker.state,"marching");
});

test("a well-armed party progresses through a village instead of attacking from its centre",()=>{
  const w=valley(),c=camp(w);c.fighters=1;
  for(let i=0;i<5;i++){const p=makeWorker(w,0,0);p.tool="spear";}
  orderWarParty(w,c.id,4);
  const destroyed=[];
  for(let h=0;h<150 && w.camps.length;h++){
    stepWorkers(w,()=>0.5);
    for(const e of stepAssault(w,()=>0.5,1))if(e.type==="campRazed")destroyed.push(e.text);
  }
  assert.equal(w.camps.length,0);
  assert.ok(destroyed[0].includes("field"));
  assert.ok(destroyed.at(-1).includes("camp"));
});

test("NPCs pay shared construction costs, wait for completion, and respect storage and beds",()=>{
  const w=valley(),c=camp(w);
  c.store.wood=100;c.store.stone=100;
  const cost=campBuildCost("hut");
  executeCampAction(w,c,{type:"BUILD",id:"hut",at:{q:9,r:1},score:60,reason:"Housing"});
  assert.equal(c.store.wood,100-cost.wood);assert.equal(c.store.stone,100-cost.stone);
  assert.equal(campBeds(c),4);
  for(let h=0;h<24;h++)stepConstruction(w);
  assert.equal(campBeds(c),8);
  c.store.food=600;c.store.wood=200;c.store.stone=150;
  building(c,"woodcutter",9,2);building(c,"quarryCamp",10,2);
  campDailyEconomy(w,c);
  assert.equal(c.store.food,588);assert.equal(c.store.wood,200);assert.equal(c.store.stone,150);
  building(c,"store",11,2);assert.equal(campCapacity(c).wood,800);
});

test("NPC winter farms yield nothing, reserves feed residents, and shortages have consequences",()=>{
  const w=valley(),c=camp(w);w.day=73;c.store.food=300;
  for(let i=0;i<24;i++){w.day=73+i;campDailyEconomy(w,c);}
  assert.equal(c.store.food,12);assert.equal(c.fighters,2);
  c.store.food=0;
  for(let i=0;i<3;i++)campDailyEconomy(w,c);
  assert.equal(c.fighters,1);
});

test("utility decisions are legal, explained, deterministic and respond to shortages",()=>{
  const w=valley(),c=camp(w);c.store.food=200;c.store.wood=40;
  c.buildings.find(b=>b.id==="farm").condition=0;
  const sites={farm:{q:9,r:0}};
  const a=chooseCampAction(w,c,sites,false);
  assert.equal(a.type,"BUILD");assert.equal(a.id,"farm");assert.ok(a.reason);assert.ok(a.score>0);
  assert.deepEqual(a,chooseCampAction(w,c,sites,false));
  c.store.wood=0;
  assert.notEqual(chooseCampAction(w,c,sites,false).type,"BUILD");
  assert.equal(chooseCampAction(w,c,{},false).type,"WAIT");
  c.store.food=0;
  assert.equal(chooseCampAction(w,c,{},false).type,"FORAGE");
});

test("traders prefer markets and defenders prefer fortifications under the same circumstances",()=>{
  const w=valley(),c=camp(w);
  c.fighters=2;Object.assign(c.store,{food:500,wood:150,stone:100,coins:30});
  building(c,"farm",9);building(c,"woodcutter",10);building(c,"quarryCamp",11);
  const sites={market:{q:9,r:2},watchtower:{q:10,r:2}};
  c.strategy="trader";assert.equal(chooseCampAction(w,c,sites,false).id,"market");
  c.strategy="defender";assert.equal(chooseCampAction(w,c,sites,false).id,"watchtower");
});

test("NPC currency trading uses finite merchant stock and saves its weekly budget",()=>{
  const w=valley(),c=camp(w);c.store.coins=300;c.store.food=0;
  campMerchant(w,c);
  assert.equal(c.store.food,60);assert.equal(c.store.coins,120);
  campMerchant(w,c);assert.equal(c.store.food,60);
  const loaded=decodeSave(encodeSave(w)).world;
  campMerchant(loaded,loaded.camps[0]);assert.equal(loaded.camps[0].store.food,60);
  loaded.day=8;campMerchant(loaded,loaded.camps[0]);assert.equal(loaded.camps[0].store.food,100);
});

test("caravan trades conserve both settlements' resources and refuse missing NPC stock",()=>{
  const w=valley(),c=camp(w,"settler");
  building(c,"market",9);c.store.food=40;w.store.food=100;
  assert.ok(requestTrade(w,c.id,"stone","food",100).ok);
  Object.assign(w.caravans[0],w.home);
  stepCaravans(w,()=>1);
  assert.equal(w.store.food,120);assert.equal(c.store.food,20);
  assert.equal(w.store.stone,50);assert.equal(c.store.stone,100);
  w.day+=3;w.store.stone=150;c.store.food=0;
  requestTrade(w,c.id,"stone","food",100);Object.assign(w.caravans.at(-1),w.home);
  assert.ok(stepCaravans(w,()=>1).some(e=>e.type==="tradeDeclined"));
  assert.equal(w.store.stone,150);
});

test("NPC resource expeditions travel hourly, survive saves, loot actual stock and return population",()=>{
  let w=valley(),a=camp(w),b=camp(w,"settler",-8);
  a.fighters=6;b.fighters=1;b.store.food=300;
  const total=a.store.food+b.store.food;
  assert.ok(startCampExpedition(w,a));assert.equal(a.fighters,3);
  stepCampExpeditions(w);assert.equal(distance(a.home,a.expedition),1);
  w=decodeSave(encodeSave(w)).world;[a,b]=w.camps;
  for(let h=0;h<120&&a.expedition;h++)stepCampExpeditions(w);
  assert.equal(a.expedition,null);assert.equal(a.fighters,6);
  assert.ok(b.store.food<300);assert.equal(a.store.food+b.store.food,total);
  assert.equal(startCampExpedition(w,{...a,fighters:1}),false);
});

test("invalid expedition cargo, population and merchant budgets are rejected on import",()=>{
  const w=valley(),a=camp(w),b=camp(w,"settler",-8);a.fighters=6;b.store.food=300;
  assert.ok(startCampExpedition(w,a));
  for(const change of [d=>d.camps[0].expedition.cargo.food=-1,d=>d.camps[0].expedition.people=99,d=>d.camps[0].store.food=-1]){
    const data=JSON.parse(encodeSave(w));change(data.world);assert.throws(()=>decodeSave(JSON.stringify(data)),/Invalid/);
  }
});

test("1000-day villages stay bounded, survive winters and replay deterministically after loading",()=>{
  const original=createWorld(23,{width:40,height:28});
  placeFinished(original,original.home.q,original.home.r,"base");
  let replay=null;
  const actions=new Set(),strategies=new Set();
  for(let h=0;h<24000;h++){
    advanceHour(original);
    if(replay)advanceHour(replay);
    if(h===11999)replay=decodeSave(encodeSave(original)).world;
    for(const c of original.camps){
      actions.add(c.ai.action);strategies.add(c.strategy);
      assert.ok(c.buildings.filter(b=>b.condition>0).length<=MAX_BUILDINGS);
      assert.ok(c.fighters>=0&&campResidents(original,c)<=12);
      for(const [r,n]of Object.entries(c.store))assert.ok(Number.isFinite(n)&&n>=0,r);
      for(const [r,cap]of Object.entries(campCapacity(c)))assert.ok(c.store[r]<=cap+0.0001,r);
    }
  }
  assert.ok(original.camps.length>=2);
  assert.ok(actions.has("BUILD")&&actions.has("REPAIR")&&actions.has("TRADE")&&actions.has("RAID"));
  assert.deepEqual([...strategies].sort(),["defender","raider","trader"]);
  // Normalize optional legacy defaults (e.g. absent counters versus zero).
  assert.deepEqual(JSON.parse(encodeSave(decodeSave(encodeSave(original)).world,undefined,0)),JSON.parse(encodeSave(decodeSave(encodeSave(replay)).world,undefined,0)));
});
