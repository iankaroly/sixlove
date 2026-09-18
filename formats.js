// What you can build, which era each roll lands on, and how a season is scored.

const TOURS = {
  atp: { name: "ATP", short: "ATP", players: () => ATP },
  wta: { name: "WTA", short: "WTA", players: () => WTA },
  open: { name: "Open era mix", short: "Mixed", players: () => [...ATP, ...WTA] },
};

// Era pools. The scene line is what the roll board shows under the decade.
const ERAS = [
  ["70s", "1970s", { atp: "Wood and wool", wta: "Open era pioneers", open: "Wood and wool" }],
  ["80s", "1980s", { atp: "Graphite arrives", wta: "Graphite arrives", open: "Graphite arrives" }],
  ["90s", "1990s", { atp: "Serve and volley's last stand", wta: "The power game arrives", open: "Power and volleys" }],
  ["00s", "2000s", { atp: "Baseline power", wta: "The Williams era", open: "The power baseline" }],
  ["10s", "2010s", { atp: "The Big Four", wta: "Serena's decade", open: "The golden decade" }],
  ["20s", "2020s", { atp: "The next generation", wta: "The new guard", open: "The new guard" }],
];

const RATING_KEYS = [
  ["serve", "Serve"], ["rtn", "Return"], ["rally", "Rally"], ["net", "Net"], ["clutch", "Clutch"], ["dbl", "Doubles"],
];
const SURFACES = { hard: "Hard", clay: "Clay", grass: "Grass" };

// ---------- how a player is really judged ----------
// The bars show skills. What wins matches is skills plus the things a tennis fan knows: how a player
// handles the big moments, what they have actually won, which surface suits them, and how their game
// matches up against the opponent's. None of that is printed on the card.

// Play styles, from the label on the card. Servers, volleyers, retrievers, power hitters, all-courters.
const STYLE_FAMILY = {
  "Big server": "server", "Kick serve": "server",
  "Serve and volley": "volleyer", "Net rusher": "volleyer", "Doubles specialist": "volleyer",
  "Counterpuncher": "retriever", "Return king": "retriever", "Return queen": "retriever", "Grinder": "retriever",
  "Moonballer": "retriever", "Giant killer": "retriever", "Baseline machine": "retriever", "Clay grinder": "retriever",
  "Clay artist": "retriever", "Clay king": "retriever", "Clay queen": "retriever", "The Mosquito": "retriever",
  "Power baseline": "power", "Power": "power", "Flat hitter": "power", "Big hitter": "power", "Two-fisted power": "power",
  "Two-fisted": "power", "Forehand": "power", "One-handed power": "power", "Lefty power": "power",
};
const family = (p) => STYLE_FAMILY[p.style] || "allcourt";
const FAMILY_NAMES = { server: "big server", volleyer: "volleyer", retriever: "retriever", power: "power hitter", allcourt: "all-courter" };

// Matchups, in rating points for the first style against the second.
const MATCHUP = {
  server: { retriever: -2.5, volleyer: 1, power: 0.5, allcourt: 0, server: 0 },
  volleyer: { power: -2, retriever: 1.5, server: 0, allcourt: 0, volleyer: 0 },
  retriever: { power: 2, volleyer: -1.5, server: 1.5, allcourt: 0, retriever: 0 },
  power: { volleyer: 2, retriever: -2, server: 0, allcourt: 0, power: 0 },
  allcourt: { server: 0.5, volleyer: 0.5, retriever: 0.5, power: 0.5, allcourt: 0 },
};
// Surfaces, in rating points: volleyers and servers love grass and hate clay, retrievers the reverse.
const SURFACE_FIT = {
  server: { hard: 0.5, clay: -2, grass: 2 }, volleyer: { hard: 0, clay: -2.5, grass: 2.5 },
  retriever: { hard: 0, clay: 2, grass: -1.5 }, power: { hard: 0.5, clay: -0.5, grass: 0 }, allcourt: { hard: 0.5, clay: 0, grass: 0.5 },
};
const matchup = (a, b) => MATCHUP[family(a)][b] || 0;

// What a player has actually won. Zero slams is 60, ten is 92, twenty-plus tops out.
const pedigree = (p) => Math.min(99, 60 + p.slams * 3.2);
const skill = (p) => 0.24 * p.serve + 0.2 * p.rtn + 0.32 * p.rally + 0.12 * p.net + 0.12 * p.clutch;
const singlesRating = (p, surface) =>
  0.5 * skill(p) + 0.25 * p[surface] + 0.25 * (0.55 * p.clutch + 0.45 * pedigree(p)) + SURFACE_FIT[family(p)][surface];
// In the last three matches of a run, nerves count double.
const finaleBonus = (p) => (p.clutch - 82) * 0.12;

// Doubles is its own craft, and chemistry is real: two net players click, two grinders get passed,
// and pairs that actually played together get a bonus. Compatriots get a little too.
const REAL_PAIRS = [
  ["Bob Bryan", "Mike Bryan"], ["Martina Navratilova", "Pam Shriver"], ["Billie Jean King", "Rosie Casals"],
  ["Gigi Fernández", "Natasha Zvereva"], ["Sara Errani", "Roberta Vinci"], ["Barbora Krejčíková", "Kateřina Siniaková"],
  ["Martina Hingis", "Jana Novotná"], ["Helena Suková", "Jana Novotná"], ["Lisa Raymond", "Sam Stosur"],
  ["Stefan Edberg", "Anders Järryd"], ["Jack Sock", "John Isner"], ["Rafael Nadal", "Carlos Alcaraz"],
  ["Roger Federer", "Stan Wawrinka"], ["Serena Williams", "Venus Williams"], ["Steffi Graf", "Gabriela Sabatini"],
  ["Arantxa Sánchez Vicario", "Jana Novotná"], ["Lindsay Davenport", "Natasha Zvereva"], ["Rod Laver", "Ken Rosewall"],
  ["John Newcombe", "Rod Laver"], ["Margaret Court", "Evonne Goolagong"], ["Andy Murray", "Jamie Murray"],
  ["Coco Gauff", "Jessica Pegula"], ["Ashleigh Barty", "Coco Gauff"], ["Kim Clijsters", "Justine Henin"],
];
const isRealPair = (a, b) => REAL_PAIRS.some(([x, y]) => (x === a.name && y === b.name) || (x === b.name && y === a.name));
function chemistry(a, b) {
  const fa = family(a), fb = family(b);
  let c = 0;
  if (fa === "volleyer" && fb === "volleyer") c += 3;
  else if (fa === "volleyer" || fb === "volleyer") c += 1;
  if (fa === "retriever" && fb === "retriever") c -= 2.5;
  if (fa === "power" && fb === "power") c -= 1;
  if (a.cc === b.cc) c += 1;
  if (isRealPair(a, b)) c += 4;
  return c;
}
const pairRating = (a, b) => 0.5 * (a.dbl + b.dbl) / 2 + 0.2 * (a.net + b.net) / 2 + 0.15 * (a.serve + b.serve) / 2 + 0.15 * (a.rtn + b.rtn) / 2 + chemistry(a, b);

// Each roll deals a hand from the era. Legends are rare, doubles specialists turn up often enough to matter.
const HAND_SIZE = 8;
function dealWeight(p) {
  const r = singlesRating(p, "hard");
  if (p.dbl >= 92 && r < 80) return 0.9;
  return r >= 91 ? 0.1 : r >= 87 ? 0.25 : r >= 82 ? 0.5 : r >= 76 ? 0.8 : 1;
}
// Weighted sample without replacement, driven by the game's seeded rng so rooms and dailies stay identical.
function dealHand(players, rng, size = HAND_SIZE) {
  const pool = players.map((p) => ({ p, w: dealWeight(p) }));
  const hand = [];
  while (hand.length < size && pool.length) {
    let total = pool.reduce((s, x) => s + x.w, 0), r = rng() * total, i = 0;
    for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r <= 0) break; }
    hand.push(pool.splice(i, 1)[0].p);
  }
  return hand;
}

// NCAA rule: the ladder must run in order of ability. A spot may be this much stronger than the spot above it.
const STACK_TOLERANCE = 4;

// A dual match: three doubles lines for one point, then six singles. First to four.
// The card has six singles spots and three doubles teams with two seats each. A rolled player goes into
// any open spot; a singles player can also be seated in doubles from the roster.
const seat = (team, side) => ({ id: `d${team}${side}`, name: `Doubles ${team}`, short: `Dbl ${team}`, seat: true, team });
const DUAL_SLOTS = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `s${n}`, name: `No. ${n} singles`, short: `No. ${n}`, line: n, singles: true })),
  seat(1, "a"), seat(1, "b"), seat(2, "a"), seat(2, "b"), seat(3, "a"), seat(3, "b"),
];
const DUAL_LADDER = [5, 3, 1, -1, -3, -5];   // opponent strength by singles line, relative to the dual's rating
const DUAL_DOUBLES = [2, 0, -2];               // and by doubles line

// Twelve duals, from a soft opener to the NCAA final.
const SEASON = [
  ["Ohio State", "Season opener, Columbus", 62], ["Michigan", "Ann Arbor", 64],
  ["Baylor", "ITA Indoor, Chicago", 66], ["Tennessee", "Knoxville", 68],
  ["Florida", "Gainesville", 70], ["Georgia", "Athens", 72],
  ["Texas", "Austin", 73], ["Wake Forest", "Conference final", 75],
  ["Virginia", "NCAA round of 16", 77], ["TCU", "NCAA quarterfinal", 79],
  ["Stanford", "NCAA semifinal", 81], ["USC", "NCAA final", 83],
];

// A cup tie: two singles players and a doubles pair. Five rubbers, first to three.
const CUP_SLOTS = [
  { id: "s1", name: "No. 1 singles", short: "No. 1", line: 1, singles: true }, { id: "s2", name: "No. 2 singles", short: "No. 2", line: 2, singles: true },
  { id: "d1a", name: "Doubles", short: "Dbl", seat: true, team: 1 }, { id: "d1b", name: "Doubles", short: "Dbl", seat: true, team: 1 },
];
// Seven ties. Surface null means your home surface.
const CUP_RUN = [
  ["Canada", "Qualifier, at home", null, 66], ["Australia", "Group stage, at home", null, 69],
  ["Argentina", "Group stage, Buenos Aires", "clay", 72], ["Great Britain", "Group stage, Eastbourne", "grass", 75],
  ["France", "Quarterfinal, at home", null, 78], ["Spain", "Semifinal, Madrid", "clay", 81],
  ["Italy", "Final, Bologna", "hard", 84],
];
const CUP_LADDER = { 1: 3, 2: -3, 0: 0 };  // their No. 1, No. 2 and doubles pair, relative to the tie's rating
// The five rubbers in order: [my slot, their line]. Play stops once a side has three.
const CUP_RUBBERS = [["s1", 2], ["s2", 1], ["d", 0], ["s1", 1], ["s2", 2]];
// Opposing teams have styles too, dealt from the stage name so they're the same for everyone in a room.
const FAMILIES = ["server", "volleyer", "retriever", "power", "allcourt"];
function opponentStyle(stageTitle, line) {
  let h = 2166136261;
  for (const ch of `${stageTitle}#${line}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return FAMILIES[(h >>> 0) % FAMILIES.length];
}
// Every match is decided by a logistic on the rating gap. Five points of gap is about 88-12, so class tells.
const MATCH_WIDTH = 2.5;
const winChance = (mine, theirs) => 1 / (1 + Math.exp(-(mine - theirs) / MATCH_WIDTH));

const BUILDS = {
  dual: {
    name: "A college team",
    headline: "Draft six pros. Win the national title.",
    lede: "Roll, and you get a hand of eight from one era: a different eight every time, from journeymen and doubles specialists up to, once in a while, a legend. Take one and give them a spot: the singles ladder, No. 1 to No. 6, or a seat on Doubles 1, 2 or 3. Singles players can be seated in doubles too. When the card is full, play a twelve-dual season and try to go 12-0.",
    rule: "The ladder has to run in order of ability. Put a clearly better player below a weaker one and the NCAA calls it stacking: that line is defaulted every match.",
    knowledge: "The bars are only part of it. Big-match nerve, what a player actually won, surface, style matchups and doubles chemistry all count, and none of it is printed on the card. Servers get neutralised by great returners, volleyers get passed by power hitters, retrievers grind power down. Two net players click in doubles; real-life partners click more.",
    posterTitle: "Lineup card", footEmpty: "Six singles spots and three doubles teams. No. 1 faces their best player, No. 6 their weakest. Doubles 1 faces their best pair.",
    seatHint: "Use the arrows to reorder the ladder any time before you play. Roll for a doubles player, or tap an open seat to add someone already in singles.",
    place: "a spot on the ladder", crateLede: "Choose one player from this pool.",
    fullTitle: "The lineup card is in", fullLede: "Twelve duals: doubles point first, then six singles, first to four. The opponents get tougher all the way to the NCAA final.",
    start: "Play the season", running: "in season", stage: "Dual", win: "W", loss: "L", surfaceNote: "Every dual is on hard courts.",
    verdicts: ["12-0. A perfect season and a national title.", "One or two slipped away, but the banner goes up.",
      "A tournament team. Not a champion.", "A .500 season. The athletic director is patient, for now.", "Rebuilding year."],
  },
  cup: {
    name: "A nation cup team",
    headline: "Draft four pros. Bring the cup home.",
    lede: "Two singles players and a doubles pair, rolled one era at a time. A singles player can take a doubles seat too. Ties are played on whatever the host lays down, so pick your home surface and draft for it.",
    rule: "Each tie is five rubbers, first to three: singles day one, doubles day two, reverse singles day three. Away ties are on the hosts' surface.",
    knowledge: "The bars are only part of it. Nerve, pedigree, surface and style matchups all count. Volleyers and servers love grass and hate clay; retrievers live on clay. Two net players click in doubles; real-life partners click more.",
    posterTitle: "Tie nomination", footEmpty: "Two singles spots and a doubles pair. A singles player can double up.",
    seatHint: "Use the arrows to swap your singles any time before you play. Roll for a doubles player, or tap an open seat to add one of your singles players.",
    place: "a place on the team", crateLede: "Choose one player from this pool.",
    fullTitle: "The team is nominated", fullLede: "Seven ties. Home ties are on your surface; away ties are on theirs.",
    start: "Play the ties", running: "in the cup", stage: "Tie", win: "W", loss: "L", surfaceNote: "",
    verdicts: ["Seven ties, seven wins. The cup comes home.", "Six from seven. The cup comes home with one scare.",
      "A strong run, but the away surfaces bit.", "Home wins only. The away days were a struggle.", "Relegation playoff next year."],
  },
};
