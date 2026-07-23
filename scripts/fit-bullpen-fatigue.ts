// Model-improvement loop, iteration #1: bullpen rest/fatigue.
//
// ✗ VERDICT (2026-07-23, 1,044 OOS games): FAILED stage-1. Train folds
// consistently picked gamma 0.03-0.05, but OOS ML log-loss WORSENED
// (Δ −0.00087, z=−0.86) and favAcc dropped 57.7%→56.7% — in-sample
// mirage. NRFI unchanged to 4 decimals (falsification check passed, so
// the plumbing is sound — the 2-day-IP signal just doesn't generalize).
// fatigueLogRaPerIp stays 0 in production; the feature seam remains for
// a future variant (1-day window, leverage-arm availability) if the
// loop revisits with better data.
//
// Hypothesis: a pen that threw a lot over the last 2 days allows more runs
// tonight (tired arms, or the mop-up tier covering) — so v7's bullpen
// log-RA should shift by `fatigueLogRaPerIp` per excess reliever IP
// (run-model.ts; feature computed in season-aggregates.ts, leak-free from
// cached daily_raw).
//
// STAGE-1 GATE (model quality): out-of-sample ML log-loss, PAIRED per
// game vs the same walk-forward-fitted config with fatigue off. gamma is
// fit conditionally on each fold's base config (cheap 1-D sweep; a joint
// refit is only warranted if the conditional fit passes the gate).
// Falsification check: bullpens don't pitch the 1st inning, so NRFI
// log-loss must stay ~unchanged — movement there means a leak.
//
// Stage-2 (product gate) runs in scripts/fit-registry.ts if stage-1
// passes: EV card with ML=v7+fatigue vs the shipped card, paired
// bootstrap over days.
//
//   npx tsx --env-file=.env.local scripts/fit-bullpen-fatigue.ts [YEAR]

import { loadEvalGames, fitV7Grid, predictV7, logLoss, type EvalGame } from "./_v7-eval";
import { type V7Config } from "@/lib/sports/mlb/run-model";

const YEAR = process.argv[2] ?? "2026";
const GAMMAS = [0.005, 0.01, 0.02, 0.03, 0.05];

const monthOf = (d: string) => d.slice(0, 7);

function mlTrainLoss(games: EvalGame[], cfg: V7Config): number {
  let sum = 0, n = 0;
  for (const g of games) {
    const p = predictV7(g, cfg);
    if (!p) continue;
    sum += logLoss(p.homeWin, g.actualWinner === "home");
    n++;
  }
  return n ? sum / n : Infinity;
}

async function main() {
  console.log(`\nLoading ${YEAR} eval games…`);
  const games = await loadEvalGames(YEAR);

  // Feature sanity: the fatigue input should be roughly centered with a
  // few-IP spread. A degenerate distribution means the aggregate is broken.
  const excess = games.flatMap((g) => [g.away.bullpen.fatigueExcessIp ?? 0, g.home.bullpen.fatigueExcessIp ?? 0]);
  const mean = excess.reduce((s, x) => s + x, 0) / excess.length;
  const sd = Math.sqrt(excess.reduce((s, x) => s + (x - mean) ** 2, 0) / excess.length);
  console.log(`  ${games.length} games. fatigueExcessIp: mean ${mean.toFixed(2)}, sd ${sd.toFixed(2)}, min ${Math.min(...excess).toFixed(1)}, max ${Math.max(...excess).toFixed(1)}\n`);

  // Walk-forward: per test month, fit base cfg (gamma=0), then sweep gamma
  // on the SAME training data by ML log-loss.
  const months = [...new Set(games.map((g) => monthOf(g.date)))].sort();
  type Paired = { base: number; fat: number; baseNrfi: number; fatNrfi: number; homeWon: boolean };
  const oos: Paired[] = [];
  let baseFavC = 0, fatFavC = 0, favN = 0;
  for (const tm of months) {
    const train = games.filter((g) => monthOf(g.date) < tm);
    if (train.length < 250) continue;
    const base = fitV7Grid(train);
    let bestGamma = 0, bestLoss = mlTrainLoss(train, base);
    for (const gamma of GAMMAS) {
      const loss = mlTrainLoss(train, { ...base, fatigueLogRaPerIp: gamma });
      if (loss < bestLoss) { bestLoss = loss; bestGamma = gamma; }
    }
    console.log(`  ${tm}: base betaOff=${base.betaOff} betaPitch=${base.betaPitch} hfa=${base.hfaMultiplier} → gamma=${bestGamma} (train n=${train.length})`);
    const fatCfg = { ...base, fatigueLogRaPerIp: bestGamma };
    for (const g of games.filter((x) => monthOf(x.date) === tm)) {
      const pb = predictV7(g, base);
      const pf = predictV7(g, fatCfg);
      if (!pb || !pf) continue;
      const homeWon = g.actualWinner === "home";
      oos.push({
        base: logLoss(pb.homeWin, homeWon), fat: logLoss(pf.homeWin, homeWon),
        baseNrfi: logLoss(pb.nrfi, g.actualNrfi), fatNrfi: logLoss(pf.nrfi, g.actualNrfi),
        homeWon,
      });
      favN++;
      if ((pb.homeWin >= 0.5) === homeWon) baseFavC++;
      if ((pf.homeWin >= 0.5) === homeWon) fatFavC++;
    }
  }

  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const baseLL = avg(oos.map((o) => o.base)), fatLL = avg(oos.map((o) => o.fat));
  const deltas = oos.map((o) => o.base - o.fat); // >0 → fatigue better
  const dMean = avg(deltas);
  const dSe = Math.sqrt(deltas.reduce((s, x) => s + (x - dMean) ** 2, 0) / deltas.length / deltas.length);
  const z = dSe > 0 ? dMean / dSe : 0;

  console.log(`\nSTAGE-1 GATE — OOS ${oos.length} games (paired per game):`);
  console.log(`  ML log-loss    base ${baseLL.toFixed(4)}  fatigue ${fatLL.toFixed(4)}  Δ ${(baseLL - fatLL >= 0 ? "+" : "")}${(baseLL - fatLL).toFixed(5)} (z=${z.toFixed(2)}; need z ≳ 2 to promote)`);
  console.log(`  ML favAcc      base ${(100 * baseFavC / favN).toFixed(1)}%  fatigue ${(100 * fatFavC / favN).toFixed(1)}%`);
  console.log(`  NRFI log-loss  base ${avg(oos.map((o) => o.baseNrfi)).toFixed(4)}  fatigue ${avg(oos.map((o) => o.fatNrfi)).toFixed(4)}  (falsification: must be ~equal)`);
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
