# The game as it actually is

Update: building and upgrade durations plus fixed 60-second days are described in [Pacing and construction](09-pacing-and-construction.md). Also see [Settlement controls](08-settlement-controls.md) for current saving, queue, economy, and attack behaviour.

`docs/00`–`docs/02` still describe what they built. `docs/03`–`docs/06` do not:
they were written when a day was the atom, farms and woodcutters both sat on
grass, and nobody walked anywhere. They are kept as history and marked as such.

This is the current picture. It is a map, not a tutorial — the real
documentation is the header comment on each module in `src/game/`, which is
maintained alongside the code and usually explains *why* a number is what it
is. Several of them record the measurement that produced it, which is worth
more than the number.

---

## The rules that must not be broken

These are load-bearing. Each one is cheap to violate by accident and expensive
to discover afterwards.

1. **`advanceHour` is the only thing that advances simulated time.** Player
   actions mutate the world synchronously and publish through `useSettlement.act`. This is what makes turn-based play, idle play and
   offline catch-up the same code path, and it is why the whole simulation can
   be replayed from a seed.
2. **A season is a pure function of `world.day`.** Nothing seasonal is stored.
3. **Tiles are sparse.** `getTile` may hand back a *throwaway* built from the
   seed; writing to it does nothing. `touchTile` is the only way in.
4. **Terrain changes go through `setTerrain`**, which maintains the histogram,
   which is what makes animal capacity O(1) instead of O(map).
5. **Anywhere the scene memoises something derived from `tiles`, `revision`
   belongs in the deps.** Tiles are live mutable objects; array identity is not
   a signal that the contents changed. This caused the demolish crash.
6. **A fox must never gain anything from attacking a person.** The predator-prey
   balance is tuned across three simulated years on the assumption that rabbits
   are the only food. A second source would rewrite all of it, silently.
7. **Every resource needs at least one source that does not cost that
   resource.** Two farms spend all your starting wood, and with no wood you
   cannot build a woodcutter. Clearing forest is the escape hatch.
8. **Nothing may occupy `world.raiders` indefinitely.** A party that cannot
   reach its target blocks every future raid. See below.
9. **Days are 1-based.** `calendar.js` clamps, but do not lean on it.
10. **Territory claims are REFERENCE COUNTED.** Two buildings side by side both
    claim the tile between them; a plain set would punch a hole in the middle
    of the farm when either was demolished, and the hole would be invisible
    until somebody tried to build there.
11. **There must always be something claimable on the frontier.** Gating jobs
    on land means a settlement that cannot expand can do nothing at all, and it
    would fail silently with every button greyed out. The claim job is the
    guarantee; `territory.test.mjs` checks it across 25 seeds.
12. **A neighbour's buildings are NOT on tiles.** They live on the camp, in
    `camp.buildings`. `produceHour`, `dailyWear`, `countBuildings`,
    `protectedStores` and the auto-repair chore all walk the active set, and a
    faction marker on `tile.building` would need a check adding to every one of
    them — the day somebody forgets one, your farms pay out for enemy fields or
    your workers walk across the valley to mend a raider's hut.
13. **Their strength is `min(fighters, housing)`, never a stored number.** It
    is the only reason burning a hut is visible as fewer raiders. A stored
    count that recruited itself back made ten razed buildings change nothing.
14. **Camps are addressed by `id`, never by index.** `campById` is the only way
    in. Camps are razed, leave the valley, and are replaced by other people —
    anything holding a position in `world.camps` will eventually be talking to
    the wrong settlement. Orders, raid parties and marching workers all carry a
    `campId` for this reason.
15. **A settler camp may become a raider camp; the reverse never happens.**
    `burnSomething` is the only place that writes `camp.kind`. Burning peaceful
    neighbours out is meant to be irreversible, and a second writer anywhere
    would quietly make it not.
16. **Nothing in `advanceHour` may walk the whole board.** `allTiles` is for
    tests and benchmarks, and has no callers in `src/game/` or `src/ui/`. This
    single rule is why the size menu goes up to 400×200 at all, and why a day on
    that board costs what a day on 24×16 does.
17. **Never mix a value from a ref with a value from a prop.** They update at
    different moments, and the gap between them is a frame in which the two
    disagree. The time of day was `prop hour + ref fraction` and jumped
    backwards nearly an hour on every tick for months. If two numbers have to
    agree, one thing owns both. See `visualClock.js`.
18. **`sunDirection` sweeps continuously through all 24 hours.** The moon is
    drawn and lit as the anti-sun, so it rides on this vector; a discontinuity
    here swings every shadow in the scene through 180° in one frame.
19. **Anything quantised against a moving input needs hysteresis.** `Math.round`
    is unstable on a boundary and the camera is never perfectly still. Snapping
    the shadow frustum to a grid stopped one artefact and started a worse one.

## Time

The atom is the **hour**. Production, worker movement and job progress run
hourly; animals, building wear, eating, recruiting and the rivals run **daily**,
when the date rolls over. That split is deliberate: a rabbit does not breed
hourly, and stepping the ecosystem twenty-four times as often would mean
retuning a balance that is currently stable and tested.

A year is 96 days — four seasons of 24. Daylight runs from 8 hours in winter to
15.5 in summer, and **everything visual is driven by the sun's elevation rather
than by the clock**, so winter is automatically low and golden, midnight has no
seam, and lamps light earlier in December than in June without a single
season-specific line.

## Territory

The board is not yours. What is yours is **owned** tiles — anything you have
built on or finished a job on — plus the ring around them, which is the
**claimed** territory. Building and working are refused outside it.

That gives the border a shape nobody has to enforce: it can never have holes,
it can never be disconnected from the base, and it grows exactly one tile
beyond the last thing you did. Which is also the rule the player is told:
*finish something, and the ground around it opens up.*

`owned` is saved; `claims` is rebuilt from it on load, the same way `active`
is — one source of truth, and a save that cannot disagree with itself.

**The claim job** (10 worker-hours, no cost, frontier tiles only) is the escape
hatch, and it is not optional. Plain grass has no job on it unless you happen
to hold a seed; sand away from water has none either. Without a job that works
on bare ground, a settlement whose opening nineteen tiles held no forest and no
rock could never expand and the game would stop with nothing on screen to say
why.

**Raiders may not enter ground you hold.** A consequence worth knowing: a
player who claims every approach cannot be raided at all. That is a real end
state rather than a bug — you own the valley — and `raidsPossible` exists so
the UI can say so, because a threat that quietly stops arriving is
indistinguishable from a broken system.

The border is **drawn**: everything outside it is rendered at half brightness.
A refusal the player cannot see coming reads as a bug rather than a rule.

## The neighbours

They have an address. `rivals.js` used to say a rival settlement you could
attack was "a whole second game" and out of scope, and raiders walked in from
the edge of the map — which made the threat *weather*: nothing to scout,
nothing to plan around, and paying it off was the only interaction available.

`rivalcamp.js` owns every other settlement on the board: a camp each, a border of
its own that grows the same way yours does, fields, a store, and fighters. They
are a **simulation, not an opponent** — no AI decides anything; they expand on a
timer and build when they can afford it, and the whole valley costs less per day
than one worker's pathfinding.

### Two sorts, and how many of them

There are **raiders** and there are **settlers**. Both build, expand, feed
themselves and can be attacked; the difference is what they do about you.
Raiders send parties. Settlers send caravans.

    campCountFor    = clamp(round(sqrt(tiles) / 13), 1, 6)
    campDistanceFor = clamp(round(sqrt(tiles) / 4),  8, 40)   tiles from home

Which gives 2 neighbours on Small, 5 on Medium and 6 on Large and Huge. The
first camp is **always** a raider and the second **always** a settler, then they
alternate — so no board is all threat, and no board is all trade. A big map
being emptier than a small one was the complaint; a big map now has more people
in it and they are further away.

They are addressed by **id**, never by position in `world.camps`. Camps are
razed, leave the valley and are replaced, so an index points at the wrong people
sooner or later. Every order, every raid party and every marching worker carries
a `campId`.

### Trade

A settler camp with a market sends a caravan about every 11 days. It walks to
your base at 3 tiles a day, waits 30 days, and goes home if nothing happens.

What it carries is the interesting part, and the first version of it was wrong
in both directions. It now takes from **every** surplus rather than only the
largest — the first version emptied stone and left 11,000 wood sitting there —
and it gives back whatever you are **shortest** of, capped at 40 units, because
before the cap it handed over 986 herbs for a pile of stone. That is not a
trade, it is a gift, and a gift is not a mechanic.

About a quarter of caravans bring a **migrant**, which is the only way in the
game to gain a worker without paying for one.

### Burning out the people who were being nice to you

You can send a war party at a settler camp exactly as at a raider camp. If you
do, the camp turns raider **permanently** — `camp.kind` changes, `camp.turnedOn`
records the day, and there is no path back. Nothing else in the codebase may
write `camp.kind`, or the consequence stops being a consequence. The button
warns you before you press it, which is the least it can do.

**Going after them.** A war party is ordered like any other standing
instruction, queues like one, and costs no resources at all — the cost is
people. Workers march, storm the camp, and:

    attack  = sum over the party of (2 + defence rating x 4)
    defence = how many fighters the camp can still field

Beat it and a building burns, goods come home and a defender is gone. Fail and
the party takes another day of casualties, and after four days of getting
nowhere they come home. Huts burn first — that is both the effective move and
the intuitive one, since it takes fighters off the board *today* rather than
starving them off over a month. Raze the camp itself and they leave the valley;
somebody else settles about 110 days later, because a permanently empty valley
turns an idle game into a screensaver.

Measured over 540 days on one seed: leaving them alone gives 25 raids and 1,035
food banked; going after them every 40 days gives 20 raids, two routs, and
2,783 food.

Three numbers here were wrong at first, and all three failed the same way —
**a system that runs and has no effect**:

1. The assault could never win. Five armed workers mustered 8.5 against a
   healthy camp's 12: 400 days of expeditions, 98 repulsions, zero buildings
   burned, 101 dead. An option the player cannot win is worse than none.
2. Once it could win it still changed nothing, because strength was a stored
   count that recruited itself back. It is derived from housing now.
3. A losing party was annihilated — the odds multiplier reached 3, so sending
   four farmers was not a mistake but an execution. Capped at 1.6.

## Barriers

**A fence and a wall are the same thing.** They were not, and that was the
mistake: a fence stopped animals while raiders walked straight through it, so
it was two mechanics, one of which did nothing about the threat you built it
for.

Both now stop everything, and they differ in one number — `integrity`, in
raider-days. A fence (25) falls in about a day; a wall (150) takes most of a
week, by which time a party has usually given up. A fence is therefore a real
answer to a raid, and a wall is a better one.

Nothing here is an absolute, deliberately: a defence you build once and never
think about again stops being interesting the day it goes up. **Your own
people walk through freely** — a barrier that blocked workers would mean a ring
of wall traps everyone inside it. Assume a gate.

## Getting better

The old healing was a timer: lie down, gain 1.5 health an hour. Nothing to
build, nothing to spend, nobody who did it, no way to be better at it.

A system needs four things and this has them — an **infirmary** to lie up in,
**herbs** to spend, **somebody** to do the tending (anyone can; the medicine
skill makes them better), and a **reason to bother**: a deep wound left alone
**festers**, and a festering wound kills in about a week.

Two numbers carry the whole thing:

- Plain rest is **0.4/hour**, down from 1.5. At the old rate, five different
  configurations — nothing, a bed, herbs, both, both plus a trained healer —
  measured *identically*. A baseline that good leaves nothing to improve.
- Festering does **16/day**, which must exceed what rest restores (9.6/day) or
  it is not a threat, it is a slower recovery.

Measured over 25 days with four badly hurt workers: no care at all kills two of
them; a bed alone prevents every death; herbs alone prevent the festering.

It cannot kill anyone who was not warned — festering emits an event every
single day of it. Death by inattention is fair; death by surprise is not.

## The loop

You direct **people**. Buildings, once built, produce on their own — that is
what keeps it idle-friendly.

- A job is costed in **worker-hours**, so two workers halve the wait.
- Jobs **queue**. `startWork` puts the job on the tile; whoever comes free next
  picks up the one with the fewest workers on it, oldest first, nearest to break
  a tie. A job nobody can route to is skipped until tomorrow.
- Workers with nothing asked of them **mend what is falling down**, then go
  **foraging**. That was added after measuring: they were out of the base 2% of
  the time, which made the fox, the horse and the map itself inert.
- Anyone badly hurt **walks home and rests**, automatically. An idle game must
  not punish you for looking away.

## The base

Camp → Homestead → Hamlet → Village → Town. Each level houses more people and
unlocks the next thing: a workshop at Homestead, training at Hamlet, mastery at
Village.

The late levels are priced in **timber and stone, not food**. Food is a flow,
not a pile — every worker eats six a day, so a settlement big enough to be worth
upgrading eats its own surplus and the bank never fills. The first pass wanted
400 food banked for a Village and a two-year playthrough never got there.

Skills cap at **5**, and 4–5 are mastery: a Village to teach, several times the
cost, three times the hours, and about 15% more output. That is a late-game sink
for a settlement with nothing left to want, not a power spike.

Tools are a **shared pool** — a count per kind, not personal kit — and they
**wear out** from use, which is what keeps the workshop running. Wear is pooled
too: `world.toolUse` banks hours per kind and one breaks when a kind has banked
a whole tool's life. Same player-visible behaviour as per-tool condition,
without a record per tool in every save.

## Horses

Catching a horse is an **order**, not an accident. You ask for one; the next
free worker walks out, chases it, and leads it back to a paddock. It can fail —
a spooked horse bolts and the chase continues — which is what makes horsemanship
worth training.

Two details worth keeping:

- **Patience measures wasted hours, not elapsed ones.** The counter resets
  whenever the worker gets closer than they have ever been, so a long walk never
  times out and a horse that keeps outrunning them does.
- **A caught horse is not automatically ridden.** It goes to the paddock;
  mounting is a separate decision. Otherwise the first person to catch anything
  is permanently the one on horseback.

## The rivals

Raiders arrive from the edge of the map, take what is not in a granary, and
leave. The design rule is that **a raid is a tax on visible surplus, not a dice
roll on your settlement**:

- Pressure follows **exposed** goods, so a granary makes you less worth robbing
  rather than merely cushioning the blow. Build enough and you are genuinely not
  worth the walk.
- The answer is always **building something**: granaries put goods out of reach,
  walls bar the way, watchtowers give a day's warning. All three are stone,
  which is what stone was short of.
- **Raids cost goods, not people.** There is a test asserting that.

Three bugs in this system are worth remembering, because all three *looked like
working code*:

1. `raidEntry` gave up silently on the default board, so **no raid ever
   happened** while every other test passed.
2. Fights were evaluated at range 1. A raider moves three tiles a day and a
   worker six, so they were never in the same square when the day was scored:
   **zero raiders were ever driven off** while workers were being injured.
3. A party that could not reach its target never left, so `world.raiders` never
   emptied and **no further raid was ever scheduled**. One playthrough froze on
   day 107 and the rivals were dead for the next four hundred days.

The lesson each time: assert that the system *fires*, not only that it returns
the right shape when it does.

## Night, and the four things that were wrong in it

Night used to sit flat at **0.39** of light for ten hours, and the key light was
the SUN — below the horizon, flipped back above it and left dim so it did not
light the world from underneath. That flip was a fudge covering a missing light.

There is now a real moon: a second directional light on the anti-sun side of the
sky, `MOON_KEY` of directional and `MOON_AMBIENT` of fill, ramped in by sun
elevation. Night measures **0.94**, about 2.3× as light, and dusk and dawn are
untouched because the ramp finishes before there is any sky colour left to
spoil. Winter nights are longer *and* moonlit for longer, for free.

**The moon has no phase cycle, deliberately.** It is drawn as the anti-sun —
opposite side of the sky, so it rises as the sun sets without needing an orbit —
which means it is geometrically always full, and a phase in the lighting would
contradict the disc in the sky. It could be given an orbit of its own, and then
a new moon would be a night you cannot see in. This exists precisely so that you
can. Every night gets a moon; that is a game decision, not an oversight.

Making the moon a real light then exposed three faults that had been harmless
while the far side of the sky held nothing but a dim disc:

1. **The sun flipped 180° at midnight, every night.** `sunDirection` computed
   its azimuth as `PI * clamp01(through)`, pinning it at one end all night and
   the other end from sunset — and at midnight `through` crossed between them in
   a single frame. The comment directly above it had always claimed it swept the
   whole day so the moon would travel sensibly. The clamp did the opposite of
   what the comment said. Worst per-minute step across all four seasons: 0.87
   before, **0.007** after.
2. **The clock ran backwards an hour, every game hour.** Time of day was
   `prop hour + ref fraction` — the fraction reset the instant it wrapped, the
   hour arrived a frame later. Measured at **79 backward jumps in twenty seconds**
   on Fast, up to 0.93 of an hour each; the sun, every shadow, the lamps and the
   clock read-out all snapped together. `visualClock.js` owns its own hour now
   and reconciles against *what it expected the simulation to read*, using
   absolute hours — a bare 0..23 cannot tell a late render from a real jump.
3. **Three shadow faults, all landing at sunset.** The light grazed at 0.04 of
   its radius, stretching the shadow map over an enormous depth range;
   `castShadow` switched off with the sun still at most of its strength, which
   both popped and recompiled every material in the scene; and the shadow camera
   had no target at all, so it sat at the origin forever and shadows stopped
   existing the moment you panned off the middle of the board.

And one self-inflicted: quantising the shadow frustum to stop it crawling made
it *strobe* instead, because `Math.round` is unstable on a boundary and the
camera is never perfectly still. `settle()` holds the value unless the view has
moved three-quarters of a step — with tests for both halves, that it holds still
and that it still moves.

None of this was visible to any test, because all of it lived inside a
`useFrame`. That is the lesson, and it has its own section under Testing.

## Rendering

- One **InstancedMesh** for every visible tile. Only chunks near the camera are
  built, so a 400×200 board costs about what a 24×16 one does.
- **Nothing in the scene holds simulation state.** Smooth movement and the lamps
  are ref mutations inside `useFrame`; putting either in React state would
  re-render the board sixty times a second.
- Dynamic lights are **capped at 8** and moved to whichever buildings are
  nearest the camera. Every light is compiled into every material's shader, so
  a ninth does not cost 12% more — it stalls the frame.
- A crash inside the canvas is caught by `CanvasBoundary` and costs you the
  picture, not the farm.

## Performance, and three lessons

The simulation runs at **1.0–3.0 ms per game day, and the figure barely moves
between board sizes** — 24×16 and 400×200 cost the same, though the larger board
is 208 times the area. A hundred days of offline catch-up on the biggest board is
about a fifth of a second. `test/scaling.test.mjs` measures all four sizes and
asserts it stays that way.

That flatness is not luck, it is the sparse tile store: nothing inside
`advanceHour` walks the whole board. `allTiles` exists for tests and benchmarks
and has no callers in `src/game/` or `src/ui/`. Keep it that way and the size
menu is free; add one full scan to the hourly path and the Huge board dies.

**Lesson one — a failed search is the expensive one.** It used to be 194ms:

> A **failed** path is the most expensive kind — the search cannot stop early,
> so it expands its whole node budget before admitting defeat. One unreachable
> building was therefore re-searched by every idle worker every hour, forever,
> and they then stood still anyway.

The guard is `lastPathFail`, stamped on the job or the building and retried
tomorrow. Jobs already had it; the repair chore did not. If the game ever feels
slow again, look for something being searched for repeatedly and not found.

`findPath` is A*, not Dijkstra, with hex distance as the heuristic, and its
frontier is a binary min-heap. That heuristic must never over-estimate the
remaining cost or paths silently stop being optimal.

`getTerrain` keeps a lazily-filled cache of base terrain in `world.baseTerrain`,
because one A* search asks about eighteen thousand tiles and each miss was
recomputing fractal noise — 36% of all time on a large board. It needs no
invalidation: base terrain is a pure function of `(seed, q, r)`, and `modified`
is consulted first. It is cleared wholesale at 40,000 entries rather than
evicting cleverly, since refilling it is cheap and bounding it matters more.

**Lesson two — profile, do not guess.** Told that a large board cost 104 ms/day,
the obvious suspect was the linear-scan priority queue in `findPath`. Replacing
it with a heap moved 104.5 to 97.6. A CPU profile then said `fbm2` was 36% and
the heap was nowhere, which is how the terrain cache got written. The guess cost
an hour; the profile took two minutes.

**Lesson three, and the expensive one — measure the thing, not the harness.**
That 104 ms/day was not real. The benchmark chose tiles out of `allTiles(...)`,
whose iteration order starts at the far corner of the board, so on a 400×200 map
it claimed land and built farms *two hundred tiles from home* — which no player
can do, because building is confined to territory and territory grows outward
from the base. What it was measuring was six workers failing, five times a day,
to walk somewhere unreachable. A later version of the same benchmark put its own
`[...allTiles(world)]` scan — eighty thousand tiles, most generated on the spot —
*inside* the stopwatch and billed the simulation for it.

Two rounds of optimisation went into a number the benchmark was generating. Both
optimisations were worth keeping and neither was the problem. The rule that came
out of it: **time the narrowest possible thing, and make the benchmark play the
game the way the game is played.** `scaling.test.mjs` does both, and says so at
length in its header so nobody repeats the afternoon.

## Testing

`npm test` — 342 tests, about twenty seconds, no browser. `npm run lint` is a
`no-undef` check over plain JavaScript (`tsc -p tsconfig.lint.json`; nothing is
compiled and no `.ts` file exists). `npm run check` runs both. Everything in
`src/game/` is plain JavaScript with no React or Three.js imports, which is the
entire reason that is possible. `buildingLook.js` lives in `scene/` but is kept
free of JSX for the same reason.

`test/support.mjs` lets a test say "the player has settled this ground" and get
on with what it is actually testing. `test/territory.test.mjs` must not use it:
the thing it tests is exactly what those helpers skip.

`test/imports.test.mjs` reads every file in `src/` as text and checks that each
named import resolves to a real export. `node --test` only imports what a test
names and cannot parse JSX at all, so a missing export in a `.jsx` file reaches
the browser as a blank screen with no test failure anywhere. That has happened.

`test/smoke.test.mjs` plays a busy year — building, claiming, training,
catching horses, sending war parties, talking to the assistant — and insists
nothing throws. It exists because `takeWarOrder` called an **unimported**
`bestWeapon` and every test passed: an identifier that was never imported is
not a bad import, it is a free variable, and nothing static catches it. The
real answer is a linter with `no-undef`, which is still on the TODO; this is
the version that works today.

`test/scaling.test.mjs` plays four boards and times only what is inside
`advanceHour`. Its bounds are deliberately loose — a timing test that fails on a
busy machine gets deleted, and a deleted test guards nothing. What it needs to
catch is a thirty-fold regression, not a ten-percent one. It also asserts the
thing the scaling feature actually promised: that a bigger board gets more
neighbours, which is exact rather than timed.

### Anything inside a `useFrame` is untested by construction

It needs React and Three.js to run at all, so `node --test` cannot reach it and
the only thing that ever looks at it is a person watching the screen. Every
fault in that code has arrived as a bug report rather than as a failing test.

So three modules now sit in `src/scene/` with no React and no Three.js imports:

| Module | Pulled out because |
|---|---|
| `buildingLook.js` | the LOOK and LAMP tables needed testing |
| `sunShadow.js` | three shadow faults at once, none visible to any test |
| `visualClock.js` | the sun ran backwards an hour, every hour, for months |

**If a `useFrame` is deciding something rather than applying something, that
decision belongs in a plain module next to these.** `Atmosphere.jsx` now reads
almost entirely as "work out the answer, apply the answer", which is what it
should have looked like all along.

`test/visualclock.test.mjs` is worth copying for one thing in particular: its
**first test is the bug**, run against a faithful copy of the old expression. A
test that reproduces the fault is the only kind that proves the fix was aimed at
the right thing, and it keeps the reason on the record rather than in a commit
message nobody will read.

### The failure mode this project keeps having

The tests that have earned their place are the ones asserting that a system
*does something*, over a realistic run, rather than that a function returns the
right shape. Every serious bug in this project has been a system that ran
without errors and had no effect — the fox that never bit anyone, the raid that
never launched, the healing that measured the same with and without, the camp
strength that recruited itself straight back.

Its close cousin, and the one that cost the most: **a check that runs and cannot
fail.** While fixing the shadows I wrote a JSX syntax sweep, got a clean result,
and only then thought to plant a deliberate error in it — which it also passed,
because the thing I thought was illegal was not. The sweep was worthless until I
had watched it fail. The same applies to the linter: `npm run lint` reported a
clean tree, and that meant nothing until the `bestWeapon` bug was planted again
and `TS2304` came back.

**Watch a new check fail before you trust it passing.**
