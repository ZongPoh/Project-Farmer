/**
 * The time-of-day read-out.
 *
 * This component exists to CONTAIN A RE-RENDER. The clock lives in a ref that
 * the scene mutates every frame; if the time of day were React state, every
 * tick would re-render App, the board and the panel. Instead this polls the
 * ref a few times a second and re-renders only itself.
 *
 * Pausing freezes the simulation. There are no player time-skip controls.
 */
import { useEffect, useState } from "react";
import { clockString, phaseOf, skyAt, sunHours } from "../game/daytime.js";
import { visualTime, visualDay } from "../scene/visualClock.js";
import { seasonOf } from "../game/calendar.js";

const PHASE_LABEL = {
  night: "Night",
  dawn: "Dawn",
  morning: "Morning",
  day: "Midday",
  afternoon: "Afternoon",
  dusk: "Dusk",
};

export default function Clock({ clockRef, day, hour, running }) {
  // Read the WHOLE visual time out of the ref, not an hour from React plus a
  // fraction from the ref. Mixing the two is what made the sun jump backwards
  // an hour on every tick, and this read-out had exactly the same fault: it
  // would show 06:59 for a moment after the world had reached 07:00. See the
  // header of `visualClock.js`.
  const [now, setNow] = useState(() => ({
    t: visualTime(clockRef.current), day: visualDay(clockRef.current),
  }));
  const t = running ? now.t : ((hour || 0) % 24) / 24;
  const onDay = running ? now.day : day;

  // Four times a second is smooth enough to read and cheap enough to ignore.
  // The lighting itself updates every frame, independently of this.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(
      () => setNow({ t: visualTime(clockRef.current), day: visualDay(clockRef.current) }),
      250
    );
    return () => clearInterval(id);
  }, [running, clockRef]);

  const season = seasonOf(onDay);
  const phase = phaseOf(t, onDay);
  const sky = skyAt(t, onDay);
  const hours = sunHours(onDay);

  return (
    <span className="clock" title={`Sunrise ${clockString(hours.sunrise / 24)}, sunset ${clockString(hours.sunset / 24)}`}>
      <span
        className="orb"
        aria-hidden="true"
        style={{
          // A small disc of the current sky colour: the fastest way to see
          // at a glance whether it is the middle of the night.
          background: `rgb(${sky.horizon.map((c) => Math.round(c * 255)).join(",")})`,
          boxShadow: `0 0 8px rgba(${sky.sunColor.map((c) => Math.round(c * 255)).join(",")},${
            0.25 + sky.sunDiscOpacity * 0.5
          })`,
        }}
      />
      <span className="time">{clockString(t)}</span>
      <span className="muted">{PHASE_LABEL[phase] || phase}</span>
      <span className={`season season-${season.id}`}>
        {season.label} {season.dayOfSeason}/{24} · yr {season.year}
      </span>

    </span>
  );
}
