// Model-improvement loop, iteration #2, Phase A: umpire NRFI tendencies —
// SIGNAL-CEILING probe.
//
// ✗ VERDICT (2026-07-23, 1,058 OOS games): FAILED Phase A — killed
// without building Phase B. The walk-forward fit chose beta=0 in EVERY
// fold (the ump term never reduced train log-loss), and the raw check
// runs BACKWARDS: 2024-25 "run-suppressing" umps saw FEWER 2026 NRFIs
// (44.5%) than run-leaning umps (50.6%) — anti-signal within noise
// (~1.7 SE). Plausible mechanism: the 2026 ABS challenge system
// compresses exactly the per-ump zone differences this feature feeds
// on. Corpus/coverage were fine (7,284 hist games, 96 umps, 100% of
// 2026 games matched a plate ump) — the signal itself is dead.
//
// Hypothesis: the plate umpire's zone measurably moves 1st-inning scoring,
// so scaling both inning-1 λ's by the ump's historical 1st-inning run
// ratio (EB-shrunk to league) should improve NRFI log-loss.
//
// Phase A knowingly uses the POST-HOC plate-ump assignment (from the
// game's own boxscore) because assignments aren't in our prediction-time
// cache (nextDaySchedule has no officials). This measures the CEILING: if
// there's no signal even with perfect assignment knowledge, the iteration
// dies here without building the prediction-time source. If it passes,
// Phase B predicts tonight's plate ump from crew rotation (today's HP is
// usually yesterday's 1B — derivable from cached boxscores).
//
// Tendencies are leak-free per game: 2024-2025 historical corpus + 2026
// games STRICTLY EARLIER than the game's date. Ump effect only touches
// the two inning-1 λ's, so ML is untouched by construction — the paired
// gate is NRFI log-loss (z ≳ 2 to proceed to Phase B).
//
//   npx tsx --env-file=.env.local scripts/fit-umpire-nrfi.ts [YEAR]

import { supabaseAdmin } from "@/lib/supabase";
import { loadEvalGames, fitV7Grid, logLoss, type EvalGame } from "./_v7-eval";
import { halfInningLambdas, scorelessProb, type V7Config } from "@/lib/sports/mlb/run-model";

const YEAR = process.argv[2] ?? "2026";
const HIST_SEASONS = [2024, 2025];
const GRID_K = [20, 50, 100];          // EB pseudo-games of league prior
const GRID_BETA = [0.25, 0.5, 0.75, 1.0];

const monthOf = (d: string) => d.slice(0, 7);

type UmpStat = { n: number; runs: number };

async function loadHistoricalUmpCorpus(): Promise<{ byUmp: Map<number, UmpStat>; leagueRunsPerGame: number }> {
  const sb = supabaseAdmin();
  const byUmp = new Map<number, UmpStat>();
  let totalRuns = 0, totalGames = 0;
  for (const season of HIST_SEASONS) {
    // Regular-season pks for the season, then JSON-projected officials +
    // linescore innings — pulling whole boxscore_raw payloads would be
    // ~100s of MB; the `->` projection keeps it to a few KB per row.
    const pks: number[] = [];
    for (let f = 0; ; f += 1000) {
      const { data, error } = await sb.from("historical_games")
        .select("game_pk").eq("season", season).eq("game_type", "R")
        .range(f, f + 999);
      if (error) throw error;
      const chunk = (data ?? []) as Array<{ game_pk: number }>;
      pks.push(...chunk.map((r) => r.game_pk));
      if (chunk.length < 1000) break;
    }
    for (let i = 0; i < pks.length; i += 200) {
      const batch = pks.slice(i, i + 200);
      type Row = {
        game_pk: number;
        officials: Array<{ official?: { id?: number }; officialType?: string }> | null;
        innings: Array<{ num?: number; away?: { runs?: number }; home?: { runs?: number } }> | null;
      };
      const { data, error } = await sb.from("historical_boxscores")
        .select("game_pk, officials:boxscore_raw->officials, innings:linescore_raw->innings")
        .in("game_pk", batch);
      if (error) throw error;
      for (const r of (data ?? []) as Row[]) {
        const hp = r.officials?.find((o) => o.officialType === "Home Plate");
        const umpId = hp?.official?.id;
        const first = r.innings?.find((x) => x.num === 1);
        const a = first?.away?.runs, h = first?.home?.runs;
        if (typeof umpId !== "number" || typeof a !== "number" || typeof h !== "number") continue;
        const cur = byUmp.get(umpId) ?? { n: 0, runs: 0 };
        cur.n += 1; cur.runs += a + h;
        byUmp.set(umpId, cur);
        totalRuns += a + h; totalGames += 1;
      }
    }
    console.log(`  ${season}: corpus now ${totalGames} games, ${byUmp.size} umps`);
  }
  return { byUmp, leagueRunsPerGame: totalGames ? totalRuns / totalGames : 1.05 };
}

async function main() {
  console.log(`\nLoading historical ump corpus (${HIST_SEASONS.join("+")})…`);
  const { byUmp: histUmp, leagueRunsPerGame } = await loadHistoricalUmpCorpus();
  console.log(`  league 1st-inning runs/game: ${leagueRunsPerGame.toFixed(3)}`);

  console.log(`\nLoading ${YEAR} eval games…`);
  const games = await loadEvalGames(YEAR);
  const withUmp = games.filter((g) => g.plateUmpId !== null).length;
  console.log(`  ${games.length} games, ${withUmp} with plate ump (${(100 * withUmp / games.length).toFixed(0)}%).`);

  // As-of-date ump stats per game: historical corpus + 2026 games strictly
  // earlier. Process date groups in order; snapshot before adding the day.
  const running = new Map<number, UmpStat>();
  const asOf = new Map<number, UmpStat>();   // keyed by gamePk
  const dates = [...new Set(games.map((g) => g.date))].sort();
  const byDate = new Map<string, EvalGame[]>();
  for (const g of games) { const l = byDate.get(g.date) ?? []; l.push(g); byDate.set(g.date, l); }
  for (const date of dates) {
    for (const g of byDate.get(date)!) {
      if (g.plateUmpId === null) continue;
      const hist = histUmp.get(g.plateUmpId) ?? { n: 0, runs: 0 };
      const run = running.get(g.plateUmpId) ?? { n: 0, runs: 0 };
      asOf.set(g.gamePk, { n: hist.n + run.n, runs: hist.runs + run.runs });
    }
    for (const g of byDate.get(date)!) {
      if (g.plateUmpId === null || g.firstInningRuns === null) continue;
      const run = running.get(g.plateUmpId) ?? { n: 0, runs: 0 };
      run.n += 1; run.runs += g.firstInningRuns;
      running.set(g.plateUmpId, run);
    }
  }

  const lambdaMult = (g: EvalGame, K: number, beta: number): number => {
    const s = asOf.get(g.gamePk);
    if (!s || s.n === 0) return 1;
    const shrunk = (s.runs + K * leagueRunsPerGame) / (s.n + K);
    return Math.pow(shrunk / leagueRunsPerGame, beta);
  };
  const nrfiFor = (g: EvalGame, cfg: V7Config, mult: number): number => {
    const a1 = halfInningLambdas(g.away, g.home, false, cfg)[0]!;
    const h1 = halfInningLambdas(g.home, g.away, true, cfg)[0]!;
    return scorelessProb(a1 * mult, cfg.dispersion) * scorelessProb(h1 * mult, cfg.dispersion);
  };

  // Diagnostic: spread of as-of multipliers at mid-grid K — a degenerate
  // spread means shrinkage ate the whole signal.
  const mults = games.map((g) => lambdaMult(g, 50, 1)).filter((m) => m !== 1);
  const mMin = Math.min(...mults), mMax = Math.max(...mults);
  console.log(`  ump λ1 ratio spread (K=50, beta=1): ${mMin.toFixed(3)} – ${mMax.toFixed(3)}`);

  // Walk-forward fit of (K, beta) by train NRFI log-loss.
  const months = [...new Set(games.map((g) => monthOf(g.date)))].sort();
  type Paired = { base: number; ump: number; actual: boolean; mult: number };
  const oos: Paired[] = [];
  for (const tm of months) {
    const train = games.filter((g) => monthOf(g.date) < tm);
    if (train.length < 250) continue;
    const cfg = fitV7Grid(train);
    let bestK = 50, bestBeta = 0, bestLoss = Infinity;
    for (const K of GRID_K) for (const beta of [0, ...GRID_BETA]) {
      let sum = 0, n = 0;
      for (const g of train) {
        const p = nrfiFor(g, cfg, lambdaMult(g, K, beta));
        if (!Number.isFinite(p)) continue;
        sum += logLoss(p, g.actualNrfi); n++;
      }
      const loss = n ? sum / n : Infinity;
      if (loss < bestLoss) { bestLoss = loss; bestK = K; bestBeta = beta; }
    }
    console.log(`  ${tm}: K=${bestK} beta=${bestBeta} (train n=${train.length})`);
    for (const g of games.filter((x) => monthOf(x.date) === tm)) {
      const base = nrfiFor(g, cfg, 1);
      const ump = nrfiFor(g, cfg, lambdaMult(g, bestK, bestBeta));
      if (!Number.isFinite(base) || !Number.isFinite(ump)) continue;
      // mult for the raw-signal check is the FIXED mid-grid tendency
      // (K=50, beta=1), independent of the fitted beta — so the check
      // still reports raw signal when the fit chooses beta=0.
      oos.push({ base: logLoss(base, g.actualNrfi), ump: logLoss(ump, g.actualNrfi), actual: g.actualNrfi, mult: lambdaMult(g, 50, 1) });
    }
  }

  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const deltas = oos.map((o) => o.base - o.ump);
  const dMean = avg(deltas);
  const dSe = Math.sqrt(deltas.reduce((s, x) => s + (x - dMean) ** 2, 0) / deltas.length / deltas.length);
  const z = dSe > 0 ? dMean / dSe : 0;

  // Outcome-vs-tendency sanity: do high-run-ump games actually see fewer
  // NRFIs out of sample? (Raw signal at K=50/beta=1, independent of the
  // fitted beta — meaningful even when the fit picked beta=0.)
  const hi = oos.filter((o) => o.mult > 1.03), lo = oos.filter((o) => o.mult < 0.97);
  const rate = (xs: Paired[]) => xs.length ? xs.filter((o) => o.actual).length / xs.length : NaN;

  console.log(`\nPHASE-A GATE — OOS ${oos.length} games (paired per game):`);
  console.log(`  NRFI log-loss  base ${avg(oos.map((o) => o.base)).toFixed(4)}  +ump ${avg(oos.map((o) => o.ump)).toFixed(4)}  Δ ${(dMean >= 0 ? "+" : "")}${dMean.toFixed(5)} (z=${z.toFixed(2)}; need z ≳ 2 for Phase B)`);
  console.log(`  raw check: NRFI rate when ump leans runs (mult>1.03, n=${hi.length}): ${(100 * rate(hi)).toFixed(1)}%  vs run-suppressing ump (mult<0.97, n=${lo.length}): ${(100 * rate(lo)).toFixed(1)}%`);
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
