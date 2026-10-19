> **HISTORICAL — this describes the game as it was, not as it is.**
>
> Written during step 5, before hours, workers, forest, the base levels,
> the rivals and everything after. Following it would build the wrong thing.
> It is kept because the *reasoning* in it is still good and the decisions it
> records are still the decisions that were made.
>
> For how the game works now, read `docs/07-the-game-now.md`, then the module
> headers in `src/game/` — those are maintained with the code and this is not.

# Step 5 — "How's my farm today?" without an LLM

The input box at the bottom of the screen is already there and does nothing.
Make it work.

## Build the answer before the question

Write `describeFarm(world)` first. It returns a few plain sentences built from
real state:

```js
`Day ${world.day}. ${jobs} jobs running${soonest}. ` +
`You have ${grassCount} grass, ${farmCount} farms, ${store.food} food.` +
(foxes.length ? ` A fox is near ${foxes[0].q},${foxes[0].r}.` : "")
```

This is the valuable half, and it can only ever say true things because every
clause is read from the world.

## Then the parser

```js
const INTENTS = [
  { id: "REPORT", words: ["how", "status", "report", "today", "doing"] },
  { id: "ADVISE", words: ["what", "should", "next", "help", "suggest"] },
  { id: "BUILD",  words: ["build", "place", "put"] },
  { id: "JOB",    words: ["irrigate", "quarry", "drain", "flood"] },
];
```

Lowercase the input, drop filler (`the`, `a`, `my`, `is`, `do`, `i`), then
score each intent by how many of its words appear. Highest score wins; if
nothing scores, fall back to suggesting the closest command with a Levenshtein
distance.

Pull coordinates out with a regex over the remainder: `/-?\d+/g`. That handles
"build a farm at 2,-1" and "build farm 2 -1" identically.

## Advice, cheaply

`ADVISE` does not need intelligence, just a ranked list of checks:

```js
if (store.food < 5) return "Food is low. Build a farm on grass.";
if (idleGrassTiles > 3) return `You have ${idleGrassTiles} empty grass tiles.`;
if (sandNextToWater) return "That sand by the water could be irrigated.";
```

Order matters — the first true thing is the advice. This reads as thoughtful
and costs nothing.

## Done when

Typing "how's my farm?" gives a true summary, and "build a farm at 2 -1"
places one.

## Exercise

Log every input the parser failed to understand. After a week of playing you
will have a list of the phrasings to support next. That is how you grow a
parser — from real misses, not from guessing.
