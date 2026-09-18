// Season simulator for tuning. node tools/sim.mjs [width]
import fs from "node:fs";
import vm from "node:vm";
const src = ["players.js", "formats.js"].map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).join("\n");
const { ATP, WTA, singlesRating, pairRating, SEASON, DUAL_LADDER, DUAL_DOUBLES, CUP_RUN, CUP_LADDER, CUP_RUBBERS, ERAS, STACK_TOLERANCE } =
  vm.runInNewContext(`${src}\n;({ ATP, WTA, singlesRating, pairRating, SEASON, DUAL_LADDER, DUAL_DOUBLES, CUP_RUN, CUP_LADDER, CUP_RUBBERS, ERAS, STACK_TOLERANCE })`);
const WIDTH = Number(process.argv[2] || 4);
const OFFSET = Number(process.argv[3] || 0);
const toP = (r) => { const [era, name, cc, years, style, slams, college, serve, rtn, rally, net, clutch, dbl, hard, clay, grass] = r; return { era, name, serve, rtn, rally, net, clutch, dbl, hard, clay, grass }; };
const logistic = (d) => 1 / (1 + Math.exp(-d / WIDTH));

function draftDual(players, strategy) {
  const byEra = Object.groupBy(players, (p) => p.era);
  const eras = Object.keys(byEra);
  const picks = [];
  for (let i = 0; i < 6; i++) {
    const pool = byEra[eras[Math.floor(Math.random() * eras.length)]].filter((p) => !picks.includes(p));
    const ranked = [...pool].sort((a, b) => singlesRating(b, "hard") - singlesRating(a, "hard"));
    picks.push(strategy === "best" ? ranked[0] : strategy === "median" ? ranked[Math.floor(ranked.length / 2)] : pool[Math.floor(Math.random() * pool.length)]);
  }
  return picks.sort((a, b) => singlesRating(b, "hard") - singlesRating(a, "hard"));
}
function playSeason(lineup) {
  let wins = 0;
  for (const [, , D0] of SEASON) { const D = D0 + OFFSET;
    let pts = 0, dbl = 0;
    for (let i = 0; i < 3; i++) if (Math.random() < logistic(pairRating(lineup[2 * i], lineup[2 * i + 1]) - (D + DUAL_DOUBLES[i]))) dbl++;
    if (dbl >= 2) pts++;
    lineup.forEach((p, k) => { if (Math.random() < logistic(singlesRating(p, "hard") - (D + DUAL_LADDER[k]))) pts++; });
    if (pts >= 4) wins++;
  }
  return wins;
}
function draftCup(players, strategy, surface) {
  const byEra = Object.groupBy(players, (p) => p.era);
  const eras = Object.keys(byEra);
  const picks = [];
  for (let i = 0; i < 4; i++) {
    const pool = byEra[eras[Math.floor(Math.random() * eras.length)]].filter((p) => !picks.includes(p));
    const ranked = [...pool].sort((a, b) => singlesRating(b, surface) - singlesRating(a, surface));
    picks.push(strategy === "best" ? ranked[0] : strategy === "median" ? ranked[Math.floor(ranked.length / 2)] : pool[Math.floor(Math.random() * pool.length)]);
  }
  picks.sort((a, b) => singlesRating(b, surface) - singlesRating(a, surface));
  return { s1: picks[0], s2: picks[1], d: [picks[2], picks[3]] };
}
function playCup(team, home) {
  let wins = 0;
  for (const [, , surf, D0] of CUP_RUN) {
    const D = D0 + OFFSET, surface = surf || home;
    let mine = 0, theirs = 0;
    for (const [slot, line] of CUP_RUBBERS) {
      if (mine === 3 || theirs === 3) break;
      const r = slot === "d" ? pairRating(...team.d) : singlesRating(team[slot], surface);
      if (Math.random() < logistic(r - (D + CUP_LADDER[line]))) mine++; else theirs++;
    }
    if (mine === 3) wins++;
  }
  return wins;
}
for (const [tourName, tour] of [["ATP", ATP], ["WTA", WTA]]) {
  const players = tour.map(toP);
  for (const strategy of ["best", "median", "random"]) {
    const N = 4000; let perfect = 0, total = 0; const hist = new Array(13).fill(0);
    for (let n = 0; n < N; n++) { const w = playSeason(draftDual(players, strategy)); total += w; hist[w]++; if (w === 12) perfect++; }
    console.log(tourName, strategy.padEnd(6), "mean", (total / N).toFixed(1), "perfect", (100 * perfect / N).toFixed(1) + "%", "hist", hist.map((h) => Math.round(100 * h / N)).join(" "));
  }
  for (const strategy of ["best", "median", "random"]) {
    const N = 4000; let perfect = 0, total = 0; const hist = new Array(8).fill(0);
    for (let n = 0; n < N; n++) { const w = playCup(draftCup(players, strategy, "hard"), "hard"); total += w; hist[w]++; if (w === 7) perfect++; }
    console.log(tourName, "cup", strategy.padEnd(6), "mean", (total / N).toFixed(1), "perfect", (100 * perfect / N).toFixed(1) + "%", "hist", hist.map((h) => Math.round(100 * h / N)).join(" "));
  }
  const ranked = players.map((p) => [singlesRating(p, "hard").toFixed(1), p.name]).sort((a, b) => b[0] - a[0]);
  console.log(" top:", ranked.slice(0, 5).map((r) => `${r[1]} ${r[0]}`).join(", "), "\n bottom:", ranked.slice(-4).map((r) => `${r[1]} ${r[0]}`).join(", "));
}
