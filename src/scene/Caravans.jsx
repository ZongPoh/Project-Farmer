import PersonModel from "./PersonModel.jsx";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { hexToWorld } from "../game/hex.js";
import { getTerrain } from "../game/tiles.js";
import { TERRAIN } from "../game/terrain.js";
import { TILE_SIZE } from "./InstancedTiles.jsx";

function Cart({ caravan, world, running }) {
  const node=useRef(null), wheels=useRef(null), motion=useRef({stamp:"",points:[],index:0,placed:false});
  useFrame((_,delta)=>{
    const m=motion.current, el=node.current;
    if(!el)return;
    const point=at=>{const p=hexToWorld(at.q,at.r,TILE_SIZE);return {x:p.x,z:p.z,y:(TERRAIN[getTerrain(world,at.q,at.r)]?.height||0)+0.05};};
    const stamp=JSON.stringify(caravan.trail||[{q:caravan.q,r:caravan.r}]);
    if(stamp!==m.stamp) {
      m.stamp=stamp;m.points=(caravan.trail||[{q:caravan.q,r:caravan.r}]).map(point);m.index=1;
      const start=m.points[0];el.position.set(start.x,start.y,start.z);m.placed=true;
    }
    if(!running || m.index>=m.points.length)return;
    const to=m.points[m.index], dx=to.x-el.position.x,dz=to.z-el.position.z,gap=Math.hypot(dx,dz),step=Math.min(gap,delta*0.65);
    if(gap<0.025){el.position.set(to.x,to.y,to.z);m.index++;return;}
    el.rotation.y=Math.atan2(dx,dz);el.position.x+=dx/gap*step;el.position.z+=dz/gap*step;el.position.y+=(to.y-el.position.y)*Math.min(1,delta*4);
    if(wheels.current) for(const wheel of wheels.current.children) wheel.rotation.x+=step*8;
  });
  return <group ref={node}>
    <mesh position={[0,0.22,0]} castShadow><boxGeometry args={[0.48,0.17,0.65]}/><meshStandardMaterial color="#927047"/></mesh>
    <group ref={wheels}>{[-0.28,0.28].flatMap(x=>[-0.2,0.2].map(z=><group key={`${x},${z}`} position={[x,0.13,z]}><mesh rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[0.13,0.13,0.06,10]}/><meshStandardMaterial color="#302c2a"/></mesh></group>))}</group>
    {[-0.12,0.12].map(x=><mesh key={x} position={[x,0.4,0]} castShadow><boxGeometry args={[0.2,0.23,0.3]}/><meshStandardMaterial color={caravan.state==="coming"?"#83b5db":"#d4ae68"}/></mesh>)}
    <group position={[0,0,0.57]} scale={0.8}><PersonModel person={{id:caravan.id}} color="#8ec8c0"/></group>
  </group>;
}
export default function Caravans({world,tiles,running}) {
  const visible=new Set(tiles.map(t=>`${t.q},${t.r}`));
  return <group>{(world.caravans||[]).filter(c=>visible.has(`${c.q},${c.r}`)||(c.trail||[]).some(t=>visible.has(`${t.q},${t.r}`))).map(c=><Cart key={c.id} caravan={c} world={world} running={running}/>)}</group>;
}
