// Read side of the predictions system. Reads `prediction_results`
// (populated by the predictions-comparator cron) to surface accuracy
// + Brier on /mlb/predictions. The cron stores the snapshotted
// predictions denormalized alongside the actual outcomes, so this
// loader doesn't need to join back to daily_predictions.
//
// Two cuts:
//   - yesterday: per-game pick + actual, for the "How we did" table
//   - rolling: aggregate win/NRFI accuracy + Brier across last N days,
//     skipping non-final games (postponed/suspended/etc.) in the
//     denominator. Matches the comparator's null semantics.

import { supabaseAdmin } from "@/lib/supabase";
import { findTeamByMlbApiId } from "@/lib/teams";
import {
  ML_PLAY_THRESHOLD,
  ML_STRONG_THRESHOLD,
  NRFI_PLAY_THRESHOLD,
  NRFI_STRONG_THRESHOLD,
  type WinPlay,
  type NrfiPlay,
} from "./predictions";
import { PREDICTIONS_MODEL_VERSION } from "./predictions-data";

type RawResultRow = {
  date:              string;
  game_pk:           number;
  away_win_pct:      number;
  home_win_pct:      number;
  nrfi_pct:          number;
  status:            string;
  away_score:        number | null;
  home_score:        number | null;
  away_first_inning: number | null;
  home_first_inning: number | null;
  actual_winner:     "away" | "home" | null;
  actual_nrfi:       boolean | null;
  win_correct:       boolean | null;
  nrfi_correct:      boolean | null;
  win_brier:         number | null;
  nrfi_brier:        number | null;
};

export type GamePredictionOutcome = {
  gamePk:        number;
  date:          string;
  awayAbbr:      string;
  homeAbbr:      string;
  awayWinPct:    number;
  homeWinPct:    number;
  nrfiPct:       number;
  /** Status as reported by the comparator (e.g. "Final", "Postponed"). */
  status:        string;
  awayScore:     number | null;
  homeScore:     number | null;
  awayFirstInning: number | null;
  homeFirstInning: number | null;
  /** Side our pick favored; null if even. */
  predictedWinner: "away" | "home" | "even";
  /** Side that actually won; null if game didn't reach a decision. */
  actualWinner:    "away" | "home" | null;
  winCorrect:    boolean | null;
  /** Whether we predicted NRFI (true if nrfi_pct >= 0.5). */
  predictedNrfi: boolean;
  actualNrfi:    boolean | null;
  nrfiCorrect:   boolean | null;
};

export type AccuracySummary = {
  /** Games where both prediction and final outcome existed. */
  finals:       number;
  winHits:      number;
  winAccuracy:  number | null;
  /** Mean Brier over the same finals set. Lower is better; 0.25 ≈ coin flip. */
  winBrier:     number | null;
  nrfiFinals:   number;
  nrfiHits:     number;
  nrfiAccuracy: number | null;
  nrfiBrier:    number | null;
};

// Pick-only accuracy — applies ML_PLAY_THRESHOLD / NRFI_PLAY_THRESHOLD
// after the fact so the denominator is "of the games we'd have actually
// flagged as a play, how many hit." This is the number a partner asks
// about ("of your picks, what's your hit rate") — the all-game accuracy
// above is a calibration metric, not a results metric.
export type PlayAccuracySummary = {
  mlPlays:        number;
  mlPlayHits:     number;
  mlHitRate:      number | null;
  nrfiPlays:      number;
  nrfiPlayHits:   number;
  nrfiHitRate:    number | null;
};

function teamAbbr(daily: { away_team_id?: number; home_team_id?: number }, side: "away" | "home"): string {
  const id = side === "away" ? daily.away_team_id : daily.home_team_id;
  if (typeof id !== "number") return "—";
  return findTeamByMlbApiId(id)?.abbreviation ?? `#${id}`;
}

function predictedWinnerOf(awayPct: number, homePct: number): "away" | "home" | "even" {
  if (awayPct === homePct) return "even";
  return homePct > awayPct ? "home" : "away";
}

// Yesterday's graded predictions, joined back to the snapshot row in
// daily_predictions so we can render away/home abbreviations alongside
// the comparator's denormalized win pcts. Returns [] when no row exists
// yet for that date (e.g. comparator hasn't run today).
export async function loadPredictionOutcomesForDate(date: string): Promise<GamePredictionOutcome[]> {
  const sb = supabaseAdmin();
  const [resultsQ, predsQ] = await Promise.all([
    sb.from("prediction_results")
      .select(
        "date, game_pk, away_win_pct, home_win_pct, nrfi_pct, status, " +
        "away_score, home_score, away_first_inning, home_first_inning, " +
        "actual_winner, actual_nrfi, win_correct, nrfi_correct, win_brier, nrfi_brier",
      )
      .eq("sport", "mlb")
      .eq("date", date)
      .eq("model_version", PREDICTIONS_MODEL_VERSION)
      .order("game_pk", { ascending: true }),
    sb.from("daily_predictions")
      .select("game_pk, away_team_id, home_team_id")
      .eq("sport", "mlb")
      .eq("date", date)
      .eq("model_version", PREDICTIONS_MODEL_VERSION),
  ]);

  if (resultsQ.error || predsQ.error) return [];
  const teamMap = new Map<number, { away_team_id: number; home_team_id: number }>();
  for (const r of (predsQ.data ?? []) as Array<{ game_pk: number; away_team_id: number; home_team_id: number }>) {
    teamMap.set(r.game_pk, { away_team_id: r.away_team_id, home_team_id: r.home_team_id });
  }

  const out: GamePredictionOutcome[] = [];
  for (const r of ((resultsQ.data ?? []) as unknown) as RawResultRow[]) {
    const teams = teamMap.get(r.game_pk);
    out.push({
      gamePk:        r.game_pk,
      date:          r.date,
      awayAbbr:      teams ? teamAbbr(teams, "away") : "—",
      homeAbbr:      teams ? teamAbbr(teams, "home") : "—",
      awayWinPct:    Number(r.away_win_pct),
      homeWinPct:    Number(r.home_win_pct),
      nrfiPct:       Number(r.nrfi_pct),
      status:        r.status,
      awayScore:     r.away_score,
      homeScore:     r.home_score,
      awayFirstInning: r.away_first_inning,
      homeFirstInning: r.home_first_inning,
      predictedWinner: predictedWinnerOf(Number(r.away_win_pct), Number(r.home_win_pct)),
      actualWinner:    r.actual_winner,
      winCorrect:    r.win_correct,
      predictedNrfi: Number(r.nrfi_pct) >= 0.5,
      actualNrfi:    r.actual_nrfi,
      nrfiCorrect:   r.nrfi_correct,
    });
  }
  return out;
}

// Rolling accuracy across the last `days` days, ending yesterday inclusive.
// Skips non-final rows (postponed/suspended) so the denominator is "games
// we could be evaluated on."
export async function loadPredictionAccuracy(days: number, endDate: string): Promise<AccuracySummary & PlayAccuracySummary> {
  const end = new Date(endDate + "T00:00:00Z");
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const startIso = start.toISOString().slice(0, 10);
  const endIso = end.toISOString().slice(0, 10);

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("prediction_results")
    .select("away_win_pct, home_win_pct, nrfi_pct, win_correct, nrfi_correct, win_brier, nrfi_brier, actual_winner, actual_nrfi")
    .eq("sport", "mlb")
    .eq("model_version", PREDICTIONS_MODEL_VERSION)
    .gte("date", startIso)
    .lte("date", endIso);
  if (error) {
    return { finals: 0, winHits: 0, winAccuracy: null, winBrier: null,
             nrfiFinals: 0, nrfiHits: 0, nrfiAccuracy: null, nrfiBrier: null,
             mlPlays: 0, mlPlayHits: 0, mlHitRate: null,
             nrfiPlays: 0, nrfiPlayHits: 0, nrfiHitRate: null };
  }

  let finals = 0, winHits = 0, winBrierSum = 0;
  let nrfiFinals = 0, nrfiAllHits = 0, nrfiBrierSum = 0;
  let mlPlays = 0, mlPlayHits = 0;
  let nrfiPlays = 0, nrfiPlayHits = 0;
  for (const r of (data ?? []) as Array<{
    away_win_pct: number;
    home_win_pct: number;
    nrfi_pct: number;
    win_correct: boolean | null;
    nrfi_correct: boolean | null;
    win_brier: number | null;
    nrfi_brier: number | null;
    actual_winner: "away" | "home" | null;
    actual_nrfi: boolean | null;
  }>) {
    if (r.win_correct !== null) {
      finals++;
      if (r.win_correct) winHits++;
      if (r.win_brier !== null) winBrierSum += Number(r.win_brier);

      // Pick-only ML accuracy: only count games where one side cleared
      // the play threshold AND the game graded (actual_winner !== null).
      const awayPct = Number(r.away_win_pct);
      const homePct = Number(r.home_win_pct);
      let pickedSide: "away" | "home" | null = null;
      if (awayPct >= ML_PLAY_THRESHOLD) pickedSide = "away";
      else if (homePct >= ML_PLAY_THRESHOLD) pickedSide = "home";
      if (pickedSide !== null && r.actual_winner !== null) {
        mlPlays++;
        if (pickedSide === r.actual_winner) mlPlayHits++;
      }
    }
    if (r.nrfi_correct !== null) {
      nrfiFinals++;
      if (r.nrfi_correct) nrfiAllHits++;
      if (r.nrfi_brier !== null) nrfiBrierSum += Number(r.nrfi_brier);

      // Pick-only NRFI accuracy: NRFI play when prob >= threshold; YRFI
      // play when prob <= 1 - threshold. Skip the no-play zone in between.
      const nrfi = Number(r.nrfi_pct);
      let pickedNrfi: boolean | null = null;
      if (nrfi >= NRFI_PLAY_THRESHOLD) pickedNrfi = true;
      else if (nrfi <= 1 - NRFI_PLAY_THRESHOLD) pickedNrfi = false;
      if (pickedNrfi !== null && r.actual_nrfi !== null) {
        nrfiPlays++;
        if (pickedNrfi === r.actual_nrfi) nrfiPlayHits++;
      }
    }
  }

  return {
    finals,
    winHits,
    winAccuracy:  finals      > 0 ? winHits  / finals      : null,
    winBrier:     finals      > 0 ? winBrierSum  / finals  : null,
    nrfiFinals,
    nrfiHits:     nrfiAllHits,
    nrfiAccuracy: nrfiFinals  > 0 ? nrfiAllHits / nrfiFinals  : null,
    nrfiBrier:    nrfiFinals  > 0 ? nrfiBrierSum / nrfiFinals : null,
    mlPlays,
    mlPlayHits,
    mlHitRate:    mlPlays   > 0 ? mlPlayHits   / mlPlays   : null,
    nrfiPlays,
    nrfiPlayHits,
    nrfiHitRate:  nrfiPlays > 0 ? nrfiPlayHits / nrfiPlays : null,
  };
}

// Mirror winPlayFor/nrfiPlayFor from predictions.ts, but against a
// graded historical outcome row. Both return null when no side cleared
// the threshold (no play would have been made).
export function outcomeWinPlay(o: GamePredictionOutcome): WinPlay | null {
  if (o.awayWinPct >= ML_PLAY_THRESHOLD) {
    return { side: "away", abbr: o.awayAbbr, winPct: o.awayWinPct, strong: o.awayWinPct >= ML_STRONG_THRESHOLD };
  }
  if (o.homeWinPct >= ML_PLAY_THRESHOLD) {
    return { side: "home", abbr: o.homeAbbr, winPct: o.homeWinPct, strong: o.homeWinPct >= ML_STRONG_THRESHOLD };
  }
  return null;
}

export function outcomeNrfiPlay(o: GamePredictionOutcome): NrfiPlay | null {
  if (o.nrfiPct >= NRFI_PLAY_THRESHOLD) {
    return { side: "NRFI", probability: o.nrfiPct, strong: o.nrfiPct >= NRFI_STRONG_THRESHOLD };
  }
  if (o.nrfiPct <= 1 - NRFI_PLAY_THRESHOLD) {
    const yrfi = 1 - o.nrfiPct;
    return { side: "YRFI", probability: yrfi, strong: yrfi >= NRFI_STRONG_THRESHOLD };
  }
  return null;
}
