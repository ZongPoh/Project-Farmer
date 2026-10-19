# Step 1 — The hex grid (already built, read this to understand it)

## Coordinates

Square grids are easy because x and y are obvious. Hex grids are not, and the
trick that makes them easy is using **three** coordinates that sum to zero.

We store two, `q` and `r`. The third is implied: `s = -q - r`. Distance,
rounding and neighbours all become simple once you think in three.

Read `src/game/hex.js`. The two functions worth understanding:

- `hexToWorld(q, r, size)` — where a tile sits in 3D. The board lies on the
  XZ plane; Y is height.
- `round(q, r)` — turning a fractional hex back into a whole one. You cannot
  just `Math.round` both numbers; near the edges that picks the wrong tile.
  Round all three, then repair whichever moved furthest.

## The 3D part

A hexagonal column is just a cylinder with six sides:

```jsx
<cylinderGeometry args={[radius, radius, height, 6]} />
```

**One detail that will waste your afternoon if you get it wrong.** Three.js
builds that cylinder with corners at 30°, 90°, 150°… which is exactly the
pointy-top orientation these coordinates assume. So it needs **no rotation**.
Many tutorials tell you to rotate by `Math.PI / 6`; that is for a different
layout and will leave gaps between your tiles.

I verified this by reading the vertex positions out of the geometry rather
than trusting it — a good habit when something looks subtly wrong on screen.

## Exercises

1. Change `START_RADIUS` in `world.js` from 3 to 4. You should get 61 tiles.
   Check with `tileCount(4)`.
2. Make the camera start closer. `Board.jsx`, the `camera` prop.
3. Hard: colour each tile by its distance from the centre using
   `distance({q,r}, {q:0,r:0})`. You should see rings.
