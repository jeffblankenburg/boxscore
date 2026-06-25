// One-shot backfill: wipes existing daily_predictions + prediction_results
// for MLB, then regenerates them with the v2 model for June 1-24, 2026.
// Each date's predictions use only data available through that date
// (loadPredictionsForDate already does this — standings + probables from
// the prior day's daily_raw, and the new aggregates loader honors a
// throughDate cutoff). So this is an honest backfill, not a leakage retro.
//
// Run: npx tsx --env-file=.env.local scripts/backfill-june-predictions.ts
//   or: npx tsx --env-file=.env.local scripts/backfill-june-predictions.ts 2026-06-01 2026-06-24

import { supabaseAdmin } from "../lib/supabase";
import { loadPredictionsForDate, PREDICTIONS_MODEL_VERSION } from "../lib/sports/mlb/predictions-data";
import { ML_PLAY_THRESHOLD, NRFI_PLAY_THRESHOLD } from "../lib/sports/mlb/predictions";
import { findTeamByMlbApiId } from "../lib/teams";

const START_DEFAULT = "2026-06-01";
const END_DEFAULT = "2026-06-24";

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const stop = new Date(end + "T00:00:00Z").getTime();
  while (d.getTime() <= stop) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

type RawScheduleGame = {
  gamePk?: number;
  status?: { abstractGameState?: string; detailedState?: string };
  teams?: {
    away?: { score?: number; team?: { id?: number } };
    home?: { score?: number; team?: { id?: number } };
  };
  linescore?: {
    innings?: Array<{ num?: number; home?: { runs?: number }; away?: { runs?: number } }>;
  };
};
type RawSchedule = { dates?: Array<{ games?: RawScheduleGame[] }> };
type RawBoxGame = {
  linescore?: { innings?: Array<{ num: number; home?: { runs?: number }; away?: { runs?: number } }> };
};
type RawPayload = {
  schedule?: RawSchedule;
  games?: Record<string, RawBoxGame>;
};

type Outcome = {
  status: string;
  awayScore: number | null;
  homeScore: number | null;
  awayFirstInning: number | null;
  homeFirstInning: number | null;
};

function outcomeFor(gamePk: number, payload: RawPayload): Outcome | null {
  const scheduleGame = (payload.schedule?.dates ?? [])
    .flatMap((d) => d.games ?? [])
    .find((g) => g.gamePk === gamePk);
  if (!scheduleGame) return null;
  const status = scheduleGame.status?.detailedState
    ?? scheduleGame.status?.abstractGameState ?? "unknown";
  let aFirst: number | null = null, hFirst: number | null = null;
  const innings = scheduleGame.linescore?.innings ?? payload.games?.[String(gamePk)]?.linescore?.innings;
  if (Array.isArray(innings)) {
    const first = innings.find((i) => i.num === 1);
    if (first) {
      aFirst = typeof first.away?.runs === "number" ? first.away.runs : null;
      hFirst = typeof first.home?.runs === "number" ? first.home.runs : null;
    }
  }
  return {
    status,
    awayScore: scheduleGame.teams?.away?.score ?? null,
    homeScore: scheduleGame.teams?.home?.score ?? null,
    awayFirstInning: aFirst,
    homeFirstInning: hFirst,
  };
}

function score(pred: { home_win_pct: number; away_win_pct: number; nrfi_pct: number }, out: Outcome) {
  const isFinal = /final/i.test(out.status);
  let actual_winner: "away" | "home" | null = null;
  let win_correct: boolean | null = null;
  let win_brier: number | null = null;
  let actual_nrfi: boolean | null = null;
  let nrfi_correct: boolean | null = null;
  let nrfi_brier: number | null = null;
  if (isFinal && out.awayScore !== null && out.homeScore !== null && out.awayScore !== out.homeScore) {
    actual_winner = out.homeScore > out.awayScore ? "home" : "away";
    const predFav = pred.home_win_pct > pred.away_win_pct ? "home" : "away";
    win_correct = actual_winner === predFav;
    const homeWon = actual_winner === "home" ? 1 : 0;
    win_brier = (pred.home_win_pct - homeWon) ** 2;
  }
  if (isFinal && out.awayFirstInning !== null && out.homeFirstInning !== null) {
    actual_nrfi = (out.awayFirstInning + out.homeFirstInning) === 0;
    const predNrfi = pred.nrfi_pct >= 0.5;
    nrfi_correct = predNrfi === actual_nrfi;
    nrfi_brier = (pred.nrfi_pct - (actual_nrfi ? 1 : 0)) ** 2;
  }
  return { actual_winner, win_correct, win_brier, actual_nrfi, nrfi_correct, nrfi_brier };
}

async function main() {
  const [, , startArg, endArg] = process.argv;
  const start = startArg ?? START_DEFAULT;
  const end = endArg ?? END_DEFAULT;
  const sb = supabaseAdmin();

  // No table wipe needed — service_role doesn't have DELETE on these
  // tables, and we don't need it: daily_predictions's PK is
  // (sport, date, game_pk) so the upsert clobbers v1 rows in place,
  // and prediction_results carries model_version in its PK so v1 rows
  // can stay archived. The page filters by PREDICTIONS_MODEL_VERSION
  // when computing rolling stats, so the old rows are invisible.

  // ─── Backfill ────────────────────────────────────────────────────────
  const dates = dateRange(start, end);
  console.log(`Backfilling ${dates.length} dates [${start} → ${end}] with model ${PREDICTIONS_MODEL_VERSION}\n`);

  type Tally = { mlPlays: number; mlHits: number; nrfiPlays: number; nrfiHits: number; games: number };
  const totals: Tally = { mlPlays: 0, mlHits: 0, nrfiPlays: 0, nrfiHits: 0, games: 0 };

  for (const date of dates) {
    const t0 = Date.now();
    const result = await loadPredictionsForDate(date);

    // Pull raw payload for the same date to score outcomes.
    const { data: rawRow } = await sb
      .from("daily_raw").select("payload").eq("sport", "mlb").eq("date", date).maybeSingle();
    const payload = ((rawRow as { payload?: RawPayload } | null)?.payload ?? {}) as RawPayload;

    // Build daily_predictions rows + prediction_results rows in one pass.
    const predRows: Array<Record<string, unknown>> = [];
    const resRows: Array<Record<string, unknown>> = [];
    const tally: Tally = { mlPlays: 0, mlHits: 0, nrfiPlays: 0, nrfiHits: 0, games: 0 };

    for (const g of result.games) {
      const awayPct = g.away.winProbability;
      const homePct = g.home.winProbability;
      const nrfiPct = g.nrfiProbability;
      predRows.push({
        sport: "mlb", date, game_pk: g.gamePk,
        model_version: PREDICTIONS_MODEL_VERSION,
        away_team_id: g.away.teamId, home_team_id: g.home.teamId,
        away_win_pct: awayPct.toFixed(4),
        home_win_pct: homePct.toFixed(4),
        nrfi_pct: nrfiPct.toFixed(4),
        inputs: null,
      });

      const out = outcomeFor(g.gamePk, payload);
      if (!out) {
        resRows.push({
          sport: "mlb", date, game_pk: g.gamePk,
          model_version: PREDICTIONS_MODEL_VERSION,
          away_win_pct: awayPct.toFixed(4),
          home_win_pct: homePct.toFixed(4),
          nrfi_pct: nrfiPct.toFixed(4),
          status: "missing",
          away_score: null, home_score: null,
          away_first_inning: null, home_first_inning: null,
          actual_winner: null, actual_nrfi: null,
          win_correct: null, nrfi_correct: null,
          win_brier: null, nrfi_brier: null,
        });
        continue;
      }
      const sc = score({ home_win_pct: homePct, away_win_pct: awayPct, nrfi_pct: nrfiPct }, out);
      resRows.push({
        sport: "mlb", date, game_pk: g.gamePk,
        model_version: PREDICTIONS_MODEL_VERSION,
        away_win_pct: awayPct.toFixed(4),
        home_win_pct: homePct.toFixed(4),
        nrfi_pct: nrfiPct.toFixed(4),
        status: out.status,
        away_score: out.awayScore, home_score: out.homeScore,
        away_first_inning: out.awayFirstInning, home_first_inning: out.homeFirstInning,
        ...sc,
      });

      tally.games++;
      // Pick-only tally (matches /mlb/predictions Recap math)
      let pickedSide: "away" | "home" | null = null;
      if (awayPct >= ML_PLAY_THRESHOLD) pickedSide = "away";
      else if (homePct >= ML_PLAY_THRESHOLD) pickedSide = "home";
      if (pickedSide && sc.actual_winner !== null) {
        tally.mlPlays++;
        if (pickedSide === sc.actual_winner) tally.mlHits++;
      }
      let pickedNrfi: boolean | null = null;
      if (nrfiPct >= NRFI_PLAY_THRESHOLD) pickedNrfi = true;
      else if (nrfiPct <= 1 - NRFI_PLAY_THRESHOLD) pickedNrfi = false;
      if (pickedNrfi !== null && sc.actual_nrfi !== null) {
        tally.nrfiPlays++;
        if (pickedNrfi === sc.actual_nrfi) tally.nrfiHits++;
      }
    }

    if (predRows.length > 0) {
      const upPred = await sb.from("daily_predictions").upsert(predRows, { onConflict: "sport,date,game_pk" });
      if (upPred.error) throw new Error(`upsert daily_predictions ${date}: ${upPred.error.message}`);
    }
    if (resRows.length > 0) {
      const upRes = await sb.from("prediction_results").upsert(resRows, { onConflict: "sport,date,game_pk,model_version" });
      if (upRes.error) throw new Error(`upsert prediction_results ${date}: ${upRes.error.message}`);
    }

    totals.games   += tally.games;
    totals.mlPlays += tally.mlPlays; totals.mlHits   += tally.mlHits;
    totals.nrfiPlays += tally.nrfiPlays; totals.nrfiHits += tally.nrfiHits;

    const mlRate = tally.mlPlays ? `${tally.mlHits}/${tally.mlPlays} (${((tally.mlHits/tally.mlPlays)*100).toFixed(0)}%)` : "—";
    const nrfiRate = tally.nrfiPlays ? `${tally.nrfiHits}/${tally.nrfiPlays} (${((tally.nrfiHits/tally.nrfiPlays)*100).toFixed(0)}%)` : "—";
    console.log(`${date}  ${String(tally.games).padStart(2)} games  ML ${mlRate.padEnd(13)}  NRFI ${nrfiRate.padEnd(14)}  (${((Date.now()-t0)/1000).toFixed(1)}s)`);
  }

  console.log(`\n─── Totals (Jun ${start.slice(-2)} → ${end.slice(-2)}) ────────────────────`);
  console.log(`Games graded: ${totals.games}`);
  const mlRate = totals.mlPlays ? `${((totals.mlHits/totals.mlPlays)*100).toFixed(1)}%` : "—";
  const nrfiRate = totals.nrfiPlays ? `${((totals.nrfiHits/totals.nrfiPlays)*100).toFixed(1)}%` : "—";
  console.log(`ML plays:    ${totals.mlHits} of ${totals.mlPlays}   (${mlRate} hit rate)`);
  console.log(`NRFI plays:  ${totals.nrfiHits} of ${totals.nrfiPlays}   (${nrfiRate} hit rate)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
