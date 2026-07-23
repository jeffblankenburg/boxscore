// Fits v7's composition weights (betaOff, betaPitch, hfaMultiplier) by
// WALK-FORWARD monthly: for each test month, fit on all strictly-earlier
// games (min log-loss over a grid), then evaluate that month out-of-sample.
// April is training-only. Accumulated OOS predictions answer the real
// question: does fitting raise hit rate / ROI over v6?
//
// dispersion r + firstInningBump stay fixed (fit from linescores).
// The daily-card head-to-head (registry vs v6-alone vs naive hybrid)
// lives in scripts/fit-registry.ts, which shares this walk-forward.
//   npx tsx --env-file=.env.local scripts/fit-v7.ts [YEAR]

import { loadEvalGames, fitV7Grid, predictV7, logLoss, type EvalGame, type V7Probs } from "./_v7-eval";
import { mlOddsInPlayableRange } from "@/lib/sports/mlb/predictions";
import { americanToProfitMultiplier } from "@/lib/sports/mlb/clv";

const YEAR = process.argv[2] ?? "2026";
const STAKE = 10;

const monthOf = (d: string) => d.slice(0, 7);

// ─── metrics ────────────────────────────────────────────────────────────
type Tally = { favC: number; favN: number; ll: number; plays: number; hits: number; staked: number; profit: number };
const mk = (): Tally => ({ favC: 0, favN: 0, ll: 0, plays: 0, hits: 0, staked: 0, profit: 0 });
function tallyMl(t: Tally, p: number, actual: "away" | "home", odds: number | null, thr: number) {
  t.favN++; if ((p >= 0.5) === (actual === "home")) t.favC++; t.ll += logLoss(p, actual === "home");
  if (p >= thr && mlOddsInPlayableRange(odds)) {
    t.plays++; const win = actual === "home"; if (win) t.hits++;
    if (odds != null) { t.staked += STAKE; t.profit += win ? STAKE * americanToProfitMultiplier(odds) : -STAKE; }
  }
}
function tallyNrfi(t: Tally, p: number, actual: boolean, nOdds: number | null, yOdds: number | null, thr: number) {
  t.favN++; if ((p >= 0.5) === actual) t.favC++; t.ll += logLoss(p, actual);
  let pick: boolean | null = null;
  if (p >= thr) pick = true; else if (p <= 1 - thr) pick = false;
  if (pick !== null) {
    t.plays++; const win = pick === actual; if (win) t.hits++;
    const odds = pick ? nOdds : yOdds;
    if (odds != null) { t.staked += STAKE; t.profit += win ? STAKE * americanToProfitMultiplier(odds) : -STAKE; }
  }
}
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "—");
const roi = (t: Tally) => (t.staked ? ((100 * t.profit) / t.staked).toFixed(1) + "%" : "—");
const line = (label: string, t: Tally) =>
  `  ${label.padEnd(14)} favAcc ${pct(t.favC, t.favN).padStart(6)}  logloss ${(t.ll / t.favN).toFixed(4)}  |  plays ${String(t.plays).padStart(4)}  hit ${pct(t.hits, t.plays).padStart(6)}  ROI ${roi(t).padStart(7)}`;

async function main() {
  console.log(`\nLoading ${YEAR} eval games…`);
  const games = await loadEvalGames(YEAR);
  const faith = games.reduce((s, g) => s + Math.abs(g.reV6HomeWin - g.v6HomeWin), 0) / games.length;
  console.log(`  ${games.length} games. Reconstruction faithfulness mean|Δv6| = ${faith.toFixed(5)}\n`);

  const months = [...new Set(games.map((g) => monthOf(g.date)))].sort();
  // OOS: each test month fit on all strictly-earlier games. Skip until ≥250
  // training games so early folds aren't fit on noise.
  const oos: Array<{ g: EvalGame; p: V7Probs }> = [];
  const foldParams: string[] = [];
  for (const tm of months) {
    const train = games.filter((g) => monthOf(g.date) < tm);
    if (train.length < 250) continue;
    const cfg = fitV7Grid(train);
    foldParams.push(`  ${tm}: betaOff=${cfg.betaOff} betaPitch=${cfg.betaPitch} hfa=${cfg.hfaMultiplier} (train n=${train.length})`);
    for (const g of games.filter((x) => monthOf(x.date) === tm)) {
      const p = predictV7(g, cfg);
      if (p) oos.push({ g, p });
    }
  }
  console.log(`Walk-forward fitted params per test month:\n${foldParams.join("\n")}`);
  console.log(`\nOut-of-sample evaluation on ${oos.length} games (test months only):`);

  // v6 (shipped) vs v7-fitted at the v6 threshold 0.545 — apples to apples.
  const THR = 0.545;
  const v6ml = mk(), v6nr = mk(), v7ml = mk(), v7nr = mk();
  for (const { g, p } of oos) {
    tallyMl(v6ml, g.v6HomeWin, g.actualWinner, g.mlHomeOdds, THR);
    tallyNrfi(v6nr, g.v6Nrfi, g.actualNrfi, g.nrfiOdds, g.yrfiOdds, THR);
    tallyMl(v7ml, p.homeWin, g.actualWinner, g.mlHomeOdds, THR);
    tallyNrfi(v7nr, p.nrfi, g.actualNrfi, g.nrfiOdds, g.yrfiOdds, THR);
  }
  console.log(`\nMONEYLINE @ ${THR}`);
  console.log(line("v6 (shipped)", v6ml));
  console.log(line("v7 (fitted)", v7ml));
  console.log(`\nNRFI @ ${THR}`);
  console.log(line("v6 (shipped)", v6nr));
  console.log(line("v7 (fitted)", v7nr));

  // Threshold sweep on v7-fitted OOS probs — where's the ROI sweet spot?
  console.log(`\nv7-fitted threshold sweep (OOS):`);
  console.log(`  thr     ML plays  ML hit   ML ROI  |  NRFI plays  NRFI hit  NRFI ROI`);
  for (const thr of [0.52, 0.54, 0.55, 0.56, 0.58, 0.60]) {
    const ml = mk(), nr = mk();
    for (const { g, p } of oos) { tallyMl(ml, p.homeWin, g.actualWinner, g.mlHomeOdds, thr); tallyNrfi(nr, p.nrfi, g.actualNrfi, g.nrfiOdds, g.yrfiOdds, thr); }
    console.log(`  ${thr.toFixed(2)}   ${String(ml.plays).padStart(7)}  ${pct(ml.hits, ml.plays).padStart(6)}  ${roi(ml).padStart(6)}  |  ${String(nr.plays).padStart(9)}  ${pct(nr.hits, nr.plays).padStart(7)}  ${roi(nr).padStart(7)}`);
  }
  console.log(`\n(Daily-card head-to-head vs v6-alone: scripts/fit-registry.ts)\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
