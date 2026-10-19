# The torch, and two things that already worked (2026-09-25)

The raid only ever ran one way. You could march on a camp and burn a hut; they
could take your goods and scuff whatever they walked over. This gives them a
reason to come for a particular building — and, in the course of checking two
old backlog items, found that neither of them was broken.

No save change.

## One of them carries a torch

A party of **three or more** sends one of its number after a building it has
chosen, and that raider stays on it until it is a ruin: 35 condition a day, so
three days for something whole.

What they go for, in order: **granary**, warehouse, market, infirmary, coop,
farm, woodcutter, quarry camp. A granary first because a granary is exactly
what puts your goods beyond their reach, and burning it is how they get at next
year's. Never the base — they rob you, they do not burn you out, which is the
rule `vandalise` has always had and the reason a raid can never end the game.
Never a wall, gate or tower either: barriers have the breaching rules already,
and a torch-bearer queueing to knock a wall down would quietly replace them.

A burned granary stops protecting anything, because `protectedStores` scales
with condition. So the raid after this one takes more. That is the sharper
exchange this was for, and the first argument the game has ever made for a
second granary.

## The torch-bearer does not fight, and that is a balance fix

A raider with a torch deals no damage to anyone. It can be hit back for free.

This is not flavour. **Measured** on a 220-day run, seed 11: a torch-bearer
walks further into the settlement than a looter does and then stands on one
spot for days, so it picks up three or four times the contact a looter ever
had. Fighting normally, the run went from 85 fights and **no** deaths to 122
fights and **three**. "A raid costs goods, not people" is the rule this whole
file is balanced around, and `rivals.test.mjs` has an executable version of it
that duly went red. With the torch-bearer's hands full: 87 fights, one death.

## Two backlog items that were already fixed

Both had been sitting in the TODO for passes. Both were measured before
anything was changed, which is the rule, and both turned out to need a test
rather than a fix.

**"Watchtowers only spotted 2 raids in 25."** A tower near the base now spots
**nine raids out of nine** (`scratch/towers.mjs`, seed 11, 400 days). `spotted`
watches the whole approach — `d(tower,entry) + d(tower,target) <= d(entry,target)
+ range` — rather than its own doorstep, and that landed some passes ago.

But there is a real finding underneath the stale one. In a settlement with no
wood coming in, the tower decays from range 7 to range **0** over 180 days and
spots **one** raid in five. That is almost certainly where "2 in 25" came from.
A neglected tower seeing less far is deliberate — it is a gentler failure than
one that blinks off — and it is the difference between a tower that works and a
tower you built once.

**"raidFoiled has never fired in a playthrough."** It fires. Three granaries
cover 431 food, 345 wood and 230 stone; a settlement holding less than that
sent raiders home empty **four times in 400 days**. What had never happened was
a *run* that built three granaries, which is a different complaint and a fair
one.

Both now have a test that plays 300 days and asserts the counts, so the next
person to read the backlog does not go and fix something that works.

## Not done

- The torch-bearer picks the best building by rank and then by distance from
  home. It does not care whether it can actually get there, so a granary walled
  off behind a gate will draw somebody who then has to breach.
- Nothing burns a *camp's* granary in return; the player's war party still
  burns whatever is nearest.
- Still nobody has watched a raid in a browser.
