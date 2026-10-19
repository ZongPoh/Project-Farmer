import Part from "./ModelPart.jsx";

export default function PersonModel({person, color, mounted = false, hostile = false}) {
  const skin=["#c8936c","#a87350","#dfb491"][Math.abs(Number(person.id) || person.campId || 0)%3];
  const tool=hostile?"spear":person.tool;
  return <group position={[0,mounted?0.58:0,0]}>
    {[-1,1].map(s=><group key={s}>
      <Part color="#514c43" position={[s*(mounted?0.16:0.055),0.13,0]} scale={[0.08,0.24,0.09]} rotation={mounted?[0,0,s*0.3]:[0,0,0]}/>
      <Part color="#3d342b" position={[s*(mounted?0.19:0.055),0.035,0.035]} scale={[0.095,0.07,0.15]}/>
      <Part color={color} position={[s*0.14,0.33,0]} scale={[0.07,0.24,0.09]} rotation={[0,0,s*0.15]}/>
      <Part shape="round" color={skin} position={[s*0.155,0.205,0.01]} scale={[0.08,0.09,0.085]}/>
    </group>)}
    <Part color={color} position={[0,0.33,0]} scale={[0.22,0.26,0.14]}/>
    <Part color="#675038" position={[0,0.235,0]} scale={[0.23,0.045,0.15]}/>
    <Part shape="round" color={skin} position={[0,0.53,0.015]} scale={[0.19,0.2,0.19]}/>
    <Part shape="round" color="#6a4832" position={[0,0.61,0]} scale={[0.195,0.085,0.19]}/>
    {[-0.04,0.04].map(x=><Part key={x} color="#302e29" position={[x,0.54,0.101]} scale={[0.018,0.02,0.01]}/>)}
    {hostile ? <><Part shape="round" color="#686f70" position={[0,0.625,0]} scale={[0.23,0.15,0.23]}/><Part color="#833f36" position={[0,0.56,-0.11]} scale={[0.15,0.18,0.045]}/></> : <><Part shape="log" color="#c6aa6b" position={[0,0.635,0]} scale={[0.31,0.025,0.3]}/><Part shape="log" color="#bc9c5d" position={[0,0.68,0]} scale={[0.19,0.075,0.18]}/></>}
    {(person.state==="foraging" || person.carrying) && <Part color="#a68250" position={[0,0.34,-0.14]} scale={[0.2,0.22,0.15]}/>}
    {tool && <group position={[0.2,0.32,0.06]} rotation={[0,0,-0.2]}>
      <Part color="#947447" position={[0,0.02,0]} scale={[0.025,tool==="spear"?0.7:0.43,0.025]}/>
      {tool==="spear" ? <Part shape="cone" color="#b3bab6" position={[0,0.45,0]} scale={[0.07,0.2,0.055]}/> : <Part color="#98a4a3" position={[tool==="axe"?0.05:0,0.24,0]} scale={tool==="pick"?[0.23,0.045,0.06]:tool==="spade"?[0.11,0.14,0.035]:[0.14,0.1,0.04]}/>}
    </group>}
  </group>;
}
