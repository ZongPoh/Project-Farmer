/// <reference types="vite/client" />
// Isolated model gallery; no player state or storage access.
import React from "react";
import {createRoot} from "react-dom/client";
import {Canvas} from "@react-three/fiber";
import {OrbitControls,Html} from "@react-three/drei";
import SettlementModel from "../src/scene/SettlementModel.jsx";
import PersonModel from "../src/scene/PersonModel.jsx";
import ConstructionSite from "../src/scene/ConstructionSite.jsx";
const entries=[
 ["base","Founding camp",1],["base","Town base",5],["quarryCamp","Quarry hoist",1],
 ["well","Well",1],["granary","Granary",1],["infirmary","Infirmary",1],
 ["paddock","Stable yard",1],["hut","Settler home",1],["store","Raider store",1],
 ["market","Market",1],["workshop","Workshop",1],["camp","Raider camp",1],
];
function Gallery(){return <><div style={{padding:12,background:"#172132",color:"white",fontFamily:"sans-serif"}}>Settlement models · workers and equipped tools · construction</div><Canvas style={{height:"calc(100vh - 44px)",background:"#bdcfdb"}} camera={{position:[9,14,17],fov:40}}><ambientLight intensity={1.3}/><directionalLight position={[5,12,8]} intensity={2}/>{entries.map(([id,label,level],i)=><group key={i} position={[(i%3-1)*3,0,(Math.floor(i/3)-1.5)*2.5]}><SettlementModel building={{id}} level={Number(level)} kind={i>=7 ? i===8||i===11?"raider":"settler":"player"}/><Html center position={[0,0,-0.9]} style={{font:"12px sans-serif",whiteSpace:"nowrap",color:"#263830"}}>{label}</Html></group>)}<group position={[-3,0,6]} scale={1.3}><PersonModel person={{id:1,tool:"axe"}} color="#aaad72"/></group><group position={[-2,0,6]} scale={1.3}><PersonModel person={{id:2,tool:"pick"}} color="#749aab"/></group><group position={[-1,0,6]} scale={1.3}><PersonModel person={{id:3,tool:"spade"}} color="#b8a66d"/></group><group position={[0,0,6]} scale={1.3}><PersonModel person={{id:4,carrying:true}} color="#974c45" hostile/></group><group position={[2,0,6]}><ConstructionSite building={{construction:{done:12,needed:24}}}/></group><OrbitControls/></Canvas></>;}
const root=createRoot(document.getElementById("root"));root.render(<Gallery/>);
if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount());
