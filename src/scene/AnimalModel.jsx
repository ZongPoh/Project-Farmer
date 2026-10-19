import Part from "./ModelPart.jsx";

/** Faces +Z; feet rest at zero so motion follows terrain without floating. */
export default function AnimalModel({ animal }) {
  if (animal.species === "rabbit") return <group>
    <Part shape="round" color="#d9cbb5" position={[0,0.14,0]} scale={[0.27,0.27,0.35]} />
    <Part shape="round" color="#eee0cc" position={[0,0.23,0.17]} scale={[0.21,0.21,0.21]} />
    {[-1,1].map(side=><group key={side}>
      <Part shape="round" color="#d9cbb5" position={[side*0.055,0.42,0.14]} scale={[0.068,0.32,0.075]} rotation={[0,0,-side*0.15]} />
      <Part color="#bc8b86" position={[side*0.055,0.43,0.18]} scale={[0.024,0.18,0.012]} rotation={[0,0,-side*0.15]} />
      <Part shape="round" color="#292b2b" position={[side*0.083,0.26,0.23]} scale={[0.025,0.03,0.025]} />
      <Part shape="round" color="#eee0cc" position={[side*0.095,0.04,0.09]} scale={[0.09,0.07,0.2]} />
    </group>)}
    <Part shape="round" color="#faf0dc" position={[0,0.17,-0.18]} scale={[0.12,0.12,0.12]} />
    <Part shape="round" color="#bd8d88" position={[0,0.21,0.275]} scale={[0.04,0.035,0.035]} />
  </group>;
  if (animal.species === "fox") return <group>
    <Part shape="round" color="#b95726" position={[0,0.22,0]} scale={[0.27,0.29,0.49]} />
    <Part shape="round" color="#dc7835" position={[0,0.32,0.27]} scale={[0.24,0.25,0.29]} />
    <Part shape="cone" color="#f1d8b5" position={[0,0.27,0.43]} scale={[0.16,0.24,0.15]} rotation={[Math.PI/2,0,0]} />
    <Part shape="round" color="#292722" position={[0,0.27,0.55]} scale={[0.055,0.05,0.06]} />
    {[-1,1].map(side=><group key={side}>
      <Part shape="cone" color="#a44925" position={[side*0.09,0.5,0.24]} scale={[0.13,0.22,0.13]} />
      <Part shape="cone" color="#322720" position={[side*0.09,0.52,0.28]} scale={[0.065,0.1,0.025]} />
      <Part shape="round" color="#222923" position={[side*0.105,0.35,0.365]} scale={[0.03,0.035,0.025]} />
      {[-0.15,0.16].map(z=><Part key={z} color="#443027" position={[side*0.09,0.08,z]} scale={[0.065,0.16,0.07]} />)}
    </group>)}
    <Part shape="round" color="#c96c30" position={[0.04,0.24,-0.39]} scale={[0.21,0.22,0.47]} rotation={[0,-0.2,0]} />
    <Part shape="round" color="#f2dec0" position={[0.085,0.26,-0.59]} scale={[0.16,0.17,0.22]} rotation={[0,-0.2,0]} />
  </group>;
  const coat = animal.id % 2 ? "#8d5c3f" : "#b78b62";
  return <group>
    <Part shape="round" color={coat} position={[0,0.48,0]} scale={[0.4,0.47,0.73]} />
    <Part shape="round" color={coat} position={[0,0.75,0.27]} scale={[0.27,0.6,0.29]} rotation={[-0.35,0,0]} />
    <Part shape="round" color={coat} position={[0,1.02,0.38]} scale={[0.24,0.27,0.42]} />
    <Part shape="round" color="#d0b196" position={[0,0.96,0.57]} scale={[0.23,0.19,0.18]} />
    <Part color="#382a25" position={[0,0.82,0.15]} scale={[0.1,0.47,0.09]} rotation={[-0.35,0,0]} />
    <Part color="#382a25" position={[0,0.42,-0.43]} scale={[0.12,0.52,0.12]} rotation={[-0.3,0,0]} />
    {[-1,1].map(side=><group key={side}>
      <Part shape="cone" color={coat} position={[side*0.085,1.22,0.29]} scale={[0.085,0.22,0.1]} />
      <Part shape="round" color="#201e1d" position={[side*0.113,1.045,0.44]} scale={[0.028,0.034,0.035]} />
      {[-0.24,0.24].map(z=><group key={z}>
        <Part color={coat} position={[side*0.14,0.22,z]} scale={[0.09,0.43,0.1]} />
        <Part color="#342c2a" position={[side*0.14,0.045,z+0.025]} scale={[0.12,0.09,0.15]} />
      </group>)}
    </group>)}
    {animal.tamed && <group>
      <Part color="#344e65" position={[0,0.7,0]} scale={[0.43,0.08,0.36]} />
      <Part color="#70472e" position={[0,0.77,0]} scale={[0.27,0.08,0.26]} />
      <Part color="#d9b65e" position={[0,0.95,0.53]} scale={[0.247,0.035,0.035]} />
    </group>}
  </group>;
}
