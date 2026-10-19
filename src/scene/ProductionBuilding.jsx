import Part from "./ModelPart.jsx";
import { seasonAppearance } from "./seasonAppearance.js";

function Roof({color}) {
  return <group>{[-1,1].map(side=><Part key={side} color={color} position={[side*0.17,0.5,0]} scale={[0.43,0.07,0.66]} rotation={[0,0,-side*0.55]} />)}</group>;
}
export default function ProductionBuilding({building,health,day = 1}) {
  const season = seasonAppearance(day);
  if(building.id === "farm") return <group>
    <Part color="#61472f" position={[0.12,0.025,0.22]} scale={[1.1,0.05,0.89]} />
    {[-0.28,0,0.28,0.56].map((x,row)=><group key={x}>
      <Part color="#3f3126" position={[x,0.055,0.22]} scale={[0.13,0.045,0.85]} />
      {[-0.08,0.14,0.36,0.58].map(z=><group key={z} position={[x,0.075,z]} scale={[1,0.45+health*0.55,1]}>
        <Part color="#718845" position={[0,0.1,0]} scale={[0.025,0.2,0.025]} />
        <Part shape="round" color={health<0.4 ? "#947249" : season.crop} position={[0,0.19,0]} scale={[0.12,0.17 * (1 - season.snow * 0.65),0.1]} />
      </group>)}
    </group>)}
    <group position={[-0.29,0,-0.38]} scale={[0.85,0.7+health*0.3,0.72]}>
      <Part color="#ac6845" position={[0,0.21,0]} scale={[0.57,0.42,0.55]} />
      <Part color="#543e30" position={[0,0.14,0.282]} scale={[0.2,0.28,0.018]} />
      <Part color="#d9c9a0" position={[-0.23,0.22,0.29]} scale={[0.04,0.44,0.035]} />
      <Part color="#d9c9a0" position={[0.23,0.22,0.29]} scale={[0.04,0.44,0.035]} />
      <Roof color={season.snow > 0.5 ? "#E9F1F4" : health<0.4 ? "#665b50" : "#854332"}/>
    </group>
    <Part color="#baa16c" position={[0.42,0.14,-0.35]} scale={[0.24,0.28,0.24]} />
  </group>;
  return <group>
    <Part color="#7e694d" position={[0,0.025,0]} scale={[1.1,0.05,1.1]} />
    <group position={[-0.22,0,-0.18]} scale={[1,0.7+health*0.3,1]}>
      <Part color="#795337" position={[0,0.2,0]} scale={[0.57,0.4,0.55]} />
      {[0.08,0.2,0.32].map(y=><Part key={y} color="#a47b4c" position={[0,y,0.284]} scale={[0.6,0.075,0.035]} />)}
      <Part color="#312d28" position={[0.04,0.14,0.31]} scale={[0.21,0.28,0.025]} />
      <Roof color={season.snow > 0.5 ? "#E9F1F4" : health<0.4 ? "#595750" : "#455c52"}/>
    </group>
    {[[0.36,0.11],[0.56,0.11],[0.46,0.27]].map(([x,y])=><group key={`${x},${y}`} position={[x,y,0.03]}>
      <Part shape="log" color="#775233" position={[0,0,0]} scale={[0.18,0.65,0.18]} rotation={[Math.PI/2,0,0]} />
      <Part shape="log" color="#d4b985" position={[0,0,0.331]} scale={[0.14,0.015,0.14]} rotation={[Math.PI/2,0,0]} />
    </group>)}
    <Part shape="log" color="#6b4b31" position={[-0.25,0.13,0.47]} scale={[0.29,0.26,0.29]} />
    <Part shape="log" color="#d4b985" position={[-0.25,0.265,0.47]} scale={[0.26,0.025,0.26]} />
    <group position={[-0.25,0.38,0.47]} rotation={[0,0,-0.4]}>
      <Part color="#9d7546" position={[0,0.08,0]} scale={[0.035,0.38,0.04]} />
      <Part color="#b8c1c2" position={[0.07,-0.035,0]} scale={[0.16,0.13,0.045]} />
    </group>
  </group>;
}
