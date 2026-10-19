import { makeVisualClock, stepVisualClock } from "../src/scene/visualClock.js";
import { executeCampAction } from "../src/game/campAI.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, allTiles } from "../src/game/world.js";
import { place, protectedStores, stableCapacity, barrierAt, countBuildings } from "../src/game/buildings.js";
import { upgradeBase, baseHouses, baseUnlocks } from "../src/game/base.js";
import { advanceHour, advanceHours, SECONDS_PER_DAY } from "../src/game/tick.js";
import { setTerrain } from "../src/game/tiles.js";
import { claimTile } from "../src/game/territory.js";
import { foundCamp, campIncome, campHousing, stepCamps } from "../src/game/rivalcamp.js";
import { BUILD_HOURS, UPGRADE_HOURS, constructionHours, operational, stepConstruction } from "../src/game/construction.js";
import { encodeSave, decodeSave, catchUp } from "../src/game/persistence.js";
import { lampFor } from "../src/scene/buildingLook.js";

function site() {
  const w = createWorld(23, {width:40,height:28});
  for (const t of allTiles(w)) setTerrain(w,t.q,t.r,"grass");
  w.store = {food:20,wood:10000,stone:10000,herbs:0,seeds:10};
  w.autoForage=false; w.autoRepair=false; w.valleySettled=true; w.nextRaidDay=99999;
  return w;
}
function finishHours(w,n) { for(let h=0;h<n;h++) stepConstruction(w); }

test("territory scaling is shared, gradual and bounded for early buildings",()=>{
  for(const id of ["farm","woodcutter","wall"]) {
    for(const [size,hours] of [[19,6],[20,8],[29,8],[30,10],[109,24],[500,48]]) {
      const holding={claims:new Map(Array.from({length:size},(_,i)=>[String(i),1]))};
      assert.equal(constructionHours(id,holding),hours);
    }
  }
  assert.equal(constructionHours("base",{claims:new Map()}),0);
  assert.equal(constructionHours("granary",{claims:new Map()}),48);
});

test("expanding territory preserves active durations and scaled projects survive reload",()=>{
  const w=site();place(w,0,0,"base");
  const early=place(w,1,0,"farm").building;
  assert.equal(early.construction.needed,6);
  for(const t of allTiles(w))claimTile(w,t.q,t.r);
  const late=place(w,0,1,"farm").building;
  assert.equal(late.construction.needed,48);
  assert.equal(early.construction.needed,6);
  finishHours(w,2);
  const restored=decodeSave(encodeSave(w)).world;
  const projects=[...restored.modified.values()].filter(t=>t.building?.id==="farm").map(t=>t.building.construction);
  assert.deepEqual(projects.map(c=>c.needed).sort((a,b)=>a-b),[6,48]);
  assert.ok(projects.every(c=>c.done===2));
});

test("120 seconds is the fixed day length and old faster saves are migrated",()=>{
  assert.equal(SECONDS_PER_DAY,120);
  const saved=decodeSave(encodeSave(site(),{running:true,offline:true,secondsPerDay:6},1000));
  assert.equal(saved.settings.secondsPerDay,120);
  assert.equal(catchUp(saved,121_000).hoursRun,24);
});

test("initial base is instant, becomes home and prevents duplicate founding",()=>{
  const w=site(); const result=place(w,0,0,"base");
  assert.ok(result.ok); assert.equal(result.hours,0);
  assert.deepEqual(w.home,{q:0,r:0});
  assert.equal(countBuildings(w,"base"),1);
  assert.equal(place(w,1,0,"base").ok,false);
  assert.equal(result.building.construction,null);
  assert.equal(operational(result.building),true);
  assert.ok(place(w,1,0,"farm").ok);
});

test("farms do not produce until their final construction hour",()=>{
  const w=site();place(w,0,0,"base");finishHours(w,12);
  const farm=place(w,1,0,"farm");
  const before=w.store.food;
  advanceHours(w,farm.hours-1);
  assert.equal(w.store.food,before);assert.equal(countBuildings(w,"farm"),0);
  assert.equal(lampFor(farm.building),null);
  advanceHour(w);
  assert.equal(w.store.food,before+1);assert.equal(countBuildings(w,"farm"),1);
});

test("unfinished storage, stables and barriers do not grant benefits",()=>{
  const w=site();place(w,0,0,"base");finishHours(w,12);
  place(w,1,0,"granary");place(w,0,1,"paddock");place(w,-1,0,"wall");
  assert.equal(protectedStores(w).food || 0,0);assert.equal(stableCapacity(w),0);assert.equal(barrierAt(w,-1,0),null);
  finishHours(w,48);
  assert.equal(protectedStores(w).food,150);assert.equal(stableCapacity(w),3);assert.ok(barrierAt(w,-1,0));
});

test("base upgrades pay once and unlock only after completion, including reload",()=>{
  const w=site();place(w,0,0,"base");finishHours(w,12);w.store.food=1000;
  const result=upgradeBase(w);const paid=w.store.wood;
  assert.ok(result.ok);assert.equal(w.baseLevel,1);assert.equal(baseHouses(w),4);assert.equal(baseUnlocks(w,"craft"),false);
  assert.equal(upgradeBase(w).ok,false);assert.equal(w.store.wood,paid);
  finishHours(w,17);
  const restored=decodeSave(encodeSave(w)).world;
  finishHours(restored,30);assert.equal(restored.baseLevel,1);
  finishHours(restored,1);assert.equal(restored.baseLevel,2);assert.equal(baseHouses(restored),7);assert.ok(baseUnlocks(restored,"craft"));
});

for (const kind of ["settler","raider"]) test(`${kind} buildings use the same construction durations`,()=>{
  const w=site();const camp=foundCamp(w,kind,{q:8,r:0});
  const headquarters=camp.buildings.find(b=>b.id==="camp");
  const farm=camp.buildings.find(b=>b.id==="farm");
  assert.ok(farm,"founders can build in their own territory");
  assert.equal(headquarters.construction.needed,BUILD_HOURS.camp);
  assert.equal(farm.construction.needed,constructionHours("farm",camp));
  assert.equal(campHousing(camp),0);assert.equal(campIncome(camp),0);
  finishHours(w,5);assert.equal(campIncome(camp),0);
  finishHours(w,7);assert.ok(campHousing(camp)>0);assert.ok(campIncome(camp)>0);
  finishHours(w,12);assert.ok(campIncome(camp)>0);
});

for(const kind of ["settler","raider"]) test(`${kind} upgrades also wait before changing level`,()=>{
  const w=site();const camp=foundCamp(w,kind,{q:8,r:0});finishHours(w,24);
  for(let i=0;i<4;i++)camp.buildings.push({id:"hut",q:9,r:i,condition:100});
  camp.store.food=500; camp.store.wood=90;
  const main=camp.buildings.find(b=>b.id==="camp");
  executeCampAction(w,camp,{type:"UPGRADE",at:main,level:2,reason:"Test upgrade",score:52});
  assert.equal(camp.store.wood,0);assert.equal(camp.store.food,455);
  assert.equal(main.construction.needed,UPGRADE_HOURS[2]);assert.equal(camp.level,1);
  finishHours(w,47);assert.equal(camp.level,1);
  finishHours(w,1);assert.equal(camp.level,2);
});

test("a destroyed construction site cannot finish or grant its upgrade",()=>{
  const w=site();place(w,0,0,"base");finishHours(w,12);
  const b=place(w,1,0,"farm").building;b.condition=0;
  finishHours(w,48);assert.equal(b.construction.done,0);assert.equal(countBuildings(w,"farm"),0);
});

 test("old saves restore the placed home and finish initial founding without skipping upgrades",()=>{
  const w=site(); const result=place(w,3,2,"base");
  assert.ok(result.ok);
  w.home={q:0,r:0};
  result.building.construction={kind:"build",done:3,needed:12,targetLevel:null};
  const restored=decodeSave(encodeSave(w)).world;
  assert.deepEqual(restored.home,{q:3,r:2});
  assert.equal([...restored.modified.values()].find(t=>t.building?.id==="base").building.construction,null);
  restored.store.food=1000;
  assert.ok(upgradeBase(restored).ok);
  finishHours(restored,5);
  const again=decodeSave(encodeSave(restored)).world;
  assert.deepEqual(again.home,{q:3,r:2});
  assert.equal([...again.modified.values()].find(t=>t.building?.id==="base").building.construction.done,5);
});


test("early farms take 30 real seconds for players, settlers and raiders",()=>{
  const w=site();place(w,0,0,"base");
  const farms=[place(w,1,0,"farm").building];
  for(const {kind,q} of [{kind:"settler",q:8},{kind:"raider",q:-8}]) {
    const camp=foundCamp(w,kind,{q,r:0});
    farms.push(camp.buildings.find(b=>b.id==="farm"));
  }
  const clock=makeVisualClock(w.day,w.hour);
  const frame=running=>{
    const ticks=stepVisualClock(clock,0.25,SECONDS_PER_DAY,w.day,w.hour,running);
    for(let i=0;i<ticks;i++)advanceHour(w);
  };
  for(let i=0;i<60;i++)frame(true); // Fifteen seconds is half an early farm build.
  for(const farm of farms)assert.equal(farm.construction.done,3);
  for(let i=0;i<80;i++)frame(false);
  for(const farm of farms)assert.equal(farm.construction.done,3,"pause freezes construction");
  for(let i=0;i<59;i++)frame(true);
  for(const farm of farms)assert.ok(farm.construction,"not done before 30 seconds");
  frame(true);
  for(const farm of farms)assert.equal(farm.construction,null);
});
