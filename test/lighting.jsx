import {SECONDS_PER_DAY} from "../src/game/tick.js";
/// <reference types="vite/client" />
// A dense settlement lighting check, isolated from player saves.
import React,{useRef} from "react";
import {createRoot} from "react-dom/client";
import Board from "../src/scene/Board.jsx";
import {makeVisualClock} from "../src/scene/visualClock.js";
import {createWorld,allTiles} from "../src/game/world.js";
import {setTerrain} from "../src/game/tiles.js";
import {claimTile} from "../src/game/territory.js";
import {place} from "../src/game/buildings.js";
import {distance} from "../src/game/hex.js";
const world=createWorld(23,{width:24,height:16});world.hour=0;
world.store={food:10000,wood:10000,stone:10000,seeds:100,herbs:100};
for(const t of allTiles(world))if(distance(t,{q:0,r:0})<=7){setTerrain(world,t.q,t.r,"grass");claimTile(world,t.q,t.r);}
place(world,0,0,"base");world.baseLevel=3;
let i=0;
for(const t of allTiles(world)) {
 const d=distance(t,{q:0,r:0});if(d===0||d>6)continue;
 const id=d===6?(i++%4===0?"watchtower":"wall"):["farm","woodcutter","granary","infirmary","paddock","well"][i++%6];
 if(id==="woodcutter")setTerrain(world,t.q,t.r,"forest");if(id==="well")setTerrain(world,t.q,t.r,"sand");
 const result=place(world,t.q,t.r,id);if(result.ok)result.building.construction=null;
}
const focus={q:0,r:0};
function Check(){const clock=useRef(makeVisualClock(1,0));return <><div style={{font:"14px sans-serif",padding:12,background:"#182331",color:"#dee4e8"}}>Midnight · dense settlement · soft lanterns and readable moonlit terrain</div><div style={{height:"calc(100vh - 42px)"}}><Board world={world} revision={0} selected={null} onSelect={()=>{}} clockRef={clock} running={false} secondsPerDay={SECONDS_PER_DAY} onHourEnd={()=>{}} focusAt={focus}/></div></>;}
const root=createRoot(document.getElementById("root"));root.render(<Check/>);
if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount());
