import { placeFinished as place, foundFinishedCamp as foundCamp } from "./support.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, allTiles } from "../src/game/world.js";

import { setTerrain } from "../src/game/tiles.js";
import { makeWorker, takeWarOrder, stepWorkers } from "../src/game/workers.js";
import { orderWarParty, requestedQuote, requestTrade, stepCaravans, buildingAt } from "../src/game/rivalcamp.js";
import { stepAssault } from "../src/game/rivals.js";
import { encodeSave, decodeSave } from "../src/game/persistence.js";

function valley() {
  const w = createWorld(23, {width:40, height:28});
  for (const t of allTiles(w)) setTerrain(w, t.q, t.r, "grass");
  place(w, 0, 0, "base");
  w.autoRepair = false; w.autoForage = false;
  w.store = {food:1000,wood:1000,stone:1000,herbs:100,seeds:20};
  for (let i=0; i<6; i++) makeWorker(w, 0, 0);
  const a = foundCamp(w,"raider",{q:8,r:0});
  const b = foundCamp(w,"settler",{q:-8,r:0});
  b.buildings = b.buildings.filter(x => x.q !== -7 || x.r !== 0);
  b.buildings.push({id:"market",q:-7,r:0,condition:100});
  return {w,a,b};
}

test("simultaneous attacks never combine forces across villages", () => {
  const {w,a,b} = valley();
  for (const [worker,camp] of [[w.workers[0],a],[w.workers[1],b]]) {
    const target = camp.buildings.find(b=>b.id !== "camp");
    worker.q=target.q; worker.r=target.r;
    worker.state="storming"; worker.marching={q:target.q,r:target.r,campId:camp.id};
  }
  const before = [a,b].map(c=>c.buildings.map(x=>x.condition));
  const events=stepAssault(w,()=>0.5);
  assert.equal(events.filter(e=>e.type==="assaultRepulsed").length,2);
  assert.deepEqual([a,b].map(c=>c.buildings.map(x=>x.condition)),before);
  assert.equal(b.kind,"raider","a failed attack also ends peaceful relations");
  assert.equal(b.turnedOn,w.day);
});

test("orders reserve a worker at home, including repeat requests", () => {
  const {w,a,b} = valley();
  w.workers=w.workers.slice(0,3);
  assert.equal(orderWarParty(w,a.id,1).sending,1);
  assert.equal(orderWarParty(w,b.id,5).sending,1);
  assert.equal(orderWarParty(w,a.id,1).ok,false);
  assert.equal(orderWarParty(w,a.id,-1).ok,false);
});

test("a blocked route cannot turn a distant worker into an attacker", () => {
  const {w,a}=valley();
  orderWarParty(w,a.id,1);
  const worker=w.workers[0];
  assert.ok(takeWarOrder(w,worker));
  for (let r=-14;r<14;r++) setTerrain(w,4,r,"water");
  worker.path=null;
  stepWorkers(w,()=>0.5);
  assert.notEqual(worker.state,"storming");
  assert.equal(worker.marching,null);
});

test("requested trades use exact goods, survive saves, and honour arrival reserves", () => {
  const {w,b}=valley();
  w.store.food=100; // room for the delivery under the new storage limit
  const before=w.store.stone;
  assert.ok(requestTrade(w,b.id,"stone","food",100).ok);
  assert.equal(w.store.stone,before,"no payment until arrival");
  assert.equal(requestedQuote(w,b.id,"herbs","wood",20).ok,false,"only one incoming caravan");
  const loaded=decodeSave(encodeSave(w)).world;
  const caravan=loaded.caravans[0];
  caravan.q=loaded.home.q;caravan.r=loaded.home.r;
  stepCaravans(loaded,()=>1);
  assert.equal(loaded.store.stone,before-100);
  assert.equal(loaded.store.food,w.store.food+20);
  assert.equal(loaded.tradesCompleted,1);
  const second=valley();
  requestTrade(second.w,second.b.id,"herbs","stone",50);
  second.w.store.herbs=55;
  Object.assign(second.w.caravans[0],second.w.home);
  assert.ok(stepCaravans(second.w,()=>1).some(e=>e.type==="tradeDeclined"));
  assert.equal(second.w.store.herbs,55);
});

test("rival inspection identifies each building's actual village", () => {
  const {w,a,b}=valley();
  assert.equal(buildingAt(w,a.home.q,a.home.r).camp.id,a.id);
  assert.equal(buildingAt(w,-7,0).building.id,"market");
  assert.equal(buildingAt(w,-7,0).camp.id,b.id);
});

test("a full store cancels a caravan exchange without charging the player", () => {
  const {w,b}=valley();
  w.store.food=600;
  const stone=w.store.stone;
  assert.ok(requestTrade(w,b.id,"stone","food",100).ok);
  Object.assign(w.caravans[0],w.home);
  assert.ok(stepCaravans(w,()=>1).some(e=>e.type==="tradeDeclined"));
  assert.equal(w.store.stone,stone);
  assert.equal(w.store.food,600);
});
