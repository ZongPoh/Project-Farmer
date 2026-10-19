# Pacing and construction

The game now runs at a fixed **120 real seconds per game day** (5 seconds per game hour). Run/Pause remains. The speed selector and +1 hour / +1 day controls are removed. Offline progress uses the same 120-second pace, including saves made with the old faster speeds. Internal hour/day functions remain for the simulation and automated tests; they are not player controls.

## Shared construction durations

Costs are paid when work starts. The site occupies its tile, but new buildings provide no production, storage protection, animal barriers, shelter, beds, or stabling until complete. Sites display scaffolding and a progress bar. Pausing stops progress; saving preserves the remaining work. Construction uses elapsed game time rather than worker-hours, so the same process applies to player settlements, settlers and raiders, which have different population simulations.

| Building | Game hours | Real time while running |
| --- | --- | --- |
| Initial player base | 0 | Instant |
| Rival camp | 12 | 1 minute |
| Fence | 6 | 30 seconds |
| Farm, woodcutter, wall | 6–48, based on territory | 30 seconds–4 minutes |
| Well, gate, paddock, rival hut | 24 | 2 minutes |
| Quarry camp | 36 | 3 minutes |
| Watchtower (including wall-mounted), granary, infirmary, rival store, market, workshop | 48 | 4 minutes |

Your initial base is ready immediately and sets the Home destination to the tile you chose. Older saves correct Home to the placed base and finish any initial base construction; upgrade progress is preserved. Construction does not require recruiting a worker, avoiding a circular dependency at the start. Existing buildings in older saves remain completed.

## Territory-based early construction

Farms, woodcutters and walls take 30 seconds (6 game hours) while the settlement holds at most 19 claimed tiles, including its border. Each additional group of 10 tiles adds 10 seconds (2 game hours), capped at 4 minutes. This uses each owner's own territory: player expansion never increases an AI village's build times. At 20–29 tiles these buildings take 40 seconds; at 30–39, 50 seconds; at 100–109, 2 minutes.

The duration is fixed when construction starts and appears in the build menu in game hours and real seconds. Later expansion does not lengthen an active project. Saved projects retain their original duration, including legacy projects. Other building types and headquarters upgrades keep the times listed here.

## Upgrades

Base/headquarters upgrades take 48, 72, 96 and 144 game hours for levels 2, 3, 4 and 5 respectively (4, 6, 8 and 12 minutes in real time). The previous level remains usable while work proceeds. Costs cannot be charged twice by clicking again; new capacity and unlocks arrive on completion.

Peaceful and raider headquarters start upgrades when their settlement has enough completed buildings and food. They use the same duration table as the player. Their higher tiers increase food storage and trade-goods production; huts still determine fighter housing, so burning a hut retains its strategic effect. Both their construction sites and upgrades are visible through tile inspection.

World save version 10 persists construction on the building itself. Versions 8 and 9 still load. Tests cover delayed production and protection, founding, upgrades for all three factions, mid-project save/load, destroyed sites, and fixed-speed migration. Other rule tests use explicitly completed building fixtures when construction is not their subject.
