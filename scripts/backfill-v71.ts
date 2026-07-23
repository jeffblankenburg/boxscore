// Backfill v7.1 across the season so /mlb/predictions can show its
// historical accuracy + Season Picks from day one, instead of waiting
// weeks for the live shadow to accumulate.
//
// For each date it:
//   1. regenerates v7.1 predictions from the same cached inputs the live
//      engine uses (loadPredictionInputsForDate → predictGamesV71),
//   2. upserts the daily_predictions snapshot row (model_version=v7.1)
//      for provenance + the team-id join the history table needs,
//   3. writes the graded prediction_results row by COPYING the outcome
//      (actual_winner / actual_nrfi / scores / first innings / linescore
//      / captured odds) from the already-graded v6 row for the same
//      (date, game_pk) — outcomes are model-agnostic — and recomputing
//      only the four model-dependent fields (win/nrfi correct + Brier)
//      against v7.1's probabilities.
//
// Copying outcomes (rather than re-parsing daily_raw) guarantees v7.1's
// actuals/linescore are byte-identical to v6's, so the two versions stay
// strictly comparable. Idempotent: upserts on the natural PKs.
//
// Run:
//   npx tsx --env-file=.env.local scripts/backfill-v71.ts
//   npx tsx --env-file=.env.local scripts/backfill-v71.ts 2026-06-01 2026-06-30

import { supabaseAdmin } from "../lib/supabase";
import { loadPredictionInputsForDate } from "../lib/sports/mlb/predictions-data";
import { predictGamesV71, V71_MODEL_VERSION } from "../lib/sports/mlb/predictions-v7";

const SOURCE_VERSION = "v6-nrfi-rebased"; // where model-agnostic outcomes come from

function isoNext(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`bad iso ${iso}`);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// The outcome/odds columns we copy verbatim from the v6 result row.
type SourceResult = {
  game_pk: number;
  status: string;
  away_score: number | null;
  home_score: number | null;
  away_first_inning: number | null;
  home_first_inning: number | null;
  actual_winner: "away" | "home" | null;
  actual_nrfi: boolean | null;
  linescore: unknown;
  open_away_ml_odds: number | null; open_home_ml_odds: number | null;
  close_away_ml_odds: number | null; close_home_ml_odds: number | null;
  open_nrfi_odds: number | null; open_yrfi_odds: number | null;
  close_nrfi_odds: number | null; close_yrfi_odds: number | null;
};

const SOURCE_COLS =
  "game_pk, status, away_score, home_score, away_first_inning, home_first_inning, " +
  "actual_winner, actual_nrfi, linescore, " +
  "open_away_ml_odds, open_home_ml_odds, close_away_ml_odds, close_home_ml_odds, " +
  "open_nrfi_odds, open_yrfi_odds, close_nrfi_odds, close_yrfi_odds";

async function main() {
  const [, , startArg, endArg] = process.argv;
  const start = startArg ?? "2026-03-26";
  const end = endArg ?? "2026-07-22";
  const sb = supabaseAdmin();

  let dates = 0, predRows = 0, resultRows = 0, skippedNoInputs = 0, skippedNoSource = 0;

  for (let d = start; d <= end; d = isoNext(d)) {
    const inputs = await loadPredictionInputsForDate(d);
    if (!inputs || inputs.slate.length === 0) { skippedNoInputs++; continue; }
    const res = predictGamesV71(inputs);
    if (res.games.length === 0) { skippedNoInputs++; continue; }

    // Model-agnostic outcomes from the graded v6 rows for this date.
    const { data: srcData, error: srcErr } = await sb.from("prediction_results")
      .select(SOURCE_COLS)
      .eq("sport", "mlb").eq("model_version", SOURCE_VERSION).eq("date", d);
    if (srcErr) throw new Error(`${d}: source read: ${srcErr.message}`);
    const srcByPk = new Map<number, SourceResult>();
    for (const r of (srcData ?? []) as unknown as SourceResult[]) srcByPk.set(r.game_pk, r);
    if (srcByPk.size === 0) { skippedNoSource++; continue; }

    dates++;
    const predUpserts: Record<string, unknown>[] = [];
    const resultUpserts: Record<string, unknown>[] = [];

    for (const g of res.games) {
      const src = srcByPk.get(g.gamePk);
      if (!src) continue; // game not graded in v6 → no outcome to attach

      const awayWin = Number(g.away.winProbability.toFixed(4));
      const homeWin = Number(g.home.winProbability.toFixed(4));
      const nrfi = Number(g.nrfiProbability.toFixed(4));

      predUpserts.push({
        sport: "mlb", date: d, game_pk: g.gamePk, model_version: V71_MODEL_VERSION,
        away_team_id: g.away.teamId, home_team_id: g.home.teamId,
        away_win_pct: awayWin, home_win_pct: homeWin, nrfi_pct: nrfi,
        inputs: {
          away: { abbr: g.away.abbr, record: g.away.record, runsPerGame: g.away.runsPerGame, runsAllowedPerGame: g.away.runsAllowedPerGame, pythagWinPct: g.away.pythagWinPct, probableSp: g.away.probableSp },
          home: { abbr: g.home.abbr, record: g.home.record, runsPerGame: g.home.runsPerGame, runsAllowedPerGame: g.home.runsAllowedPerGame, pythagWinPct: g.home.pythagWinPct, probableSp: g.home.probableSp },
        },
      });

      // Recompute only the model-dependent grade fields (mirror the
      // comparator's scoreOne) against v7.1 probabilities.
      let win_correct: boolean | null = null, win_brier: number | null = null;
      if (src.actual_winner !== null) {
        const favorite = homeWin > awayWin ? "home" : "away";
        win_correct = src.actual_winner === favorite;
        win_brier = Math.pow(homeWin - (src.actual_winner === "home" ? 1 : 0), 2);
      }
      let nrfi_correct: boolean | null = null, nrfi_brier: number | null = null;
      if (src.actual_nrfi !== null) {
        nrfi_correct = (nrfi >= 0.5) === src.actual_nrfi;
        nrfi_brier = Math.pow(nrfi - (src.actual_nrfi ? 1 : 0), 2);
      }

      resultUpserts.push({
        sport: "mlb", date: d, game_pk: g.gamePk, model_version: V71_MODEL_VERSION,
        away_win_pct: awayWin, home_win_pct: homeWin, nrfi_pct: nrfi,
        status: src.status,
        away_score: src.away_score, home_score: src.home_score,
        away_first_inning: src.away_first_inning, home_first_inning: src.home_first_inning,
        actual_winner: src.actual_winner, actual_nrfi: src.actual_nrfi,
        win_correct, nrfi_correct, win_brier, nrfi_brier,
        linescore: src.linescore,
        // Copy the captured prices (model-agnostic) so v7.1 CLV is
        // populated wherever v6's was.
        open_away_ml_odds: src.open_away_ml_odds, open_home_ml_odds: src.open_home_ml_odds,
        close_away_ml_odds: src.close_away_ml_odds, close_home_ml_odds: src.close_home_ml_odds,
        open_nrfi_odds: src.open_nrfi_odds, open_yrfi_odds: src.open_yrfi_odds,
        close_nrfi_odds: src.close_nrfi_odds, close_yrfi_odds: src.close_yrfi_odds,
      });
    }

    if (predUpserts.length > 0) {
      const { error } = await sb.from("daily_predictions")
        .upsert(predUpserts, { onConflict: "sport,date,game_pk,model_version" });
      if (error) throw new Error(`${d}: daily_predictions upsert: ${error.message}`);
      predRows += predUpserts.length;
    }
    if (resultUpserts.length > 0) {
      const { error } = await sb.from("prediction_results")
        .upsert(resultUpserts, { onConflict: "sport,date,game_pk,model_version" });
      if (error) throw new Error(`${d}: prediction_results upsert: ${error.message}`);
      resultRows += resultUpserts.length;
    }
    process.stdout.write(`  ${d}: ${resultUpserts.length} games\r`);
  }

  console.log(`\n\nv7.1 backfill complete.`);
  console.log(`  dates processed        : ${dates}`);
  console.log(`  daily_predictions rows : ${predRows}`);
  console.log(`  prediction_results rows: ${resultRows}`);
  console.log(`  skipped (no inputs)    : ${skippedNoInputs}`);
  console.log(`  skipped (no v6 source) : ${skippedNoSource}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
