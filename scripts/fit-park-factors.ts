// Model-improvement loop, iteration #6: park-factor validation + refit
// headroom.
//
// ✗ VERDICT (2026-07-23, 1,044 OOS games): NO HEADROOM — axis closed.
// All-neutral (park factors OFF) costs only Δml −0.00002 / Δnrfi
// −0.00049 (z ≈ −1), so park factors barely move v7's OOS log-loss and
// no refit can clear a promotion gate. The 2024-25 empirical refit is
// slightly WORSE than the static table (2-season same-team estimates,
// SE ~0.05-0.07, are noisier than FanGraphs' 3-year consensus — the
// authoritative-source house rule wins on the data). Static table
// VALIDATED. Annual-refresh note: ATH/Sutter Health reads 1.035
// empirical vs 0.95 static — new park, worth a look at season end.
//
// The static table (lib/sports/mlb/park-factors.ts) is FanGraphs 3-year
// consensus — already the authoritative source, so this iteration does
// NOT blindly self-refit. It asks two cheaper questions first:
//   1. HEADROOM: does v7 OOS log-loss even care? Evaluate the same
//      walk-forward config with park factors zeroed (all-neutral) and
//      with an empirical 2024-25 refit. If neutral ≈ static, park factors
//      have no headroom and any refit is wasted work.
//   2. VALIDATION: per-park empirical run index (home RPG vs same-team
//      away RPG, EB-shrunk) vs the static table — flags stale entries
//      (new parks, home-venue moves) for the annual refresh.
//
// The empirical index deliberately uses the same-team home/away method so
// team quality cancels; 2024-25 regular season from historical_games.
//
//   npx tsx --env-file=.env.local scripts/fit-park-factors.ts [YEAR]

import { supabaseAdmin } from "@/lib/supabase";
import { loadEvalGames, fitV7Grid, logLoss, type EvalGame } from "./_v7-eval";
import { deriveMarkets, type TeamInputs } from "@/lib/sports/mlb/run-model";
import { parkFactorForHomeTeam } from "@/lib/sports/mlb/park-factors";
import { findTeamByMlbApiId } from "@/lib/teams";

const YEAR = process.argv[2] ?? "2026";
const SHRINK_K = 60;   // pseudo-games of neutral prior per park

const monthOf = (d: string) => d.slice(0, 7);

async function empiricalFactors(): Promise<Map<number, { pf: number; n: number }>> {
  const sb = supabaseAdmin();
  type Row = { away_team_id: number; home_team_id: number; away_score: number | null; home_score: number | null };
  const rows: Row[] = [];
  for (const season of [2024, 2025]) {
    for (let f = 0; ; f += 1000) {
      const { data, error } = await sb.from("historical_games")
        .select("away_team_id, home_team_id, away_score, home_score")
        .eq("season", season).eq("game_type", "R").range(f, f + 999);
      if (error) throw error;
      const chunk = (data ?? []) as Row[];
      rows.push(...chunk);
      if (chunk.length < 1000) break;
    }
  }
  const home = new Map<number, { g: number; r: number }>();
  const away = new Map<number, { g: number; r: number }>();
  for (const r of rows) {
    if (r.away_score === null || r.home_score === null) continue;
    const total = r.away_score + r.home_score;
    const h = home.get(r.home_team_id) ?? { g: 0, r: 0 };
    h.g++; h.r += total; home.set(r.home_team_id, h);
    const a = away.get(r.away_team_id) ?? { g: 0, r: 0 };
    a.g++; a.r += total; away.set(r.away_team_id, a);
  }
  const out = new Map<number, { pf: number; n: number }>();
  for (const [teamId, h] of home) {
    const a = away.get(teamId);
    if (!a || h.g < 30 || a.g < 30) continue;
    const raw = (h.r / h.g) / (a.r / a.g);
    const pf = (raw * h.g + 1.0 * SHRINK_K) / (h.g + SHRINK_K);
    out.set(teamId, { pf, n: h.g });
  }
  return out;
}

async function main() {
  console.log(`\nComputing 2024-25 empirical park factors…`);
  const emp = await empiricalFactors();

  // Validation table: static vs empirical, sorted by disagreement.
  const diffs = [...emp.entries()].map(([teamId, e]) => ({
    teamId, abbr: findTeamByMlbApiId(teamId)?.abbreviation ?? `#${teamId}`,
    stat: parkFactorForHomeTeam(teamId), emp: e.pf, n: e.n,
  })).sort((a, b) => Math.abs(b.emp - b.stat) - Math.abs(a.emp - a.stat));
  console.log(`  park   static  empirical(n)   Δ`);
  for (const d of diffs.slice(0, 8)) {
    console.log(`  ${d.abbr.padEnd(5)}  ${d.stat.toFixed(2)}    ${d.emp.toFixed(3)} (${d.n})   ${(d.emp - d.stat >= 0 ? "+" : "")}${(d.emp - d.stat).toFixed(3)}`);
  }

  console.log(`\nLoading ${YEAR} eval games…`);
  const games = await loadEvalGames(YEAR);

  // Variant = a parkLogFactor override applied to both cached TeamInputs.
  const withPark = (t: TeamInputs, factor: number): TeamInputs =>
    ({ ...t, parkLogFactor: 0.5 * Math.log(factor) });
  const factorFor = (g: EvalGame, variant: "static" | "empirical" | "neutral"): number => {
    if (variant === "neutral") return 1.0;
    if (variant === "empirical") return emp.get(g.homeTeamId)?.pf ?? 1.0;
    return parkFactorForHomeTeam(g.homeTeamId);
  };

  // Walk-forward: cfg fit on the incumbent (static) inputs, shared across
  // variants — a per-variant refit only matters if a variant wins, and
  // then it gets its own confirmatory run.
  const months = [...new Set(games.map((g) => monthOf(g.date)))].sort();
  type Row = { variant: string; ml: number[]; nrfi: number[] };
  const rows: Row[] = [
    { variant: "static", ml: [], nrfi: [] },
    { variant: "empirical", ml: [], nrfi: [] },
    { variant: "neutral", ml: [], nrfi: [] },
  ];
  for (const tm of months) {
    const train = games.filter((g) => monthOf(g.date) < tm);
    if (train.length < 250) continue;
    const cfg = fitV7Grid(train);
    for (const g of games.filter((x) => monthOf(x.date) === tm)) {
      for (const row of rows) {
        const f = factorFor(g, row.variant as "static" | "empirical" | "neutral");
        const m = deriveMarkets(withPark(g.away, f), withPark(g.home, f), cfg);
        if (!Number.isFinite(m.homeWin) || !Number.isFinite(m.nrfi)) continue;
        row.ml.push(logLoss(m.homeWin, g.actualWinner === "home"));
        row.nrfi.push(logLoss(m.nrfi, g.actualNrfi));
      }
    }
  }

  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const zVs = (a: number[], b: number[]) => {  // paired, b challenger
    const d = a.map((x, i) => x - b[i]!);
    const m = avg(d);
    const se = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / d.length / d.length);
    return { m, z: se > 0 ? m / se : 0 };
  };

  console.log(`\nGATE — OOS ${rows[0]!.ml.length} games (paired; cfg fit on static inputs):`);
  const base = rows[0]!;
  for (const row of rows) {
    const zM = zVs(base.ml, row.ml), zN = zVs(base.nrfi, row.nrfi);
    const tag = row.variant === "static" ? "" :
      `  Δml ${(zM.m >= 0 ? "+" : "")}${zM.m.toFixed(5)} (z=${zM.z.toFixed(2)})  Δnrfi ${(zN.m >= 0 ? "+" : "")}${zN.m.toFixed(5)} (z=${zN.z.toFixed(2)})`;
    console.log(`  ${row.variant.padEnd(10)} ML ${avg(row.ml).toFixed(4)}  NRFI ${avg(row.nrfi).toFixed(4)}${tag}`);
  }
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
