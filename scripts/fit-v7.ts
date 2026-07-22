// Fits v7's composition weights (betaOff, betaPitch, hfaMultiplier) by
// WALK-FORWARD monthly: for each test month, fit on all strictly-earlier
// games (min log-loss over a grid), then evaluate that month out-of-sample.
// April is training-only. Accumulated OOS predictions answer the real
// question: does fitting raise hit rate / ROI over v6 and pre-fit v7?
//
// dispersion r + firstInningBump stay fixed (fit from linescores).
//   npx tsx --env-file=.env.local scripts/fit-v7.ts [YEAR]

import { loadEvalGames, type EvalGame } from "./_v7-eval";
import { DEFAULT_V7_CONFIG, deriveMarkets, type V7Config } from "@/lib/sports/mlb/run-model";
import { mlOddsInPlayableRange } from "@/lib/sports/mlb/predictions";
import { americanToProfitMultiplier } from "@/lib/sports/mlb/predictions-history";
import { selectDailyRecommendations, type RecCandidate } from "@/lib/sports/mlb/recommendations";

// v7-scale play thresholds for the recommendation policy (from the sweep).
const REC_ML_THR = 0.58, REC_NRFI_THR = 0.55, MAX_PICKS = 5;

const YEAR = process.argv[2] ?? "2026";
const STAKE = 10;
const clampP = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const logloss = (p: number, y: boolean) => -(y ? Math.log(clampP(p)) : Math.log(1 - clampP(p)));

const GRID_BETA = [0.3, 0.5, 0.7, 0.9, 1.1, 1.3];
const GRID_HFA = [1.0, 1.01, 1.02, 1.03, 1.04, 1.05];

type Probs = { homeWin: number; nrfi: number };
function predict(g: EvalGame, cfg: V7Config): Probs | null {
  const m = deriveMarkets(g.away, g.home, cfg);
  if (!Number.isFinite(m.homeWin) || !Number.isFinite(m.nrfi)) return null;
  return { homeWin: m.homeWin, nrfi: m.nrfi };
}

// Combined ML+NRFI log-loss over a game set for a candidate cfg.
function trainLoss(games: EvalGame[], cfg: V7Config): number {
  let sum = 0, n = 0;
  for (const g of games) {
    const p = predict(g, cfg);
    if (!p) continue;
    sum += logloss(p.homeWin, g.actualWinner === "home") + logloss(p.nrfi, g.actualNrfi);
    n++;
  }
  return n ? sum / n : Infinity;
}

function fitBest(train: EvalGame[]): V7Config {
  let best = DEFAULT_V7_CONFIG, bestLoss = Infinity;
  for (const betaOff of GRID_BETA)
    for (const betaPitch of GRID_BETA)
      for (const hfaMultiplier of GRID_HFA) {
        const cfg = { ...DEFAULT_V7_CONFIG, betaOff, betaPitch, hfaMultiplier };
        const loss = trainLoss(train, cfg);
        if (loss < bestLoss) { bestLoss = loss; best = cfg; }
      }
  return best;
}

const monthOf = (d: string) => d.slice(0, 7);

// ─── metrics ────────────────────────────────────────────────────────────
type Tally = { favC: number; favN: number; ll: number; plays: number; hits: number; staked: number; profit: number };
const mk = (): Tally => ({ favC: 0, favN: 0, ll: 0, plays: 0, hits: 0, staked: 0, profit: 0 });
function tallyMl(t: Tally, p: number, actual: "away" | "home", odds: number | null, thr: number) {
  t.favN++; if ((p >= 0.5) === (actual === "home")) t.favC++; t.ll += logloss(p, actual === "home");
  if (p >= thr && mlOddsInPlayableRange(odds)) {
    t.plays++; const win = actual === "home"; if (win) t.hits++;
    if (odds != null) { t.staked += STAKE; t.profit += win ? STAKE * americanToProfitMultiplier(odds) : -STAKE; }
  }
}
function tallyNrfi(t: Tally, p: number, actual: boolean, nOdds: number | null, yOdds: number | null, thr: number) {
  t.favN++; if ((p >= 0.5) === actual) t.favC++; t.ll += logloss(p, actual);
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
  const oos: Array<{ g: EvalGame; p: Probs }> = [];
  const foldParams: string[] = [];
  for (const tm of months) {
    const train = games.filter((g) => monthOf(g.date) < tm);
    if (train.length < 250) continue;
    const cfg = fitBest(train);
    foldParams.push(`  ${tm}: betaOff=${cfg.betaOff} betaPitch=${cfg.betaPitch} hfa=${cfg.hfaMultiplier} (train n=${train.length})`);
    for (const g of games.filter((x) => monthOf(x.date) === tm)) {
      const p = predict(g, cfg);
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

  // ─── Recommendation-policy HEAD-TO-HEAD: v6 vs v7, same rule ────────────
  // Same policy (≥1 ML + ≥1 NRFI, ≤5/day, best-of-slate guarantee), each
  // model with its OWN calibrated thresholds. Answers: would v7's daily
  // picks actually beat v6's daily picks?
  const gradePick = (t: Tally, win: boolean, odds: number | null) => {
    t.plays++; if (win) t.hits++;
    if (odds != null) { t.staked += STAKE; t.profit += win ? STAKE * americanToProfitMultiplier(odds) : -STAKE; }
  };
  const byDay = new Map<string, Array<{ g: EvalGame; p: Probs }>>();
  for (const e of oos) { const l = byDay.get(e.g.date) ?? []; l.push(e); byDay.set(e.g.date, l); }

  type Entry = { g: EvalGame; p: Probs };
  function evalRecSet(getHome: (e: Entry) => number, getNrfi: (e: Entry) => number, mlThr: number, nrfiThr: number) {
    const all = mk(), ml = mk(), nrfi = mk(), guar = mk();
    let total = 0;
    for (const [, entries] of byDay) {
      const cands: RecCandidate[] = entries.map((e) => ({
        gamePk: e.g.gamePk, awayAbbr: e.g.awayAbbr, homeAbbr: e.g.homeAbbr,
        homeWin: getHome(e), nrfi: getNrfi(e), homeMlOdds: e.g.mlHomeOdds,
      }));
      const recs = selectDailyRecommendations(cands, { mlThreshold: mlThr, nrfiThreshold: nrfiThr, maxPicks: MAX_PICKS, oddsBandOk: mlOddsInPlayableRange });
      total += recs.length;
      const gByPk = new Map(entries.map((e) => [e.g.gamePk, e.g]));
      for (const r of recs) {
        const g = gByPk.get(r.gamePk)!;
        const win = r.market === "ML" ? g.actualWinner === "home" : g.actualNrfi === (r.side === "NRFI");
        const odds = r.market === "ML" ? g.mlHomeOdds : r.side === "NRFI" ? g.nrfiOdds : g.yrfiOdds;
        gradePick(all, win, odds); gradePick(r.market === "ML" ? ml : nrfi, win, odds);
        if (r.guaranteed) gradePick(guar, win, odds);
      }
    }
    return { all, ml, nrfi, guar, total };
  }

  const recLine = (label: string, t: Tally) => `  ${label.padEnd(16)} picks ${String(t.plays).padStart(4)}  hit ${pct(t.hits, t.plays).padStart(6)}  ROI ${roi(t).padStart(7)}  (odds ${t.staked / STAKE}/${t.plays})`;
  const v6rec = evalRecSet((e) => e.g.v6HomeWin, (e) => e.g.v6Nrfi, 0.545, 0.545);
  const v7rec = evalRecSet((e) => e.p.homeWin, (e) => e.p.nrfi, REC_ML_THR, REC_NRFI_THR);
  // Best-of-breed: v6's ML (its strength) + v7's NRFI (its strength).
  const hybrid = evalRecSet((e) => e.g.v6HomeWin, (e) => e.p.nrfi, 0.545, REC_NRFI_THR);

  console.log(`\n═══ RECOMMENDATION-SET HEAD-TO-HEAD (≥1 ML + ≥1 NRFI, ≤${MAX_PICKS}/day), OOS ${byDay.size} days ═══`);
  console.log(`\nv6 (thr 0.545/0.545) — ${(v6rec.total / byDay.size).toFixed(1)} picks/day`);
  console.log(recLine("ALL", v6rec.all)); console.log(recLine("ML", v6rec.ml)); console.log(recLine("NRFI", v6rec.nrfi)); console.log(recLine("guaranteed top", v6rec.guar));
  console.log(`\nv7 (thr ${REC_ML_THR}/${REC_NRFI_THR}) — ${(v7rec.total / byDay.size).toFixed(1)} picks/day`);
  console.log(recLine("ALL", v7rec.all)); console.log(recLine("ML", v7rec.ml)); console.log(recLine("NRFI", v7rec.nrfi)); console.log(recLine("guaranteed top", v7rec.guar));
  console.log(`\nHYBRID  v6 ML + v7 NRFI  — ${(hybrid.total / byDay.size).toFixed(1)} picks/day`);
  console.log(recLine("ALL", hybrid.all)); console.log(recLine("ML", hybrid.ml)); console.log(recLine("NRFI", hybrid.nrfi)); console.log(recLine("guaranteed top", hybrid.guar));
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
