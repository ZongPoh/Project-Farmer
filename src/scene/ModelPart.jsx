import * as THREE from "three";

// Reuse geometry and palette materials across visible wildlife and buildings.
const shapes = {
  box: new THREE.BoxGeometry(1, 1, 1),
  round: new THREE.IcosahedronGeometry(0.5, 1),
  cone: new THREE.ConeGeometry(0.5, 1, 5),
  log: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
};
const palette = new Map();
export default function ModelPart({ shape = "box", color, position, scale, rotation = undefined }) {
  if (!palette.has(color)) palette.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }));
  return <mesh geometry={shapes[shape]} material={palette.get(color)} position={position} scale={scale} rotation={rotation} castShadow receiveShadow dispose={null} />;
}
