import Part from "./ModelPart.jsx";
import ProductionBuilding from "./ProductionBuilding.jsx";

export const SETTLEMENT_MODELS = ["base", "quarryCamp", "well", "granary", "infirmary", "paddock", "camp", "hut", "store", "market", "workshop"];
function Roof({color = "#695346", width = 0.85, depth = 0.8}) {
  return <group>{[-1,1].map(s=><Part key={s} color={color} position={[s*width/4,0.12,0]} scale={[width*0.6,0.07,depth]} rotation={[0,0,-s*0.5]}/>)}</group>;
}
function House({roof, wall = "#c6b48f"}) {
  return <group>
    <Part color={wall} position={[0,0.27,0]} scale={[0.7,0.54,0.62]}/>
    {[-0.31,0.31].map(x=><Part key={x} color="#70553e" position={[x,0.28,0.32]} scale={[0.055,0.56,0.04]}/>)}
    <Part color="#473c30" position={[0,0.17,0.32]} scale={[0.22,0.34,0.025]}/>
    <Part color="#b4d4ce" position={[-0.22,0.34,0.33]} scale={[0.1,0.12,0.03]}/>
    <group position={[0,0.53,0]}><Roof color={roof}/></group>
  </group>;
}
function Barrel({at}) {return <group position={at}><Part shape="log" color="#997347" position={[0,0.14,0]} scale={[0.23,0.28,0.23]}/>{[0.06,0.22].map(y=><Part key={y} shape="log" color="#555452" position={[0,y,0]} scale={[0.24,0.035,0.24]}/>)}</group>;}
function Tent({color}) {return <group>
  {[-1,1].map(s=><Part key={s} color={color} position={[s*0.22,0.28,0]} scale={[0.72,0.045,0.65]} rotation={[0,0,-s*0.82]}/>)}
  <Part color="#584431" position={[0,0.3,0.33]} scale={[0.035,0.6,0.035]}/>
  <Part color="#584431" position={[0,0.3,-0.33]} scale={[0.035,0.6,0.035]}/>
</group>;}
export default function SettlementModel({building, health = 1, level = 1, kind = "player", day = 1}) {
  const id=building.id, accent=kind === "raider" ? "#873e38" : kind === "settler" ? "#4f718b" : "#697c65";
  return <group scale={[1,0.65+health*0.35,1]}>
    {kind !== "player" && <group position={[-0.58,0,0]}><Part color="#66503b" position={[0,0.5,0]} scale={[0.035,1,0.035]}/><Part color={accent} position={[0.13,0.87,0]} scale={[0.28,0.18,0.025]}/></group>}
    {(id === "base" || id === "camp") && <>
      {level===1 ? <group position={[-0.15,0,-0.12]}><Tent color={kind==="player"?"#ddc489":accent}/></group> : <House roof={accent} wall={level>=4?"#a5a6a0":"#c6b48f"}/>}
      <group position={[0.36,0,0.39]}>{Array.from({length:6},(_,i)=>{const a=i*Math.PI/3;return <Part key={i} shape="round" color="#858782" position={[Math.cos(a)*0.14,0.05,Math.sin(a)*0.14]} scale={[0.1,0.1,0.1]}/>;})}<Part shape="cone" color="#df9b42" position={[0,0.12,0]} scale={[0.13,0.2,0.13]}/></group>
      <Barrel at={[-0.48,0,0.38]}/>
      {level>=3 && <group position={[-0.48,0,-0.2]} scale={0.6}><House roof={accent}/></group>}
      {level>=5 && <><Part color="#949993" position={[0.39,0.63,-0.21]} scale={[0.25,1.26,0.3]}/><Part shape="cone" color={accent} position={[0.39,1.35,-0.21]} scale={[0.44,0.3,0.44]}/></>}
    </>}
    {id === "well" && <>
      <Part shape="log" color="#385d72" position={[0,0.045,0]} scale={[0.5,0.07,0.5]}/>
      {Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return <Part key={i} color="#a4aaa6" position={[Math.cos(a)*0.3,0.17,Math.sin(a)*0.3]} scale={[0.22,0.34,0.14]} rotation={[0,-a+Math.PI/2,0]}/>;})}
      {[-0.42,0.42].map(x=><Part key={x} color="#7b603d" position={[x,0.45,0]} scale={[0.07,0.9,0.07]}/>)}
      <group position={[0,0.89,0]}><Roof color="#527b7e" depth={0.67}/></group>
      <Part shape="log" color="#7b603d" position={[0,0.6,0]} scale={[0.07,0.91,0.07]} rotation={[0,0,Math.PI/2]}/>
      <Part color="#b6a077" position={[0,0.37,0]} scale={[0.018,0.44,0.018]}/>
      <Part shape="log" color="#8d6a45" position={[0.45,0.09,0.34]} scale={[0.16,0.18,0.16]}/>
    </>}
    {(id === "granary" || id === "store") && <>
      {[-0.3,0.3].flatMap(x=>[-0.25,0.25].map(z=><Part key={`${x},${z}`} color="#74736b" position={[x,0.11,z]} scale={[0.13,0.22,0.13]}/>))}
      <group position={[0,0.2,0]}><House roof={id==="store"?accent:"#aa8248"} wall="#a48a60"/></group>
      <Barrel at={[-0.48,0,0.4]}/><Barrel at={[-0.3,0,0.53]}/>
      <Part color="#b9a682" position={[0,0.12,0.49]} scale={[0.25,0.08,0.4]} rotation={[-0.38,0,0]}/>
      <Part shape="log" color="#c8b893" position={[0.46,0.38,-0.18]} scale={[0.26,0.76,0.26]}/>
      <Part shape="cone" color="#786548" position={[0.46,0.83,-0.18]} scale={[0.32,0.18,0.32]}/>
    </>}
    {id === "infirmary" && <>
      <House roof="#547d73" wall="#e0ded0"/>
      <Part color="#e7e2ce" position={[0.3,0.45,0.36]} scale={[0.23,0.24,0.04]}/>
      <Part color="#4b8972" position={[0.3,0.45,0.387]} scale={[0.05,0.16,0.018]}/>
      <Part color="#4b8972" position={[0.3,0.45,0.39]} scale={[0.16,0.05,0.018]}/>
      <Part color="#a8865e" position={[-0.42,0.13,0.33]} scale={[0.13,0.13,0.55]}/>
      {[-0.15,0.1,0.35].map(z=><Part key={z} shape="round" color="#78985e" position={[0.48,0.12,z]} scale={[0.18,0.2,0.17]}/>)}
    </>}
    {id === "paddock" && <>
      {[-0.62,0.62].flatMap(x=>[-0.52,0,0.52].map(z=><Part key={`${x},${z}`} color="#957248" position={[x,0.2,z]} scale={[0.06,0.4,0.06]}/>))}
      {[-0.62,0.62].flatMap(x=>[0.13,0.3].map(y=><Part key={`${x},${y}`} color="#a78a5b" position={[x,y,0]} scale={[0.04,0.05,1.1]}/>))}
      {[0.13,0.3].map(y=><Part key={y} color="#a78a5b" position={[0,y,-0.52]} scale={[1.25,0.05,0.04]}/>)}
      <group position={[-0.27,0,-0.23]} scale={0.58}><House roof="#6d7250" wall="#9b8057"/></group>
      <Part color="#6a6552" position={[0.31,0.09,0.34]} scale={[0.43,0.18,0.2]}/><Part color="#6b9eae" position={[0.31,0.185,0.34]} scale={[0.35,0.015,0.13]}/>
      <Part color="#c4ab59" position={[0.31,0.16,-0.21]} scale={[0.28,0.32,0.3]}/>
    </>}
    {id === "quarryCamp" && <>
      <Part color="#9a9588" position={[0,0.025,0]} scale={[1.1,0.05,0.9]}/>
      {[-0.31,0.31].map(x=><Part key={x} color="#7b6141" position={[x,0.45,-0.2]} scale={[0.08,0.95,0.08]} rotation={[0,0,x>0?0.18:-0.18]}/>)}
      <Part color="#7b6141" position={[0,0.93,-0.2]} scale={[0.85,0.1,0.12]}/>
      <Part color="#393e3c" position={[0,0.62,-0.2]} scale={[0.02,0.57,0.02]}/>
      <Part color="#726c60" position={[0,0.32,-0.2]} scale={[0.25,0.13,0.28]}/>
      {[-0.31,-0.12,0.08,0.28].map((x,i)=><Part key={x} shape="round" color={i%2?"#a9aca6":"#808c8b"} position={[x,0.12,0.3]} scale={[0.24,0.2+i*0.04,0.25]}/>)}
      <Part color="#675541" position={[0.43,0.14,0.07]} scale={[0.31,0.24,0.36]}/>
      {[-0.11,0.25].map(z=><Part key={z} shape="log" color="#343b3c" position={[0.43,0.08,z]} scale={[0.13,0.36,0.13]} rotation={[0,0,Math.PI/2]}/>)}
    </>}
    {id === "hut" && <><House roof={accent}/><Part color="#8c8d87" position={[-0.2,0.75,-0.2]} scale={[0.14,0.55,0.14]}/><Part color="#8c734c" position={[0.35,0.1,0.45]} scale={[0.4,0.15,0.17]}/></>}
    {id === "market" && <>
      {[-0.45,0.45].flatMap(x=>[-0.3,0.3].map(z=><Part key={`${x},${z}`} color="#84643e" position={[x,0.36,z]} scale={[0.045,0.72,0.045]}/>))}
      {[-0.36,-0.18,0,0.18,0.36].map((x,i)=><Part key={x} color={i%2?"#e2d4b0":accent} position={[x,0.73,0]} scale={[0.18,0.045,0.82]} rotation={[0.12,0,0]}/>)}
      <Part color="#956e44" position={[0,0.23,0.19]} scale={[0.89,0.45,0.22]}/>
      {[-0.28,0,0.28].map((x,i)=><Part key={x} shape="round" color={["#c5a34d","#91aa61","#be7750"][i]} position={[x,0.5,0.18]} scale={[0.18,0.12,0.17]}/>)}
      <Barrel at={[-0.38,0,-0.4]}/>
    </>}
    {id === "workshop" && <>
      <group position={[-0.22,0,-0.15]} scale={0.8}><House roof={accent} wall="#a59579"/></group>
      <Part color="#7e837f" position={[0.4,0.34,-0.12]} scale={[0.28,0.68,0.36]}/>
      <Part color="#3e3932" position={[0.4,0.16,0.065]} scale={[0.17,0.2,0.02]}/><Part shape="cone" color="#e7a04d" position={[0.4,0.13,0.085]} scale={[0.1,0.14,0.04]}/>
      <Part color="#7b817e" position={[0.4,0.86,-0.16]} scale={[0.15,0.45,0.17]}/>
      <Part color="#665442" position={[0,0.15,0.47]} scale={[0.23,0.3,0.2]}/><Part color="#555e61" position={[0,0.32,0.47]} scale={[0.4,0.1,0.18]}/>
    </>}
    {id === "farm" && <ProductionBuilding building={building} health={health} day={day}/>}
  </group>;
}
