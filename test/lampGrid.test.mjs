import test from "node:test";
import assert from "node:assert/strict";
import { buildLampGrid, LAMP_CELL_SIZE, lampTexture } from "../src/scene/lampGrid.js";
import { LAMP } from "../src/scene/buildingLook.js";

function lightsAt(grid,x,z){
  const col=Math.floor((x-grid.origin[0])/LAMP_CELL_SIZE), row=Math.floor((z-grid.origin[1])/LAMP_CELL_SIZE);
  if(col<0||row<0||col>=grid.width||row>=grid.height)return [];
  const offset=(row*grid.width+col)*4, start=grid.cells[offset], count=grid.cells[offset+1];
  return Array.from({length:count},(_,i)=>Array.from(grid.records.slice((start+i*2)*4,(start+i*2)*4+4)));
}

test("every lamp in a dense zoomed-out settlement illuminates its own area",()=>{
  const lamps=Array.from({length:400},(_,i)=>({x:(i%20)*1.73-17,y:0.7,z:Math.floor(i/20)*1.5-15,lamp:LAMP.farm}));
  const grid=buildLampGrid(lamps);
  for(const lamp of lamps) assert.ok(lightsAt(grid,lamp.x,lamp.z).some(l=>Math.abs(l[0]-lamp.x)<0.0001&&Math.abs(l[2]-lamp.z)<0.0001));
  // Spatial work stays local even when hundreds of lamps are on screen.
  assert.ok(lightsAt(grid,0,0).length<80);
});

test("overlapping lights are not truncated to eight, and reach crosses cell boundaries",()=>{
  const lamps=Array.from({length:20},(_,i)=>({x:-0.1,y:1,z:i/100,lamp:LAMP.base}));
  const grid=buildLampGrid(lamps);
  assert.equal(lightsAt(grid,0,0).length,20);
  for(const x of [-5.5,-4,0,4,5.3]) assert.equal(lightsAt(grid,x,0).length,20);
  assert.equal(lightsAt(grid,100,100).length,0);
});

test("empty settlements and multi-row texture packing preserve lookup offsets",()=>{
  assert.equal(lightsAt(buildLampGrid([]),0,0).length,0);
  const data=Float32Array.from({length:44},(_,i)=>i);
  const texture=lampTexture(data,4);
  assert.equal(texture.image.width,4);assert.equal(texture.image.height,3);
  assert.deepEqual(Array.from(texture.image.data).slice(0,44),Array.from(data));
  texture.dispose();
});
