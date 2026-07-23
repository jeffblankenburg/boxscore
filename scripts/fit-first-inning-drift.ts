// Model-improvement loop, iteration #4: season-adaptive first-inning bump.
//
// ◐ VERDICT (2026-07-23, 1,044 OOS games): BORDERLINE PASS → promoted as
// the v7.1 SHADOW (predictions-v7.ts predictGamesV71), not into the card.
// The incumbent static bump is REJECTED by calibration (predicts mean
// NRFI 52.3% vs 47.7% actual — a z≈3 bias); the adaptive read lands at
// 47.8% with fold-stable params (src=season K=100 r1=0.55). Paired
// log-loss improves Δ +0.00355 but only z=1.26 (< the 2.0 solo-promote
// bar), and the pick mix flips hard toward YRFI (picks@0.57: 61.4% hit
// +4.1% ROI vs static's 54.4% / −18.3%) — a big enough product change
// that it earns its card slot via live shadow grading, same as v7 did.
//
// Born from iteration #3's diagnostic (fit-nrfi-dependence.ts): v7
// predicts mean NRFI 52.6% vs 47.7% actual on 2026 — firstInningBump was
// fit on 2024-25 linescores and 2026 first innings are hotter (per-half
// 1st-inning scoreless ~71.7% → ~69.6%). A static bump goes stale
// whenever 1st-inning scoring drifts season to season (rule changes, ball
// changes, lineup construction).
//
// Challenger: derive the bump from the season-to-date league 1st-inning
// run rate the aggregates pipeline already computes (point-in-time,
// leak-free), EB-shrunk toward the 2024-25 fixture prior so April doesn't
// whipsaw:  bump = ln( shrink(rpg1_asof, n, prior, K) / leagueLambda ).
//
// Gate: paired OOS NRFI log-loss (z ≳ 2) + calibration-in-the-large.
// ML falsification: bump touches inning 1 of both teams symmetrically, so
// ML must stay ~unchanged.
//
//   npx tsx --env-file=.env.local scripts/fit-first-inning-drift.ts [YEAR]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEvalGames, fitV7Grid, predictV7, logLoss, type EvalGame } from "./_v7-eval";
import { halfInningLambdas, scorelessProb, shrinkRate, type V7Config } from "@/lib/sports/mlb/run-model";

const YEAR = process.argv[2] ?? "2026";
const FIXTURES = join(process.cwd(), "docs/predictions-v7/fixtures");
// EB prior weight in team-games. League-wide the rate has ~2 team-games
// per MLB game, so 900 ≈ a month of season — the drift signal takes over
// by May while April leans on the prior. The low end matters for the
// last30 source (~800 team-games in its window). Swept below.
const GRID_K = [100, 300, 900, 1800];
// First-inning dispersion. 0.391 (the all-innings 2024-25 fit) matched
// 2024-25 first innings exactly, but 2026's first-inning distribution
// changed shape: lower scoreless prob at the SAME mean rate → higher r
// (more Poisson-like). Walk-forward fit; 0.391 in the grid means "no
// change" stays available every fold.
const GRID_R1 = [0.391, 0.45, 0.55, 0.7, 0.9, 1.2];

const monthOf = (d: string) => d.slice(0, 7);

/** 2024-25 league 1st-inning runs per half-inning from the fixtures —
 *  the EB prior for the season-to-date rate. */
function priorRpg1(): number {
  let runs = 0, halves = 0;
  for (const f of ["linescores_2024.csv", "linescores_2025.csv"]) {
    const lines = readFileSync(join(FIXTURES, f), "utf8").split("\n");
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const [, , inning, , runsStr] = line.split(",");
      if (inning !== "1") continue;
      runs += Number(runsStr); halves++;
    }
  }
  return runs / halves;
}

async function main() {
  const prior = priorRpg1();
  console.log(`\n2024-25 prior league 1st-inning rate: ${prior.toFixed(4)} runs/half`);

  console.log(`Loading ${YEAR} eval games…`);
  const games = await loadEvalGames(YEAR);
  console.log(`  ${games.length} games. As-of league rpg1 range: ${Math.min(...games.map((g) => g.league1stRpgAsOf)).toFixed(3)} – ${Math.max(...games.map((g) => g.league1stRpgAsOf)).toFixed(3)}`);

  // Two rate sources for the adaptive bump: season-to-date (drift only)
  // and trailing-30-day (drift + the within-season temperature curve —
  // iteration #4's first pass showed season-to-date closes too little of
  // the gap because May-Jul first innings run hotter than the season
  // average that still contains April).
  type Source = "season" | "last30";
  const adaptiveCfg = (g: EvalGame, cfg: V7Config, src: Source, K: number): V7Config => ({
    ...cfg,
    firstInningBump: Math.log(
      (src === "season"
        ? shrinkRate(g.league1stRpgAsOf, g.league1stGamesAsOf, prior, K)
        : shrinkRate(g.league1stRpg30AsOf, g.league1stGames30AsOf, prior, K)
      ) / cfg.leagueLambda,
    ),
  });

  // Challenger NRFI: adaptive λ1 (via the bump) AND a first-inning-only
  // dispersion r1 — the inning PMFs for ML/totals keep cfg.dispersion, so
  // ML is exactly unchanged and needs no falsification run.
  const nrfiAt = (g: EvalGame, cfg: V7Config, r1: number): number => {
    const a1 = halfInningLambdas(g.away, g.home, false, cfg)[0]!;
    const h1 = halfInningLambdas(g.home, g.away, true, cfg)[0]!;
    return scorelessProb(a1, r1) * scorelessProb(h1, r1);
  };

  // Walk-forward: base cfg per fold; (source, K, r1) swept on train NRFI
  // log-loss so the choice is itself out-of-sample at eval time.
  const months = [...new Set(games.map((g) => monthOf(g.date)))].sort();
  type Paired = { baseN: number; adaN: number; pBase: number; pAda: number; actual: boolean; nOdds: number | null; yOdds: number | null };
  const oos: Paired[] = [];
  for (const tm of months) {
    const train = games.filter((g) => monthOf(g.date) < tm);
    if (train.length < 250) continue;
    const cfg = fitV7Grid(train);
    let bestSrc: Source = "season", bestK = GRID_K[0]!, bestR1 = cfg.dispersion, bestLoss = Infinity;
    for (const src of ["season", "last30"] as Source[]) {
      for (const K of GRID_K) {
        for (const r1 of GRID_R1) {
          let sum = 0, n = 0;
          for (const g of train) {
            const p = nrfiAt(g, adaptiveCfg(g, cfg, src, K), r1);
            if (!Number.isFinite(p)) continue;
            sum += logLoss(p, g.actualNrfi); n++;
          }
          const loss = n ? sum / n : Infinity;
          if (loss < bestLoss) { bestLoss = loss; bestSrc = src; bestK = K; bestR1 = r1; }
        }
      }
    }
    const sample = games.filter((x) => monthOf(x.date) === tm)[0]!;
    console.log(`  ${tm}: src=${bestSrc} K=${bestK} r1=${bestR1}; adaptive bump at month start: ${adaptiveCfg(sample, cfg, bestSrc, bestK).firstInningBump.toFixed(4)} (static ${cfg.firstInningBump})`);
    for (const g of games.filter((x) => monthOf(x.date) === tm)) {
      const pb = predictV7(g, cfg);
      const pa = nrfiAt(g, adaptiveCfg(g, cfg, bestSrc, bestK), bestR1);
      if (!pb || !Number.isFinite(pa)) continue;
      oos.push({
        baseN: logLoss(pb.nrfi, g.actualNrfi), adaN: logLoss(pa, g.actualNrfi),
        pBase: pb.nrfi, pAda: pa, actual: g.actualNrfi,
        nOdds: g.nrfiOdds, yOdds: g.yrfiOdds,
      });
    }
  }

  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const deltas = oos.map((o) => o.baseN - o.adaN);
  const dMean = avg(deltas);
  const dSe = Math.sqrt(deltas.reduce((s, x) => s + (x - dMean) ** 2, 0) / deltas.length / deltas.length);
  const z = dSe > 0 ? dMean / dSe : 0;
  const actualRate = oos.filter((o) => o.actual).length / oos.length;

  console.log(`\nGATE — OOS ${oos.length} games (paired per game):`);
  console.log(`  NRFI log-loss   static ${avg(oos.map((o) => o.baseN)).toFixed(4)}  adaptive ${avg(oos.map((o) => o.adaN)).toFixed(4)}  Δ ${(dMean >= 0 ? "+" : "")}${dMean.toFixed(5)} (z=${z.toFixed(2)}; promote at z ≳ 2)`);
  console.log(`  calibration     actual NRFI ${(100 * actualRate).toFixed(1)}%  |  mean predicted: static ${(100 * avg(oos.map((o) => o.pBase))).toFixed(1)}%  adaptive ${(100 * avg(oos.map((o) => o.pAda))).toFixed(1)}%`);
  console.log(`  (ML exactly unchanged by construction — r1 and the bump only touch the NRFI read.)`);

  // STAGE-2: pick-level. Same play rule (conviction ≥ thr, favored side),
  // graded at captured FanDuel opening prices where present.
  const { americanToProfitMultiplier } = await import("@/lib/sports/mlb/clv");
  const STAKE = 10;
  for (const thr of [0.55, 0.57]) {
    for (const [label, pOf] of [["static", (o: Paired) => o.pBase], ["adaptive", (o: Paired) => o.pAda]] as const) {
      let plays = 0, hits = 0, staked = 0, profit = 0, nSide = 0;
      for (const o of oos) {
        const p = pOf(o);
        let pick: boolean | null = null;
        if (p >= thr) pick = true; else if (p <= 1 - thr) pick = false;
        if (pick === null) continue;
        plays++; if (pick) nSide++;
        const win = pick === o.actual;
        if (win) hits++;
        const odds = pick ? o.nOdds : o.yOdds;
        if (odds != null) { staked += STAKE; profit += win ? STAKE * americanToProfitMultiplier(odds) : -STAKE; }
      }
      console.log(`  picks@${thr} ${label.padEnd(9)} plays ${String(plays).padStart(3)} (${nSide} NRFI/${plays - nSide} YRFI)  hit ${plays ? ((100 * hits) / plays).toFixed(1) : "—"}%  ROI ${staked ? ((100 * profit) / staked).toFixed(1) : "—"}% (odds ${staked / STAKE}/${plays})`);
    }
  }
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
