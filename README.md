# Hex Farm

A 3D hex-tile farming game, built in stages so you can learn the web stack as
you go — a mini project built with AI. React + Three.js, a static site hosted
on GitHub Pages. There is no server: your game saves to a file you download.

## Run it

Needs **Node 20.19+ or 22.12+** (`node -v` to check).

```bash
npm install         # reproduces node_modules exactly from package-lock.json
npm run dev         # http://localhost:5173
npm test            # 376 tests, no browser — keep them passing
npm run lint        # no-undef over plain JS; catches a bug that shipped twice
npm run check       # lint + test
npm run build       # produces dist/
```

`node_modules` is not included and should never be committed — that is what
`package-lock.json` is for. It pins every package to an exact version, so
`npm install` gives you the same tree I tested against.

## Put it on GitHub Pages

The site is static, so GitHub hosts it for free. `.github/workflows/pages.yml`
builds and publishes it on every push to `main`.

1. Create a repository on GitHub and push this folder to it.
2. In the repository, open **Settings → Pages** and set **Source** to
   **GitHub Actions**.
3. Push to `main` (or run the workflow by hand from the **Actions** tab). The
   site appears at `https://<your-user>.github.io/<repo-name>/`.

The workflow runs `npm run check` before building, so a push that breaks a test
is not published. `vite.config.js` uses relative paths, so renaming the
repository needs no change.

## Saving your game

- **Save to file** downloads your whole settlement as a small `.json` file.
  **Load from file** opens one, on any computer or browser. This is the real
  save: keep the file and you keep the farm.
- The browser also autosaves every few seconds as a safety net, so a refresh
  does not lose anything — but browser storage is per-browser and can be
  cleared, so download a file for anything you want to keep.

## Pacing and construction

Days run at **2 minutes each**. Run/Pause is the only time control. All factions build over time; new buildings do nothing until finished, and upgrades retain their old capabilities until completion. Farms, woodcutters and walls start at 30 seconds and take longer as each settlement claims more land, up to 4 minutes. Inspect a tile or open Manage settlement to follow progress. See [construction durations](docs/09-pacing-and-construction.md).

## New settlement controls

- **Save to file / Load from file:** download the settlement as a JSON file and open it again anywhere. The browser also autosaves every three seconds and when leaving the page, so a refresh restores your settlement. A recovery backup is kept before replacing a map or loading a file.
- **Progress while away:** only if the saved game was running and this option was enabled. Uses 120 seconds per day, respects pause, and caps absence at 120 game days. Backup imports open paused without catch-up.
- **Manage settlement:** inspect all tile jobs, change their priority, reorder within a priority, and cancel work. Track expeditions, milestones, daily programmes, and requested trades.
- **Minimap:** click any location or use Home / Village shortcuts to move the camera and inspect a tile.
- **Economy:** optional road maintenance spends stone for faster travel; preventive care spends herbs for a smaller travel bonus and daily recovery. Both preserve reserves. Request exact trades from peaceful villages with markets; goods change hands on arrival.
- **Rival inspection and attacks:** click a village building to see its condition, purpose, owner, and village inventory. The attack, tribute, and horse controls are connected. Separate villages have separate battles; blocked routes cannot start a distant fight. Failed attacks also turn peaceful settlers hostile.

See [the feature guide](docs/08-settlement-controls.md) for costs, limits, and recovery behaviour.

## What the game is now

A settlement on a hex map, with optional bounded progress while you are away.
You direct people; the buildings and the world look after themselves.

- **A rectangular board, from 24x16 to 400x200.** Only the tiles near the
  camera are rendered, and only the tiles you have touched are stored, so the
  big sizes cost about what the small ones do — measured, and asserted by a
  test: a game day costs 1–3ms at every size.
- **An hourly clock, four seasons and a real sky.** The sun's elevation drives
  the light, so a short winter day is automatically low and golden and
  midnight has no seam. Lamps come on at dusk over everything you have built,
  and a moon makes the rest of the board navigable without making it daylight.
- **Terrain you change**: quarry mountains, irrigate sand, drain and flood,
  plant and clear forest. Every job is costed in *worker-hours*, so a second
  pair of hands halves the wait.
- **People who walk there and do it.** Jobs queue when everyone is busy;
  workers with nothing asked of them go and mend what is falling down, and
  then go foraging. Population follows food, not your patience.
- **A base that turns a surplus into capability.** Camp to Town: housing,
  hired hands, a workshop, and trades that can be taken to mastery.
- **An ecosystem that is genuinely alive.** Rabbits eat your crops, foxes eat
  rabbits and occasionally bite people, and horses can be caught and ridden.
  Tuned across three simulated years, and it will collapse if you break it.
- **Land that is actually yours.** Your territory is what you have built on or
  worked, plus the ring around it. You cannot build or work outside it, and
  raiders cannot come inside it — which makes the border something to push
  rather than a line on a map. Fences and walls differ only in how long they
  take to break.
- **Neighbours, and not all of them hostile.** How many you get scales with the
  board: two on the small one, six on the largest, and never all of one sort.
  **Raiders** steal whatever is not in a granary and lead your horses away.
  **Settlers** farm their own land and send a caravan to your gate every week or
  two, taking your surplus and paying in what you are short of — sometimes with
  somebody who wants to come and live with you.
- **You can go after any of them.** Every camp has a real address: fields, huts,
  a store of your own goods, and fighters. A war party costs no resources, only
  people, who march for days and come back hurt. Burn the huts and fewer raiders
  come today; raze the camp and they leave the valley. Do it to the peaceful ones
  and they stop being peaceful — permanently.
- **A text assistant** that answers "how is my farm?" and takes instructions,
  with no model behind it — just a parser and the game's own state.

## Where to read about it

`docs/07-the-game-now.md` is the current picture. After that, the module
headers in `src/game/` are the real documentation: they are maintained with
the code, they explain *why* each number is what it is, and several of them
record the measurement that produced it.

`docs/00`–`docs/02` still describe what they built. **`docs/03`–`docs/06` are
historical** and say so at the top — the game changed shape under them. The
reasoning in `docs/DESIGN.md` is still sound; its details predate hours,
workers and the rivals.

Five test files have headers longer than their tests, and those are the ones
worth reading: `imports`, `smoke`, `scaling`, `sunshadow` and `visualclock`.
Each exists because of one specific bug that got past everything else, and each
header says what it was. `visualclock.test.mjs` goes furthest — its first test
*is* the bug, run against a copy of the code that had it.

## Layout

```
src/
  game/        pure rules, no React, no Three.js  <- all the tests point here
    hex.js       axial coordinate maths
    grid.js      the rectangular board; offset <-> axial translation
    noise.js     hashed value noise, position-addressed
    worldgen.js  what a tile looks like before anyone touched it
    tiles.js     getTerrain / getTile / touchTile, and the active set
    world.js     createWorld, save and load (version 10)
    terrain.js   TERRAIN + CONVERSIONS, costed in worker-hours
    buildings.js BUILDINGS, production, wear, and what your buildings do for you
    animals.js   SPECIES and the predator-prey loop
    workers.js   people: pathing, jobs, the queue, chores
    horses.js    catching, keeping and riding them
    territory.js the borders — yours and every camp's, refcounted
    rivalcamp.js the neighbours: raiders, settlers, caravans, trade, migrants
    rivals.js    the raids themselves, and what they come to take
    healing.js   infirmaries, herbs, healers, wounds that turn bad
    base.js      levels, hiring, skills, tools, the work-rate formula
    danger.js    fox attacks, hunting, injury, death, rest
    calendar.js  seasons, derived from world.day
    daytime.js   sun position and sky palette, from sun elevation
    tick.js      advanceHour — the only thing that changes the world
    assistant.js the text interface
  scene/       Three.js rendering
    Board.jsx          the canvas, camera, and what gets drawn
    InstancedTiles.jsx every visible tile in one draw call
    useVisibleTiles.js the camera window, chunked
    Atmosphere.jsx     the one place that reads the clock each frame
    NightLights.jsx    lamps on what you have built
    useSmoothMotion.js what makes people walk rather than teleport
    sunShadow.js       where the sun stands, and what its shadow covers
    visualClock.js     the clock the SUN runs on, as opposed to the world's
    buildingLook.js    the LOOK and LAMP tables
  ui/          normal React DOM
    TilePanel.jsx  BasePanel.jsx  StoreBar.jsx  Clock.jsx
    CanvasBoundary.jsx  a crash in the canvas must not cost you the farm
  App.jsx      wires it together
```

The split matters. Everything in `game/` is plain JavaScript with no imports
from React or Three.js, which is why it can be tested in Node in milliseconds.
Keep new rules there and the game stays testable.

The same applies inside `scene/`. `sunShadow.js`, `visualClock.js` and
`buildingLook.js` are plain JavaScript too, and each was pulled out of a
`useFrame` only after something in it turned out to be wrong — a `useFrame`
needs React and Three.js to run at all, so no test can reach it and the only
thing that ever checks it is a person watching the screen. If one is *deciding*
something rather than applying something, move the decision out.

See [Fortifications, rabbit pens and trading](docs/10-fortifications-and-trade.md) for gates, breeding enclosures, caravan visuals and ranged watchtowers.
