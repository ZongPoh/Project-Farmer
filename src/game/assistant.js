import { constructionLabel } from "./construction.js";
/**
 * "How's my farm today?" — without a language model. (Step 5)
 *
 * An LLM would be a bad fit here: slow, costs money per message, and it will
 * cheerfully tell you about a barn you never built. Everything below is
 * generated FROM GAME STATE, so it can only ever say true things.
 *
 * Three pieces, in the order docs/05 recommends building them:
 *   1. describeFarm()  the report. Build this first — it is the valuable half.
 *   2. parse()         intent matching + slot filling. The easy half.
 *   3. respond()       glue: read the intent, act on it, answer in a sentence.
 */
import { neighbors, distance } from "./hex.js";
import { getTile, getTerrain, activeTiles, terrainCount } from "./tiles.js";
import { TERRAIN, TERRAIN_IDS, optionsFor, findConversion } from "./terrain.js";
import {
  BUILDINGS, BUILDING_IDS, place, repair, countBuildings, protectedStores,
} from "./buildings.js";
import { SPECIES, SPECIES_IDS, census, populationOf } from "./animals.js";
import { startWork, startClaim } from "./tick.js";
import { seasonOf, describeDate, DAYS_PER_SEASON } from "./calendar.js";
import { workerSummary, staffOn } from "./workers.js";
import { nextTier, baseTier } from "./base.js";
import { clockString } from "./daytime.js";
import { orderCatch } from "./horses.js";
import { territorySize } from "./territory.js";
import { careSummary } from "./healing.js";
import {
  campSummaries, orderWarParty, canSendWarParty, pendingArrivals, KINDS,
  MAX_PARTY_SENT,
} from "./rivalcamp.js";
import {
  payTribute, activeRaiders, daysUntilRaid, partySize, exposedGoods,
} from "./rivals.js";

// ---------------------------------------------------------------------------
// 1. THE REPORT
// ---------------------------------------------------------------------------

/** "1 fox" / "2 foxes" — English needs -es after x, s, ch and sh. */
export function plural(n, word) {
  if (n === 1) return `${n} ${word}`;
  const es = /(x|s|ch|sh)$/.test(word);
  return `${n} ${word}${es ? "es" : "s"}`;
}

/**
 * How close something has to be to be worth telling the player about.
 *
 * On a small board everything is nearby and this never bites. On a big one it
 * is the difference between a useful report and a list of trivia about places
 * the player has never visited.
 */
export const NEWS_RANGE = 12;

/** The closest animal of a species to home, within range, or null. */
export function nearest(world, speciesId, range = NEWS_RANGE) {
  let best = null;
  let bestD = Infinity;
  for (const a of world.animals) {
    if (a.species !== speciesId) continue;
    const d = distance(world.home, a);
    if (d <= range && d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

/** Counts the report and the advice both need. Computed once, reused. */
export function surveyFarm(world) {
  // Terrain totals come from the cached histogram — O(1), not a board walk.
  const terrain = {};
  for (const id of TERRAIN_IDS) {
    const n = terrainCount(world, id);
    if (n) terrain[id] = n;
  }

  const buildings = {};
  const jobs = [];
  const ruined = [];
  let builtOnGrass = 0;

  // Only the active tiles. A report that walked 80,000 tiles every time the
  // player typed "status" would stall the UI on a big board.
  for (const tile of activeTiles(world)) {
    if (tile.work) {
      jobs.push({
        q: tile.q, r: tile.r,
        to: tile.work.to,
        // Worker-hours remaining, not days. Reading the old daysNeeded /
        // daysDone here quietly produced NaN once jobs moved to hours.
        left: Math.max(0, tile.work.needed - tile.work.done),
        staff: staffOn(world, tile.q, tile.r),
      });
    }
    const b = tile.building;
    if (b) {
      buildings[b.id] = (buildings[b.id] || 0) + 1;
      if (tile.terrain === "grass") builtOnGrass++;
      if (b.condition <= 40) {
        ruined.push({ q: tile.q, r: tile.r, id: b.id, condition: b.condition });
      }
    }
  }

  jobs.sort((a, b) => a.left - b.left);

  // Grass with nothing on it, by subtraction rather than by counting tiles.
  const grassBeingWorked = jobs.filter((j) => {
    const t = getTerrain(world, j.q, j.r);
    return t === "grass";
  }).length;
  const idleGrass = Math.max(0, (terrain.grass || 0) - builtOnGrass - grassBeingWorked);

  return {
    terrain, buildings, jobs, idleGrass, ruined,
    // Finding irrigable sand needs a search, so it is a separate, lazy call.
    irrigable: [],
    hasBase: countBuildings(world, "base") > 0,
    store: world.store,
    animals: census(world),
  };
}

/**
 * A patch of sand near home that could be irrigated, or null.
 *
 * Searched outward from the base rather than by scanning the board, and it
 * stops at the first hit. Advice only ever needs one suggestion, so there is
 * no reason to find all of them — and on a 400x200 board finding all of them
 * would cost more than everything else the assistant does put together.
 */
export function findIrrigable(world, limit = 400) {
  const seen = new Set();
  const queue = [world.home];
  let looked = 0;

  while (queue.length && looked < limit) {
    const { q, r } = queue.shift();
    const k = `${q},${r}`;
    if (seen.has(k)) continue;
    seen.add(k);
    looked++;

    const terrain = getTerrain(world, q, r);
    if (terrain === null) continue;

    if (terrain === "sand") {
      const tile = getTile(world, q, r);
      if (!tile.work && !tile.building) {
        const opt = optionsFor(world, tile).find((o) => o.id === "irrigate");
        if (opt && !opt.blockedBy) return { q, r };
      }
    }
    for (const n of neighbors(q, r)) {
      if (!seen.has(`${n.q},${n.r}`)) queue.push(n);
    }
  }
  return null;
}

/**
 * A few plain sentences about the farm, every clause read from real state.
 * This is the half that carries the feature; the parser is trivial by
 * comparison.
 */
export function describeFarm(world) {
  const s = surveyFarm(world);
  const lines = [];

  const season = seasonOf(world.day);
  const people = workerSummary(world);
  lines.push(`Day ${world.day}, ${clockString((world.hour || 0) / 24)} — ${describeDate(world.day)}.`);

  if (people.total === 0) {
    lines.push("Nobody works here yet — grow some food and people will come.");
  } else {
    lines.push(
      `${plural(people.total, "worker")}, ${people.idle} free` +
        (people.mounted ? `, ${people.mounted} on horseback` : "") +
        `. Room for ${people.cap}, limited by ${people.limitedBy}.`
    );
  }

  if (!s.hasBase) {
    lines.push("You have not placed your base yet — pick a grass tile.");
  } else {
    const tier = baseTier(world.baseLevel || 1);
    const next = nextTier(world);
    lines.push(
      `The base is a ${tier.label.toLowerCase()}` +
        (next
          ? `; the next step needs ${Object.entries(next.cost).map(([r2, n]) => `${n} ${r2}`).join(", ")}.`
          : ", as large as it gets.")
    );
  }

  // Jobs, with the soonest named because that is what you actually want.
  if (s.jobs.length === 0) {
    lines.push("No work in progress.");
  } else {
    const soonest = s.jobs[0];
    const left = Math.ceil(soonest.left);
    const when = left <= 1
      ? "the next is nearly done"
      : `the next needs ${plural(left, "more worker-hour")}`;
    const waiting = s.jobs.filter((j) => j.staff === 0).length;
    lines.push(
      `${plural(s.jobs.length, "job")} on the go — ${when} (${soonest.q},${soonest.r} to ${soonest.to})` +
        (waiting ? `, ${waiting} still waiting for a free worker` : "") + "."
    );
  }

  // Land.
  const land = ["grass", "forest", "sand", "water", "mountain"]
    .filter((t) => s.terrain[t])
    .map((t) => `${s.terrain[t]} ${t}`)
    .join(", ");
  lines.push(`Land: ${land}.`);

  // Winter is the one season worth flagging unprompted, because it is the
  // one you have to have planned for.
  if (season.id === "autumn" && season.daysLeft <= 8) {
    lines.push(`Winter starts in ${plural(season.daysLeft, "day")} — farms stop harvesting. Check your food reserves in Economy.`);
  } else if (season.id === "winter") {
    lines.push(`Winter: farms do not harvest, and spring is ${plural(season.daysLeft, "day")} off.`);
  }

  // Store and buildings.
  const built = Object.entries(s.buildings)
    .map(([id, n]) => plural(n, BUILDINGS[id].label.toLowerCase()))
    .join(", ");
  lines.push(
    `Store: ${s.store.food} food, ${s.store.wood} wood, ${s.store.stone} stone` +
      (s.store.seeds ? `, ${plural(s.store.seeds, "seed")}` : "") + "." +
      (built ? ` You have ${built}.` : " Nothing built yet.")
  );

  // Wildlife — only mention what is actually out there.
  const seen = s.animals.filter((a) => a.count > 0);
  if (seen.length) {
    lines.push(
      "Wildlife: " + seen.map((a) => plural(a.count, a.label.toLowerCase())).join(", ") + "."
    );
    // Only a fox NEAR HOME is news. On a 400x200 board there is almost always
    // a fox somewhere, and reporting one 100 tiles away is noise dressed up
    // as information.
    const fox = nearest(world, "fox", NEWS_RANGE);
    if (fox) {
      lines.push(`A fox is ${plural(distance(world.home, fox), "tile")} from home, at ${fox.q},${fox.r}.`);
    }
  }

  if (s.ruined.length) {
    const r = s.ruined[0];
    lines.push(
      `The ${BUILDINGS[r.id].label.toLowerCase()} at ${r.q},${r.r} is at ${Math.round(r.condition)}% and needs repair.`
    );
  }

  return lines.join(" ");
}

/**
 * Advice, cheaply. No intelligence needed — just an ordered list of checks
 * where the first true one wins. Order IS the judgement.
 */
export function adviseFarm(world) {
  const s = surveyFarm(world);
  const people = workerSummary(world);

  if (!s.hasBase) return "Start by placing your base on a grass tile. Try: build base at 0,0";
  if (s.store.food <= 2) return "Food is nearly gone. Build a farm on grass before anything else.";

  // Seasonal advice outranks the general-purpose ladder below, because it is
  // time-limited: the window to act on it closes.
  const season = seasonOf(world.day);
  const farms = s.buildings.farm || 0;
  if (season.id === "autumn" && season.daysLeft <= 8 && s.store.food < 12 + farms * 4) {
    return `Winter is ${plural(season.daysLeft, "day")} away and farms will stop harvesting. Check winter reserves in Economy and build granaries if you need storage.`;
  }
  if (season.id === "winter" && s.store.food < 8) {
    return "Food is short in winter. Farms cannot harvest until spring; try hunting, foraging or limited market purchases.";
  }
  if (season.id === "spring" && farms > 0 && s.store.wood >= 4) {
    return "Spring is the best time to expand — growth is high and the wildlife is breeding. Another farm now pays for itself by autumn.";
  }
  // Only worth saying if they can actually act on it. Telling somebody with
  // no wood to spend a wood is the kind of advice that makes a player think
  // the game is broken — and it is exactly the state a wood shortage puts
  // them in, so this rung fired precisely when it was least useful.
  if (s.ruined.length && (s.store.wood || 0) >= 1) {
    const r = s.ruined[0];
    return `The ${BUILDINGS[r.id].label.toLowerCase()} at ${r.q},${r.r} is falling apart. Repair it — it costs 1 wood.`;
  }
  if ((s.buildings.farm || 0) === 0) {
    return "You have no farm yet. One on grass gives you a food an hour — that is the whole economy.";
  }
  if (s.store.food < 8 && (s.buildings.farm || 0) < 2) {
    return "One farm is thin cover. A second would give you room to breathe.";
  }
  // THE DEAD END, and it is worth guarding against explicitly: a farm costs
  // wood, a woodcutter costs wood, and with none of either you can no longer
  // make wood. Clearing a wood costs nothing and yields twelve, so it is
  // always the way out — but only if the player knows it exists.
  if (s.store.wood < 2) {
    return (s.terrain.forest || 0) > 0
      ? "You have no wood, and everything costs wood. Clear a forest tile — it costs nothing to start and gives you 12 timber."
      : "You have no wood and no forest to fell. Quarrying a mountain yields stone; plant a seed if you have one, and the trees will come back.";
  }
  if (s.store.wood <= 4 && (s.buildings.woodcutter || 0) === 0) {
    return "Wood is short. A woodcutter on a forest tile keeps it coming, and finds seeds while it works.";
  }

  // STONE. It gates the base past a homestead, and every tool, and it has no
  // passive source at all — so a settlement can sit on thousands of food and
  // timber for years without ever learning why it has stopped progressing.
  // This rung exists because a playthrough did exactly that.
  const stoneWanted = nextTier(world) && (nextTier(world).cost.stone || 0) > 0;
  if ((s.store.stone || 0) < 10 && (s.buildings.quarryCamp || 0) === 0 && stoneWanted) {
    return (s.terrain.sand || 0) > 0
      ? "You have no stone, and the base cannot grow past a homestead without it. A quarry camp goes on sand."
      : "You have no stone and no sand to dig. Quarrying a mountain turns it to sand and yields stone to start you off.";
  }
  if (people.total === 0 && (s.buildings.farm || 0) > 0) {
    return "Nobody has arrived yet. Keep the food climbing and workers will come on their own.";
  }
  const waiting = s.jobs.filter((j) => j.staff === 0).length;
  if (waiting > 0 && people.total === 0) {
    return `${plural(waiting, "job")} queued and nobody to do them. Build a farm — workers arrive once there is food.`;
  }
  if (waiting > 0 && people.idle === 0) {
    return `${plural(waiting, "job")} queued behind the work already under way. Another pair of hands would clear them faster.`;
  }
  if (people.total > 0 && people.idle === people.total && (s.buildings.woodcutter || 0) === 0) {
    return "Everyone is idle. A woodcutter on a forest tile would keep the timber coming.";
  }
  if ((world.store.seeds || 0) > 0 && (s.terrain.forest || 0) < 4) {
    return `You have ${plural(world.store.seeds, "seed")}. Planting one turns grass into forest, which is where wood comes from.`;
  }
  // Rabbits only matter if they are near enough to reach the farm.
  if ((s.buildings.farm || 0) > 0 && !s.buildings.fence && nearest(world, "rabbit")) {
    return "Rabbits are getting at your crops. A fence around the farm keeps them and the foxes out.";
  }
  if (s.idleGrass > 3) {
    // "You have 42,015 empty grass tiles" is a true sentence and useless
    // advice. Past a point the number stops being the interesting part.
    return s.idleGrass > 40
      ? "There is far more grass than you are using. Put down more farms."
      : `You have ${plural(s.idleGrass, "empty grass tile")}. That is room for farms.`;
  }
  // Seeds have a second use now, and it is the one that pays every day.
  if ((world.store.seeds || 0) > 20 && !s.buildings.coop) {
    return `You have ${plural(world.store.seeds, "seed")} and nothing eating them. A hen coop turns grain into eggs all year, winter included — and wants a fence around it, or a fox will help itself.`;
  }
  const sand = findIrrigable(world);
  if (sand) {
    return `The sand at ${sand.q},${sand.r} could be irrigated into grass — or fenced and left as it is, because goats graze sand and nothing else in the valley does.`;
  }
  if (s.jobs.length === 0) return "Nothing is in progress. Quarry a mountain if you want more land to work with.";
  return "Things look steady. Let a few days run and see what the wildlife does.";
}

// ---------------------------------------------------------------------------
// 2. THE PARSER
// ---------------------------------------------------------------------------

/**
 * `kind: "command"` intents ask the game to DO something; `"question"`
 * intents only read state. On a tie the command wins — "build a farm" and
 * "how is my farm" both contain "farm", and the verb is what settles it.
 * Without that rule the question list quietly swallows every command that
 * happens to name a building.
 */
export const INTENTS = [
  { id: "BUILD", kind: "command", words: ["build", "place", "put", "construct", "make"] },
  { id: "JOB", kind: "command", words: ["irrigate", "quarry", "drain", "flood", "dig", "convert", "plant", "clear", "fell", "chop"] },
  { id: "REPAIR", kind: "command", words: ["repair", "fix", "mend"] },
  { id: "TAME", kind: "command", words: ["tame", "catch", "horse", "horses"] },
  { id: "TRIBUTE", kind: "command", words: ["tribute", "pay", "bribe", "appease"] },
  { id: "CLAIM", kind: "command", words: ["claim", "take", "expand", "settle", "border", "territory", "land"] },
  { id: "ATTACK", kind: "command", words: ["attack", "burn", "assault", "war", "storm", "avenge"] },
  { id: "CARE", kind: "question", words: ["hurt", "injured", "wounded", "sick", "heal", "health", "infirmary", "herbs"] },
  { id: "RAID", kind: "question", words: ["raid", "raiders", "rivals", "attack", "defend", "defence", "defense"] },
  { id: "REPORT", kind: "question", words: ["how", "status", "report", "today", "doing", "going", "summary", "farm"] },
  { id: "ADVISE", kind: "question", words: ["should", "next", "help", "suggest", "advice", "advise"] },
  { id: "LOOK", kind: "question", words: ["look", "inspect", "tell", "about", "what's", "whats", "describe"] },
];

const FILLER = new Set([
  "the", "a", "an", "my", "is", "are", "i", "to", "at", "on", "of", "in", "it",
  "me", "please", "can", "you", "and", "for", "s",
]);

export function tokenize(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9,\-\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Classic Levenshtein — used only for the "did you mean" fallback. */
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

const VOCAB = [
  ...new Set([
    ...INTENTS.flatMap((i) => i.words),
    ...BUILDING_IDS.map((b) => b.toLowerCase()),
    ...SPECIES_IDS,
    ...Object.keys(TERRAIN),
  ]),
];

/** The closest known word, if the guess is close enough to be worth offering. */
export function closestWord(word) {
  let best = null, bestD = Infinity;
  for (const v of VOCAB) {
    const d = levenshtein(word, v);
    if (d < bestD) { bestD = d; best = v; }
  }
  // More than two edits away is a different word, not a typo.
  return bestD <= 2 && bestD > 0 ? best : null;
}

/**
 * Pull the structure out of a sentence: intent, coordinates, and any known
 * nouns. "build a farm at 2,-1" and "build farm 2 -1" parse identically.
 */
export function parse(input) {
  const tokens = tokenize(input);
  const words = tokens.filter((t) => !FILLER.has(t));

  // Coordinates: any two integers anywhere in the text.
  const numbers = (String(input).match(/-?\d+/g) || []).map(Number);
  const coords = numbers.length >= 2 ? { q: numbers[0], r: numbers[1] } : null;

  // Known nouns. Buildings are matched case-insensitively against their ids.
  const building = BUILDING_IDS.find((id) => words.includes(id.toLowerCase()))
    // "quarry camp" is two words; catch the common shorthand too.
    || (words.includes("camp") ? "quarryCamp" : null);
  const species = SPECIES_IDS.find((id) => words.includes(id));
  const terrain = Object.keys(TERRAIN).find((id) => words.includes(id));
  const job = ["irrigate", "quarry", "drain", "flood", "plant", "clear"].find((id) => words.includes(id))
    // A few natural synonyms for the tree jobs.
    || (words.includes("fell") || words.includes("chop") ? "clear" : null);

  // Score each intent by how many of its words appear. Highest wins; on a
  // tie a command beats a question (see the note on INTENTS).
  let best = null, bestScore = 0, bestKind = null;
  for (const intent of INTENTS) {
    const score = intent.words.reduce((n, w) => n + (words.includes(w) ? 1 : 0), 0);
    if (score === 0) continue;
    const beatsOnScore = score > bestScore;
    const beatsOnKind = score === bestScore && intent.kind === "command" && bestKind !== "command";
    if (beatsOnScore || beatsOnKind) {
      bestScore = score;
      best = intent.id;
      bestKind = intent.kind;
    }
  }

  // A named building with "quarry" in it should not be read as the quarry job.
  let intent = best;
  if (intent === "JOB" && building === "quarryCamp") intent = "BUILD";

  return {
    intent, score: bestScore, words, coords,
    building, species, terrain, job,
    unknown: words.filter((w) => !VOCAB.includes(w) && !/^-?\d+$/.test(w)),
  };
}

// ---------------------------------------------------------------------------
// 3. GLUE
// ---------------------------------------------------------------------------

function describeTile(world, q, r) {
  const tile = getTile(world, q, r);
  if (!tile) return `There is no tile at ${q},${r}.`;
  const bits = [`${q},${r} is ${TERRAIN[tile.terrain].label.toLowerCase()}.`];
  if (tile.building) {
    if (tile.building.construction) bits.push(constructionLabel(tile.building));
    bits.push(
      `There is a ${BUILDINGS[tile.building.id].label.toLowerCase()} on it, at ${Math.round(tile.building.condition)}%.`
    );
  }
  if (tile.work) {
    bits.push(`It becomes ${tile.work.to} in ${plural(tile.work.daysNeeded - tile.work.daysDone, "day")}.`);
  }
  const here = world.animals.filter((a) => a.q === q && a.r === r);
  if (here.length) {
    // Group by species — "2 rabbits", not "rabbit and rabbit".
    const counts = {};
    for (const a of here) counts[a.species] = (counts[a.species] || 0) + 1;
    const seen = Object.entries(counts).map(([sp, n]) =>
      plural(n, SPECIES[sp].label.toLowerCase())
    );
    bits.push(`You can see ${seen.join(" and ")} there.`);
  }
  if (!tile.building && !tile.work) {
    const jobs = optionsFor(world, tile).filter((o) => !o.blockedBy);
    if (jobs.length) bits.push(`You could ${jobs.map((j) => j.id).join(" or ")} it.`);
  }
  return bits.join(" ");
}

/**
 * Answer one line of player input.
 *
 * Returns { text, changed } — `changed` tells the UI whether the world was
 * mutated and so needs a re-render. The assistant never advances time; only
 * advanceDay does that.
 */
export function respond(world, input) {
  const p = parse(input);

  if (!p.intent) {
    // The "did you mean" fallback, so a typo is a nudge and not a shrug.
    for (const w of p.words) {
      const near = closestWord(w);
      if (near) return { text: `I do not know "${w}". Did you mean "${near}"?`, changed: false };
    }
    return {
      text: 'Try "how is my farm?", "what should I do next?", or "build a farm at 2,-1".',
      changed: false,
    };
  }

  switch (p.intent) {
    case "REPORT":
      return { text: describeFarm(world), changed: false };

    case "ADVISE":
      return { text: adviseFarm(world), changed: false };

    case "LOOK":
      if (!p.coords) return { text: "Which tile? Give me coordinates, like 2,-1.", changed: false };
      return { text: describeTile(world, p.coords.q, p.coords.r), changed: false };

    case "BUILD": {
      if (!p.building) {
        return {
          text: `Build what? You can build: ${BUILDING_IDS.map((b) => BUILDINGS[b].label.toLowerCase()).join(", ")}.`,
          changed: false,
        };
      }
      if (!p.coords) return { text: `Where should the ${BUILDINGS[p.building].label.toLowerCase()} go? Give me coordinates.`, changed: false };
      const res = place(world, p.coords.q, p.coords.r, p.building);
      if (!res.ok) return { text: `I cannot: ${res.reason}.`, changed: false };
      return {
        text: `${BUILDINGS[p.building].label} construction started at ${p.coords.q},${p.coords.r} — ${res.hours} game hours.`,
        changed: true,
      };
    }

    case "JOB": {
      if (!p.job) {
        return { text: "Which job? irrigate, quarry, drain, flood, plant or clear.", changed: false };
      }
      if (!p.coords) return { text: `Which tile should I ${p.job}?`, changed: false };
      const res = startWork(world, p.coords.q, p.coords.r, p.job);
      if (!res.ok) return { text: `I cannot: ${res.reason}.`, changed: false };
      const conv = findConversion(p.job);
      return {
        text: `Started — ${p.coords.q},${p.coords.r} becomes ${conv.to} in ${plural(res.days, "day")}.`,
        changed: true,
      };
    }

    case "REPAIR": {
      if (!p.coords) return { text: "Repair what? Give me coordinates.", changed: false };
      const res = repair(world, p.coords.q, p.coords.r);
      if (!res.ok) return { text: `I cannot: ${res.reason}.`, changed: false };
      return { text: `Repaired — now at ${Math.round(res.condition)}%.`, changed: true };
    }

    case "TAME": {
      // There is one way to get a horse: ask for one. The old coordinate
      // form ("tame 3,4") needed a worker standing on that tile, which the
      // player cannot arrange — workers are not steered by hand — so it has
      // gone. Coordinates, if given, are simply ignored.
      const res = orderCatch(world);
      if (!res.ok) return { text: `I cannot: ${res.reason}.`, changed: false };
      return {
        text:
          res.distance === null
            ? "Somebody will go out after a horse and bring it to a paddock."
            : `Somebody will go out after a horse — the nearest is about ${plural(res.distance, "tile")} off.`,
        changed: true,
      };
    }

    case "CLAIM": {
      if (!p.coords) {
        const size = territorySize(world);
        return {
          text:
            `You hold ${plural(size.claimed, "tile")}, ${size.owned} of them worked. ` +
            'Finish anything on a tile and the ring around it opens up — or say ' +
            '"claim 3,-2" to take a frontier tile outright.',
          changed: false,
        };
      }
      const res = startClaim(world, p.coords.q, p.coords.r);
      if (!res.ok) return { text: `I cannot: ${res.reason}.`, changed: false };
      return {
        text: res.queued
          ? `Queued — somebody will take ${p.coords.q},${p.coords.r} when they are free.`
          : `Taking ${p.coords.q},${p.coords.r}. ${plural(res.hours, "worker-hour")}.`,
        changed: true,
      };
    }

    case "CARE": {
      const care = careSummary(world);
      if (care.hurt === 0) {
        return { text: "Nobody is hurt. You have " + plural(care.herbs, "herb") + " put by.", changed: false };
      }
      return {
        text:
          `${plural(care.hurt, "person")} hurt` +
          (care.festering ? `, and ${care.festering} of those wounds have turned bad` : "") +
          `. ${care.beds} bed${care.beds === 1 ? "" : "s"}, ${plural(care.herbs, "herb")}. ` +
          (care.canTreat
            ? `They are being treated${care.healer ? ` by ${care.healer}` : ""}.`
            : care.herbs === 0
            ? "Nothing to treat them with — send somebody foraging."
            : "Nobody is well enough to tend the others."),
        changed: false,
      };
    }

    case "ATTACK": {
      // No camp named: the raiders, never the settlers. Burning out people who
      // have done nothing to you should take more than one ambiguous word.
      const check = canSendWarParty(world, null, MAX_PARTY_SENT);
      if (!check.ok) return { text: `I cannot: ${check.reason}.`, changed: false };
      const res = orderWarParty(world, check.camp.id, check.most);
      if (!res.ok) return { text: `I cannot: ${res.reason}.`, changed: false };
      return {
        text:
          `${plural(res.sending, "person")} setting out for ${res.target.q},${res.target.r}. ` +
          "Spears matter more than numbers.",
        changed: true,
      };
    }

    case "TRIBUTE": {
      const res = payTribute(world);
      if (!res.ok) return { text: `I cannot: ${res.reason}.`, changed: false };
      return {
        text: `Paid ${res.cost.food} food and ${res.cost.wood} wood. They will leave you be until day ${res.until}.`,
        changed: true,
      };
    }

    case "RAID": {
      const here = activeRaiders(world).length;
      if (here > 0) {
        return {
          text:
            `${plural(here, "raider")} on your land right now. Anyone indoors is safe — ` +
            "they take whatever is not in a granary and then leave.",
          changed: false,
        };
      }
      const due = daysUntilRaid(world);
      const safe = protectedStores(world);
      const exposed = exposedGoods(world);
      const neighbours = campSummaries(world);
      const coming = pendingArrivals(world);
      const describeThem = neighbours.length
        ? neighbours
            .map(
              (t) =>
                `${KINDS[t.kind].label.toLowerCase()} at ${t.home.q},${t.home.r} ` +
                `with ${plural(t.strength, "fighter")}`
            )
            .join("; ") + ". "
        : coming.length
        ? `The valley is empty; more will come in about ${plural(coming[0].days, "day")}. `
        : "";
      return {
        text:
          describeThem +
          (due === null
            ? "Nobody has come for you yet."
            : `Next raid expected in about ${plural(due, "day")}, likely ${plural(partySize(world), "raider")}.`) +
          ` You have ${exposed} in goods they could take and ${Math.round(
            (safe.food || 0) + (safe.wood || 0) + (safe.stone || 0)
          )} under granary.` +
          (neighbours.some((t) => t.loot > 0)
            ? ` They are sitting on ${neighbours.reduce((n, t) => n + t.loot, 0)} of yours.`
            : "") +
          ` Survived ${plural(world.raidsSurvived || 0, "raid")} so far.`,
        changed: false,
      };
    }

    default:
      return { text: describeFarm(world), changed: false };
  }
}

/**
 * Every input the parser could not place. docs/05 is right that this list is
 * how a parser grows — you add the phrasings people actually typed, not the
 * ones you imagined. The UI writes to it; nothing reads it yet but you.
 */
export function logMiss(world, input) {
  world.parserMisses = world.parserMisses || [];
  if (world.parserMisses.length < 100) world.parserMisses.push(input);
}
