# Current design decisions

Hex Farm is a settlement sandbox on a procedural hex valley. Buildings produce automatically; people carry out terrain jobs, maintenance and expeditions. Seasons, wildlife, neighbours and limited labour give expansion consequences.

## One simulation clock

`advanceHour` advances production, travel and work. At midnight it also runs population, wildlife, wounds, wear, neighbours and daily programmes. `advanceDay` calls it 24 times. Offline progress reuses the hourly path at 120 seconds per day and a 120-day cap.

Player actions start construction, queue jobs and request trades synchronously. Buildings and upgrades finish only as game time advances. `useSettlement.act` publishes the resulting revision to React. Rendering interpolates movement and lighting but does not invent production or combat outcomes.

## Sparse world, bounded rendering

Untouched terrain is derived from seed and coordinates. `getTile` can return a temporary tile; call `touchTile` before writing and `setTerrain` for conversions. Active tiles drive production and jobs. The camera draws a bounded window with instanced ground; the minimap uses a fixed sampling budget. Simulation cost grows with active entities rather than empty map area.

## People make time meaningful

Work is measured in worker-hours. Jobs have player-selected priority, staffing balance, and queue sequence. Workers walk to the work and can be unavailable through training, injuries or expeditions. Buildings continue producing without a dedicated worker. Optional stone and herb programmes provide recurring uses for surplus without imposing unavoidable upkeep on a new settlement.

## Neighbours are separate settlements

Their buildings live on camp records, never on player tiles. Territory is reference-counted. Camps and orders are addressed by stable IDs, and battles resolve per camp with physically present attackers. Attacking peaceful settlers permanently ends trade, including unsuccessful attacks. Village inspection reads camp buildings directly.

## Reliable, transparent controls

The text assistant is a parser backed by real game state, not a language model. Buttons and text commands use the same game rules. Local saves, backups and bounded offline progress make persistence a player feature rather than only a simulation helper. See [Settlement controls](08-settlement-controls.md) for current costs, safeguards and limitations.

## Verify consequences

Game rules stay separate from React and Three.js so tests can simulate months of play. Test meaningful outcomes such as raids ending, trades removing resources, queues dispatching in the requested order, and saves producing identical continued simulations. Inspect the browser too: rule tests alone did not catch the missing attack callback between panels.
