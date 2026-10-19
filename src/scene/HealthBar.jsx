import { Billboard } from "@react-three/drei";

/** Unlit, camera-facing bars remain readable at night and while units turn. */
export default function HealthBar({ health, max = 100, height = 1, hostile = false }) {
  const fraction = Math.max(0, Math.min(1, health / max));
  const width = 0.62;
  return <Billboard position={[0, height, 0]}>
    <mesh renderOrder={20}>
      <planeGeometry args={[width + 0.05, 0.105]} />
      <meshBasicMaterial color="#17202b" depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
    {fraction > 0 && <mesh position={[-width * (1 - fraction) / 2, 0, 0.001]} renderOrder={21}>
      <planeGeometry args={[width * fraction, 0.065]} />
      <meshBasicMaterial color={fraction < 0.3 ? "#f27563" : hostile ? "#f0a06f" : "#83dca5"} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>}
  </Billboard>;
}
