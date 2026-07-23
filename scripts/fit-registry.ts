// Fits the per-market recalibration shifts used by the edge-aware
// daily-card selector (lib/sports/mlb/recommendations.ts) and answers the
// ship question: does the per-market registry card (ML=v6 + NRFI=v7,
// EV-ranked) BEAT v6-alone? The 2026-07-22 head-to-head showed the naive
// conviction-ranked hybrid does NOT (+5.2% vs v6's +7.1% ALL-recs ROI) —
// both baselines are reproduced inline here so any improvement is measured
// against the exact numbers that killed the naive approach.
//
// Everything is WALK-FORWARD monthly like scripts/fit-v7.ts (shared via
// scripts/_v7-eval.ts): for each test month, the v7 config AND the
// per-market recal shifts are fit on strictly-earlier games only.
//
// Design notes carved by this script's own failed variants (2026-07-22):
//   * Recal must be fit on the PICK REGION (stated prob ≥ the market's
//     threshold), as a shift: global OLS finds v6 ML calibrated on average
//     (slope ≈ 1.0 by July) even though its >0.545 picks hit 68% — the
//     edge lives in the tail where we bet.
//   * EV must be priced at market-TYPICAL odds. A per-game-price EV
//     ranking selects maximal model-vs-market disagreement and scored 42%
//     on ML (vs 68% for the same model conviction-ranked) — adverse
//     selection, the market is sharper than us game-by-game.
//
//   npx tsx --env-file=.env.local scripts/fit-registry.ts [YEAR]

import { loadEvalGames, fitV7Grid, predictV7, type EvalGame, type V7Probs } from "./_v7-eval";
import { mlOddsInPlayableRange } from "@/lib/sports/mlb/predictions";
import { americanToProfitMultiplier } from "@/lib/sports/mlb/clv";
import { selectDailyCard, type CardCandidate, type Market, type MarketPolicy } from "@/lib/sports/mlb/recommendations";

const YEAR = process.argv[2] ?? "2026";
const STAKE = 10;
const MAX_PICKS = 5;
// Per-market pick thresholds on each engine's stated scale: v6 calibrated
// 0.545 (fit-calibration.ts); v7 NRFI 0.55 and v7 ML 0.58 (fit-v7.ts sweep).
const V6_THR = 0.545, V7_NRFI_THR = 0.55, V7_ML_THR = 0.58;

const monthOf = (d: string) => d.slice(0, 7);

// ─── pick-region recal shift ────────────────────────────────────────────
// a = realized hit − mean stated prob over the region we'd actually bet.
// n < 30 → no shift (don't trust a handful of picks).
function fitShift(pts: Array<{ x: number; y: number }>): { a: number; n: number } {
  const n = pts.length;
  if (n < 30) return { a: 0, n };
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  return { a: my - mx, n };
}

// ─── grading ────────────────────────────────────────────────────────────
type Tally = { plays: number; hits: number; staked: number; profit: number };
const mk = (): Tally => ({ plays: 0, hits: 0, staked: 0, profit: 0 });
function grade(t: Tally, win: boolean, odds: number | null) {
  t.plays++; if (win) t.hits++;
  if (odds != null) { t.staked += STAKE; t.profit += win ? STAKE * americanToProfitMultiplier(odds) : -STAKE; }
}
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "—");
const roi = (t: Tally) => (t.staked ? ((100 * t.profit) / t.staked).toFixed(1) + "%" : "—");
const recLine = (label: string, t: Tally) =>
  `  ${label.padEnd(16)} picks ${String(t.plays).padStart(4)}  hit ${pct(t.hits, t.plays).padStart(6)}  ROI ${roi(t).padStart(7)}  (odds ${t.staked / STAKE}/${t.plays})`;

type Entry = { g: EvalGame; p: V7Probs };
type Pick = { market: Market; gamePk: number; side: "home" | "NRFI" | "YRFI"; guaranteed: boolean };
type CardSet = { all: Tally; ml: Tally; nrfi: Tally; guar: Tally; total: number; days: number };

function gradeCards(byDay: Map<string, Entry[]>, cardFor: (date: string, entries: Entry[]) => Pick[]): CardSet {
  const all = mk(), ml = mk(), nrfi = mk(), guar = mk();
  let total = 0, days = 0;
  for (const [date, entries] of byDay) {
    days++;
    const gByPk = new Map(entries.map((e) => [e.g.gamePk, e.g]));
    const picks = cardFor(date, entries);
    total += picks.length;
    for (const r of picks) {
      const g = gByPk.get(r.gamePk)!;
      const win = r.market === "ML" ? g.actualWinner === "home" : g.actualNrfi === (r.side === "NRFI");
      const odds = r.market === "ML" ? g.mlHomeOdds : r.side === "NRFI" ? g.nrfiOdds : g.yrfiOdds;
      grade(all, win, odds); grade(r.market === "ML" ? ml : nrfi, win, odds);
      if (r.guaranteed) grade(guar, win, odds);
    }
  }
  return { all, ml, nrfi, guar, total, days };
}

function printCardSet(title: string, c: CardSet) {
  console.log(`\n${title} — ${(c.total / c.days).toFixed(1)} picks/day`);
  console.log(recLine("ALL", c.all)); console.log(recLine("ML", c.ml));
  console.log(recLine("NRFI", c.nrfi)); console.log(recLine("guaranteed top", c.guar));
}

// The pre-redesign conviction-ranked selector, kept verbatim as the
// baseline: guaranteed best-conviction per market, filler by raw
// probability across markets. This is the selector that produced the
// +7.1% (v6-alone) and +5.2% (naive hybrid) head-to-head numbers.
function naiveCard(entries: Entry[], getHome: (e: Entry) => number, getNrfi: (e: Entry) => number, mlThr: number, nrfiThr: number): Pick[] {
  const conv = (n: number) => Math.max(n, 1 - n);
  const side = (n: number): "NRFI" | "YRFI" => (n >= 0.5 ? "NRFI" : "YRFI");
  const topMl = entries.reduce((b, e) => (getHome(e) > getHome(b) ? e : b));
  const topNr = entries.reduce((b, e) => (conv(getNrfi(e)) > conv(getNrfi(b)) ? e : b));
  const picks: Pick[] = [
    { market: "ML", gamePk: topMl.g.gamePk, side: "home", guaranteed: true },
    { market: "NRFI", gamePk: topNr.g.gamePk, side: side(getNrfi(topNr)), guaranteed: true },
  ];
  const taken = new Set(picks.map((p) => `${p.gamePk}|${p.market}`));
  const pool: Array<Pick & { prob: number }> = [];
  for (const e of entries) {
    if (getHome(e) >= mlThr && mlOddsInPlayableRange(e.g.mlHomeOdds) && !taken.has(`${e.g.gamePk}|ML`)) {
      pool.push({ market: "ML", gamePk: e.g.gamePk, side: "home", guaranteed: false, prob: getHome(e) });
    }
    if (conv(getNrfi(e)) >= nrfiThr && !taken.has(`${e.g.gamePk}|NRFI`)) {
      pool.push({ market: "NRFI", gamePk: e.g.gamePk, side: side(getNrfi(e)), guaranteed: false, prob: conv(getNrfi(e)) });
    }
  }
  pool.sort((a, b) => b.prob - a.prob);
  for (const p of pool) { if (picks.length >= MAX_PICKS) break; picks.push(p); }
  return picks;
}

async function main() {
  console.log(`\nLoading ${YEAR} eval games…`);
  const games = await loadEvalGames(YEAR);
  console.log(`  ${games.length} games.\n`);

  // Walk-forward: per test month, fit v7 cfg + pick-region shifts on
  // strictly-earlier games.
  type Fold = { mlV6: number; mlV7: number; nrfiV7: number };
  const months = [...new Set(games.map((g) => monthOf(g.date)))].sort();
  const oos: Entry[] = [];
  const folds = new Map<string, Fold>();
  for (const tm of months) {
    const train = games.filter((g) => monthOf(g.date) < tm);
    if (train.length < 250) continue;
    const cfg = fitV7Grid(train);
    const trainP = train.map((g) => ({ g, p: predictV7(g, cfg) })).filter((e): e is Entry => e.p !== null);
    const mlV6 = fitShift(train
      .filter((g) => g.v6HomeWin >= V6_THR && mlOddsInPlayableRange(g.mlHomeOdds))
      .map((g) => ({ x: g.v6HomeWin, y: g.actualWinner === "home" ? 1 : 0 })));
    const mlV7 = fitShift(trainP
      .filter((e) => e.p.homeWin >= V7_ML_THR && mlOddsInPlayableRange(e.g.mlHomeOdds))
      .map((e) => ({ x: e.p.homeWin, y: e.g.actualWinner === "home" ? 1 : 0 })));
    const nrfiV7 = fitShift(trainP
      .filter((e) => Math.max(e.p.nrfi, 1 - e.p.nrfi) >= V7_NRFI_THR)
      .map((e) => ({ x: Math.max(e.p.nrfi, 1 - e.p.nrfi), y: e.g.actualNrfi === (e.p.nrfi >= 0.5) ? 1 : 0 })));
    folds.set(tm, { mlV6: mlV6.a, mlV7: mlV7.a, nrfiV7: nrfiV7.a });
    console.log(`  ${tm}: cfg betaOff=${cfg.betaOff} betaPitch=${cfg.betaPitch} hfa=${cfg.hfaMultiplier}` +
      ` | shift mlV6 ${mlV6.a >= 0 ? "+" : ""}${mlV6.a.toFixed(3)} (n=${mlV6.n})` +
      ` mlV7 ${mlV7.a >= 0 ? "+" : ""}${mlV7.a.toFixed(3)} (n=${mlV7.n})` +
      ` nrfiV7 ${nrfiV7.a >= 0 ? "+" : ""}${nrfiV7.a.toFixed(3)} (n=${nrfiV7.n})`);
    for (const g of games.filter((x) => monthOf(x.date) === tm)) {
      const p = predictV7(g, cfg);
      if (p) oos.push({ g, p });
    }
  }

  const byDay = new Map<string, Entry[]>();
  for (const e of oos) { const l = byDay.get(e.g.date) ?? []; l.push(e); byDay.set(e.g.date, l); }
  console.log(`\nOOS: ${oos.length} games over ${byDay.size} days.`);

  // Market-typical prices — EV for ranking is computed at these.
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const mlMed = median(oos.map((e) => e.g.mlHomeOdds).filter((o): o is number => o != null));
  const nrMed = median(oos.map((e) => e.g.nrfiOdds).filter((o): o is number => o != null));
  const yrMed = median(oos.map((e) => e.g.yrfiOdds).filter((o): o is number => o != null));
  const nrfiDefault = Math.round((nrMed + yrMed) / 2);
  console.log(`Median captured odds: ML home ${mlMed}, NRFI ${nrMed}, YRFI ${yrMed}`);

  // ─── Baselines (must reproduce the 2026-07-22 head-to-head) ───────────
  printCardSet(`BASELINE A: v6-alone naive (thr ${V6_THR}/${V6_THR})`,
    gradeCards(byDay, (_d, entries) => naiveCard(entries, (e) => e.g.v6HomeWin, (e) => e.g.v6Nrfi, V6_THR, V6_THR)));
  printCardSet(`BASELINE B: naive hybrid v6 ML + v7 NRFI (thr ${V6_THR}/${V7_NRFI_THR})`,
    gradeCards(byDay, (_d, entries) => naiveCard(entries, (e) => e.g.v6HomeWin, (e) => e.p.nrfi, V6_THR, V7_NRFI_THR)));

  // ─── EV registry cards ─────────────────────────────────────────────────
  function evCard(entries: Entry[], date: string, mlSource: "v6" | "v7", nrfiThr: number): Pick[] {
    const fold = folds.get(monthOf(date))!;
    const cands: CardCandidate[] = [];
    for (const e of entries) {
      cands.push({
        gamePk: e.g.gamePk, market: "ML", side: "home",
        probability: mlSource === "v6" ? e.g.v6HomeWin : e.p.homeWin, odds: e.g.mlHomeOdds,
      });
      const fav = e.p.nrfi >= 0.5;
      cands.push({
        gamePk: e.g.gamePk, market: "NRFI", side: fav ? "NRFI" : "YRFI",
        probability: Math.max(e.p.nrfi, 1 - e.p.nrfi), odds: fav ? e.g.nrfiOdds : e.g.yrfiOdds,
      });
    }
    const policies: Record<Market, MarketPolicy> = {
      ML: {
        recalShift: mlSource === "v6" ? fold.mlV6 : fold.mlV7, defaultOdds: mlMed,
        threshold: mlSource === "v6" ? V6_THR : V7_ML_THR, required: true, oddsOk: mlOddsInPlayableRange,
      },
      NRFI: { recalShift: fold.nrfiV7, defaultOdds: nrfiDefault, threshold: nrfiThr, required: true },
    };
    return selectDailyCard(cands, policies, MAX_PICKS).map((p) =>
      ({ market: p.market, gamePk: p.gamePk, side: p.side, guaranteed: p.guaranteed }));
  }

  for (const nrfiThr of [V7_NRFI_THR, 0.56, 0.57]) {
    printCardSet(`EV CARD (ML=v6, NRFI=v7), NRFI thr ${nrfiThr}`,
      gradeCards(byDay, (date, entries) => evCard(entries, date, "v6", nrfiThr)));
  }
  // Champion check: does v7 ML beat v6 ML under the same EV selection?
  printCardSet(`EV CARD (ML=v7, NRFI=v7), NRFI thr ${V7_NRFI_THR}`,
    gradeCards(byDay, (date, entries) => evCard(entries, date, "v7", V7_NRFI_THR)));

  // ─── Paired bootstrap over days — the promotion gate ───────────────────
  // Point-estimate ROI on ~130 odds-carrying picks has an SE of ~8pp, so
  // eyeballing "+6.8% vs +7.1%" promotes noise. Resample DAYS with
  // replacement (both strategies graded on the same days → paired) and
  // report P(challenger beats champion) on hit rate and ROI.
  type DayResult = { hits: number; plays: number; profit: number; staked: number };
  function perDay(cardFor: (date: string, entries: Entry[]) => Pick[]): Map<string, DayResult> {
    const out = new Map<string, DayResult>();
    for (const [date, entries] of byDay) {
      const gByPk = new Map(entries.map((e) => [e.g.gamePk, e.g]));
      const d: DayResult = { hits: 0, plays: 0, profit: 0, staked: 0 };
      for (const r of cardFor(date, entries)) {
        const g = gByPk.get(r.gamePk)!;
        const win = r.market === "ML" ? g.actualWinner === "home" : g.actualNrfi === (r.side === "NRFI");
        const odds = r.market === "ML" ? g.mlHomeOdds : r.side === "NRFI" ? g.nrfiOdds : g.yrfiOdds;
        d.plays++; if (win) d.hits++;
        if (odds != null) { d.staked += STAKE; d.profit += win ? STAKE * americanToProfitMultiplier(odds) : -STAKE; }
      }
      out.set(date, d);
    }
    return out;
  }
  // Deterministic LCG so reruns are comparable; seed choice is arbitrary.
  function pairedBootstrap(label: string, champ: Map<string, DayResult>, chall: Map<string, DayResult>, iters = 4000) {
    const dates = [...byDay.keys()];
    let seed = 1234567;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
    let hitWins = 0, roiWins = 0, dHitSum = 0, dRoiSum = 0;
    for (let i = 0; i < iters; i++) {
      let aH = 0, aP = 0, aPr = 0, aS = 0, bH = 0, bP = 0, bPr = 0, bS = 0;
      for (let j = 0; j < dates.length; j++) {
        const d = dates[Math.floor(rand() * dates.length)]!;
        const a = champ.get(d)!, b = chall.get(d)!;
        aH += a.hits; aP += a.plays; aPr += a.profit; aS += a.staked;
        bH += b.hits; bP += b.plays; bPr += b.profit; bS += b.staked;
      }
      const dHit = bH / bP - aH / aP;
      const dRoi = (bS ? bPr / bS : 0) - (aS ? aPr / aS : 0);
      dHitSum += dHit; dRoiSum += dRoi;
      if (dHit > 0) hitWins++;
      if (dRoi > 0) roiWins++;
    }
    console.log(`  ${label.padEnd(34)} Δhit ${(100 * dHitSum / iters).toFixed(1).padStart(5)}pp  P(hit↑) ${(100 * hitWins / iters).toFixed(0).padStart(3)}%  |  ΔROI ${(100 * dRoiSum / iters).toFixed(1).padStart(5)}pp  P(ROI↑) ${(100 * roiWins / iters).toFixed(0).padStart(3)}%`);
  }

  console.log(`\nPAIRED BOOTSTRAP (challenger vs champion, ${byDay.size} days, 4000 resamples):`);
  const dBaseA = perDay((_d, entries) => naiveCard(entries, (e) => e.g.v6HomeWin, (e) => e.g.v6Nrfi, V6_THR, V6_THR));
  const dEvV6 = perDay((date, entries) => evCard(entries, date, "v6", V7_NRFI_THR));
  const dEvV7 = perDay((date, entries) => evCard(entries, date, "v7", V7_NRFI_THR));
  pairedBootstrap("EV(ML=v6) vs v6-alone", dBaseA, dEvV6);
  pairedBootstrap("EV(ML=v7) vs v6-alone", dBaseA, dEvV7);
  pairedBootstrap("EV(ML=v7) vs EV(ML=v6)", dEvV6, dEvV7);
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
