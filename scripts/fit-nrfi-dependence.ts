// Model-improvement loop, iteration #3: NRFI half-inning dependence.
//
// ✗ VERDICT (2026-07-23, 1,058 OOS games): FAILED — the premise is
// mismeasured. The dependence is nearly nonexistent (rho 1.008 in
// 2024-25, 1.002 in 2026 — a 0.4pp effect, not the remembered ~3pp),
// and the upward correction moves the WRONG way: z=−3.33. The gate's
// calibration line exposed the real defect: v7 predicts mean NRFI 52.6%
// vs 47.7% actual — the model OVERSTATES NRFI because firstInningBump
// was fit on 2024-25 linescores and 2026 first innings are hotter
// (per-half scoreless ~71.7% → ~69.6%). That diagnostic spawned
// iteration #4: scripts/fit-first-inning-drift.ts.
//
// v7 computes NRFI as P(top scoreless) × P(bottom scoreless) — independent
// halves. But the halves share conditions (park, weather, night, the
// baseball itself), so scoreless outcomes are positively correlated and
// the product UNDERSTATES the joint scoreless probability — the known
// ~3pp gap flagged when the engine shipped (docs/predictions-v7).
//
// rho = P(both scoreless) / (P(top 0) × P(bottom 0)), measured from the
// committed linescore fixtures. 2024+2025 pooled is the production
// constant (leak-free for all of 2026 by construction); the 2026 fixture
// value is printed as a stability check, not used in the fit.
//
// Gate: paired OOS NRFI log-loss vs the same walk-forward config with
// rho=1, plus calibration-in-the-large (mean predicted NRFI vs actual
// rate — the defect this fixes). ML untouched by construction.
//
//   npx tsx --env-file=.env.local scripts/fit-nrfi-dependence.ts [YEAR]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEvalGames, fitV7Grid, logLoss, type EvalGame } from "./_v7-eval";
import { halfInningLambdas, scorelessProb, type V7Config } from "@/lib/sports/mlb/run-model";

const YEAR = process.argv[2] ?? "2026";
const FIXTURES = join(process.cwd(), "docs/predictions-v7/fixtures");

const monthOf = (d: string) => d.slice(0, 7);

function rhoFromLinescores(files: string[]): { rho: number; n: number; pBoth: number; indep: number } {
  // game_pk,date,inning,half,runs — collect inning-1 T/B per game.
  const byGame = new Map<string, { t?: number; b?: number }>();
  for (const f of files) {
    const lines = readFileSync(join(FIXTURES, f), "utf8").split("\n");
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const [gamePk, , inning, half, runs] = line.split(",");
      if (inning !== "1") continue;
      const cur = byGame.get(gamePk!) ?? {};
      if (half === "T") cur.t = Number(runs);
      else if (half === "B") cur.b = Number(runs);
      byGame.set(gamePk!, cur);
    }
  }
  let n = 0, t0 = 0, b0 = 0, both0 = 0;
  for (const g of byGame.values()) {
    if (g.t === undefined || g.b === undefined) continue;
    n++;
    if (g.t === 0) t0++;
    if (g.b === 0) b0++;
    if (g.t === 0 && g.b === 0) both0++;
  }
  const pBoth = both0 / n, indep = (t0 / n) * (b0 / n);
  return { rho: pBoth / indep, n, pBoth, indep };
}

async function main() {
  const fit = rhoFromLinescores(["linescores_2024.csv", "linescores_2025.csv"]);
  const check26 = rhoFromLinescores(["linescores_2026.csv"]);
  console.log(`\nrho fit (2024+2025 pooled, n=${fit.n}): P(both 0)=${fit.pBoth.toFixed(4)} vs indep ${fit.indep.toFixed(4)} → rho=${fit.rho.toFixed(4)}`);
  console.log(`rho check (2026 thru fixture date, n=${check26.n}): ${check26.rho.toFixed(4)} (stability check only)`);
  const RHO = fit.rho;

  console.log(`\nLoading ${YEAR} eval games…`);
  const games = await loadEvalGames(YEAR);
  console.log(`  ${games.length} games.`);

  const nrfiFor = (g: EvalGame, cfg: V7Config, rho: number): number => {
    const a1 = halfInningLambdas(g.away, g.home, false, cfg)[0]!;
    const h1 = halfInningLambdas(g.home, g.away, true, cfg)[0]!;
    return Math.min(0.99, rho * scorelessProb(a1, cfg.dispersion) * scorelessProb(h1, cfg.dispersion));
  };

  // Walk-forward: the ONLY fitted input is rho (from prior seasons), so
  // there's nothing to fit per fold beyond the usual base config.
  const months = [...new Set(games.map((g) => monthOf(g.date)))].sort();
  type Paired = { base: number; rho: number; pBase: number; pRho: number; actual: boolean };
  const oos: Paired[] = [];
  for (const tm of months) {
    const train = games.filter((g) => monthOf(g.date) < tm);
    if (train.length < 250) continue;
    const cfg = fitV7Grid(train);
    for (const g of games.filter((x) => monthOf(x.date) === tm)) {
      const pBase = nrfiFor(g, cfg, 1);
      const pRho = nrfiFor(g, cfg, RHO);
      if (!Number.isFinite(pBase) || !Number.isFinite(pRho)) continue;
      oos.push({ base: logLoss(pBase, g.actualNrfi), rho: logLoss(pRho, g.actualNrfi), pBase, pRho, actual: g.actualNrfi });
    }
  }

  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const deltas = oos.map((o) => o.base - o.rho);
  const dMean = avg(deltas);
  const dSe = Math.sqrt(deltas.reduce((s, x) => s + (x - dMean) ** 2, 0) / deltas.length / deltas.length);
  const z = dSe > 0 ? dMean / dSe : 0;
  const actualRate = oos.filter((o) => o.actual).length / oos.length;

  console.log(`\nGATE — OOS ${oos.length} games (paired per game):`);
  console.log(`  NRFI log-loss     base ${avg(oos.map((o) => o.base)).toFixed(4)}  +rho ${avg(oos.map((o) => o.rho)).toFixed(4)}  Δ ${(dMean >= 0 ? "+" : "")}${dMean.toFixed(5)} (z=${z.toFixed(2)}; promote at z ≳ 2)`);
  console.log(`  calibration       actual NRFI rate ${(100 * actualRate).toFixed(1)}%  |  mean predicted: base ${(100 * avg(oos.map((o) => o.pBase))).toFixed(1)}%  +rho ${(100 * avg(oos.map((o) => o.pRho))).toFixed(1)}%`);
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
