# Current update

**2026-09-25 — the torch.** `docs/18-the-torch.md`. A raid party of three or
more now sends one of them after a building it has chosen — a granary first —
and stays on it until it is a ruin, which is the first time the exchange has run
both ways. The torch-bearer does not fight, and that is a measured balance fix,
not flavour. Two backlog items turned out to be already fixed: a tower **in
repair** spots nine raids out of nine (a neglected one decays to range 0 and
spots one in five, which is where "2 in 25" came from), and `raidFoiled` fires
four times in 400 days once three granaries cover what you hold. 475 tests pass.

**2026-09-25 — goats and hens.** `docs/17-goats-and-hens.md`. Two animals that
are not more rabbits: a goat grazes **sand**, which nothing else in the game has
ever wanted, and gives milk every day of the year; a hen lives in a coop, eats
**grain**, and lays through the winter — the first use seeds have had besides
planting a wood. A fox will take a hen from a coop standing in the open and
**gains nothing** by it (invariant 6), so a fence around the coop is the answer.
Pens are no longer rabbit-shaped: `penFor(world, q, r, species)`. 472 tests pass.

**2026-09-24 — the ladder means something.** `docs/16-the-ladder.md`. The base
level is now the population ceiling and houses fill it in — 4 / 7 / 11 / 16 / 22,
the numbers that were already written down — so a "Hamlet" is no longer 15 people
and a Village no longer holds 55. Village and Town cost roughly three times what
they did. Town moved from day 96 to day 150 and the population settles at 22.
**The next lever is labour, not price:** a Town of sixteen still runs 146
buildings, because buildings produce whether or not anyone works them, and that
is why price rises get out-accumulated. 462 tests pass.

**2026-09-24 — the resource rework.** Two passes, both measured on
`scratch/growth.mjs` before and after. `docs/14-the-ground.md`: a woodcutter
thins the stand it stands in and the stand grows back, a quarry seam is finite,
and ground you cleared and left alone turns back into wood. `docs/15-ceilings-and-the-monument.md`:
herbs and seeds have a ceiling, and the monument is a sink that takes stone and
timber every day for the rest of the game. Stone at day 288 is down from 11,850
to 4,491 and Town moved from day 96 to day 144 — the target is nearer 200, so
this is not finished. **461 tests pass. Save version 12.**

**2026-09-21 — first playtest fixes.** Horses no longer starve or vanish without a
trace, there's one way to get a horse (the catch order), wildlife migrates in near
home, and kept animals now pay their way (pens, foals, manure, market). Camps keep
growing with you, and the player's snowball has real brakes: upkeep that rises with
size, farmland fertility, masonry upkeep and the rising cost of land. See
`docs/13-playtest-fixes.md`, including what was measured and what is **not** done yet.
437 tests pass. Save version 11.


Fixed 48-second days, removal of manual time skips, and timed construction/upgrades for all factions are complete. See `docs/09-pacing-and-construction.md`.

Saving, recovery backups, job priorities, minimap, milestones, optional recurring resource uses, requested trades, rival inspection and attack fixes are implemented. See `docs/08-settlement-controls.md`. The notes below record earlier design observations; economy balance remains open to playtesting.

# Hex Farm — TODO

Current as of 2026-09-13 (eighth revision). `docs/03`–`docs/06` are now marked
HISTORICAL at the top of each file; `docs/07-the-game-now.md` is the current
picture and is the thing to read first.

**342 tests pass.** `npm test` is the fastest way to know you have not broken
anything; it runs in about twenty seconds now that `scaling.test.mjs` plays four
boards. `npm run lint` is new and catches the one class of bug that has shipped
twice; `npm run check` runs both.

> The visual work is being seen now, and it keeps finding things the tests could
> not. Three separate reports — "too bright", "the shadows seem jittering",
> "flickering when changing day" — turned up six real faults between them, four
> of which had been in the code for months. The simulation itself has still
> never been watched in a browser; everything about the rules below was measured
> headlessly.
>
> The lesson worth carrying: **anything living inside a `useFrame` is untested
> by construction.** Three modules have now been pulled out of one — see
> "Scene logic that is plain JavaScript" below.

---

## The invariants — break these and things fail quietly

1. **`advanceHour` is the only thing that changes the world.** Not `dispatch`,
   not the sky, not the assistant. This is what makes turn-based play, idle
   play and offline catch-up the same code.
2. **A season is a pure function of `world.day`.** Nothing seasonal is stored.
3. **Tiles are sparse.** `getTile` may hand back a *throwaway* built from the
   seed; writing to it does nothing. `touchTile` is the only way in.
4. **Terrain changes go through `setTerrain`**, which keeps the histogram
   right, which is what makes animal capacity O(1).
5. **Anywhere the scene memoises something derived from `tiles`, `revision`
   belongs in the deps.** Tiles are live mutable objects; array identity is
   not a signal that the contents changed. This caused the demolish crash.
6. **A fox must never gain anything from attacking a person.** The
   predator-prey balance is tuned across three simulated years on the
   assumption that rabbits are the only food. A second source would rewrite
   all of it silently.
7. **Every resource needs at least one source that does not cost that
   resource.** Learned the hard way: two farms spend all your starting wood,
   and with no wood you cannot build a woodcutter. Clearing forest is the
   escape hatch, and the advice now names it.
8. **Nothing may occupy `world.raiders` indefinitely.** A raid party that
   cannot reach its target never loots and never leaves, so no further raid is
   ever scheduled. One playthrough froze on day 107 and the rivals were
   silently dead for four hundred days.
9. **Days are 1-based.** `calendar.js` clamps now, but do not lean on it.
10. **Territory claims are REFERENCE COUNTED.** Two buildings side by side both
    claim the tile between them; a plain set would punch a hole in the middle of
    the farm when either was demolished, invisible until somebody tried to
    build there.
11. **There must always be something claimable on the frontier.** Gating jobs
    on land means a settlement that cannot expand can do nothing at all, and it
    fails with every button greyed out and no explanation. The claim job is the
    guarantee; `territory.test.mjs` checks it across 25 seeds.
12. **A neighbour's buildings live on the camp, NOT on tiles.** Everything that
    walks the active set would otherwise need a faction check, and forgetting one
    means your farms pay out for their fields.
13. **Their strength is `min(fighters, housing)`, never a stored number.** It
    is the only reason burning a hut is visible as fewer raiders. A stored
    `fighters` count was recruited straight back, so razing a camp measured as
    doing nothing at all.
14. **There are many neighbours, addressed by `id`.** `world.camps` is an array
    and `campById` is the only way in. An index is not an identity: camps leave
    the valley and come back, and anything holding a position instead of an id
    will point at the wrong people. Every order, every raid party and every
    marching worker carries a `campId`.
15. **A settler camp can become a raider camp; the reverse never happens.**
    Burning peaceful neighbours out sets `kind = "raider"` permanently. Nothing
    else may write `camp.kind`, or the consequence stops being a consequence.
16. **Nothing in `advanceHour` may walk the whole board.** `allTiles` is for
    tests and benchmarks only — the simulation uses the sparse active set, and
    that is the entire reason a 400×200 board costs the same per day as a 24×16
    one. `scaling.test.mjs` is the guard.
17. **Never mix a value from a ref with a value from a prop.** They update at
    different moments. The time of day was `prop hour + ref fraction`, and on
    the frame the fraction wrapped it had already reset while the hour had not
    yet arrived — so the sun jumped backwards nearly an hour, every game hour,
    for months. If two numbers have to agree, one thing owns both.
18. **`sunDirection` must sweep continuously through the whole 24 hours.** It
    is the anti-sun, so the moon rides on it. A clamp that pinned the azimuth
    overnight flipped the light 180° at midnight; harmless while the far side
    of the sky held only a dim disc, and very much not once the moon became a
    real light.
19. **Anything quantised against a moving input needs hysteresis.** Snapping
    the shadow frustum to a grid stopped it crawling and started it strobing,
    because `Math.round` is unstable on a boundary and the camera is never
    perfectly still. `settle()` in `sunShadow.js`, and there are tests for both
    halves — that it holds still, and that it still moves.

---

## 0 — Do these first

Both of these need you rather than me: this session has no shell on your machine
and its npm registry is blocked, so neither could be run from here.

- [ ] **Make it a git repo.** Fifteen passes of substantial change, no history.
      If a pass goes wrong there is still no way back. `.gitignore` is now
      written and checked against what is actually in the folder, so this is
      two commands:

      ```
      git init && git add -A
      git commit -m "Hex Farm as of the fifteenth pass"
      ```

- [ ] `npm install` once, to pick up `typescript` — it is a new devDependency
      and `npm run lint` needs it. See section 5 for what it is doing there.
- [ ] Push to GitHub and set Settings → Pages → Source to "GitHub Actions"
      (Firebase is dropped; see README "Put it on GitHub Pages"). `docs/00`
      argues for deploying on day one and it has now been rather more than one day.
- [ ] A **formatter** is still missing. Prettier, probably; the linter half of
      that old TODO item is done.

---

## 1 — DONE: the base, and danger

Both built. Camp → Homestead → Hamlet → Village → Town, each level housing
more people and unlocking the next thing:

- **Hire** — buy a worker today instead of waiting for one. Each costs more
  than the last, and paying never lifts the ceiling: housing and food still
  bind. Money buys speed, not physics.
- **Craft** (homestead+) — axe, spade, pick, spear. Tools are a shared POOL;
  workers pick up whatever suits the job and put it back, so there is no kit
  management.
- **Train** (hamlet+) — labour helps everything a little, the four trades help
  a lot but only their own work. Costs resources and the worker's time.
- **Danger** — foxes bite people in the field, workers hunt at a cost, the
  hurt walk home and rest, and a dying rider frees their horse to the wild.
- **Foraging** — idle workers with nothing to mend go out and look for food
  and seeds. Added after measuring: workers were out of the base 2% of the
  time, which made the fox, the horse and the map itself inert.

Everything is in `src/game/base.js` and `src/game/danger.js`, both data-first.

## 1b — DONE: it moves, and it is lit

- **Workers and animals walk** instead of teleporting between tiles, via
  `src/scene/useSmoothMotion.js`. The simulation still moves them a whole tile
  at a time — only the picture catches up, so nothing about `advanceHour`
  changed. Exponential smoothing, no React state, no per-frame allocation, and
  it snaps rather than slides when the gap is more than 8 units (that is the
  camera window scrolling, not a walk).
- **Lamps on everything you have built**, so night reads as scattered lit
  farmsteads rather than a black screen. Three layers: an emissive lantern and
  a blended pool of light per building (both free), plus a fixed pool of 8 real
  point lights that move to whichever buildings are nearest the camera.
  `MAX_LAMPS` in `buildingLook.js` is a hard cap and the comment there explains
  why. Brightness comes from `skyAt().lampGlow`, which is driven by sun
  elevation — so winter evenings light earlier than summer ones for free.

## 2 — DONE: stone has somewhere to go, and skills have a top end

- **Tools wear out.** Pooled wear: `world.toolUse` banks hours per KIND and one
  breaks when a kind has banked a whole tool's life. Same behaviour as per-tool
  condition, without a record per tool in every save.
- **Four new buildings**, all stone sinks and all defences: **stone wall** (bars
  raiders, never decays), **watchtower** (a day's warning, steadies fighters),
  **granary** (puts goods out of a raid's reach), **paddock** (somewhere to keep
  caught horses).
- **Skills cap at 5.** Levels 4–5 are mastery: a Village to teach, several times
  the cost, three times the hours, ~15% more output. A late-game sink, not a
  power spike. A fifth skill, **horsemanship**, arrived with the horses.
- **Village and Town are reachable.** The late levels are priced in timber and
  stone rather than food — food is a flow, not a pile, so a settlement large
  enough to want an upgrade eats its own surplus. A greedy 540-day playthrough
  now reaches **Town with 22 people**; before, it stalled at Hamlet.
- **Deaths are no longer very rare in one direction and lethal in the other.**
  The dials are `RAIDER_HIT` and `FIGHT_RANGE` in `rivals.js` and
  `FOX_ATTACK_CHANCE`/`FOX_REACH` in `danger.js`. Re-run `seasons.test.mjs`
  after touching the fox ones — it guards the predator-prey balance.

## 2b — DONE: the rivals, and horses you can actually ask for

- **Rival farmers raid you.** They take whatever is not in a granary and lead
  your horses away. Pressure follows EXPOSED goods, so building granaries makes
  you less worth robbing rather than merely cushioning the blow. Tribute exists
  for the settlement caught out with nothing built, and is deliberately the
  worse long-run answer.
- **Catching a horse is an order.** You ask; the next free worker walks out,
  chases it, and leads it back to a paddock. It can fail. Caught horses are NOT
  automatically ridden — mounting is a separate decision.

## 2c — DONE: territory, barriers, and looking after the hurt

- **Territory.** The board is not yours; your land is what you have built on or
  worked, plus the ring around it. Building and working are refused outside it,
  and the border is drawn on the board so the refusal is visible before it is
  hit. Raiders may not enter ground you hold.
- **The claim job** — 10 worker-hours, no cost, frontier tiles only. Not
  optional: without a job that works on bare ground, a settlement whose opening
  nineteen tiles held no forest and no rock could never expand, and it would
  fail with every button greyed out and nothing on screen to say why.
- **A fence and a wall are now the same thing**, differing only in `integrity`.
  Both stop everything; a fence falls in about a day, a wall takes most of a
  week. Nothing is an absolute any more. Your own people walk through freely —
  a barrier that blocked workers would trap a settlement inside its own wall.
- **Healing is a system rather than a timer.** An infirmary to lie up in, herbs
  to spend, somebody to do the tending, and wounds that fester if nobody does.
  Plain rest dropped from 1.5/hour to 0.4 because at the old rate five
  different configurations measured identically.

## 2d — DONE: the neighbours have an address

- **A second settlement on the board.** Camp, border, fields, a store of what
  they have taken from you, and fighters. It grows on a timer and raids set out
  from there, so the threat has somewhere you can go and look at.
- **You can go after them.** A war party costs no resources — only people, who
  march for days and come back hurt. Burn their huts and they field fewer
  raiders today; burn their fields and they starve down over a month; raze the
  camp and they leave the valley for about 110 days.
- **Spears decide it.** Unarmed farmers are repulsed every time; an armed party
  gets in. That is the clearest reason the workshop has ever had to exist.
- Measured over 540 days: leaving them alone gives 25 raids and 1,035 food
  banked; attacking every 40 days gives 20 raids, two routs and 2,783 food.

## 2e — DONE: the valley fills up, and it fills up in proportion

- **Not everyone out there wants to rob you.** There are two sorts of
  neighbour now. **Raiders** are the camp from 2d, unchanged. **Settlers** build
  farms, markets and workshops, never raid, and send a **caravan** to your gate
  about every eleven days.
- **Trade is a real exchange, not a shop.** A caravan carries 200 units, takes
  from *every* surplus you have rather than only the largest, and gives back
  whatever you are shortest of — capped at 40 units, because the first version
  handed over 986 herbs for a pile of stone and that is not a trade, it is a
  gift. It waits 30 days and then goes home. Roughly a quarter of the time a
  **migrant** walks in with it, which is the only way to gain a worker without
  paying for one.
- **Settlers are not pacifists, they are peaceful.** Burn them out and the camp
  turns raider **permanently** — `camp.kind` changes and `camp.turnedOn` records
  the day. There is no path back. The war-party button on a settler camp says so
  before you press it.
- **How many neighbours you get scales with the board.** `campCountFor` is
  `clamp(round(sqrt(tiles) / 13), 1, 6)` — 2 on Small, 5 on Medium, 6 on Large
  and Huge — and how far off they settle scales the same way,
  `clamp(round(sqrt(tiles) / 4), 8, 40)` tiles. The first camp is always a
  raider and the second always a settler, then they alternate, so no board can
  be all threat or all trade.
- **Measured flat across all four board sizes: 1.0–3.0 ms per simulated day.**
  A hundred days of offline catch-up on the Huge board is about a fifth of a
  second. See the note at the top of `scaling.test.mjs` — two rounds of
  optimisation went into a 100 ms/day figure that the *benchmark* was
  generating, and the lesson is written down there at length.

## 2f — DONE: a moon, and four things that were wrong in the dark

Asked for as "night is a bit dark, could you add maybe a moonlight, still dark
but not that dark". Three rounds, because each fix uncovered the next fault.

- **Night has a moon.** It used to sit flat at 0.39 of light for ten hours, and
  the key light was the SUN — below the horizon, flipped back up and left dim.
  That flip was a fudge covering a missing light. There is now a second
  directional light on the anti-sun side of the sky, and night measures **0.94,
  about 2.3× as light**. Dusk and dawn are untouched, because the ramp is keyed
  to sun elevation and is finished before there is any sky colour left to spoil.
- **No phase cycle, deliberately.** The moon is drawn as the anti-sun, so it is
  geometrically always full. It could be given an orbit of its own, and then a
  new moon would be a night you cannot see in — which is the thing being fixed.
  Every night gets a moon. `MOON_KEY` and `MOON_AMBIENT` are the dials.
- **The sun flipped 180° at midnight, every night.** `sunDirection` clamped its
  azimuth, pinning it at one end all night and the other end after sunset, and
  at midnight it crossed between them in a single frame. The comment above it
  had always claimed it swept the whole day. Harmless while the far side of the
  sky held a dim disc; catastrophic once the moon was a real light at full
  strength. Worst per-minute step across all four seasons: **0.87 → 0.007**.
- **The clock ran backwards an hour, every game hour.** Time of day was
  `prop hour + ref fraction`; the fraction reset the instant it wrapped and the
  hour arrived a frame later. Measured at **79 backward jumps in twenty seconds
  on Fast**, up to 0.93 of an hour each. `Clock.jsx` had the same fault and
  would show 06:59 after the world had reached 07:00.
- **Three shadow faults**, all landing at sunset: the light grazed at 0.04 of
  its radius so the shadow map was stretched over an enormous depth range;
  `castShadow` switched off with the sun still at most of its strength, which
  both popped and recompiled every material in the scene; and the shadow camera
  had no target, so it sat at the origin forever and shadows simply stopped
  existing once you panned off the middle of the board.
- **Quantising the frustum traded a crawl for a strobe.** `Math.round` is
  unstable on a boundary and the camera is never still. `settle()` holds the
  value unless the view has moved three-quarters of a step.

Two of those six were mine, introduced by the fix before. The rest had been
there for months and no test could see any of them, which is what section 5b
is about.

## 3 — Next up

- [ ] **Stone still runs away, but trade now bites.** It was 18,000 by year two;
      caravans take from every surplus, so on a board with a settler camp the
      pile is visibly dented. On a board with only raiders it is untouched, and
      whether you get a settler is the seed's decision rather than yours.
      Something that wants stone *continuously* is still the answer.
- [ ] **Herbs accumulate past any possible use** (300+ by year two) because
      foraging is what every idle worker does. Trade will take them now, at the
      harshest rate in the table, which is a sink but not a use.
- [x] **Nothing lets you ask for a trade.** Resolved in the settlement-controls update. Previous note: A caravan turns up when the settlers
      feel like it and offers what it offers. A market of your own, or a request
      you could send, would make the relationship something you steer.
- [x] **A camp that has turned raider is indistinguishable afterwards.** Resolved in the settlement-controls update. Previous note: The
      day is recorded in `camp.turnedOn` and nothing reads it. The panel should
      say "they used to trade with you", because that is the most interesting
      sentence in the game and it is currently invisible.
- [ ] **Expansion has no resource cost.** The claim job is deliberately free so
      it can never softlock, but that means land is unlimited if you are
      patient. A cost that is refundable, or that scales with how much you
      already hold, would make the border a decision.
- [x] **`raidFoiled` has never fired in a playthrough.** Measured 2026-09-25: it
      fires four times in 400 days once three granaries cover what you hold. The
      complaint was really "no run has built three granaries". `docs/18`.
- [x] **Watchtowers only spotted 2 raids in 25.** Measured 2026-09-25: a tower
      **in repair** spots nine of nine. One left to decay drops to range 0 over
      180 days and spots one in five, which is where the old number came from.
      `docs/18`.
- [x] **A stolen horse is still gone for good.** Fixed in the playtest pass:
      stolen horses wait in `camp.horses` and razing a building brings them home.
- [ ] **Nothing scouts.** You can see their camp only if the camera is over it,
      so the panel numbers are the only way to know their strength. A watchtower
      that reported on them, or a worker sent to look, would fit.
- [x] **They never attack your buildings deliberately.** Done 2026-09-25: one
      raider in a party of three carries a torch and comes for a named building,
      a granary first. `docs/18`.
- [ ] **Horses still only carry.** Cart? Ploughing? Horsemanship now has a
      reason to exist but only one.

## 4 — Known gaps and rough edges

- [x] **No minimap.** Resolved in the settlement-controls update. Previous note: `maxDistance` is capped deliberately (zooming out to see
      a 400×200 board would mean rendering it), so on a large map you can get
      lost.
- [x] **Jobs cannot be reordered or prioritised.** Resolved in the settlement-controls update. Previous note: Strict FIFO by `work.seq`.
- [x] **No way to see the whole job queue** Resolved in the settlement-controls update. Previous note: except by clicking each tile.
- [ ] **`world.parserMisses` is collected and never read.** It is how a parser
      grows — look at it occasionally.
- [ ] **Training can starve you.** Nothing stops a player dumping every scrap of
      food into skills. Arguably their choice; a warning would be kinder.

---

## 5 — Housekeeping

- [x] `seasonOf(0)` no longer returns a degenerate object — `calendar.js` clamps
      days to 1 at the entrance, so a stray 0 cannot turn the whole sky NaN.
- [x] An error boundary wraps the canvas. A throw in the scene now costs the
      picture, not the farm and not the session.
- [x] `docs/03`–`docs/06` are marked HISTORICAL at the top, and
      `docs/07-the-game-now.md` describes the game as it actually is.
- [x] `README.md` rewritten — "What already works" no longer stops at step 2.
- [x] `imports.test.mjs` checks every named import in the tree resolves, and
      `smoke.test.mjs` plays a few hundred days so the runtime finds free
      variables a static check cannot. Both were written after a bug shipped.
- [x] `scaling.test.mjs` measures the clock at all four board sizes and asserts
      it stays flat, so the next person to see a big number checks the harness
      before optimising the engine.
- [x] **A `no-undef` linter, at last.** `npm run lint` — `tsc -p
      tsconfig.lint.json`, which is TypeScript used purely as a checker over
      plain JavaScript. No `.ts` file exists and nothing is compiled; `strict`
      is off on purpose, because turning it on means hundreds of implicit-any
      errors that would bury the one class of error that has actually cost
      anything here. Verified by planting the `bestWeapon` bug again and
      watching it fail — `TS2304: Cannot find name`. The tree is clean.
      `npm run check` runs the linter and the tests together.
- [x] `.gitignore` written and checked against what is actually in the folder,
      so `git init` is now two commands. See section 0.
- [ ] **Make it a git repo.** Still no history. Needs you — no shell here.
- [ ] Publish to GitHub Pages (README, "Put it on GitHub Pages").
- [ ] **A formatter.** Prettier. The linter half of this is done.
- [ ] `docs/DESIGN.md` reasoning is still sound but its details predate hours,
      workers and the rivals.

---

---

## Where things are

```
src/game/            pure rules — no React, no Three.js, all of it tested
  hex.js             axial coordinate maths
  grid.js            the rectangular board; offset <-> axial translation
  noise.js           hashed value noise, position-addressed
  worldgen.js        what a tile looks like before anyone touched it
  tiles.js           getTerrain / getTile / touchTile, the active set
  world.js           createWorld, save and load (version 8)
  terrain.js         TERRAIN + CONVERSIONS, costed in worker-hours
  buildings.js       BUILDINGS, produceHour, dailyWear
  animals.js         SPECIES, the predator-prey loop
  workers.js         people: pathing, jobs, the queue, chores
  territory.js       borders: refcounted claims, for you and for every camp
  rivalcamp.js       the neighbours: raiders and settlers, their land, caravans,
                     trade, migrants, and going after any of them
  healing.js         infirmaries, herbs, healers, wounds that turn bad
  horses.js          catching, keeping and riding them
  rivals.js          the raiders, and what they come to take
  base.js            levels, hiring, skills, tools, the work-rate formula
  danger.js          fox attacks, hunting, injury, death, rest
  calendar.js        seasons, derived from world.day
  daytime.js         sun position and sky palette, from sun elevation
  tick.js            advanceHour — the only thing that changes the world
  assistant.js       the text interface

src/scene/           Three.js
  Board.jsx          canvas, camera, orbit, what gets drawn
  InstancedTiles.jsx every visible tile in one draw call
  useVisibleTiles.js the camera window, chunked
  Sky.jsx            gradient dome, sun, moon, stars
  Atmosphere.jsx     the one place that reads the clock each frame
  NightLights.jsx    lamps on what you have built; a capped pool of 8 lights
  useSmoothMotion.js the hook that makes people walk rather than teleport
  Workers.jsx / Animals.jsx / Raiders.jsx / Building.jsx / Markers.jsx
  buildingLook.js    the LOOK and LAMP tables, plain JS so they can be tested
  sunShadow.js       where the sun stands and what its shadow covers — plain JS
  visualClock.js     the clock the SUN runs on, as opposed to the world's

src/ui/              normal React DOM
  TilePanel.jsx  BasePanel.jsx  StoreBar.jsx  Clock.jsx
  CanvasBoundary.jsx a crash in the canvas must not cost you the farm

test/                342 tests, ~20s
  hex  world  grid  buildings  ecosystem  seasons  workers  base  assistant
  rendering  horses  rivals  territory  healing  imports  rivalcamp  smoke
  scaling            four board sizes, timed narrowly — read the header note
  sunshadow          the sun's position and shadow frustum
  visualclock        the clock the sun runs on; test 1 IS the bug
  support.mjs        fixtures — lets a test say "this ground is settled"
                     and get on with what it is actually testing
```

## Scene logic that is plain JavaScript

Three modules now live in `src/scene/` with **no React and no Three.js
imports**, so `node --test` can reach them. That is not tidiness — each was
pulled out because it was wrong, had been wrong for a long time, and was
untestable where it sat:

| Module | Pulled out because |
|---|---|
| `buildingLook.js` | the LOOK and LAMP tables needed testing |
| `sunShadow.js` | three shadow faults at once, none visible to any test |
| `visualClock.js` | the sun ran backwards an hour, every hour, for months |

**Anything inside a `useFrame` is untested by construction.** It needs React and
Three.js to run at all, so the only thing that ever looks at it is a person
watching the screen — which is why every fault in that code has arrived as a
bug report rather than a failing test. If a `useFrame` is DECIDING something
rather than applying something, that decision belongs in a plain module beside
these three.

## 5b — The tests that exist because of a specific humiliation

Worth knowing why, because each guards a class of bug rather than a line.

- **`imports.test.mjs`** — `danger.js` gained a `sheltered` export, a
  hand-curated push left that one file out, and the app died on load with
  "does not provide an export named". It now checks that every named import in
  the tree resolves. *Push the whole tree. Never a chosen list.*
- **`smoke.test.mjs`** — `takeWarOrder` called `bestWeapon` without importing
  it. Every test passed, including the import test, because an identifier that
  was never imported is not an import, it is a free variable. It plays a busy
  few hundred days so the runtime finds what static checks cannot. The real fix
  is a linter with `no-undef`, which is still in section 5.
- **`scaling.test.mjs`** — see its header. A benchmark measuring itself: two
  rounds of optimisation went into a 100 ms/day figure the benchmark was
  generating, by building where no player can build.
- **`sunshadow.test.mjs`** — three shadow faults living inside a `useFrame`,
  where nothing but a person watching a sunset could ever have seen them.
- **`visualclock.test.mjs`** — the sun ran backwards an hour on every tick,
  because the time of day was half prop and half ref. **Its first test is the
  bug**, run against a faithful copy of the old expression, so what was wrong
  is on the record rather than only in a commit message. Worth copying that
  trick: a test that reproduces the fault is the only kind that proves the fix
  was aimed at the right thing.


## Numbers you will want to tune

| What | Where | Now |
|---|---|---|
| Hours per day | `tick.js` | 24 |
| Seconds per day (play speed) | `App.jsx` `SPEEDS` | 48 / 24 / 6 |
| Farm yield | `buildings.js` | 1 food/hour |
| Woodcutter yield | `buildings.js` | 1 wood/hour, 0.03 seeds/hour |
| Worker food | `workers.js` `FOOD_PER_WORKER` | 6/day |
| Worker speed | `workers.js` | 6 on foot, 18 mounted |
| Worker cap — a hard ceiling, houses fill it | `base.js` `BASE_LEVELS[].houses` | 4 / 7 / 11 / 16 / 22 |
| Upgrade prices | `base.js` `BASE_LEVELS[].cost` | 90 → 260 → 1,400 → 4,800 timber |
| Hire cost | `base.js` `HIRE_COST` | 40 food, 20 wood, +35% each |
| Skill bonus | `base.js` `SKILLS` | labour 12%, trades 35% per level |
| Tool bonus | `base.js` `TOOLS` | 55–70% on matching work |
| Fox attack | `danger.js` | reach 4, 40% a day, 14 damage |
| Forage | `workers.js` `FORAGE_*` | range 4, 3 food a trip |
| Auto-repair threshold | `workers.js` `AUTO_REPAIR_BELOW` | 70% |
| Season length | `calendar.js` `DAYS_PER_SEASON` | 24 (96-day year) |
| Winter severity | `calendar.js` `SEASONS.winter` | growth 0.35 |
| Board size | `App.jsx` `SIZES` | 24×16 up to 400×200 |
| Light budget | `buildingLook.js` `MAX_LAMPS` | 8 — a hard cap, see the note |
| **How light a night is** | `daytime.js` `MOON_KEY` | 0.42 directional |
| ...and how filled-in | `daytime.js` `MOON_AMBIENT` | 0.18 ambient |
| Night, all in | measured | 0.94, against 0.39 before the moon |
| When moonlight is full | `daytime.js` `moonlight` | elevation −0.32 to −0.06 |
| Shadow steadiness | `sunShadow.js` `MIN_HEIGHT` | 0.22 — raise for steadier, lower for longer |
| Shadow map | `sunShadow.js` `SHADOW_MAP` | 2048; 1024 was twice the crawl |
| Shadow frustum | `sunShadow.js` `MIN/MAX_SPAN` | 24–64, follows the camera |
| Frustum stickiness | `sunShadow.js` `settle` | ¾ of a step, or it strobes |
| Evening shadow fade | `sunShadow.js` `SHADOW_FADE_ABOVE` | full above elevation 0.14 |
| Lamp brightness | `buildingLook.js` `LAMP` | base 6, farm 2.4, well 1.4 |
| When lamps light | `daytime.js` `lampGlow` | ~90% lit at sunset |
| Walk smoothing | `Workers.jsx` / `Animals.jsx` | 7 / 2.5 |
| First raid | `rivals.js` `FIRST_RAID_DAY` | day 40 |
| Raid interval | `rivals.js` | 50 days poor, 18 days rich |
| Party size | `rivals.js` `MAX_PARTY` | up to 5 |
| Raider damage | `rivals.js` `RAIDER_HIT` | 12/day, before defence |
| Fight range | `rivals.js` `FIGHT_RANGE` | 3 — measured, see the comment |
| Granary cover | `buildings.js` `LAMP`/`protects` | 150 food, 120 wood, 80 stone |
| Tool life | `base.js` `TOOLS[].life` | axe 200h, spade 220h, pick 150h |
| Skill ceiling | `base.js` `MAX_SKILL` | 5, mastery from 4 |
| Catch odds | `horses.js` | 30% + 13% per horsemanship level |
| Paddock size | `buildings.js` `stables` | 3 a paddock |
| Starting land | `territory.js` `BASE_CLAIM_RADIUS` | 1 owned, so 19 tiles held |
| Claim job | `tick.js` `CLAIM_HOURS` | 10 worker-hours, free |
| Fence / wall | `buildings.js` `barrier.integrity` | 25 / 150 raider-days |
| Breaching | `rivals.js` `BREACH_FORCE` | 10 per raider per day |
| Plain rest | `danger.js` `HEAL_PER_HOUR` | 0.4 — the "built nothing" baseline |
| Festering | `healing.js` `FESTER_DAMAGE` | 16/day; must beat rest |
| Wound risk from | `healing.js` `FESTER_BELOW` | 55 — above the retreat threshold |
| Herbs | `workers.js` `FORAGE_HERB_CHANCE` | 0.2 a trip |
| How many neighbours | `rivalcamp.js` `campCountFor` | `sqrt(tiles)/13`, 1–6 |
| How far off they settle | `rivalcamp.js` `campDistanceFor` | `sqrt(tiles)/4`, 8–40 |
| Who settles where | `rivalcamp.js` `campKindFor` | raider, settler, alternating |
| Their size | `rivalcamp.js` `MAX_BUILDINGS` | 14 buildings, 70 tiles |
| Their fighters | `rivalcamp.js` | `min(fighters, housing)`, cap 12 |
| Caravan frequency | `rivalcamp.js` `TRADE_EVERY` | every 11 days |
| Caravan load | `rivalcamp.js` `CARAVAN_CAPACITY` | 200 units, speed 3 |
| How long it waits | `rivalcamp.js` `CARAVAN_PATIENCE` | 30 days |
| What they pay | `rivalcamp.js` `TRADE_RATES` | food 5, herbs 10, seeds 20 |
| Most they will give | `rivalcamp.js` `MAX_GIVE` | 40 units — see the comment |
| Migrant odds | `rivalcamp.js` `MIGRANT_CHANCE` | 0.25 a caravan |
| Attacker worth | `rivals.js` `ASSAULT_BASE`/`ARMS` | `2 + rating x 4` |
| Worst beating | `rivals.js` `WORST_ODDS` | 1.6 x ASSAULT_HIT |
| Giving up | `rivals.js` `ASSAULT_PATIENCE` | 4 days of no progress |
| Coming back | `rivalcamp.js` `RESETTLE_AFTER` | 110 days after a rout |
