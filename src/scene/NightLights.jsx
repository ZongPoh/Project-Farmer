/** Small warm fixtures over readable moonlight. No flat additive light discs. */
import { useMemo, useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { hexToWorld } from "../game/hex.js";
import { TERRAIN } from "../game/terrain.js";
import { TILE_SIZE } from "./InstancedTiles.jsx";
import { lampFor } from "./buildingLook.js";

import { buildLampGrid, lampTexture, installLampShader } from "./lampGrid.js";

export default function NightLights({built,nightRef}) {
  const {scene,gl}=useThree();
  const uniforms=useMemo(()=>({
    settlementCells:{value:null}, settlementLamps:{value:null},
    settlementOrigin:{value:new THREE.Vector2()}, settlementGridSize:{value:new THREE.Vector2(1,1)},
    settlementNight:{value:0},
  }),[]);
  const patched=useRef(new Map());
  const glass=useMemo(()=>new THREE.MeshStandardMaterial({color:"#aa8354",emissive:"#ffcf91",emissiveIntensity:0,roughness:0.6}),[]);
  const frame=useMemo(()=>new THREE.MeshStandardMaterial({color:"#493e32",roughness:0.85}),[]);
  const bulb=useMemo(()=>new THREE.SphereGeometry(0.029,8,6),[]);
  const cap=useMemo(()=>new THREE.CylinderGeometry(0.044,0.044,0.018,6),[]);
  useEffect(()=>()=>{glass.dispose();frame.dispose();bulb.dispose();cap.dispose();},[glass,frame,bulb,cap]);
  const lamps=useMemo(()=>built.flatMap(tile=>{
    const lamp=lampFor(tile.building);if(!lamp)return [];
    const p=hexToWorld(tile.q,tile.r,TILE_SIZE);
    return [{key:`${tile.q},${tile.r}`,x:p.x+lamp.x,z:p.z+lamp.z,y:(TERRAIN[tile.terrain]?.height||0)+lamp.height,lamp}];
  }),[built]);
  const grid=useMemo(()=>{
    const data=buildLampGrid(lamps), maxSize=gl.capabilities.maxTextureSize;
    return {...data,cellTexture:lampTexture(data.cells,maxSize),lampTexture:lampTexture(data.records,maxSize)};
  },[lamps,gl]);
  useEffect(()=>()=>{grid.cellTexture.dispose();grid.lampTexture.dispose();},[grid]);
  useEffect(()=>()=>{for(const restore of patched.current.values())restore();patched.current.clear();},[]);
  useFrame(()=>{
    const glow=nightRef?.current||0;
    glass.emissiveIntensity=1.15*glow;
    uniforms.settlementNight.value=glow;
    uniforms.settlementCells.value=grid.cellTexture;
    uniforms.settlementLamps.value=grid.lampTexture;
    uniforms.settlementOrigin.value.set(grid.origin[0],grid.origin[1]);
    uniforms.settlementGridSize.value.set(grid.width,grid.height);
    // Include newly mounted buildings, workers and instanced ground before rendering.
    scene.traverse(object=>{
      if (!(object instanceof THREE.Mesh)) return;
      const materials=Array.isArray(object.material)?object.material:[object.material];
      for(const material of materials) if(material instanceof THREE.MeshStandardMaterial && !patched.current.has(material)) {
        patched.current.set(material,installLampShader(material,uniforms));
      }
    });
  });
  return <group>
    {lamps.map(l=><group key={l.key} position={[l.x,l.y,l.z]} dispose={null}>
      <mesh geometry={bulb} material={glass}/>
      <mesh geometry={cap} material={frame} position={[0,0.043,0]}/>
      <mesh geometry={cap} material={frame} position={[0,-0.043,0]}/>
    </group>)}
  </group>;
}
