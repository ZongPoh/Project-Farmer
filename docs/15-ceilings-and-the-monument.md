# Ceilings, and somewhere for the pile to go (2026-09-24)

The second half of the resource rework. `docs/14` gave wood and stone a source
that argues back; this gives the small stores a lid and the big ones a sink.

Save version stays at **12**. The monument keeps its state on the building
(`courses`, `laid`), so it rides along in `modified` and the save format needs
nothing new.

## Herbs and seeds stop

Both were **uncapped**, which is the whole reason herbs reached 300+ by year
two: foraging is what every idle worker does, so a resource with no ceiling and
one narrow use stops being a resource and becomes a counter.

| | Base | Raised by |
|---|---|---|
| Herbs | 120 | an infirmary, +90 — medicine is kept where the sick are |
| Seeds | 40 | a granary, +20 — seed corn is kept where the corn is |

And then an **absolute ceiling** over the top of that: 300 herbs, 100 seeds.

That second lid exists because of a measurement. With only the per-building
numbers in place the growth bot ended three years with **580 seeds against a
cap of 40**, because it had built twenty-seven granaries. A ceiling that rises
with a cheap building is not a ceiling, it is a slope — the same fault the
comment in `economy.js` had already described for warehouses, moved one
building along. Food, wood and stone still scale with what you build, because
storing those *is* the game. The two small stores stop where the stock would
spoil.

Below three granaries and two infirmaries nothing changes at all, so a normal
settlement sees exactly what it saw before.

## The monument

Stone had a source that runs out and still had no sink worth the name: masonry
upkeep takes a stone or two a day, and the base upgrades take a few hundred
once and then you are done wanting them.

A monument is a tower raised in **courses**. You found it once, cheaply, and
then it takes materials off you a little at a time for the rest of the game.

- **8 courses.** Each takes 250 stone and 60 timber — 2,000 stone and 480
  timber all told.
- **20 stone and 5 timber a day** is the most the masons carry up, so a
  finished monument is about a hundred days of deliveries.
- **It never touches the last 60 stone or 60 timber.** A monument that ate the
  last of the stone would take the walls down with it, since unpaid masonry
  upkeep already wears buildings out. Short supply is not a failure state: the
  work waits and says so once.
- **You can stop it** (`setMonumentWork`) and start it again. That is the
  player's one control.

What you get is deliberately not a production bonus:

- It watches further than any tower, because it is the tallest thing for miles.
- It **can be seen** just as far, and every standing course adds 0.03 to raid
  pressure. A settlement that puts its surplus into a monument is advertising
  that it has a surplus.

Finishing it is the furthest milestone in the game. It is the thing you build
when there is nothing left to build, and it should cost something for the
privilege.

## What the three passes add up to

The same growth bot, two seeds, 60×40, at day 288:

| | Before `ground.js` | After `ground.js` | Now |
|---|---|---|---|
| Wood | 15,796 | 13,419 | **11,990** |
| Stone | 11,850 | 8,163 | **4,491** |
| Seeds | — | 580 | **100** |
| Herbs | 300+ | 120 | **120** |
| Town reached | day 96 | day 144 | day 144 |

Stone is down 62% from where this rework started. The monument accounts for
2,000 of that directly; the rest is the building itself, its upkeep, and
whatever the extra raid pressure costs — which has not been separated out, and
the honest thing is to say so rather than to claim the sink did all of it.

## Not done

- **Town still arrives on day 144.** The target is nearer 200. Stone is no
  longer the reason; timber is — wood is still 12,000 at day 288 because the
  bot works forty stands at ten a day each, and the monument stops taking any
  once it is finished. The next lever is either the upgrade prices or a second
  sink that does not finish.
- A second monument, or anything else to do with a finished one. Right now the
  sink closes at eight courses and the pile starts growing again.
- Nobody has watched any of this in a browser. Three passes now rest on
  headless measurement alone.
