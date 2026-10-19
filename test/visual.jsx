/// <reference types="vite/client" />
// Isolated visual smoke scene. It never reads or writes player saves.
import React, {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {Canvas} from "@react-three/fiber";
import {OrbitControls} from "@react-three/drei";
import AnimalModel from "../src/scene/AnimalModel.jsx";
import Building from "../src/scene/Building.jsx";
import Caravans from "../src/scene/Caravans.jsx";
import TowerShots from "../src/scene/TowerShots.jsx";
import {createWorld,allTiles} from "../src/game/world.js";
import {setTerrain,getTile} from "../src/game/tiles.js";
import {claimTile} from "../src/game/territory.js";
import {place} from "../src/game/buildings.js";
import {hexToWorld} from "../src/game/hex.js";
import {TERRAIN} from "../src/game/terrain.js";
import {stepWatchtowers} from "../src/game/towers.js";
const world=createWorld(1,{width:12,height:10});
for(const t of allTiles(world)){setTerrain(world,t.q,t.r,"grass");claimTile(world,t.q,t.r);}
world.store={wood:10000,stone:10000,food:1000,herbs:0,seeds:0};
function build(q,r,id){const res=place(world,q,r,id);if(!res.ok)throw Error(res.reason);res.building.construction=null;}
build(-3,0,"base");build(-1,0,"wall");build(0,0,"gate");build(1,0,"wall");build(1,0,"watchtower");build(-1,2,"fence");build(0,2,"fence");build(1,2,"fence");build(3,0,"watchtower");
build(-3,2,"farm");setTerrain(world,3,2,"forest");build(3,2,"woodcutter");
world.raiders=[{id:1,q:3,r:-2,health:1000,state:"incoming"}];
world.caravans=[{id:1,q:-2,r:-1,state:"coming",trail:[{q:-2,r:1},{q:-2,r:0},{q:-2,r:-1}]}];
const tiles=[...allTiles(world)];
function Scene(){const [tick,setTick]=useState(0);useEffect(()=>{const timer=setInterval(()=>{world.hour+=6;world.raiders[0].health=1000;stepWatchtowers(world);const c=world.caravans[0];c.trail=[...c.trail].reverse();Object.assign(c,c.trail.at(-1));setTick(t=>t+1);},7000);return()=>clearInterval(timer);},[]);
return <><div style={{background:"#172132",color:"white",padding:14,fontFamily:"sans-serif"}}>Visual check: farms, woodcutters, rabbit, fox, horse and fortifications · cycle {tick}</div><Canvas style={{height:"calc(100vh - 48px)",background:"#bdcfdb"}} camera={{position:[8,12,15],fov:45}}><ambientLight intensity={1.2}/><directionalLight position={[5,12,8]} intensity={2}/>{tiles.map(t=>{const p=hexToWorld(t.q,t.r,1);return <group key={`${t.q},${t.r}`} position={[p.x,0,p.z]}><mesh position={[0,0.1,0]}><cylinderGeometry args={[0.96,0.96,0.2,6]}/><meshStandardMaterial color="#799261"/></mesh>{t.building&&<Building world={world} tile={t} building={t.building} y={TERRAIN.grass.height}/>}</group>})}<group position={[-2,0.2,6]} rotation={[0,0.4,0]} scale={1.5}><AnimalModel animal={{id:1,species:"rabbit",tamed:false}}/></group><group position={[0,0.2,6]} rotation={[0,0.4,0]} scale={1.5}><AnimalModel animal={{id:2,species:"fox",tamed:false}}/></group><group position={[2.5,0.2,6]} rotation={[0,0.4,0]}><AnimalModel animal={{id:3,species:"horse",tamed:true}}/></group><Caravans world={world} tiles={tiles} running={true}/><TowerShots world={world} tiles={tiles} running={true}/><OrbitControls/></Canvas></>;
}
const root=createRoot(document.getElementById("root"));
root.render(<Scene/>);
if(import.meta.hot) import.meta.hot.dispose(()=>root.unmount());
