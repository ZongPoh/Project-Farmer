// Isolated manual UI fixture. No localStorage, no production entry point.
import React, {useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import "../src/styles.css";
import Board from "../src/scene/Board.jsx";
import RivalPanel from "../src/ui/RivalPanel.jsx";
import CombatStatus from "../src/ui/CombatStatus.jsx";
import {RulesPanel, ReserveSummary} from "../src/ui/EconomyPanel.jsx";
import {createWorld,allTiles} from "../src/game/world.js";
import {setTerrain,getTile} from "../src/game/tiles.js";
import {placeFinished,foundFinishedCamp} from "./support.mjs";
import {makeWorker} from "../src/game/workers.js";
import {orderWarParty} from "../src/game/rivalcamp.js";
import {advanceHour} from "../src/game/tick.js";
import {makeVisualClock} from "../src/scene/visualClock.js";
const w=createWorld(23,{width:40,height:28});
for(const t of allTiles(w))setTerrain(w,t.q,t.r,"grass");
placeFinished(w,0,0,"base");w.store={food:500,wood:200,stone:150,coins:30,herbs:0,seeds:1};
placeFinished(w,1,0,"warehouse");placeFinished(w,2,0,"house");
w.valleySettled=true;w.nextRaidDay=99999;w.autoRepair=false;w.autoForage=false;w.animals=[];
for(let i=0;i<8;i++){const p=makeWorker(w,0,0);p.tool="spear";}
const c=foundFinishedCamp(w,"raider",{q:6,r:0});
c.fighters=2;c.store.food=500;c.buildings.push(
 {id:"watchtower",q:5,r:1,condition:100},
 {id:"hut",q:6,r:1,condition:100},
 {id:"store",q:7,r:1,condition:100},
 {id:"wall",q:5,r:0,condition:100},
 {id:"woodcutter",q:7,r:-1,condition:100},
);
function Preview(){
 const[revision,revise]=useState(0),[focus,setFocus]=useState({...c.home}),[rules,setRules]=useState(false),[message,setMessage]=useState("Isolated fixture: your saved game is untouched.");
 const clockRef=useRef(makeVisualClock(w.day,w.hour));
 const step=()=>{const es=advanceHour(w);setMessage(es.map(e=>e.text).join(" · ")||"One game hour passed.");revise(n=>n+1);};
 return <div style={{height:"100vh",display:"grid",gridTemplateColumns:"1fr 340px",gridTemplateRows:"48px 1fr"}}>
 <header style={{gridColumn:"1 / -1",padding:8}}><button onClick={step}>Advance one hour</button> <button onClick={()=>setRules(!rules)}>Rules / village</button> Day {w.day} · {w.hour}:00 · {message}</header>
 <main style={{position:"relative",minHeight:0}}><Board world={w} revision={revision} selected={null} onSelect={()=>{}} clockRef={clockRef} running={false} secondsPerDay={120} onHourEnd={step} focusAt={focus}/><CombatStatus world={w} onFocus={setFocus}/></main>
 <aside className="panel">{rules?<><RulesPanel/><ReserveSummary world={w}/></>:<RivalPanel world={w} tile={getTile(w,c.home.q,c.home.r)} onFocus={setFocus} onWarParty={(id,n)=>{const r=orderWarParty(w,id,n);setMessage(r.ok?`Sent ${r.sending} people.`:r.reason);revise(v=>v+1);}}/>}</aside>
 </div>;
}
createRoot(document.getElementById("root")).render(<Preview/>);
