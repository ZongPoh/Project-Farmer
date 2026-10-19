# Fortifications, rabbit pens and trading

Completed walls and fences block workers, wildlife, mounted workers, traders and raiders. Routes go around them. Gates cost 8 wood and 4 stone, take 24 game hours, and must stand beside a wall or fence. They admit workers and peaceful trade but keep animals and hostile raiders out. Connected barriers join visually. Broken barriers become gaps. Raiders prefer detours; when completely enclosed they can batter a barrier down. Workers can repair barriers from an adjacent tile.

## Rabbit breeding

Enclose owned grass completely with intact fences (walls and gates can complete the boundary). Select the enclosed grass and choose **Stock breeding pair**, costing 20 food. Capacity is four rabbits per enclosed grass tile. A pair matures after four days. When fed, a mature pair produces one rabbit every fourth calendar day until the pen is full. Feeding costs one food per rabbit each day; no feed means no breeding. Breaking the enclosure releases the stocked rabbits. Pen detection is limited to 128 interior tiles to keep large maps responsive.

## Trading

**Manage settlement → Trading** contains village selection, give/receive resources, quantity, quote and travelling caravans. Economy now contains only daily programmes. **Find cart** focuses a caravan. Carts have rotating wheels and visible cargo, following each tile of their travelled route rather than cutting straight through obstacles. Blue cargo is arriving; gold cargo is returning. Animation pauses with the game. The existing daily travel speed and payment-on-arrival rules remain.

## Watchtowers

A standalone tower spots raiders within seven tiles and fires within four. Select a completed, intact wall and build **Wall watchtower** for 30 wood and 40 stone, taking 48 game hours. Its underlying wall remains a barrier while building. The mounted tower has a distinct stone platform and lookout model, with sight of nine tiles and firing range of five.

Lookouts announce newly spotted raiders. During an attack, archers deal 12 damage every six game hours to the nearest raider in firing range. They stop firing at empty-handed retreating enemies; enemies carrying stolen goods remain targets. Arrow animations reflect simulation shots. Destroyed enemies drop stolen goods and free stolen horses. Cooldowns and construction progress survive saving.

The new rule suite covers barrier detours, stale paths, friendly gates, tower mounting and cooldowns, recovered goods, enclosed breeding and escape, and caravan routes through gates.

## Settlement and wildlife models

Farms show cultivated rows, a barn and a crate. Woodcutters show a cabin, cut logs and an axe in a chopping block. Crop height and building condition affect appearance. Rabbits, foxes and horses have species-specific low-poly silhouettes; tamed horses carry a saddle and bridle. Horse and rider share a moving group so they remain aligned. Models reuse geometry and palette materials and remain limited to visible tiles. These are visual changes; production, breeding and travel rates are unchanged.

The remaining building set now includes tiered bases, quarry hoists, roofed wells, raised granaries with silos, clinics, stable yards, village homes, markets, stores and forge workshops. Faction flags distinguish neighbours. Workers show faces, clothing and equipped tools; raiders wear helmets, and traders and tower guards use the same person model. Construction sites use timber scaffolding. The isolated asset gallery at `test/assets.html` exercises these models without reading or changing player saves.

## Night lighting

Moonlight and sky fill keep unlit terrain readable, with a broader fade at dawn and dusk. Lamps are smaller, warmer, lower-intensity fixtures positioned on their buildings. Flat additive ground discs have been removed, eliminating hard-edged overlapping yellow pools. Every eligible building in the visible tile window illuminates nearby surfaces. A spatial texture lists all lamps affecting each area, so shading only evaluates local lights without an eight-light cap or camera-based reassignment. Lamps retain their individual range, colour and brightness and fade with dawn and dusk. The isolated `test/lighting.html` scene provides a dense midnight settlement for visual checks.


### Battle feedback and repair assignment

Active raids and outgoing attacks appear in a map overlay with unit health, advancing/marching/fighting/retreating counts, village condition, attack versus defence, and camera focus buttons. Unit health bars face the camera and remain readable at night. Combat still resolves daily; tower shots can change raider health between rounds. Village condition includes destroyed buildings, while unit health totals describe surviving members rather than a guaranteed victory percentage.

Automatic repairs reserve a building for one worker, including travel time. Other workers choose another damaged building or their next activity; recalling the assigned worker releases the reservation. Explicit tile jobs can still use several workers, and war parties naturally travel together. Worker display positions no longer repeat every five people sharing a tile.
