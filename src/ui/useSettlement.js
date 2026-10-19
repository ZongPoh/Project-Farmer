import { useCallback, useEffect, useRef, useState } from "react";
import { createWorld } from "../game/world.js";
import { recordMilestones } from "../game/management.js";
import { SAVE_KEY, encodeSave, decodeSave, catchUp, defaultSettings, writeSave } from "../game/persistence.js";

function openSettlement() {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    if (text) {
      const saved = decodeSave(text);
      const result = catchUp(saved);
      return { ...saved, message: result.hoursRun ? `Welcome back. ${result.hoursRun} hours progressed${result.capped ? " (120-day limit)" : ""}. ${result.events.filter(e => ["death", "milestone", "campRazed"].includes(e.type)).slice(-4).map(e => e.text).join(" ")}` : "Your settlement has been restored.", locked: false };
    }
  } catch (error) {
    return { world: createWorld(), settings: defaultSettings, locked: true, message: `Could not restore your save: ${error.message} Autosave is paused to protect it. Load from file or choose New map.` };
  }
  return { world: createWorld(), settings: defaultSettings, locked: false, message: "Place your base on a grass tile to begin — or ask me what to do." };
}

/** Every player action and simulation tick publishes exactly one revision. */
export function useSettlement() {
  const [initial] = useState(openSettlement);
  const [world, replace] = useState(initial.world);
  const [revision, publish] = useState(0);
  const worldRef = useRef(world);
  worldRef.current = world;
  const act = fn => (...args) => {
    try { return fn(...args); }
    finally {
      recordMilestones(worldRef.current);
      publish(n => n + 1);
    }
  };
  const setWorld = next => { worldRef.current = next; replace(next); publish(n => n + 1); };
  return { initial, world, setWorld, revision, act };
}

export function useAutosave(world, settings, revision, locked, onCatchUp) {
  const [status, setStatus] = useState("Autosave ready");
  const latest = useRef({ world, settings, locked, onCatchUp });
  latest.current = { world, settings, locked, onCatchUp };
  const hiddenAt = useRef(null);
  const dirty = useRef(true);
  useEffect(() => { dirty.current = true; }, [world, revision, settings.running, settings.secondsPerDay, settings.offline]);
  const flush = useCallback(() => {
    const current = latest.current;
    if (current.locked) return false;
    try {
      const result = writeSave(localStorage, encodeSave(current.world, current.settings, hiddenAt.current ?? Date.now()));
      setStatus(result.ok ? "Saved on this device" : result.reason);
      if (result.ok) dirty.current = false;
      return result.ok;
    } catch { setStatus("Saving is unavailable. Use Save to file to keep your progress."); return false; }
  }, []);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState !== "hidden" && (dirty.current || latest.current.settings.running)) flush(); }, 3000);
    const hidden = () => {
      if (document.visibilityState === "hidden") { hiddenAt.current = Date.now(); flush(); }
      else if (hiddenAt.current !== null) {
        const current = latest.current;
        if (!current.locked) {
          catchUp({ ...current, savedAt: hiddenAt.current });
          current.onCatchUp?.();
        }
        hiddenAt.current = null;
        flush();
      }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => { clearInterval(timer); window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", hidden); };
  }, [flush]);
  return { status: locked ? "Autosave paused — existing save protected" : status, flush };
}
