import HealthBar from "./HealthBar.jsx";
import Part from "./ModelPart.jsx";
import Building from "./Building.jsx";
import ConstructionSite from "./ConstructionSite.jsx";
import SettlementModel from "./SettlementModel.jsx";
/**
 * The neighbours, on the board.
 *
 * Deliberately NOT drawn through `Building.jsx`. Their huts are not your huts,
 * and the whole point of putting them on the map is that you can tell at a
 * glance whose fields you are looking at — so they get their own shapes, their
 * own colour family, and a sharper silhouette than anything you build.
 *
 * Windowed like everything else: only what falls inside the camera's tile
 * window is drawn. Their camp is usually a long way from yours, so most of the
 * time this renders nothing at all.
 */
import { useMemo } from "react";
import { hexToWorld } from "../game/hex.js";
import { TERRAIN } from "../game/terrain.js";
import { TILE_SIZE } from "./InstancedTiles.jsx";
import { getTile } from "../game/tiles.js";
import { allCamps } from "../game/rivalcamp.js";

/**
 * Shapes per building, colour per KIND.
 *
 * Raiders are iron and dried blood; settlers are blue-grey and linen. Telling
 * one camp from the other at a glance is the whole point of there being two
 * sorts of neighbour — a player who has to open a panel to find out whether
 * the people over the hill are going to rob them has not been told anything.
 */
export const RIVAL_SHAPE = {
  camp: "camp",
  farm: "field",
  hut: "hut",
  store: "hut",
  market: "hut",
  workshop: "hut",
};

export const KIND_COLOURS = {
  raider: { camp: "#8E3B34", field: "#8A7A46", hut: "#6E4A3E" },
  settler: { camp: "#46698E", field: "#7E8E5A", hut: "#5A6472" },
};

export const FALLBACK = { color: "#7A5148", shape: "hut" };

export function rivalLookFor(building) {
  if (!building || !building.id) return null;
  const shape = RIVAL_SHAPE[building.id];
  if (!shape) return FALLBACK;
  const palette = KIND_COLOURS[building.kind] || KIND_COLOURS.raider;
  return { shape, color: palette[shape] || FALLBACK.color };
}

export default function RivalCamp({ world, tiles, revision, onSelect }) {
  const onScreen = useMemo(() => {
    const set = new Set();
    for (const t of tiles) set.add(`${t.q},${t.r}`);
    return set;
  }, [tiles]);

  const terrainAt = useMemo(() => {
    const map = new Map();
    for (const t of tiles) map.set(`${t.q},${t.r}`, t.terrain);
    return map;
  }, [tiles, revision]);

  // `revision` and `world.day` for the usual reason: their buildings are
  // mutated in place when one burns, so the array identity is no signal.
  // Every neighbour's buildings, flattened, with the camp's kind carried
  // along so a settler's field can be told from a raider's at a glance.
  const visible = useMemo(() => {
    const out = [];
    for (const camp of allCamps(world)) {
      for (const b of camp.buildings || []) {
        if (b.condition > 0 && onScreen.has(`${b.q},${b.r}`)) {
          out.push({ ...b, kind: camp.kind, campId: camp.id, level: camp.level || 1 });
        }
      }
    }
    return out;
  }, [world.camps, onScreen, revision, world.day]);

  return (
    <group>
      {visible.map((b) => {
        const look = rivalLookFor(b);
        if (!look) return null;
        const { x, z } = hexToWorld(b.q, b.r, TILE_SIZE);
        const terrain = terrainAt.get(`${b.q},${b.r}`);
        const y = TERRAIN[terrain] ? TERRAIN[terrain].height : 0;
        // Burned but still standing: visibly sagging and dimmer, so the
        // player can see the damage they did without opening a panel.
        const health = Math.max(0, Math.min(1, b.condition / 100));
        const underAttack = Number.isFinite(b.lastAttacked) && (world.day - 1) * 24 + world.hour - b.lastAttacked < 4;


        return (
          <group key={`${b.q},${b.r}`} position={[x, y, z]} onClick={e => { e.stopPropagation(); onSelect(getTile(world, b.q, b.r)); }}>
            {b.construction?.kind === "build" ? (
              <ConstructionSite building={b}/>
            ) : ["woodcutter", "watchtower", "wall"].includes(b.id) ? <Building building={b} y={0} tile={b}/> : <SettlementModel building={b} health={health} level={b.level} kind={b.kind} day={world.day}/>}

            {underAttack && <><HealthBar health={b.condition} max={100} height={1.7} hostile/>{[-0.3,0.3].map(x => <Part key={x} shape="cone" color="#f18b35" position={[x,0.5,0.35]} scale={[0.2,0.55,0.2]}/>)}</>}
          </group>
        );
      })}
    </group>
  );
}
