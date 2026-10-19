import Part from "./ModelPart.jsx";
export default function ConstructionSite({building}) {
  const progress=Math.min(1,building.construction.done/building.construction.needed);
  return <group>
    <Part color="#99856a" position={[0,0.03,0]} scale={[0.9,0.06,0.8]}/>
    {[-0.36,0.36].flatMap(x=>[-0.31,0.31].map(z=><Part key={`${x},${z}`} color="#b39666" position={[x,0.35,z]} scale={[0.045,0.7,0.045]}/>))}
    {[0.22,0.55].flatMap(y=>[-0.31,0.31].map(z=><Part key={`${y},${z}`} color="#b39666" position={[0,y,z]} scale={[0.78,0.045,0.045]}/>))}
    {[-0.36,0.36].map(x=><Part key={x} color="#b39666" position={[x,0.55,0]} scale={[0.045,0.045,0.66]}/>)}
    <Part color="#b4a68c" position={[0,0.08+progress*0.18,0]} scale={[0.55,0.1+progress*0.36,0.46]}/>
    <Part color="#796044" position={[0.46,0.065,0.35]} scale={[0.22,0.13,0.3]}/>
  </group>;
}
