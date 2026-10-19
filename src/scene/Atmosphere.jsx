/**
 * The one place that reads the clock each frame.
 *
 * Sky colours, sun position, light colour and intensity, and fog all come
 * from the same call to skyAt(), so they cannot drift out of step with one
 * another — the fog literally takes the horizon colour, which is what makes
 * the board dissolve into the sky instead of stopping at a visible line.
 *
 * NO REACT STATE. Everything is a ref mutation inside useFrame. Putting the
 * time of day in state would re-render the entire app on every frame, which
 * on a 400x200 board is the one thing we spent all that effort avoiding.
 *
 * This component advances the visual clock and requests `onHourEnd` for each
 * whole hour. Hidden-tab and offline catch-up are owned by useSettlement.
 * Game rules advance only through advanceHour, regardless of the clock source.
 */
import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import Sky from "./Sky.jsx";
import { skyAt, sunDirection } from "../game/daytime.js";
import { shadowPlan, SHADOW_MAP } from "./sunShadow.js";
import { stepVisualClock, visualTime, visualDay } from "./visualClock.js";

export default function Atmosphere({
  clockRef, day, hour, running, secondsPerDay, onHourEnd, nightRef, controlsRef,
}) {
  const skyRef = useRef(null);
  const sunLightRef = useRef(null);
  const moonLightRef = useRef(null);
  const ambientRef = useRef(null);
  const planRef = useRef(null);
  const fogRef = useRef(null);
  const { scene, camera } = useThree();

  // Keep the latest callback without restarting anything.
  const onHourEndRef = useRef(onHourEnd);
  onHourEndRef.current = onHourEnd;

  useEffect(() => {
    scene.fog = new THREE.Fog("#141926", 30, 90);
    fogRef.current = scene.fog;
    return () => {
      scene.fog = null;
    };
  }, [scene]);

  useFrame((_state, delta) => {
    const clock = clockRef.current;

    // The hour is REAL SIMULATION STATE, and `advanceHour` is still the only
    // thing that moves it. What the clock ref holds is the VISUAL hour, which
    // this owns and advances itself so that it never depends on React having
    // re-rendered yet — see `visualClock.js` for the flicker that caused.
    const ticks = stepVisualClock(clock, delta, secondsPerDay, day, hour, running && document.visibilityState !== "hidden");
    for (let i = 0; i < ticks; i++) {
      if (onHourEndRef.current) onHourEndRef.current();
    }

    // Both halves of the time come out of the same clock. Taking the hour from
    // here and the day from the prop is exactly the sort of split that caused
    // the flicker, even though the day boundary itself is worth only 0.00016.
    const t = visualTime(clock);
    const onDay = visualDay(clock);
    const sky = skyAt(t, onDay);
    const dir = sunDirection(t, onDay);

    if (skyRef.current) skyRef.current.apply(sky, dir, camera.position);

    if (sunLightRef.current) {
      const light = sunLightRef.current;

      // Everything about where this light stands and what its shadow covers is
      // worked out in `sunShadow.js`, which is plain JavaScript and therefore
      // has tests. All that happens here is applying the answer. See that
      // file's header for the three faults that put it there.
      const view = controlsRef && controlsRef.current ? controlsRef.current.target : null;
      const reach = Math.hypot(
        camera.position.x - (view ? view.x : 0),
        camera.position.y,
        camera.position.z - (view ? view.z : 0)
      );
      // Last frame's plan goes back in, so the frustum can refuse to move for
      // a nudge. Without it, quantising just swaps a crawl for a strobe.
      const plan = shadowPlan(dir, sky.sunIntensity, view, reach, planRef.current);
      planRef.current = plan;

      light.target.position.set(plan.target.x, plan.target.y, plan.target.z);
      // The target is not in the scene graph, so nothing else will update it.
      light.target.updateMatrixWorld();

      light.position.set(plan.position.x, plan.position.y, plan.position.z);
      light.color.setRGB(...sky.sunColor);
      light.intensity = sky.sunIntensity;
      light.castShadow = plan.castShadow;

      // Guarded because `shadow.intensity` only exists from three r166. On an
      // older build the shadow simply stays solid until the light goes out,
      // which is the behaviour before this change rather than a broken one.
      if (light.shadow.intensity !== undefined) {
        light.shadow.intensity = plan.strength;
      }

      const shadowCam = light.shadow.camera;
      if (shadowCam.right !== plan.span) {
        shadowCam.left = -plan.span;
        shadowCam.right = plan.span;
        shadowCam.top = plan.span;
        shadowCam.bottom = -plan.span;
        shadowCam.updateProjectionMatrix();
      }
    }

    if (moonLightRef.current) {
      const light = moonLightRef.current;
      // The moon is the anti-sun, so it is genuinely above the horizon exactly
      // when the sun is below it — no clamp and no special case. It casts no
      // shadows: a second shadow map for a light this dim would buy nothing
      // and cost a whole extra pass every frame.
      light.position.set(-dir[0] * 60, Math.max(-dir[1], 0.04) * 60, -dir[2] * 60 - 10);
      light.color.setRGB(...sky.moonColor);
      light.intensity = sky.moonIntensity;
    }

    if (ambientRef.current) {
      ambientRef.current.color.setRGB(...sky.ambientColor);
      ambientRef.current.intensity = sky.ambientIntensity;
    }

    if (fogRef.current) fogRef.current.color.setRGB(...sky.fog);

    // Publish how dark it is, so the lamps on the player's buildings can come
    // on without a second component reading the clock. A number in a ref, not
    // state: this changes every frame.
    if (nightRef) nightRef.current = sky.lampGlow;
  });

  return (
    <>
      <Sky ref={skyRef} />
      <ambientLight ref={ambientRef} intensity={0.55} />
      {/*
        The sun, and the only thing in the scene that casts a shadow.

        `shadow-normalBias` rather than a plain depth bias: it offsets the
        sample along the surface normal, which is what actually fixes acne on
        ground the light is hitting at a shallow angle — and shallow is the
        whole of evening. A constant bias big enough to do the same job
        detaches shadows from the things casting them.

        The camera bounds here are only a starting point; `useFrame` fits them
        to what the player can see. `far` clears a 60-unit light standing off a
        60-unit frustum with room to spare.
      */}
      <directionalLight
        ref={sunLightRef}
        position={[6, 12, 4]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[SHADOW_MAP, SHADOW_MAP]}
        shadow-normalBias={0.04}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-far={220}
      />
      {/*
        The moon. A SECOND directional light rather than the sun light moved,
        because two lights that fade independently cross over smoothly at dusk,
        where one light teleporting to the far side of the sky would swing every
        shadow through 180 degrees in a frame. It is the only light added here;
        the point-light budget in `buildingLook.js` is untouched, and this one
        casts no shadows, so it costs a loop iteration and no extra pass.
      */}
      <directionalLight ref={moonLightRef} position={[-6, 12, -4]} intensity={0} />
    </>
  );
}
