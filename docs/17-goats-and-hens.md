# Goats, hens, and the fox at the door (2026-09-25)

Two new animals, and neither of them is another rabbit. The playtest said
animals served no purpose; the answer to that is not three things that breed
in a pen, it is three things that are good at different jobs.

No save change. Goats and hens live in `world.animals` like everything else,
with `pen` or `coop` naming where they are kept. An old save has neither, and
nothing to migrate.

## What each one is for

| | Job nothing else does | Where |
|---|---|---|
| **Goat** | grazes **sand** — the only use dry ground has ever had — and gives milk every day of the year, winter included | a fenced pen |
| **Hen** | eats **grain**, which is the first use seeds have had besides planting a wood, and lays through the winter | a coop, which is a building |
| Rabbit | breeds fast and turns a full pen into meat | a fenced pen (unchanged) |

A goat gives 0.6 food a day and eats 1 a day in winter, so it is a small net
gain over a year and a *positive* one in the season when the farms are shut.
Six hens eat 2.1 seeds a day and lay 4.8 food. Milk and eggs are fractions, and
the remainder is carried on `world.livestock.carry` rather than floored each
day — flooring a four-hen coop's 3.2 food would lose 6% of the building to
arithmetic.

## Seeds finally have somewhere to go

A woodcutter turns up a seed about every day and a half, seeds had exactly one
use (planting grass into forest), and `docs/15` had to put an absolute ceiling
of 100 on them because they were otherwise a counter that only went up. A coop
eats them. So the chain is now: a woodcutter cuts wood **and** finds a seed,
the seed feeds a hen, the hen lays, and the ceiling has something pushing
against it from below.

## Pens are no longer rabbit-shaped

`rabbitPen` is now `penFor(world, q, r, species)` and the flood fill is scoped
to the species' own terrain, so asking as a rabbit ("grass") and asking as a
goat ("grass" or "sand") are two different questions about the same fences. A
rabbit pen is still all grass and behaves exactly as it did. `rabbitPen`,
`stockRabbitPen`, `stepRabbitPens` and `cullRabbits` all still exist and still
mean what they meant.

## The fox, and invariant 6

A coop standing in the open is a larder. A fox within 4 tiles has an even
chance of taking a hen each day, and a fence around the coop stops it — which
is the second reason the game has ever had for building a fence.

**The fox gains nothing.** No energy, no shortened hunt, nothing. Invariant 6
says the predator-prey balance is tuned across three simulated years on the
assumption that rabbits are the only food a fox has, and a second source would
rewrite all of that silently. So the hen is a loss to you and not a meal to the
fox — which is also, as it happens, what foxes in a henhouse actually do.
`flocks.test.mjs` asserts the fox's energy and cooldown are untouched, because
that is exactly the sort of thing a later change would quietly undo.

Goats and hens are marked `wild: false` in `SPECIES` for the same reason: no
spawning, no migration, no line in the census. There is no wild goat anywhere.

## The market

Only horses can be bought. Everything else you breed, which is what makes the
fences worth building. Selling exists so a full pen is worth something besides
meat: a goat is 18 coins, a rabbit 4, a hen 3 — all under what the animal earns
you in a season, so selling the herd is never the clever move.

## Not done

- A goat eats the same whatever it stands on. Sand that grazes as well as grass
  is generous; if goats turn out to be the obvious opening move, that is the
  dial.
- Wool, hides and anything else an animal could give that is not food. Every
  livestock yield in the game is still food, which is one idea repeated.
- Foxes still cannot get into a *rabbit* pen. A pen only exists while its
  fences are whole, so a rotten pen opens and the rabbits simply leave; a fox
  arriving at that moment would be the better story.
- Nobody has watched any of this in a browser. `scratch/load.mjs` says the
  scene mounts and the console is clean, which is not the same thing.
