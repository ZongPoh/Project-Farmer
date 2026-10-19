import ConstructionSite from "./ConstructionSite.jsx";
import PersonModel from "./PersonModel.jsx";
import SettlementModel, { SETTLEMENT_MODELS } from "./SettlementModel.jsx";
import ProductionBuilding from "./ProductionBuilding.jsx";
import { neighbors, hexToWorld } from "../game/hex.js";
import { getBuilding } from "../game/tiles.js";
import { TILE_SIZE } from "./InstancedTiles.jsx";
/**
 * What a building looks like on the board. (Step 3)
 *
 * Deliberately primitives — cones, boxes, cylinders. Readable shapes you can
 * tell apart at a glance beat imported models at this stage, and they cost
 * nothing. Swap in real geometry much later, once the game is worth looking at.
 */
import { lookFor, healthOf } from "./buildingLook.js";

export { lookFor, FALLBACK_LOOK, LOOK } from "./buildingLook.js";

export default function Building({ building, y, world = null, tile = { q: 0, r: 0 } }) {
  const look = lookFor(building);
  // Nothing here any more — the building was demolished or replaced.
  if (!look) return null;

  if (["wall", "fence", "gate", "wallTower"].includes(building.id) && (!building.construction || building.id === "wallTower")) {
    const fence=building.id === "fence", gate=building.id === "gate", tower=building.id === "wallTower";
    const center=hexToWorld(tile.q,tile.r,TILE_SIZE);
    const links=neighbors(tile.q,tile.r).filter(n=>["wall","gate","wallTower","fence"].includes(world ? getBuilding(world,n.q,n.r)?.id : null)).map(n=>{const p=hexToWorld(n.q,n.r,TILE_SIZE);return {x:p.x-center.x,z:p.z-center.z};});
    const color=building.condition<=15 ? "#4b4541" : fence ? "#92704b" : "#8e929a";
    return <group position={[0,y,0]}>
      {links.map((n,i)=><group key={i} position={[n.x/4 + (gate ? n.x/Math.hypot(n.x,n.z)*0.25 : 0),0,n.z/4 + (gate ? n.z/Math.hypot(n.x,n.z)*0.25 : 0)]} rotation={[0,Math.atan2(n.x,n.z),0]}>
        <mesh position={[0,fence?0.24:0.3,0]} castShadow><boxGeometry args={[fence?0.08:0.24,fence?0.09:0.6,Math.max(0.1,Math.hypot(n.x,n.z)/2-(gate?0.5:0))]} /><meshStandardMaterial color={color}/></mesh>
        {fence && <mesh position={[0,0.43,0]}><boxGeometry args={[0.08,0.07,Math.max(0.1,Math.hypot(n.x,n.z)/2-(gate?0.5:0))]}/><meshStandardMaterial color={color}/></mesh>}
      </group>)}
      {gate ? <group rotation={[0,links.length ? Math.atan2(links[0].x,links[0].z) : 0,0]}>
        {[-0.4,0.4].map(z=><mesh key={z} position={[0,0.42,z]} castShadow><boxGeometry args={[0.4,0.84,0.2]}/><meshStandardMaterial color={color}/></mesh>)}
        <mesh position={[0,0.87,0]} castShadow><boxGeometry args={[0.4,0.16,1]}/><meshStandardMaterial color={color}/></mesh>
        <mesh position={[0,0.69,0]}><boxGeometry args={[0.09,0.16,0.65]}/><meshStandardMaterial color="#69ba85"/></mesh>
      </group> : <mesh position={[0,fence?0.27:0.3,0]} castShadow><cylinderGeometry args={[fence?0.08:0.48,fence?0.1:0.53,fence?0.54:0.6,6]}/><meshStandardMaterial color={color}/></mesh>}
      {tower && <group position={[0,0.6,0]}>
        <mesh position={[0,0.45,0]} castShadow><boxGeometry args={[0.43,0.9,0.43]}/><meshStandardMaterial color="#8e929a" wireframe={!!building.construction}/></mesh>
        <mesh position={[0,0.97,0]} castShadow><boxGeometry args={[0.8,0.16,0.8]}/><meshStandardMaterial color="#c1b291"/></mesh>
        {[-0.3,0.3].map(x=><mesh key={x} position={[x,1.13,0]}><boxGeometry args={[0.13,0.25,0.8]}/><meshStandardMaterial color="#8e929a"/></mesh>)}
        {!building.construction && <group position={[0,1.05,0]} scale={0.65}><PersonModel person={{id:0,tool:"spear"}} color="#b6a166"/></group>}
      </group>}
    </group>;
  }

  if (building.construction?.kind === "build") {
    return <group position={[0,y,0]}><ConstructionSite building={building}/></group>;
  }

  // A neglected building visibly sags and dulls, so you can spot disrepair
  // from the camera without opening the panel.
  const health = healthOf(building);
  const scale = 0.55 + 0.45 * health;
  if (["house", "warehouse"].includes(building.id)) return <group position={[0,y,0]}><SettlementModel building={{...building, id: building.id === "house" ? "hut" : "store"}} health={health} level={1}/></group>;
  if (SETTLEMENT_MODELS.includes(building.id)) return <group position={[0,y,0]}><SettlementModel building={building} health={health} level={world?.baseLevel || 1}/></group>;
  if (["farm", "woodcutter"].includes(building.id)) return <group position={[0,y,0]}><ProductionBuilding building={building} health={health} day={world?.day || 1}/></group>;

  // A wall is not a hut: low, wide and squat, so a line of them reads as a
  // barrier from above rather than as a row of sheds. It also ignores
  // `scale` — walls do not decay, so there is nothing to sag.
  if (look.shape === "wall") {
    return (
      <mesh position={[0, y + 0.11, 0]} castShadow>
        <cylinderGeometry args={[0.86, 0.9, 0.22, 6]} />
        <meshStandardMaterial color={look.color} roughness={0.95} />
      </mesh>
    );
  }

  if (look.shape === "ring") {
    return (
      <mesh position={[0, y + 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.78, 0.05, 6, 6]} />
        <meshStandardMaterial color={look.color} roughness={0.9} />
      </mesh>
    );
  }

  return (
    <group position={[0, y, 0]}>
      {look.shape === "tower" && <group position={[0,1.1 * scale,0]}><mesh><boxGeometry args={[0.6,0.12,0.6]}/><meshStandardMaterial color="#bba47a"/></mesh><group position={[0,0.06,0]} scale={0.65}><PersonModel person={{id:0,tool:"spear"}} color="#b6a166"/></group></group>}
      <mesh position={[0, ((look.shape === "tower" ? 1.1 : 0.42) * scale) / 2, 0]} castShadow>
        {look.shape === "cone" && <coneGeometry args={[0.34, 0.42 * scale, 6]} />}
        {look.shape === "box" && (
          <boxGeometry args={[0.46, 0.42 * scale, 0.46]} />
        )}
        {look.shape === "cylinder" && (
          <cylinderGeometry args={[0.22, 0.26, 0.42 * scale, 10]} />
        )}
        {/* Tall and narrow, so it stands out against everything else on the
            board — which is the point of a thing whose job is to see. */}
        {look.shape === "tower" && (
          <cylinderGeometry args={[0.16, 0.24, 1.1 * scale, 6]} />
        )}
        <meshStandardMaterial
          color={look.color}
          roughness={0.7}
          // Fades toward grey as it falls apart.
          emissive={look.color}
          emissiveIntensity={0.12 * health}
        />
      </mesh>
    </group>
  );
}
