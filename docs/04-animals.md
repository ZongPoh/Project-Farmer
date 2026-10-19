> **HISTORICAL — this describes the game as it was, not as it is.**
>
> Written during step 4, before hours, workers, forest, the base levels,
> the rivals and everything after. Following it would build the wrong thing.
> It is kept because the *reasoning* in it is still good and the decisions it
> records are still the decisions that were made.
>
> For how the game works now, read `docs/07-the-game-now.md`, then the module
> headers in `src/game/` — those are maintained with the code and this is not.

# Step 4 — Animals and the ecosystem

Read the animal section of `DESIGN.md` before writing any code. It explains
the failure mode that eats this kind of system, and I have hit it myself.

## The shape

```js
// src/game/animals.js
export const SPECIES = {
  rabbit: { habitat: ["grass"], density: 0.6, eats: "crops",  breedDays: 6 },
  fox:    { habitat: ["grass","mountain"], density: 0.1, eats: "rabbit",
            breedDays: 14, handlingDays: 3 },
  horse:  { habitat: ["grass"], density: 0.1, tameable: true },
};
```

Animals live in `world.animals` as a flat array of
`{ id, species, q, r, energy, cooldown }`. Keep them out of the tiles — an
animal moves, a tile does not.

## Each day, in `advanceDay`

1. **Spawn** — for each species, count suitable tiles, work out capacity
   (`tiles x density`), and if the population is under it, roll a chance to
   add one at a random suitable tile on the board edge.
2. **Move** — one tile toward whatever it wants. Rabbits toward crops, foxes
   toward rabbits, horses wander.
3. **Eat** — a rabbit on a farm tile damages the crop. A fox on a rabbit's
   tile eats it and gets `handlingDays` of cooldown where it will not hunt.
4. **Breed and die** — energy up on eating, down each day; breed above a
   threshold that **scales with population** (this is the crowding rule that
   stops the boom-and-crash).

## Counters for the player

- A fence job on a tile: foxes cannot enter, costs wood, wears out.
- A tamed horse: lets your farmer move several tiles per day instead of one,
  so you can cover more ground.

## Tune it headlessly, not by watching

Write `test/ecosystem.test.mjs` that runs 300 days and asserts the rabbit
population stays inside a sane band and never hits zero. Then adjust numbers
until it passes. Watching the screen to tune a population is slow and you will
miss slow drift.

## Done when

Rabbits appear where you made grass, foxes follow the rabbits, and a run of
300 simulated days leaves both alive.
