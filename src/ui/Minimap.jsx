import { useMemo } from "react";
import { axialToOffset, offsetToAxial, colMin, rowMin } from "../game/grid.js";
import { getTerrain } from "../game/tiles.js";
import { TERRAIN } from "../game/terrain.js";

export default function Minimap({ world, selected, onFocus }) {
  const g = world.grid;
  const point = at => { const p = axialToOffset(at.q, at.r); return { x: p.col - colMin(g) + 0.5, y: p.row - rowMin(g) + 0.5 }; };
  // A fixed sample budget, including on Huge. Changes are overlaid separately.
  const terrain = useMemo(() => {
    const cells = [];
    const step = Math.max(1, Math.ceil(Math.max(g.width, g.height) / 48));
    for (let row = 0; row < g.height; row += step) for (let col = 0; col < g.width; col += step) {
      const at = offsetToAxial(col + colMin(g), row + rowMin(g));
      cells.push(<rect key={`${col},${row}`} x={col} y={row} width={step} height={step} fill={TERRAIN[getTerrain(world, at.q, at.r)].color} />);
    }
    return cells;
  }, [world.seed, g.width, g.height]);
  const dot = (at, color, key, radius = 1) => { const p = point(at); return <circle key={key} cx={p.x} cy={p.y} r={Math.max(g.width / 110, radius)} fill={color} stroke="#111" strokeWidth={g.width / 450} />; };
  return <div className="minimap"><svg role="img" aria-label="Valley map. Click to travel to a tile." viewBox={`0 0 ${g.width} ${g.height}`} preserveAspectRatio="none" onClick={e => {
    const rect = e.currentTarget.getBoundingClientRect();
    onFocus(offsetToAxial(Math.min(g.width - 1, Math.max(0, Math.floor((e.clientX - rect.left) / rect.width * g.width))) + colMin(g), Math.min(g.height - 1, Math.max(0, Math.floor((e.clientY - rect.top) / rect.height * g.height))) + rowMin(g)));
  }}>{terrain}{[...world.modified.values()].map(t => { const p = point(t); return <rect key={`${t.q},${t.r}`} x={p.x - 0.5} y={p.y - 0.5} width={1} height={1} fill={TERRAIN[t.terrain].color} />; })}{[...(world.owned || [])].map(k => { const [q, r] = k.split(",").map(Number); const p = point({q, r}); return <rect key={k} x={p.x - 0.5} y={p.y - 0.5} width={1} height={1} fill="#D9B25F" opacity={0.6} />; })}{(world.camps || []).map(c => dot(c.home, c.kind === "settler" ? "#7bbcff" : "#ff776f", c.id))}{dot(world.home, "#fff", "home")}{selected && dot(selected, "#ffe15a", "selected", 0.7)}</svg><p className="small">Gold: your land · Blue: settlers · Red: raiders</p><button onClick={() => onFocus(world.home)}>Home</button>{(world.camps || []).map(c => <button key={c.id} onClick={() => onFocus(c.home)}>Village {c.id}</button>)}</div>;
}
