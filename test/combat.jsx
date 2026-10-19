/// <reference types="vite/client" />
// Isolated UI check: never reads or writes player saves.
import React, {useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import Board from "../src/scene/Board.jsx";
import CombatStatus from "../src/ui/CombatStatus.jsx";
import {createWorld,allTiles} from "../src/game/world.js";
import {setTerrain} from "../src/game/tiles.js";
import {makeWorker} from "../src/game/workers.js";
import {foundCamp} from "../src/game/rivalcamp.js";
import {makeVisualClock} from "../src/scene/visualClock.js";
import {SECONDS_PER_DAY} from "../src/game/tick.js";
import "../src/styles.css";
const world=createWorld(23,{width:24,height:16});
for(const t of allTiles(world))setTerrain(world,t.q,t.r,"grass");
world.hour=12;world.animals=[];
const camp=foundCamp(world,"raider",{q:3,r:0});
camp.buildings.forEach(b=>{b.construction=null;b.condition=65;});
const worker=makeWorker(world,2,0);worker.health=65;worker.state="storming";worker.marching={...camp.home,campId:camp.id};
world.raiders=[{id:1,campId:camp.id,q:0,r:0,health:24,state:"incoming",carrying:null}];
function Check(){
  const clock=useRef(makeVisualClock(1,12));const [focus,setFocus]=useState({q:1,r:0});
  return <div className="map-area" style={{height:"100vh"}}><Board world={world} revision={0} selected={null} onSelect={()=>{}} clockRef={clock} running={false} secondsPerDay={SECONDS_PER_DAY} onHourEnd={()=>{}} focusAt={focus}/><CombatStatus world={world} onFocus={at=>setFocus({q:at.q,r:at.r})}/></div>;
}
const root=createRoot(document.getElementById("root"));root.render(<Check/>);
if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount());
