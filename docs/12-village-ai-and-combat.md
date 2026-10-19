# Village AI and hourly combat

## Player-facing rules

- A normal day is 120 seconds. Each of its 24 hours is a five-second turn.
- Workers already used hourly movement. Raiders now do too (one open-ground tile per turn); combat also resolves hourly. Roads, terrain, hunger and mounts still affect worker travel.
- Choose the number sent in either village inspection or the base panel. At most 12 people can be committed, and at least one worker is reserved at home.
- Parties march to actual targets: fortifications first, other village buildings next, headquarters last. Destroying a target causes surviving troops to move to the next one. Injured troops retreat.
- The battle panel follows the current target and displays its remaining condition. Recently attacked buildings display damage indicators.
- Incoming raiders depart from a reachable hostile village. Their population is reserved while away, still consumes food, and surviving returnees rejoin that village. There is no map-edge spawn fallback.

## Autonomous villages

Villages choose a legal, affordable action daily using deterministic utility scores. Inspection shows the decision and explanation. Trading, defensive and raiding profiles weight their priorities differently.

Shared player tables define building costs, construction time, production, wear, housing, food consumption, storage and merchant prices. Village farms stop in winter. Recruitment requires beds, production capacity and stored winter food. Storage, resident and building limits keep the simulation bounded.

Actions include farming, housing, material production, storage, markets, fortifications, repairs, gathering, expanding, recruiting, headquarters upgrades, trade and resource expeditions. Trading checks finite stock and capacity. Caravans now deduct real goods from the supplying village rather than creating supplies for free.

Hostile resource expeditions choose a reachable weaker village, reserve residents, travel hourly, take actual resources after a short battle and return surviving residents and cargo. Expeditions and merchant budgets survive saves.

### Deliberate simplifications

This is rule-based game AI, not an LLM. Village residents are a population count; production and resource jobs are settled daily, not individual worker assignments. Fortifications contribute to village combat strength rather than forming the player's physical wall/pathfinding network. Resource expeditions fight defenders and take supplies; only player assaults destroy individual village buildings. Full diplomacy, coordinated armies and formal victory/defeat screens remain out of scope.

## Storage audit

Spring pink spheres are decorative flowers. Warehouses are not food storage: they add 600 wood and 450 stone capacity after 48 game hours of construction. From the starter limits, one completed warehouse produces limits of 800 wood and 600 stone. Granaries add food capacity.

Hunting, foraging, job yields and recovered raid loot now use the shared capped-resource function, including when invoked outside the main hourly tick. Existing over-cap save resources remain intact but cannot grow further.

## Verification

Run `npm run check` and `npm run build`. The village AI tests cover warehouse completion and loading, attack ordering, source-village raids, population reservation, legal decisions, winter, bounded currency trade, conserved caravans, saved expeditions and a 1,000-day deterministic save/reload simulation.

For an isolated visual check, run the development server and open `/test/manual-combat.html`. This fixture uses the real scene and panels, runs only when its hour button is pressed, and never reads or writes saved games.
