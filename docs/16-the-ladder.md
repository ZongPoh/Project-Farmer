# The ladder means something (2026-09-24)

The third pass of the resource rework, and the one that turned out to matter
most. It started as "Town arrives on day 96, aim for 200" and the measurement
said the date was the smaller half of the problem.

No save change. `scratch/pace.mjs` is new: it records the exact day of every
base upgrade and what the settlement was made of on that day, because
`growth.mjs` samples every 48 days and cannot see a ladder at all.

## What was measured

The greedy bot, three seeds, 60×40, before this pass:

| | Homestead | Hamlet | Village | Town |
|---|---|---|---|---|
| Day | 18 | 35 | 60 | 134 |
| People | 8 | 15 | 20 | 55 |
| Buildings | 14 | 31 | 56 | 130 |

Read the People row against `BASE_LEVELS`, which says a Camp houses 4, a
Homestead 7, a Hamlet 11, a Village 16 and a Town 22. A "Hamlet" of 15 people.
A "Village" of 20. And 55 people standing in a Village on the day Town was
finally affordable — a level described in the code as "as large as this valley
will hold".

The cause was one line. The population ceiling was `tier + 4 per house`, and
nothing limited how many houses you built, so the tier was a small addend and
the ladder in `BASE_LEVELS` was decoration. Raising the price of Town would
have moved one number in that table and left the other two exactly as wrong.

## The tier is the ceiling; houses fill it in

The base's own roof sleeps 4. Each finished house sleeps 4 more. **The tier
caps the total** — 4 / 7 / 11 / 16 / 22, the numbers that were already written
down.

So a house is how you *reach* your level's number and can never take you past
it. Five houses fill a Town and a sixth is a waste. A Camp that wants a fifth
pair of hands has to become a Homestead, which is what the levels were for.

`workerCapacity` now reports `beds` and `tier` beside `byBase`, and
`limitedBy` has three answers instead of two: `food`, `houses` (build one), and
`base` (the settlement itself is as big as it gets). The base panel and the
hire button say which, because "no room" is useless when the fix is a different
building.

## And then the prices

With the ceiling in place the bot reached Town *sooner* — day 94 — because
sixteen people eat a great deal less than fifty-five and buildings produce
whether or not anyone is standing in them. So Village went from 700 timber to
1,400 and Town from 1,500 to 4,800, with stone and food to match.

The bot, after both changes:

| | Homestead | Hamlet | Village | Town |
|---|---|---|---|---|
| Day | 18 | 35 | 73 | **150** |
| People | 4 | 7 | 11 | 16 |
| Buildings | 14 | 31 | 69 | 146 |

Every settlement is now the size its label claims. Town is day 150 against 96
before the rework started, and the population settles at 22 rather than
climbing past 70.

## The part that is still wrong, and it is not the price

Look at the Buildings row: 146 of them, run by 16 people.

Going from 3,600 to 4,800 timber bought **eleven days**. That is the shape of
the whole lever: income comes from buildings, buildings cost land and time, and
*nothing in the game ties either to labour*. Buildings produce on their own —
which is deliberate, it is what makes the game idle-friendly — so a Town of
sixteen can run a hundred and fifty of them and price rises just get
out-accumulated. Raising Town to 10,000 timber would have moved it a few weeks
further and made the number silly.

**The next lever is labour, not price.** Something like a building needing
somebody to work it, or output falling when there are more buildings than
hands. That is a real design change and it belongs in its own pass, with its
own measurement.

Two other things this pass exposed:

- **Food now piles up.** People were the main food sink, and they are capped.
  The bot ends year three with 26,000 food where it used to end with 500. The
  storage cap rises with every granary, which is the same slope problem
  `docs/15` describes for seeds.
- **The monument closes.** It finishes at eight courses around day 144 and the
  stone starts climbing again. A sink that finishes is a delay, not a sink.

## Not done

- Labour, above. The big one.
- A food ceiling that does not rise with a cheap building.
- Something to do with a finished monument.
- Still nobody has watched any of this in a browser. `scratch/load.mjs` is new
  and will at least tell you the scene mounts and the console is clean, which
  is not the same thing as looking at it.
