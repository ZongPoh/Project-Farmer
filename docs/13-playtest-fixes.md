# First playtest: animals, neighbours and the snowball (2026-09-21)

The first real play of the game turned up six problems. This pass fixes them. Every
cause below was **measured headlessly before it was fixed**. The measuring scripts are
in `scratch/` (`horsediag.mjs`, `popgraph.mjs`, `campgrowth.mjs`, `growth.mjs`).

World save version **11** adds `livestock`, `stoneDebt` and `upkeepShort`. Versions
8–10 still load.

## Horses kept disappearing

**Cause (measured over 3 seeds × 400 days):** every lost horse had starved (27 of 27).
Kept horses were fed only by the wild ecology. That loop skipped eating for any animal
on a cooldown, and a horse's cooldown is its 20-day breeding cooldown. A mare that
foaled starved. A ridden horse standing on the base never grazed. The starvation sweep
then removed the horse without any event naming it.

**Fix:**

- Kept animals (`tamed`) are outside the wild ecology altogether. `livestock.js` feeds
  them from the store.
- Wild horses graze through their breeding cooldown (`grazesWhileRecovering`). Rabbits
  keep the old fast because it is part of their tuned balance. Letting rabbits eat
  through it doubled their population in a single day.
- Every exit is announced with a `reason` and counted in `world.livestock.lost`. The base
  panel shows the counts.
- If a rider dies or leaves, their horse goes back to the paddock. It only goes wild if
  the paddocks are full.
- Stabling a horse puts it *in* the paddock. It used to stay wherever the rider stood.
- A raid party sends **one** raider after a horse, not all of them. A stolen horse now
  waits in that camp (`camp.horses`), and razing one of their buildings brings it home.
  If you kill the thief, you get the horse back as yours, not as a wild horse.

After the fix: 0 starved. The only remaining losses are stolen horses, which can be
recovered.

## Taming made no sense

`tameWith` and `tame` are deleted. The only way to get a horse is the **catch order**.
The tile panel's "Tame the horse" button now issues that order. The assistant's
`tame 3,4` form is gone too. You also can't catch the last `WILD_HERD_FLOOR` (3) wild
horses.

## Animals spawned very slowly

**Measured:** wild horses numbered 0–4 against a capacity of about 26 (because of the
starving mares above). Foxes numbered 0–3. On a 120×80 board, there were **zero** rabbits
and zero horses within 12 tiles of home on every sample across three years, because
everything spawned on the rim of the board.

**Fix:** migration. When the area within `LOCAL_RADIUS` (14) of home holds fewer of a
species than `MIGRATION[species].target`, a small group arrives just outside your border.
The board-wide carrying capacity still gates this. Now: 10–12 wild horses on a small
board, and between about 10 and 90 near home on a big one, depending on the seed. Rabbits near home still crash in winter and
come back in spring.

## Animals served no purpose

- **Rabbit pens** graze their own enclosure for free, and only need feeding in winter
  (0.5 each). Every fourth day each mature *pair* has a kit. Kits a full pen cannot hold
  become 3 food each. "Take two for the pot" gives 12 food.
- **Horses** in a paddock graze for free outside winter. A ridden horse, or any horse in
  winter, eats 2 food a day. Two stabled horses have a foal every 30 days. A mounted
  forager brings back twice as much. A rider adds `ASSAULT_MOUNTED` (2) to a war party.
- **Manure:** a farm within 2 tiles of kept animals yields 25% more and keeps its soil.
- **Market:** buy a horse for 90 coins, sell one for 40, sell a penned rabbit for 4.
  There's no profitable loop.

## The AI camps stopped growing

**Cause (measured):** every camp hit 12 residents and 22–24 buildings by about day 130,
then stopped. These were flat constants (`Math.min(12, …)`, `< 24`, `MAX_CLAIMS 70`).

**Fix — the mix you chose:**

- `campCeiling` rises with their headquarters level: residents `8 + 4×level`, buildings
  `10 + 6×level`.
- It is also held near your size: residents at most `max(10, 1.25×people + 4)`,
  buildings at most `max(16, yours + 8, 2×people)`.
- `pullAlong`: a camp under 60% of your headcount gains a newcomer every 6 days, if it
  has a bed and food. This doesn't apply within 24 days of you burning it.
- `MAX_STRENGTH` is now 28. Prosperity still counts 12 as "full", so raid timing didn't
  shift.

Measured with a player growing to 24 people: camps reach level 5 with 18–28 residents
and 28–37 buildings, and they keep growing into year 3. With the old caps,
`camp-growth.test.mjs` fails, which confirms the test can catch the plateau.

## The player grew very fast

**Measured** (`scratch/growth.mjs`, a bot that builds and hires steadily, real
construction times, 60×40 board): Town by about day 96, and **around 145 people by day
288**, with tens of thousands of food, wood and stone.

Brakes added in this pass:

| Brake | Where | Effect |
|---|---|---|
| Food per head rises above 12 people (`residentFood`) | `economy.js` | At 22 people each eats 8; at 40, 11.6. The biggest single lever. |
| Farmland fertility | `buildings.js` `FERTILITY` | Falls through the growing seasons, recovers in winter, and is held up by a well or manure. Never below 0.5. |
| Masonry upkeep | `buildings.js` `UPKEEP` | Stone a day for walls, towers, stores and houses. Unpaid upkeep wears them; walls included, which otherwise never decay. |
| Land costs food past 24 tiles | `tick.js` `claimCost` | +3 food per 8 tiles, capped at 45. **If you can't pay, the claim runs the slow way (×3 hours) instead of being refused.** Invariant 11 holds. |
| A big settlement is a raid target | `rivals.js` `sizePressure` | Up to +0.35 pressure from 6 to 22 people, even with everything under a granary. |
| Livestock feed | `livestock.js` | A continuous food sink. |

The same bot now ends year 3 with **70–85 people** instead of about 145. It still
reaches Town by about day 96, and wood and stone still pile up into the thousands.
**This is a first pass, not the finished rework.** See "Not done" below.

## Not done in this pass

- Quarry depletion, forest regrowth, storage caps for herbs and seeds, and a monument.
- Town comes too early. Upgrade costs are timber and stone, and those are still far too
  plentiful.
- Raiders burning buildings, settlers spending trade goods, scouting.
- The livestock list is still `world.animals` with a `tamed` flag, not a separate
  `world.livestock` array. The reasons are in the header of `livestock.js`. The wild
  balance is protected by the skip, not by where the objects live.
- New species (goat or sheep, chicken). Foxes raiding unfenced pens.
- The rider is still chosen with the per-worker "Mount" button in the base panel, not a
  dropdown.
- Audio and publishing prep, sections 5 and 7 of the roadmap.
- **None of this has been watched in a browser beyond the app loading.** The balance is
  headless measurement.
