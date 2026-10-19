import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { hexToWorld } from "../game/hex.js";
import { TERRAIN } from "../game/terrain.js";
import { getTerrain } from "../game/tiles.js";
import { TILE_SIZE } from "./InstancedTiles.jsx";
function Arrow({tile,world,running}) {
  const node=useRef(null), phase=useRef({at:tile.building.lastShot?.at,age:2});
  useFrame((_,delta)=>{
    const shot=tile.building.lastShot, m=phase.current, el=node.current;
    if(!el || !shot)return;
    if(shot.at!==m.at){m.at=shot.at;m.age=0;}
    if(running)m.age+=delta;
    el.visible=m.age<1;
    if(!el.visible)return;
    const start=hexToWorld(tile.q,tile.r,TILE_SIZE),end=hexToWorld(shot.q,shot.r,TILE_SIZE),t=m.age;
    const sy=TERRAIN[tile.terrain].height+1.5,ey=(TERRAIN[getTerrain(world,shot.q,shot.r)]?.height||0)+0.2;
    el.position.set(start.x+(end.x-start.x)*t,sy+(ey-sy)*t+Math.sin(t*Math.PI),start.z+(end.z-start.z)*t);
    el.rotation.y=Math.atan2(end.x-start.x,end.z-start.z);
  });
  return <mesh ref={node} visible={false}><boxGeometry args={[0.04,0.04,0.35]}/><meshBasicMaterial color="#ffe29a"/></mesh>;
}
export default function TowerShots({world,tiles,running}) {
  const visible = new Set(tiles.map(t => `${t.q},${t.r}`));
  const towers = [...tiles.filter(t=>["watchtower","wallTower"].includes(t.building?.id)),
    ...(world.camps || []).flatMap(c => c.buildings.filter(b => b.id === "watchtower" && visible.has(`${b.q},${b.r}`))
      .map(b => ({ q: b.q, r: b.r, terrain: getTerrain(world,b.q,b.r), building: b })))];
  return <group>{towers.map(t=><Arrow key={`${t.q},${t.r}`} tile={t} world={world} running={running}/>)}</group>;
}
