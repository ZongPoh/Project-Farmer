# Settlement controls

For the current game pace and building durations, see [Pacing and construction](09-pacing-and-construction.md).

## Saving and recovery

World version 10 adds programmes, milestones, trade totals, and fractional herb/repair spending. Version 8 and 9 worlds still migrate. Browser saves and exported backups wrap the world in a `hexfarm` envelope with timestamp and playback preferences.

The app saves every three seconds after changes, periodically while running, and on page hide. Saving failures remain visible. Invalid stored data is left intact with autosave disabled until the player explicitly starts a new map or imports a valid backup. Imports validate before replacing the live world; a failed import leaves the current game intact.

New map, board size changes, imports, and recovery require an in-game confirmation. A separate recovery slot preserves the previous map before replacement. Export a JSON backup for storage outside this browser. These are local saves, not cloud accounts or cross-device synchronisation.

Catch-up requires both Run and Progress while away to have been enabled. It uses the fixed 60 real seconds per game day, floors to whole hours, and never simulates more than 120 days. Paused games remain paused. Returning to a hidden tab uses the same rules. Imports deliberately open paused at the saved moment; they do not apply the file's age as offline time.

## Jobs, navigation, and goals

Manage settlement shows every active tile job and pending expedition. Set Normal, High, or Urgent priority. Workers choose higher priorities first, then the least-staffed job, then queue order, then distance. Arrows reorder jobs within their priority. Priorities affect the next assignment and do not interrupt work or marching. Cancellation retains the existing up-front-cost policy: consumed materials are not refunded.

The minimap samples at most 48 cells across its longest dimension and overlays changed terrain, owned land, villages, and the selected tile. Click to navigate and inspect; Home and Village buttons offer keyboard-accessible shortcuts. It is a strategic overview, not fog of war.

Milestones cover founding, farming, wood production, expansion, reaching the second spring, trading, and reaching Town. Once earned, they remain earned and are saved.

## Optional daily spending

Both programmes start disabled. Supplies are paid at midnight for that day's benefit. Disabling a programme stops the next purchase; an already-paid day retains its benefit. Unaffordable programmes wait without debt or loss of normal capabilities.

| Programme | Daily cost | Protected reserve | Benefit |
| --- | --- | --- | --- |
| Maintain roads | ceil(people / 2) stone | 20 stone | +25% worker travel speed |
| Preventive care | ceil(people / 4) herbs | 10 herbs | +10% travel speed; +2 health for living people without festering wounds |

Travel bonuses add together and apply to walking and riding. Preventive care does not cure festering wounds or replace infirmaries and medical treatment. Road maintenance is settlement-wide infrastructure spending, not individually placed road tiles.

## Requested trade

Choose a peaceful village with a market, the goods to give, 10–200 units, and what to receive. The preview is the exact deal requested. Valuations are stone/wood/food 1, herbs 3, seeds 4, with a five-to-one exchange spread and a maximum return of 40 units. There is no profitable buy/sell loop.

One incoming caravan per village is allowed; requests have a three-day cooldown. At arrival, the quoted goods are exchanged only if reserves remain: 10 herbs, max(30, two days of worker food) food, or 20 of other goods. Otherwise the deal is declined. Existing automatic surplus trades continue. Caravans cache actual routes around obstacles and give up if their existing journey patience expires. Hostile or destroyed villages cannot complete trades.

## Rival tiles and combat fixes

Click either the ground or a rival building to inspect its owner, type, purpose, condition, village centre, fighters, stores, and all surviving buildings. Click an inventory row to move to that building. Former peaceful neighbours display the day their relationship changed. Attack the whole village from the inspection panel or your base.

TilePanel now forwards the previously dropped attack, tribute, catching, mounting, and stabling callbacks. Repeated attack orders reserve at least one worker at home and respect the global party cap. Combat resolves separately per camp ID, with attackers physically at the target. A blocked march returns home rather than becoming a remote attack. A failed assault on peaceful settlers also ends peace. Marching no longer accrues movement twice per hour.

## Maintenance and verification

`useSettlement.act` publishes a revision for every UI mutation and clock callback; callers no longer manually remember a separate commit. The world object stays stable between actions. Replacements get a new object and reset the visual clock. Simulation modules remain browser-independent.

`npm run check` runs TypeScript checks and all current tests under `test/`; historical tests under `Claude outputs/` are excluded. `npm run build` creates the production bundle. Regression tests cover persistence, catch-up, priorities, programmes, milestones, requested trades, and combat isolation. The large Three.js bundle still produces Vite's size advisory.

The management panel opens by default and stays visible when selecting tiles. On narrower screens, management and tile details stack so both remain available. The Manage settlement button still toggles management. Minimap Home returns to the player-placed base, including after loading older saves.
