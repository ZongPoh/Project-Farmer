import { BASE_STORAGE, STORAGE, foodReserves, storageCapacity, marketView, PRICES, LIVESTOCK_PRICES, MARKET_PERIOD, MARKET_STOCK, MARKET_PURSE, RESIDENT_FOOD, UPKEEP_FREE_PEOPLE, residentFood } from "../game/economy.js";
import { workerCapacity } from "../game/workers.js";
import { countBuildings, masonryUpkeep } from "../game/buildings.js";
import { livestockSummary } from "../game/livestock.js";
import { groundSummaryAll } from "../game/ground.js";
import { monumentSummary, MONUMENT } from "../game/monument.js";
import { claimCost, CLAIM_FREE_UP_TO } from "../game/tick.js";
import { DAYS_PER_SEASON, seasonOf } from "../game/calendar.js";

export function ReserveSummary({ world }) {
  const reserve = foodReserves(world), capacity = storageCapacity(world), housing = workerCapacity(world);
  return <section>
    <h3>Housing and winter reserves</h3>
    <p>{world.workers.length} residents / {housing.byBase} beds · normal farm capacity supports {housing.byFood} residents before seasonal changes.</p>
    <p>{reserve.daily} food/day · {Number.isFinite(reserve.days) ? reserve.days.toFixed(1) : "∞"} days stored at current population, excluding future harvests.</p>
    <p className={reserve.shortfall ? "low" : ""}>{seasonOf(world.day).id === "winter" ? "Remaining winter" : "Full winter"}: {reserve.required} food needed for {reserve.winterDays} days. {reserve.shortfall ? `Short by ${Math.ceil(reserve.shortfall)}.` : "Resident reserve covered."}</p>
    <p className="small muted">Horses, winter rabbit pens and other spending need extra food. Population changes alter this estimate.</p>
    <h3>Upkeep</h3>
    <p className={world.upkeepShort ? "low" : ""}>Masonry: {masonryUpkeep(world).toFixed(1)} stone/day for walls, towers, stores and houses.{world.upkeepShort ? " Unpaid — stone buildings are wearing." : ""}</p>
    {(() => { const l = livestockSummary(world); return (
      <p>Livestock: {l.dailyFeed} food/day today{l.dailyGrain ? `, and ${l.dailyGrain} seeds of grain` : ""}. {l.goats} goats, {l.hens} hens, {l.rabbits} rabbits, {l.horses} horses.</p>
    ); })()}
    <GroundSummary world={world} />
    <p className="small muted">Taking more land costs food once you hold over {CLAIM_FREE_UP_TO} tiles; next claim {claimCost(world).asking} food{claimCost(world).slow ? " — not affordable, so it would be done the slow way" : ""}.</p>
    {Object.entries(capacity).map(([r, cap]) => <p key={r}>{r}: {Math.floor(world.store[r] || 0)} / {cap}{world.store[r] >= cap ? " · Full — new supplies paused" : ""}</p>)}
    {reserve.required > capacity.food && <p className="low">Build more granaries: your storage cannot hold the full resident reserve.</p>}
  </section>;
}

/**
 * What is left in the ground you are working.
 *
 * Wood and stone used to be taps: a woodcutter cut 24 a day forever and a
 * quarry camp dug 24 a day forever, which is why a three-year settlement
 * finished with fifteen thousand of each and nothing to spend it on. Now a
 * stand thins and grows back and a seam runs out, so both numbers below are
 * things the player has to actually manage. See ground.js.
 */
function GroundSummary({ world }) {
  const g = groundSummaryAll(world);
  if (!g.stands && !g.seams && !g.regrowing) return null;
  return <>
    {g.stands > 0 && <p className={g.standShare < 0.3 ? "low" : ""}>
      Woodland: {g.stands} stand{g.stands === 1 ? "" : "s"} being cut, {Math.round(g.standShare * 100)}% standing.
      {g.standShare < 0.3 ? " Cut thin — output follows what is left." : ""}
    </p>}
    {g.seams > 0 && <p className={g.spentSeams ? "low" : ""}>
      Rock: {g.seamLeft} stone left in {g.seams} seam{g.seams === 1 ? "" : "s"}.
      {g.spentSeams ? ` ${g.spentSeams} worked out — break down a mountain or move the camp.` : ""}
    </p>}
    {g.regrowing > 0 && <p className="small muted">{g.regrowing} cleared tile{g.regrowing === 1 ? "" : "s"} could grow back to woodland if left alone.</p>}
  </>;
}

/**
 * The monument: the one thing that wants stone and timber continuously.
 *
 * Shown even while it is still being built, because "why is nothing happening"
 * is the obvious question and the answer is "the scaffold is still up".
 */
export function MonumentProgress({ world, onMonumentWork }) {
  const m = monumentSummary(world);
  if (!m) return <section>
    <h3>Monument</h3>
    <p className="small muted">Not founded. A monument is raised course by course and takes {MONUMENT.COURSES * MONUMENT.course.stone} stone and {MONUMENT.COURSES * MONUMENT.course.wood} timber over a hundred days or more — the only thing in the valley that wants either of them without stopping. It watches {12} tiles, and can be seen just as far.</p>
  </section>;
  return <section>
    <h3>Monument</h3>
    {m.building
      ? <p className="small muted">Still being built at {m.q},{m.r}. Nothing is carried up a scaffold.</p>
      : <>
        <p>{m.finished ? "Finished" : `${m.courses} of ${m.of} courses standing`} · {m.q},{m.r}</p>
        {!m.finished && <>
          <p className="small">This course: {m.laid.stone}/{m.needs.stone} stone, {m.laid.wood}/{m.needs.wood} timber. Up to {MONUMENT.perDay.stone} stone and {MONUMENT.perDay.wood} timber a day, never below a reserve of {MONUMENT.reserve.stone} stone and {MONUMENT.reserve.wood} timber.</p>
          <div className="bar"><i style={{ width: `${Math.round((m.laid.stone / m.needs.stone) * 100)}%` }} /></div>
          <label><input type="checkbox" checked={!m.paused} onChange={(e) => onMonumentWork(e.target.checked)} /> Masons at work</label>
          {m.waiting && <p className="small low">Waiting for materials.</p>}
        </>}
        {m.courses > 0 && <p className="small muted">It can be seen for miles: +{Math.round(m.pressure * 100)}% raid pressure.</p>}
      </>}
  </section>;
}

export function CoinMarket({ world, onTrade, onLivestock }) {
  const market = marketView(world), ready = countBuildings(world, "market") > 0;
  return <section>
    <h3>Coin market · {world.store.coins || 0} coins</h3>
    <p className="small">{ready ? "Local merchant — trades settle immediately." : "Build a market on owned grass to unlock coin trading."}</p>
    <p className="small muted">Restocks in {MARKET_PERIOD - ((world.day - 1) % MARKET_PERIOD)} days. Merchant budget: {market.purse} coins. All your markets share these limits.</p>
    {Object.entries(PRICES).map(([resource, prices]) => <section className="queue-item" key={resource}>
      <p>{resource} · merchant stock {market.stock[resource]} · buy {prices.buy} / sell {prices.sell} coins each</p>
      <button disabled={!ready} onClick={() => onTrade(resource, "buy", 10)}>Buy 10 ({prices.buy * 10} coins)</button>{" "}
      <button disabled={!ready} onClick={() => onTrade(resource, "sell", 10)}>Sell 10 (+{prices.sell * 10} coins)</button>
    </section>)}
    {onLivestock && <section className="queue-item">
      <p>Livestock · horse buy {LIVESTOCK_PRICES.horse.buy} / sell {LIVESTOCK_PRICES.horse.sell} · goat sell {LIVESTOCK_PRICES.goat.sell} · rabbit sell {LIVESTOCK_PRICES.rabbit.sell} · hen sell {LIVESTOCK_PRICES.chicken.sell}</p>
      <p className="small">Only horses can be bought. Everything else you breed, which is what the fences are for.</p>
      <button disabled={!ready} onClick={() => onLivestock("horse", "buy")}>Buy a horse</button>{" "}
      <button disabled={!ready} onClick={() => onLivestock("horse", "sell")}>Sell an idle horse</button>{" "}
      <button disabled={!ready} onClick={() => onLivestock("goat", "sell")}>Sell a goat</button>{" "}
      <button disabled={!ready} onClick={() => onLivestock("rabbit", "sell")}>Sell a penned rabbit</button>{" "}
      <button disabled={!ready} onClick={() => onLivestock("chicken", "sell")}>Sell a hen</button>
    </section>}
  </section>;
}

export function RulesPanel() {
  return <section>
    <h3>How to build a lasting farm</h3>
    <p>Place a base on grass, then build farms and a woodcutter. Claim neighbouring land to expand; workers need reachable routes.</p>
    <h3>Housing and food</h3>
    <p>Your base provides starter beds; each completed house adds four. Base upgrades also add beds. Recruitment needs both housing and farm capacity.</p>
    <p>Each resident eats {RESIDENT_FOOD} food at midnight while you have {UPKEEP_FREE_PEOPLE} or fewer; beyond that everyone eats a little more — a bigger place costs more to run (at 22 people, {residentFood(22).toFixed(1)} each). A shortage makes everyone hungry and slows work. After three hungry days one resident leaves, while at least one remains. Automatic arrivals pause in winter; manual hiring remains your choice.</p>
    <h3>Storage</h3>
    <p>Starting limits: {BASE_STORAGE.food} food, {BASE_STORAGE.wood} wood, {BASE_STORAGE.stone} stone. Each granary adds {STORAGE.granary.food} food capacity; each warehouse adds {STORAGE.warehouse.wood} wood and {STORAGE.warehouse.stone} stone capacity.</p>
    <p>Warehouses take 48 game hours (4 minutes at normal speed) to finish. One completed warehouse raises the starting wood limit from 200 to 800 and stone from 150 to 600; food is unchanged.</p>
    <p>Buildings provide space only when complete and not ruined. Full stores stop production; excess gathered goods cannot be kept. Existing surplus survives loading or storage loss, but cannot increase until space is available. Seeds, herbs and coins have no storage cap.</p>
    <p>Storage and raid protection are separate: granaries still protect a limited quantity of goods against raiders. Warehouses add space, not protection.</p>
    <h3>Seasons and winter</h3>
    <p>Each season lasts {DAYS_PER_SEASON} game days. Farms benefit from spring and summer, slow in autumn, and produce no food throughout winter. Wood and stone production continue. Seasonal changes ease in near the end of each season; winter harvests remain zero until spring.</p>
    <p>Prepare population × {RESIDENT_FOOD} × {DAYS_PER_SEASON} food for a full winter, plus extra for rabbit pens, hiring and other spending. Four residents need 576 food. Hunting, foraging and limited trade can help, but are not guaranteed winter supplies.</p>
    <h3>Currency and neighbours</h3>
    <p>A completed market enables immediate purchases and sales in the Trading tab. Merchants restock {MARKET_STOCK} of each resource and {MARKET_PURSE} coins every {MARKET_PERIOD} days. They hold at most {MARKET_STOCK * 2} of each resource. Buying costs more than selling earns. Building extra markets does not multiply stock.</p>
    <p>Neighbour caravans use the existing barter system and need an open route. If there is no room for their delivery, the deal is cancelled without payment.</p>
    <h3>Villages and combat</h3>
    <p>Neighbour villages pay construction costs, feed their residents, need beds, respect storage limits and stop harvesting in winter. Trading, defensive and raiding personalities choose different priorities. Inspect a village to see its latest decision and reason.</p>
    <p>Choose how many people to send before attacking. Defences are targeted first, then other buildings, then the headquarters. Raiders depart from an existing rival village and return there with stolen supplies. Rival resource expeditions can also attack other villages.</p>
    <p>Village residents use a simplified population simulation, not individual worker job assignments. Their fortifications add combat strength; player walls also block paths.</p>
    <h3>Time, upkeep and saving</h3>
    <p>One day is 120 real seconds at normal speed: 24 hourly turns of 5 seconds. Workers and raiders move on hourly turns; terrain, roads, mounts and work can change travel speed. Pink spheres on spring grass are decorative flowers, not resources.</p>
    <p>Run advances time; Pause stops simulation and construction. Buildings wear down and need repairs. Idle workers can repair automatically. Saves stay in this browser; export backups for safekeeping. Enabled offline progress also consumes food and can cross winter.</p>
    <p>This is currently a sandbox. Peace, conquest, retirement and formal defeat screens are future additions.</p>
  </section>;
}
