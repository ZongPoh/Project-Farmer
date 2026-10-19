> **HISTORICAL — this describes the game as it was, not as it is.**
>
> Written during step 3, before hours, workers, forest, the base levels,
> the rivals and everything after. Following it would build the wrong thing.
> It is kept because the *reasoning* in it is still good and the decisions it
> records are still the decisions that were made.
>
> For how the game works now, read `docs/07-the-game-now.md`, then the module
> headers in `src/game/` — those are maintained with the code and this is not.

# Step 3 — The base, farms and food

## Goal

One base you place yourself, farms that produce food each day, and a store
that the whole game draws from.

## Build it in this order

1. **`src/game/buildings.js`** — copy the shape of `terrain.js`:

```js
export const BUILDINGS = {
  base:  { label: "Base",  cost: {wood: 0},  needs: "grass", unique: true },
  farm:  { label: "Farm",  cost: {wood: 4},  needs: "grass", yields: {food: 2} },
  well:  { label: "Well",  cost: {stone: 3}, needs: "sand",  enables: "irrigate" },
};
```

2. **Add `store` to the world**: `{ food: 10, wood: 6, stone: 0 }` in
   `createWorld`. Add it to the tests for save/load.

3. **Place buildings**: a `place(world, q, r, id)` function mirroring
   `startWork` — same `{ ok, reason }` return shape. Check terrain, check
   cost, check the tile is free.

4. **Produce in `advanceDay`**: loop the tiles, add each building's `yields`
   to the store. This is a three-line change, which is the payoff for keeping
   all time in one function.

5. **Render it**: a small box on top of the tile in `HexTile.jsx`. A cone for
   the base, a cube for a farm. Fancy models can come much later.

## Watch out for

- **Do not let food go negative.** Decide what happens at zero now, not
  later — animals starve, production stops, something. Silent negatives are a
  bug you will find three weeks later.
- **Draw calls.** Every tile is currently its own mesh. That is fine at 37 and
  fine at 127. If you ever go past a few hundred, switch to
  `<Instances>` from drei. Not before — instancing is harder to read and you
  do not need it yet.

## Done when

You can place a farm, press Advance a day, and watch the food number rise.

## Exercise

Give farms a `condition` that drops 1% a day and cuts yield as it falls.
Add a `repair` job that costs wood. You now have an upkeep loop, which is
what stops idle games from being boring.
