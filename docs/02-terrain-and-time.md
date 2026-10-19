# Step 2 — Terrain and time (already built)

## Rules as data, not code

Look at `CONVERSIONS` in `src/game/terrain.js`. Each conversion is an object:

```js
{
  id: "irrigate",
  from: "sand", to: "grass",
  days: () => 8,
  blockedBy: (tile, world) =>
    touches(world, tile, "water") ? null : "needs to touch water",
}
```

To add a new one you add an object. No other file changes — the panel builds
its buttons from this list, and the tests read it too. Whenever you find
yourself about to write `if (terrain === "sand" && ...)` in a component, stop
and put it here instead.

`days` is a function of the tile, which is how "a bigger mountain takes
longer" works: `days: (tile) => Math.round(10 + tile.size * 20)`.

`blockedBy` returns **a reason string, not `false`**. That reason is shown to
the player on the disabled button, so the game explains itself.

## Time

`advanceDay(world)` in `src/game/tick.js` is the only function that changes
the world. See `DESIGN.md` for why that matters so much.

It returns a list of events. Right now the UI just prints them, but in step 5
the text assistant reads the same list to tell you what happened while you
were away. Generate events for anything the player would want to be told.

## Exercises

1. Add a `forest` terrain: green, height `0.6`, buildable `false`. Add a
   conversion `grass -> forest` that takes 20 days, and `forest -> grass`
   ("clear it") that takes 5. Run `npm test` — it should still pass.
2. Make draining water take longer if the tile has more water neighbours.
3. Add an event when a job is *one day* from finishing, so the player gets
   warning. Hint: check `daysNeeded - daysDone === 1` inside `advanceDay`.
