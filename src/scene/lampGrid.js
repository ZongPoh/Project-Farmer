import * as THREE from "three";

export const LAMP_CELL_SIZE = 4;

/** Spatial lists contain every lamp whose reach overlaps a cell; no light cap. */
export function buildLampGrid(lamps) {
  if (!lamps.length) return { origin: [0, 0], width: 1, height: 1, cells: new Float32Array(4), records: new Float32Array(4) };
  const bounds = lamps.map(l => ({ l,
    x0: Math.floor((l.x-l.lamp.distance)/LAMP_CELL_SIZE), x1: Math.floor((l.x+l.lamp.distance)/LAMP_CELL_SIZE),
    z0: Math.floor((l.z-l.lamp.distance)/LAMP_CELL_SIZE), z1: Math.floor((l.z+l.lamp.distance)/LAMP_CELL_SIZE),
  }));
  const x0=Math.min(...bounds.map(b=>b.x0)), z0=Math.min(...bounds.map(b=>b.z0));
  const width=Math.max(...bounds.map(b=>b.x1))-x0+1, height=Math.max(...bounds.map(b=>b.z1))-z0+1;
  const lists=Array.from({length:width*height},()=>[]);
  for(const b of bounds) for(let z=b.z0;z<=b.z1;z++) for(let x=b.x0;x<=b.x1;x++) lists[(z-z0)*width+x-x0].push(b.l);
  const cells=new Float32Array(width*height*4), records=[];
  const color=new THREE.Color();
  lists.forEach((list,i)=>{
    cells[i*4]=records.length/4; cells[i*4+1]=list.length;
    for(const l of list){
      color.set(l.lamp.color).multiplyScalar(l.lamp.intensity);
      records.push(l.x,l.y,l.z,l.lamp.distance,color.r,color.g,color.b,0);
    }
  });
  return {origin:[x0*LAMP_CELL_SIZE,z0*LAMP_CELL_SIZE],width,height,cells,records:new Float32Array(records)};
}

/** Pack records across rows, staying within the device's texture width. */
export function lampTexture(data, maxSize) {
  const count=Math.max(1,data.length/4), width=Math.min(count,maxSize), height=Math.ceil(count/width);
  if(height>maxSize) throw new Error("Visible lamp data exceeds texture capacity.");
  const padded=new Float32Array(width*height*4); padded.set(data);
  const texture=new THREE.DataTexture(padded,width,height,THREE.RGBAFormat,THREE.FloatType);
  texture.needsUpdate=true;
  return texture;
}

const declarations=`
varying vec3 vLampWorld;
uniform sampler2D settlementCells;
uniform sampler2D settlementLamps;
uniform vec2 settlementOrigin;
uniform vec2 settlementGridSize;
uniform float settlementNight;
vec4 settlementRead(sampler2D tex, int index) {
  int width = textureSize(tex, 0).x;
  return texelFetch(tex, ivec2(index % width, index / width), 0);
}
`;

const illumination=`
#if defined(RE_Direct)
if (settlementNight > 0.001) {
  ivec2 cell = ivec2(floor((vLampWorld.xz - settlementOrigin) / ${LAMP_CELL_SIZE.toFixed(1)}));
  if (cell.x >= 0 && cell.y >= 0 && cell.x < int(settlementGridSize.x) && cell.y < int(settlementGridSize.y)) {
    vec4 entry = settlementRead(settlementCells, cell.y * int(settlementGridSize.x) + cell.x);
    for (int lampIndex = 0; lampIndex < int(entry.y); lampIndex++) {
      int record = int(entry.x) + lampIndex * 2;
      vec4 lamp = settlementRead(settlementLamps, record);
      vec3 offset = (viewMatrix * vec4(lamp.xyz, 1.0)).xyz - geometryPosition;
      float lampDistance = length(offset);
      if (lampDistance < lamp.w) {
        IncidentLight lantern;
        lantern.direction = offset / max(lampDistance, 0.0001);
        lantern.color = settlementRead(settlementLamps, record + 1).rgb * settlementNight
          * getDistanceAttenuation(lampDistance, lamp.w, 2.0);
        lantern.visible = true;
        RE_Direct(lantern, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
      }
    }
  }
}
#endif
`;

/** Reuse Three's surface lighting, including normals/roughness and tone mapping. */
export function installLampShader(material, uniforms) {
  const previous=material.onBeforeCompile, previousKey=material.customProgramCacheKey;
  material.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer);
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader="varying vec3 vLampWorld;\n"+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace("#include <worldpos_vertex>",`#include <worldpos_vertex>
      vec4 lampWorld = vec4(transformed, 1.0);
      #ifdef USE_BATCHING
        lampWorld = batchingMatrix * lampWorld;
      #endif
      #ifdef USE_INSTANCING
        lampWorld = instanceMatrix * lampWorld;
      #endif
      vLampWorld = (modelMatrix * lampWorld).xyz;
    `);
    shader.fragmentShader=declarations+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace("#include <lights_fragment_end>",illumination+"\n#include <lights_fragment_end>");
  };
  material.customProgramCacheKey=()=>previousKey.call(material)+"|settlement-grid-v1";
  material.needsUpdate=true;
  return ()=>{material.onBeforeCompile=previous;material.customProgramCacheKey=previousKey;material.needsUpdate=true;};
}
