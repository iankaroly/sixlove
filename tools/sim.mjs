// Season simulator for tuning. node tools/sim.mjs [width]
import fs from "node:fs";
import vm from "node:vm";
const src = ["players.js", "formats.js"].map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).join("\n");
const { ATP, WTA, singlesRating, pairRating, SEASON, DUAL_LADDER, DUAL_DOUBLES, CUP_RUN, CUP_LADDER, CUP_RUBBERS, matchup, finaleBonus, FAMILIES } =
  vm.runInNewContext(`${src}\n;({ ATP, WTA, singlesRating, pairRating, SEASON, DUAL_LADDER, DUAL_DOUBLES, CUP_RUN, CUP_LADDER, CUP_RUBBERS, matchup, finaleBonus, FAMILIES })`);
const WIDTH = Number(process.argv[2] || 4);
const OFFSET = Number(process.argv[3] || 0);
const toP = (r) => { const [era, name, cc, years, style, slams, college, serve, rtn, rally, net, clutch, dbl, hard, clay, grass] = r; return { era, name, cc, style, slams, serve, rtn, rally, net, clutch, dbl, hard, clay, grass }; };
const oppStyle = () => FAMILIES[Math.floor(Math.random() * FAMILIES.length)];
const logistic = (d) => 1 / (1 + Math.exp(-d / WIDTH));

function bestPairs(roster, count) {
  // Brute force the best disjoint pairs from a small roster.
  let best = null, bestSum = -Infinity;
  const rec = (left, chosen, sum) => {
    if (chosen.length === count) { if (sum > bestSum) { bestSum = sum; best = chosen; } return; }
    for (let i = 0; i < left.length; i++) for (let j = i + 1; j < left.length; j++) {
      rec(left.filter((_, k) => k !== i && k !== j), [...chosen, [left[i], left[j]]], sum + pairRating(left[i], left[j]));
    }
  };
  rec(roster, [], 0);
  return best.sort((a, b) => pairRating(...b) - pairRating(...a));
}
function draftDual(players, strategy) {
  const byEra = Object.groupBy(players, (p) => p.era);
  const eras = Object.keys(byEra);
  const picks = [];
  for (let i = 0; i < 8; i++) {
    const pool = byEra[eras[Math.floor(Math.random() * eras.length)]].filter((p) => !picks.includes(p));
    const key = i >= 6 ? (p) => p.dbl : (p) => singlesRating(p, "hard");
    const ranked = [...pool].sort((a, b) => key(b) - key(a));
    picks.push(strategy === "best" ? ranked[0] : strategy === "median" ? ranked[Math.floor(ranked.length / 2)] : pool[Math.floor(Math.random() * pool.length)]);
  }
  const ladder = picks.slice(0, 6).sort((a, b) => singlesRating(b, "hard") - singlesRating(a, "hard"));
  return { ladder, pairs: bestPairs(picks, 3) };
}
function playSeason({ ladder, pairs }) {
  let wins = 0;
  SEASON.forEach(([, , D0], si) => { const D = D0 + OFFSET, finale = si >= SEASON.length - 3;
    let pts = 0, dbl = 0;
    for (let i = 0; i < 3; i++) if (Math.random() < logistic(pairRating(...pairs[i]) - (D + DUAL_DOUBLES[i]))) dbl++;
    const lineup = ladder;
    if (dbl >= 2) pts++;
    lineup.forEach((p, k) => { if (Math.random() < logistic(singlesRating(p, "hard") + matchup(p, oppStyle()) + (finale ? finaleBonus(p) : 0) - (D + DUAL_LADDER[k]))) pts++; });
    if (pts >= 4) wins++;
  });
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
  return { s1: picks[0], s2: picks[1], d: bestPairs(picks, 1)[0] };
}
function playCup(team, home) {
  let wins = 0;
  CUP_RUN.forEach(([, , surf, D0], si) => {
    const D = D0 + OFFSET, surface = surf || home, finale = si >= CUP_RUN.length - 3;
    let mine = 0, theirs = 0;
    for (const [slot, line] of CUP_RUBBERS) {
      if (mine === 3 || theirs === 3) break;
      const r = slot === "d" ? pairRating(...team.d) : singlesRating(team[slot], surface) + matchup(team[slot], oppStyle()) + (finale ? finaleBonus(team[slot]) : 0);
      if (Math.random() < logistic(r - (D + CUP_LADDER[line]))) mine++; else theirs++;
    }
    if (mine === 3) wins++;
  });
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
