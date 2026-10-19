/**
 * The sky: a gradient dome, a sun, a moon, and stars.
 *
 * Replaces `<color attach="background">`, which was a flat dark fill and the
 * reason the board looked like it was floating in a void.
 *
 * WHY A HAND-WRITTEN GRADIENT rather than an atmospheric-scattering sky:
 * scattering models are built for daylight and have nothing to say about
 * night, so they cannot carry a full day/night cycle on their own. A vertical
 * gradient between three colours can, it costs nothing, and — since the
 * colours come from daytime.js — every one of them is chosen by code that is
 * unit-tested in Node.
 *
 * Nothing here uses React state. The clock moves every frame, so the sky is
 * updated by mutating uniforms in useFrame; putting it in state would
 * re-render the whole app sixty times a second.
 */
import { useRef, useMemo, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import { hash2 } from "../game/noise.js";

/** Big enough to sit outside everything, inside the camera's far plane. */
const DOME_RADIUS = 380;
const STAR_COUNT = 700;

const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // Direction from the centre of the dome to this vertex. The dome is
    // centred on the camera, so this is simply the view direction.
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform float uExponent;
  varying vec3 vDir;

  void main() {
    float h = vDir.y;
    vec3 col = h > 0.0
      ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), uExponent))
      : mix(uHorizon, uGround, pow(clamp(-h, 0.0, 1.0), uExponent * 1.6));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * Stars on a fixed hemisphere.
 *
 * Positions are hashed rather than Math.random so the constellations are the
 * same every session — the same reasoning as the terrain. A sky that
 * reshuffles itself on reload feels wrong in a way people notice without
 * being able to say why.
 */
function useStarGeometry() {
  return useMemo(() => {
    const positions = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);

    for (let i = 0; i < STAR_COUNT; i++) {
      const u = hash2(1337, i, 0);
      const v = hash2(1337, i, 1);
      const theta = u * Math.PI * 2;
      // Bias towards the upper dome: stars on the horizon are mostly hidden
      // by the land anyway, and crowding them there looks like noise.
      const phi = Math.acos(1 - v * 0.92);
      const r = DOME_RADIUS * 0.94;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      sizes[i] = 1 + hash2(1337, i, 2) * 2.2;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    return geom;
  }, []);
}

/**
 * The sky. Exposes an imperative `apply(sky, sunDir)` so the one place that
 * reads the clock each frame can push everything at once.
 */
const Sky = forwardRef(function Sky(_props, ref) {
  const domeRef = useRef(null);
  const starsRef = useRef(null);
  const sunRef = useRef(null);
  const moonRef = useRef(null);
  const sunMatRef = useRef(null);
  const moonMatRef = useRef(null);
  const groupRef = useRef(null);

  const starGeometry = useStarGeometry();

  const uniforms = useMemo(
    () => ({
      uTop: { value: new THREE.Color("#4A8AD6") },
      uHorizon: { value: new THREE.Color("#B2D6F0") },
      uGround: { value: new THREE.Color("#606468") },
      uExponent: { value: 0.85 },
    }),
    []
  );

  useImperativeHandle(ref, () => ({
    /**
     * Push one frame's worth of sky. `sky` is whatever skyAt() returned;
     * `sunDir` is the unit vector from sunDirection().
     */
    apply(sky, sunDir, cameraPosition) {
      uniforms.uTop.value.setRGB(sky.top[0], sky.top[1], sky.top[2]);
      uniforms.uHorizon.value.setRGB(sky.horizon[0], sky.horizon[1], sky.horizon[2]);
      uniforms.uGround.value.setRGB(sky.ground[0], sky.ground[1], sky.ground[2]);

      // Keep the dome centred on the camera so you can never reach its edge.
      if (groupRef.current && cameraPosition) {
        groupRef.current.position.set(cameraPosition.x, 0, cameraPosition.z);
      }

      if (starsRef.current) {
        starsRef.current.material.opacity = sky.starOpacity;
        starsRef.current.visible = sky.starOpacity > 0.01;
      }

      const D = DOME_RADIUS * 0.88;
      if (sunRef.current && sunMatRef.current) {
        sunRef.current.position.set(sunDir[0] * D, sunDir[1] * D, sunDir[2] * D);
        sunMatRef.current.opacity = sky.sunDiscOpacity;
        sunMatRef.current.color.setRGB(sky.sunColor[0], sky.sunColor[1], sky.sunColor[2]);
        sunRef.current.visible = sky.sunDiscOpacity > 0.01;
      }
      // The moon is the anti-sun: opposite side of the sky, so it rises as
      // the sun sets without needing an orbit of its own.
      if (moonRef.current && moonMatRef.current) {
        moonRef.current.position.set(-sunDir[0] * D, -sunDir[1] * D, -sunDir[2] * D);
        moonMatRef.current.opacity = sky.moonDiscOpacity * 0.9;
        moonRef.current.visible = sky.moonDiscOpacity > 0.01;
      }
    },
  }), [uniforms]);

  return (
    <group ref={groupRef}>
      <mesh ref={domeRef} renderOrder={-1000} frustumCulled={false}>
        <sphereGeometry args={[DOME_RADIUS, 32, 16]} />
        <shaderMaterial
          vertexShader={VERTEX}
          fragmentShader={FRAGMENT}
          uniforms={uniforms}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
        />
      </mesh>

      <points ref={starsRef} geometry={starGeometry} frustumCulled={false}>
        <pointsMaterial
          size={2.4}
          sizeAttenuation={false}
          color="#DCE6FF"
          transparent
          opacity={0}
          depthWrite={false}
          fog={false}
        />
      </points>

      <mesh ref={sunRef} frustumCulled={false}>
        <sphereGeometry args={[13, 16, 12]} />
        <meshBasicMaterial
          ref={sunMatRef}
          color="#FFF8E8"
          transparent
          opacity={0}
          depthWrite={false}
          fog={false}
        />
      </mesh>

      <mesh ref={moonRef} frustumCulled={false}>
        <sphereGeometry args={[8, 16, 12]} />
        <meshBasicMaterial
          ref={moonMatRef}
          color="#E8EEFF"
          transparent
          opacity={0}
          depthWrite={false}
          fog={false}
        />
      </mesh>
    </group>
  );
});

export default Sky;
