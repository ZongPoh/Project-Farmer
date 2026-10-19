import { seasonFactors } from "../game/calendar.js";

// Presentation only: never changes terrain, movement, harvests or saved state.
const PALETTES = {
  spring: { leaves: "#93BD72", detail: "#F2BAD3", crop: "#8CB861", snow: 0 },
  summer: { leaves: "#487E45", detail: "#E7CA6B", crop: "#D8BD58", snow: 0 },
  autumn: { leaves: "#C57B3F", detail: "#B96835", crop: "#B9894D", snow: 0 },
  winter: { leaves: "#DCE8EB", detail: "#E9F1F4", crop: "#B0BBC0", snow: 1 },
};

export function seasonAppearance(day) {
  const season = seasonFactors(day);
  const current = PALETTES[season.id];
  const next = PALETTES[season.next];
  const blend = season.blend || 0;
  return { ...current, id: season.id, snow: current.snow + (next.snow - current.snow) * blend };
}

// Stable decoration locations even as the camera pans and saves reload.
export function decorationVariant(q, r) {
  return ((Math.imul(q, 73856093) ^ Math.imul(r, 19349663)) >>> 0) % 101;
}
