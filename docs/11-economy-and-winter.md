# Storage, housing, winter and currency

Open **Manage settlement → Economy** for housing, capacity and food reserve estimates;
**Trading** for coin transactions and neighbour barter; **Rules** for the in-game guide.

- Base storage: 600 food, 200 wood, 150 stone. Granary: +900 food.
  Warehouse: +600 wood and +450 stone. Completed, non-ruined buildings add capacity.
- Existing surplus is retained when loading or losing storage. It cannot grow above
  capacity. Production pauses at capacity; excess gathered supplies are discarded.
  Seeds, herbs and coins are not capped.
- Houses cost 35 wood and 10 stone and provide four beds. Existing base housing
  and nominal farm-capacity recruitment constraints still apply. Losing housing
  blocks new arrivals but does not evict current residents.
- Residents consume six food daily. The existing hunger/worker departure rules remain.
  Outdoor farms produce zero during all winter days, including the transition to spring.
  Wildlife uses its existing seasonal ecology; winter does not turn off grazing.
- Automatic recruits and caravan migrants pause in winter. Manual hiring remains
  available. The reserve display uses current residents only; pens and other spending
  need additional reserves. Four people need 576 food for 24 days.
- A market costs 50 wood and 30 stone. Coins start at 30, including legacy saves
  missing the coin field. All markets share 60 units per resource and a 120-coin
  merchant purse. Stock refreshes on days 1, 8, 15, etc., and merchant holdings
  cannot exceed 120 units per resource. Buying replenishes the purse; selling
  replenishes stock. Food prices: buy 3/sell 1; wood: 4/2; stone: 5/2.
- Coin trades are immediate local transactions, distinct from travelling barter
  caravans. Caravan deliveries that cannot fit are cancelled without payment.
- Merchant stock and purse survive saves and imports. Reopening the tab or building
  another market does not reset them. Invalid or unaffordable trades change nothing.

This is the initial balance pass. Rival camps retain their simplified economy pending
the planned AI redesign. Peace, conquest and retirement endings remain future work.
