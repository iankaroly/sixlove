// What you can build, which pools the draw lands on, and how a season is scored.

const TOURS = {
  atp: { name: "ATP", short: "ATP", players: () => ATP },
  wta: { name: "WTA", short: "WTA", players: () => WTA },
  open: { name: "Open era mix", short: "Mixed", players: () => [...ATP, ...WTA] },
};

// Era pools. The scene line is what the draw board shows under the decade.
const ERAS = [
  ["70s", "1970s", { atp: "Wood and wool", wta: "Open era pioneers", open: "Wood and wool" }],
  ["80s", "1980s", { atp: "Graphite arrives", wta: "Graphite arrives", open: "Graphite arrives" }],
  ["90s", "1990s", { atp: "Serve and volley's last stand", wta: "The power game arrives", open: "Power and volleys" }],
  ["00s", "2000s", { atp: "Baseline power", wta: "The Williams era", open: "The power baseline" }],
  ["10s", "2010s", { atp: "The Big Four", wta: "Serena's decade", open: "The golden decade" }],
  ["20s", "2020s", { atp: "The next generation", wta: "The new guard", open: "The new guard" }],
];

// Wild pools cut across every era. They are dealt nine players at a time.
const WILD_POOLS = [
  { id: "wild-doubles", scene: "Doubles specialists", test: (p) => p.dbl >= 94 },
  { id: "wild-net", scene: "Net rushers", test: (p) => p.net >= 90 },
  { id: "wild-serve", scene: "Big servers", test: (p) => p.serve >= 92 },
  { id: "wild-return", scene: "Return artists", test: (p) => p.rtn >= 90 },
  { id: "wild-clay", scene: "Clay specialists", test: (p) => p.clay >= p.hard + 4 },
  { id: "wild-grass", scene: "Grass lovers", test: (p) => p.grass >= p.hard + 4 || p.grass >= 95 },
  { id: "wild-legends", scene: "Ten or more slams", test: (p) => p.slams >= 10 },
  { id: "wild-one", scene: "One-slam wonders", test: (p) => p.slams === 1 },
  { id: "wild-none", scene: "Never won a slam", test: (p) => p.slams === 0 },
  { id: "wild-college", scene: "College alumni", test: (p) => Boolean(p.college) },
  { id: "wild-clutch", scene: "Ice in the veins", test: (p) => p.clutch >= 90 },
];

const RATING_KEYS = [
  ["serve", "Serve"], ["rtn", "Return"], ["rally", "Rally"], ["net", "Net"], ["clutch", "Clutch"], ["dbl", "Doubles"],
];
const SURFACES = { hard: "Hard", clay: "Clay", grass: "Grass" };

// A singles line is mostly skill, partly the surface underfoot. Doubles is its own craft.
const singlesRating = (p, surface) =>
  0.68 * (0.22 * p.serve + 0.2 * p.rtn + 0.3 * p.rally + 0.1 * p.net + 0.18 * p.clutch) + 0.32 * p[surface];
const pairRating = (a, b) => 0.75 * (a.dbl + b.dbl) / 2 + 0.25 * (a.net + b.net) / 2;

// NCAA rule: the ladder must run in order of ability. A spot may be this much stronger than the spot above it.
const STACK_TOLERANCE = 4;

// A dual match: three doubles lines for one point, then six singles. First to four.
const DUAL_SLOTS = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `s${n}`, name: `No. ${n} singles`, line: n }));
const DUAL_PAIRS = [["s1", "s2"], ["s3", "s4"], ["s5", "s6"]];
const DUAL_LADDER = [5, 3, 1, -1, -3, -5];   // opponent strength by singles line, relative to the dual's rating
const DUAL_DOUBLES = [2, 0, -2];               // and by doubles line

// Twelve duals, from a soft opener to the NCAA final.
const SEASON = [
  ["Ohio State", "Season opener, Columbus", 71], ["Michigan", "Ann Arbor", 73],
  ["Baylor", "ITA Indoor, Chicago", 75], ["Tennessee", "Knoxville", 77],
  ["Florida", "Gainesville", 79], ["Georgia", "Athens", 81],
  ["Texas", "Austin", 82], ["Wake Forest", "Conference final", 84],
  ["Virginia", "NCAA round of 16", 85], ["TCU", "NCAA quarterfinal", 87],
  ["Stanford", "NCAA semifinal", 89], ["USC", "NCAA final", 91],
];

// A cup tie: two singles players and a doubles pair. Five rubbers, first to three.
const CUP_SLOTS = [
  { id: "s1", name: "No. 1 singles", line: 1 }, { id: "s2", name: "No. 2 singles", line: 2 },
  { id: "d1", name: "Doubles", line: 0 }, { id: "d2", name: "Doubles partner", line: 0 },
];
// Seven ties. Surface null means your home surface.
const CUP_RUN = [
  ["Canada", "Qualifier, at home", null, 76], ["Australia", "Group stage, at home", null, 79],
  ["Argentina", "Group stage, Buenos Aires", "clay", 82], ["Great Britain", "Group stage, Eastbourne", "grass", 84],
  ["France", "Quarterfinal, at home", null, 86], ["Spain", "Semifinal, Madrid", "clay", 89],
  ["Italy", "Final, Bologna", "hard", 92],
];
const CUP_LADDER = { 1: 3, 2: -3, 0: 0 };  // their No. 1, No. 2 and doubles pair, relative to the tie's rating
// The five rubbers in order: [my slot, their line]. Play stops once a side has three.
const CUP_RUBBERS = [["s1", 2], ["s2", 1], ["d", 0], ["s1", 1], ["s2", 2]];
// Every match is decided by a logistic on the rating gap. Four points of gap is about 73-27.
const MATCH_WIDTH = 4;
const winChance = (mine, theirs) => 1 / (1 + Math.exp(-(mine - theirs) / MATCH_WIDTH));

const BUILDS = {
  dual: {
    name: "A college team",
    headline: "Draft six pros. Win the national title.",
    lede: "The draw lands on an era. Take one player from it and give them a spot on your ladder, No. 1 to No. 6. Adjacent spots pair up for doubles. Then play a twelve-dual season and try to go 12-0.",
    rule: "The ladder has to run in order of ability. Put a clearly better player below a weaker one and the NCAA calls it stacking: that line is defaulted every match.",
    posterTitle: "Lineup card", footEmpty: "Six spots. No. 1 faces their best player, No. 6 their weakest.",
    place: "a spot on the ladder", crateLede: "Choose one player from this pool.",
    fullTitle: "The lineup is set", fullLede: "Twelve duals: doubles point first, then six singles, first to four. The opponents get tougher all the way to the NCAA final.",
    start: "Play the season", running: "in season", stage: "Dual", win: "W", loss: "L", surfaceNote: "Every dual is on hard courts.",
    verdicts: ["12-0. A perfect season and a national title.", "One or two slipped away, but the banner goes up.",
      "A tournament team. Not a champion.", "A .500 season. The athletic director is patient, for now.", "Rebuilding year."],
  },
  cup: {
    name: "A nation cup team",
    headline: "Draft four pros. Bring the cup home.",
    lede: "Two singles players and a doubles pair. Ties are played on whatever the host lays down, so pick your home surface and draft for it. Seven ties from the qualifier to the final.",
    rule: "Each tie is five rubbers, first to three: singles day one, doubles day two, reverse singles day three. Away ties are on the hosts' surface.",
    posterTitle: "Tie nomination", footEmpty: "Two singles spots and a doubles pair.",
    place: "a place on the team", crateLede: "Choose one player from this pool.",
    fullTitle: "The team is nominated", fullLede: "Seven ties. Home ties are on your surface; away ties are on theirs.",
    start: "Play the ties", running: "in the cup", stage: "Tie", win: "W", loss: "L", surfaceNote: "",
    verdicts: ["Seven ties, seven wins. The cup comes home.", "Six from seven. The cup comes home with one scare.",
      "A strong run, but the away surfaces bit.", "Home wins only. The away days were a struggle.", "Relegation playoff next year."],
  },
};
