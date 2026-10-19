# The ground runs out (2026-09-24)

The first of the resource rework. Wood and stone were the last two resources
in the game with no cost attached to having more of them, and this pass gives
both a floor they are standing on.

Save version **12** adds `world.regrowth` and, on tiles, `timber` and `rock`.
Versions 8–11 still load, and an old save needs no migration at all: an
untouched wood is a full wood by definition, so both numbers initialise
themselves the first time anything asks.

## What was measured first

`scratch/growth.mjs`, a bot that builds and hires steadily on a 60×40 board,
two seeds, 288 days:

| | day 96 | day 288 |
|---|---|---|
| Wood | 5,495 | **15,796** |
| Stone | 4,200 | **11,850** |
| Base level | **5 (Town)** | 5 |

Both lines were straight. A woodcutter cut 1 wood an hour and a quarry camp dug
1 stone an hour, forever, from ground that had no idea anything was happening
to it. Everything else in the game is a flow — food is eaten, herbs are spent,
land costs food, masonry costs stone a day — and those two were piles. That is
also why Town arrived on day 96: the late base levels are priced in timber and
stone, and both were free after the first year.

## Trees are a crop

A woodcutter draws down the **stand** on its tile, and the stand grows back.
Output is proportional to what is left, which is the whole trick: cutting slows
at exactly the rate the stand thins, so the loop settles instead of sawing
between a full stand and a bare one. It converges on the regrowth rate.

- A full stand is `240 + size × 240`, so 240 to 480 wood.
- It puts on **5 a day, plus 1 for every neighbouring tile that is still
  wood** — so 5 on an isolated copse, 11 deep in a forest.
- Nothing grows in winter. The stand is drawn down through the snow and comes
  back in spring, which gives wood the same seasonal shape food already had.

Measured over three years with the building held in repair
(`scratch/ground.mjs`):

| Woodcutter | Year 1 | Settles at | Was |
|---|---|---|---|
| Deep in a wood (6 wooded neighbours) | 1,293 | **10.0 wood/day** | 24/day, flat, forever |
| On a copse (0 wooded neighbours) | 900 | **5.6 wood/day** | 24/day, flat, forever |

Where you put a woodcutter is now a decision with an answer, which it never
was. terrain.js has claimed in a comment since step 2 that "wood is a crop you
manage rather than a deposit you exhaust" — this is the first pass where that
sentence is true.

## Rock does not

A **seam** is finite, and that is the point: stone is the one thing you can
genuinely run out of, so a mountain is worth something and breaking one down is
an investment rather than a chore.

- Plain sand holds **500** stone.
- Sand you made by quarrying a mountain holds `700 + size × 1100`, so **1,030
  to 1,800** — recorded the moment the mountain stops being a mountain.
- The last 200 come out in proportion, so the camp visibly slows before it
  stops, and then says so once: *"The rock at 4,0 is worked out."*

Measured: a camp on plain sand is finished on **day 57**; one on a broken-down
mountain on **day 111**.

A detail worth keeping: the taper is a decaying exponential, which approaches
zero and never arrives, so a seam under 1 is snapped to nothing. Without that
the camp trickles out hundredths of a stone forever and never announces
anything, and a mechanic the player cannot see is not a mechanic.

## What you clear comes back

Felling a wood used to be permanent — 12 wood and the trees were gone unless
you had found a seed. Now cleared ground grows back after **72 days** (three
seasons) if, and only if:

- nobody has built on it or started a job on it, and
- it still touches a wood, so there is something for the saplings to come from.

Clear-cut a whole forest and none of it returns. Build a farm on a clearing and
it is a farm. Leave a gap in the woods alone and the woods take it.

## The invariants this had to respect

- **16 — nothing in `advanceHour` may walk the board.** Stands are read off the
  active set, because a stand only matters where something is cutting it, and
  regrowth works from `world.regrowth`: a short list of the tiles the player
  actually cleared, capped at 400. Both are O(what you did).
- **4, and the softer rule beside it — terrain changes go through `setTerrain`,
  and tick.js is the one place that calls it.** So `stepGround` converts
  nothing. It returns the tiles ready to be woods again and tick.js does the
  conversion, exactly as it does for a finished job.
- **3 — tiles are sparse.** `timber` and `rock` live on the tile, so they ride
  along in `modified` and cost nothing for the 80,000 tiles nobody touched.

## What this did to the game

Same growth bot, same seeds, after the change:

| | day 96 | day 144 | day 288 |
|---|---|---|---|
| Base level | 4 (Village) | **5 (Town)** | 5 |
| Wood | 1,478 (was 5,495) | 2,261 | 13,419 |
| Stone | 3,093 (was 4,200) | 4,140 | 8,163 |

**Town moved from day 96 to day 144.** Early wood is down 73%.

The late-game totals are still high, and the reason is the bot rather than the
tap: it builds a woodcutter every seventh day and never stops, so by year three
it is working forty stands at ten a day each. That is a fair thing for a large
settlement to be able to do. What is missing is still the other half of the
rework — somewhere for it all to go.

## Not done in this pass

- **Storage caps for herbs and seeds, and a monument.** Wood and stone now have
  a source that argues back; they still have no continuous sink. That is the
  next task and it is what will settle the late-game numbers.
- **Town at day 144 is better, not right.** The target is nearer 200.
- Foresters, replanting as a job, or anything that lets you improve a stand
  rather than only spend it.
- Nobody has watched any of this in a browser. The app builds and loads; the
  balance is headless measurement, same as the last pass.
