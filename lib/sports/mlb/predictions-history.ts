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
  nrfiSideLabel,
  mlOddsInPlayableRange,
  type WinPlay,
  type NrfiPlay,
} from "./predictions";
import { PREDICTIONS_MODEL_VERSION } from "./predictions-data";

// A full season of MLB games (~15/day × 180 days = ~2700 rows) blows
// past Supabase's silent 1000-row default. Every query that ranges
// over "many days" of prediction_results / daily_odds MUST use this
// paginator. See feedback_supabase_1000_row_cap for the last incident.
const SUPABASE_PAGE = 1000;
async function paginateSelect<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += SUPABASE_PAGE) {
    const { data, error } = await build(from, from + SUPABASE_PAGE - 1);
    if (error || !Array.isArray(data)) return rows;
    const chunk = data as T[];
    rows.push(...chunk);
    if (chunk.length < SUPABASE_PAGE) return rows;
  }
}

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

// "If you'd bet $10 on every play, what's the P/L?" — same denominator
// as PlayAccuracySummary (one ML + one NRFI per day, always-pick rule
// applies) but graded against captured odds instead of win/loss. Plays
// with no recorded odds are tracked separately so the user can see
// "won 14 of 20, but ROI is on 17 because 3 games had no odds row."
export type PlayRoiSummary = {
  /** Per-pick stake assumed across the window. Always 10 today; kept as
   *  data so the UI can label "$10/play" without a magic number. */
  stake:            number;
  mlPlaysGraded:    number; // total ML picks in the window (with or without odds)
  mlPlaysWithOdds:  number; // subset that had odds for the picked side
  mlStaked:         number; // sum of stakes wagered on ML
  mlProfit:         number; // signed P/L on ML
  mlRoi:            number | null; // mlProfit / mlStaked
  nrfiPlaysGraded:   number;
  nrfiPlaysWithOdds: number;
  nrfiStaked:        number;
  nrfiProfit:        number;
  nrfiRoi:           number | null;
};

/** American-odds → profit multiplier on a winning bet. e.g. +150
 *  with $10 → $15 profit (150/100 * 10). -150 with $10 → $6.67 profit
 *  (100/150 * 10). Caller multiplies by stake. */
export function americanToProfitMultiplier(odds: number): number {
  if (odds >= 0) return odds / 100;
  return 100 / Math.abs(odds);
}

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
    // Team IDs are model-agnostic — a game's away/home teams don't
    // change per model version. Skip the model_version filter so we
    // still get team abbreviations even when the current model's
    // daily_predictions rows have been overwritten by another version.
    sb.from("daily_predictions")
      .select("game_pk, away_team_id, home_team_id, model_version")
      .eq("sport", "mlb")
      .eq("date", date),
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
  type Row = {
    date: string; game_pk: number;
    away_win_pct: number; home_win_pct: number; nrfi_pct: number;
    win_correct: boolean | null; nrfi_correct: boolean | null;
    win_brier: number | null; nrfi_brier: number | null;
    actual_winner: "away" | "home" | null;
    actual_nrfi: boolean | null;
  };
  type DkOddsRow = { date: string; game_pk: number; home_ml_odds: number | null };
  const [data, dkRows] = await Promise.all([
    paginateSelect<Row>((from, to) => sb
      .from("prediction_results")
      .select("date, game_pk, away_win_pct, home_win_pct, nrfi_pct, win_correct, nrfi_correct, win_brier, nrfi_brier, actual_winner, actual_nrfi")
      .eq("sport", "mlb")
      .eq("model_version", PREDICTIONS_MODEL_VERSION)
      .gte("date", startIso)
      .lte("date", endIso)
      .range(from, to)),
    paginateSelect<DkOddsRow>((from, to) => sb.from("daily_odds_first")
      .select("date, game_pk, home_ml_odds")
      .eq("sport", "mlb").eq("book", "DraftKings")
      .gte("date", startIso).lte("date", endIso)
      .range(from, to)),
  ]);
  const dkHomeOdds = new Map<string, number | null>();
  for (const r of dkRows) dkHomeOdds.set(`${r.date}|${r.game_pk}`, r.home_ml_odds);

  // Group by date so the always-pick rule (one ML + one NRFI per day,
  // even when nothing clears threshold) can be applied per slate.
  const byDate = new Map<string, Row[]>();
  for (const r of data) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }

  // Aggregate stats across the window. All-games Brier / accuracy still
  // sweep every row (calibration signal, not "did we pick well"). Pick
  // counters use the always-pick rule: threshold qualifiers first, plus
  // a best-of-slate fallback on any day with no threshold qualifier.
  let finals = 0, winHits = 0, winBrierSum = 0;
  let nrfiFinals = 0, nrfiAllHits = 0, nrfiBrierSum = 0;
  let mlPlays = 0, mlPlayHits = 0;
  let nrfiPlays = 0, nrfiPlayHits = 0;

  for (const dayRows of byDate.values()) {
    let mlDayPicked = false;
    let nrfiDayPicked = false;
    let bestMl:   { side: "away" | "home"; favPct: number; winner: "away" | "home" } | null = null;
    let bestNrfi: { pickNrfi: boolean;     dev: number;     actual: boolean        } | null = null;

    for (const r of dayRows) {
      // All-games calibration tallies.
      if (r.win_correct !== null) {
        finals++;
        if (r.win_correct) winHits++;
        if (r.win_brier !== null) winBrierSum += Number(r.win_brier);
      }
      if (r.nrfi_correct !== null) {
        nrfiFinals++;
        if (r.nrfi_correct) nrfiAllHits++;
        if (r.nrfi_brier !== null) nrfiBrierSum += Number(r.nrfi_brier);
      }

      // Threshold-qualifying ML pick for this game. Home-only per
      // winPlayFor's selection rule (see its docstring), and only when
      // DK home odds are in the playable range.
      if (r.win_correct !== null && r.actual_winner !== null) {
        const a = Number(r.away_win_pct), h = Number(r.home_win_pct);
        const homeOdds = dkHomeOdds.get(`${r.date}|${r.game_pk}`) ?? null;
        if (h >= ML_PLAY_THRESHOLD && mlOddsInPlayableRange(homeOdds)) {
          mlPlays++;
          if (r.actual_winner === "home") mlPlayHits++;
          mlDayPicked = true;
        }
        // Track best-of-slate candidate for the fallback.
        const fav  = a >= h ? a : h;
        const side: "away" | "home" = a >= h ? "away" : "home";
        if (!bestMl || fav > bestMl.favPct) {
          bestMl = { side, favPct: fav, winner: r.actual_winner };
        }
      }

      // Threshold-qualifying NRFI/YRFI pick for this game.
      if (r.nrfi_correct !== null && r.actual_nrfi !== null) {
        const p = Number(r.nrfi_pct);
        let picked: boolean | null = null;
        if (p >= NRFI_PLAY_THRESHOLD) picked = true;
        else if (p <= 1 - NRFI_PLAY_THRESHOLD) picked = false;
        if (picked !== null) {
          nrfiPlays++;
          if (picked === r.actual_nrfi) nrfiPlayHits++;
          nrfiDayPicked = true;
        }
        const dev = Math.abs(p - 0.5);
        if (!bestNrfi || dev > bestNrfi.dev) {
          bestNrfi = { pickNrfi: p >= 0.5, dev, actual: r.actual_nrfi };
        }
      }
    }

    // Always-pick fallbacks: fire when no threshold pick existed for
    // the metric on this date AND a candidate game graded. Keeping
    // fallbacks IN the tally ensures every day surfaces at least one
    // ML and one NRFI, matching what the display shows. The ROI
    // number naturally reflects that fallbacks are lower-quality
    // picks (they're rarely at good prices), which is honest.
    if (!mlDayPicked && bestMl) {
      mlPlays++;
      if (bestMl.side === bestMl.winner) mlPlayHits++;
    }
    if (!nrfiDayPicked && bestNrfi) {
      nrfiPlays++;
      if (bestNrfi.pickNrfi === bestNrfi.actual) nrfiPlayHits++;
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
export function outcomeWinPlay(o: GamePredictionOutcome, dkHomeOdds?: number | null): WinPlay | null {
  // Home only, and only when DK odds are in the playable range —
  // mirrors winPlayFor. See its docstring for why.
  if (o.homeWinPct < ML_PLAY_THRESHOLD) return null;
  if (!mlOddsInPlayableRange(dkHomeOdds)) return null;
  return { side: "home", abbr: o.homeAbbr, winPct: o.homeWinPct, strong: o.homeWinPct >= ML_STRONG_THRESHOLD };
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

/** Always-pick fallback for a graded day: pick the strongest favorite
 *  on the slate when no game cleared the ML threshold. Mirrors
 *  bestOfSlateWinPlay in predictions.ts but against outcome rows. */
export function bestOfDayWinPlay(outcomes: GamePredictionOutcome[]): { gamePk: number; play: WinPlay } | null {
  let best: { gamePk: number; favPct: number; play: WinPlay } | null = null;
  for (const o of outcomes) {
    const fav  = o.awayWinPct >= o.homeWinPct ? o.awayWinPct : o.homeWinPct;
    const play: WinPlay = o.awayWinPct >= o.homeWinPct
      ? { side: "away", abbr: o.awayAbbr, winPct: o.awayWinPct, strong: o.awayWinPct >= ML_STRONG_THRESHOLD }
      : { side: "home", abbr: o.homeAbbr, winPct: o.homeWinPct, strong: o.homeWinPct >= ML_STRONG_THRESHOLD };
    if (!best || fav > best.favPct) best = { gamePk: o.gamePk, favPct: fav, play };
  }
  return best ? { gamePk: best.gamePk, play: best.play } : null;
}

/** Same idea for NRFI: pick the slate's strongest lean. */
export function bestOfDayNrfiPlay(outcomes: GamePredictionOutcome[]): { gamePk: number; play: NrfiPlay } | null {
  let best: { gamePk: number; dev: number; play: NrfiPlay } | null = null;
  for (const o of outcomes) {
    const dev = Math.abs(o.nrfiPct - 0.5);
    const play: NrfiPlay = o.nrfiPct >= 0.5
      ? { side: "NRFI", probability: o.nrfiPct,     strong: o.nrfiPct     >= NRFI_STRONG_THRESHOLD }
      : { side: "YRFI", probability: 1 - o.nrfiPct, strong: (1 - o.nrfiPct) >= NRFI_STRONG_THRESHOLD };
    if (!best || dev > best.dev) best = { gamePk: o.gamePk, dev, play };
  }
  return best ? { gamePk: best.gamePk, play: best.play } : null;
}

// ─── ROI ($10/play P/L on graded picks against captured odds) ──────────

type RoiResultRow = {
  date: string; game_pk: number;
  away_win_pct: number; home_win_pct: number; nrfi_pct: number;
  win_correct: boolean | null; nrfi_correct: boolean | null;
  actual_winner: "away" | "home" | null;
  actual_nrfi: boolean | null;
};
type OddsLookupRow = {
  date: string; game_pk: number;
  away_ml_odds: number | null; home_ml_odds: number | null;
  nrfi_odds:    number | null; yrfi_odds:    number | null;
};

export type DayOdds = {
  mlByGamePk:   Map<number, { away: number | null; home: number | null }>;
  nrfiByGamePk: Map<number, { nrfi: number | null; yrfi: number | null }>;
};

/** Odds captured for one date, keyed by game_pk. ML odds come from
 *  DraftKings, NRFI odds from FanDuel — same book split loadPlayRoi
 *  uses. Missing games/books return empty maps rather than throwing so
 *  the caller can silently render "—" for a missing price. */
export async function loadOddsForDate(date: string): Promise<DayOdds> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("daily_odds_first")
    .select("date, game_pk, book, away_ml_odds, home_ml_odds, nrfi_odds, yrfi_odds")
    .eq("sport", "mlb")
    .eq("date", date)
    .in("book", ["DraftKings", "FanDuel"]);
  const mlByGamePk = new Map<number, { away: number | null; home: number | null }>();
  const nrfiByGamePk = new Map<number, { nrfi: number | null; yrfi: number | null }>();
  if (error || !data) return { mlByGamePk, nrfiByGamePk };
  type Row = OddsLookupRow & { book: string };
  for (const r of data as Row[]) {
    if (r.book === "DraftKings") {
      mlByGamePk.set(r.game_pk, { away: r.away_ml_odds, home: r.home_ml_odds });
    } else if (r.book === "FanDuel") {
      nrfiByGamePk.set(r.game_pk, { nrfi: r.nrfi_odds, yrfi: r.yrfi_odds });
    }
  }
  return { mlByGamePk, nrfiByGamePk };
}

/** Same day-grouping logic as loadPredictionAccuracy, but each picked
 *  game is joined to daily_odds (DraftKings book for now) and the
 *  outcome is converted to $stake P/L. Plays where odds weren't
 *  captured (no row, or odds value null for the side we picked) count
 *  toward `*PlaysGraded` but not toward staked/profit. */
export async function loadPlayRoi(
  days: number,
  endDate: string,
  stake = 10,
): Promise<PlayRoiSummary> {
  const end = new Date(endDate + "T00:00:00Z");
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const startIso = start.toISOString().slice(0, 10);
  const endIso = end.toISOString().slice(0, 10);

  const sb = supabaseAdmin();
  // ML odds come from ESPN→DraftKings; NRFI odds come from FanDuel.
  // Pull both books in one query so the join is cheap, then split into
  // two lookups by book.
  type OddsRowWithBook = OddsLookupRow & { book: string };
  const [resRows, oddsRows] = await Promise.all([
    paginateSelect<RoiResultRow>((from, to) => sb.from("prediction_results")
      .select("date, game_pk, away_win_pct, home_win_pct, nrfi_pct, win_correct, nrfi_correct, actual_winner, actual_nrfi")
      .eq("sport", "mlb")
      .eq("model_version", PREDICTIONS_MODEL_VERSION)
      .gte("date", startIso)
      .lte("date", endIso)
      .range(from, to)),
    paginateSelect<OddsRowWithBook>((from, to) => sb.from("daily_odds_first")
      .select("date, game_pk, book, away_ml_odds, home_ml_odds, nrfi_odds, yrfi_odds")
      .eq("sport", "mlb")
      .in("book", ["DraftKings", "FanDuel"])
      .gte("date", startIso)
      .lte("date", endIso)
      .range(from, to)),
  ]);

  const mlOddsByKey = new Map<string, OddsLookupRow>();
  const nrfiOddsByKey = new Map<string, OddsLookupRow>();
  for (const o of oddsRows) {
    const k = `${o.date}|${o.game_pk}`;
    if (o.book === "DraftKings") mlOddsByKey.set(k, o);
    if (o.book === "FanDuel")    nrfiOddsByKey.set(k, o);
  }

  const byDate = new Map<string, RoiResultRow[]>();
  for (const r of resRows) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }

  let mlPlaysGraded = 0, mlPlaysWithOdds = 0, mlStaked = 0, mlProfit = 0;
  let nrfiPlaysGraded = 0, nrfiPlaysWithOdds = 0, nrfiStaked = 0, nrfiProfit = 0;

  // For each day: find threshold-qualifying ML and NRFI picks; if none,
  // pick the always-pick fallback. Then look up odds and book P/L.
  for (const dayRows of byDate.values()) {
    // ── ML ─────────────────────────────────────────────────────────
    type MlPick = { gamePk: number; side: "away" | "home"; winner: "away" | "home" };
    const mlPicks: MlPick[] = [];
    let bestMl: { gamePk: number; favPct: number; side: "away" | "home"; winner: "away" | "home" } | null = null;
    for (const r of dayRows) {
      if (r.win_correct === null || r.actual_winner === null) continue;
      const a = Number(r.away_win_pct), h = Number(r.home_win_pct);
      // Home-only ML picks + DK odds range filter — matches
      // outcomeWinPlay and the accuracy tally.
      const homeOdds = mlOddsByKey.get(`${r.date}|${r.game_pk}`)?.home_ml_odds ?? null;
      if (h >= ML_PLAY_THRESHOLD && mlOddsInPlayableRange(homeOdds)) {
        mlPicks.push({ gamePk: r.game_pk, side: "home", winner: r.actual_winner });
      }
      // Track best-of-day candidate for the fallback (unfiltered so
      // we can always surface *something* on quiet slates).
      const fav = a >= h ? a : h;
      const side: "away" | "home" = a >= h ? "away" : "home";
      if (!bestMl || fav > bestMl.favPct) {
        bestMl = { gamePk: r.game_pk, favPct: fav, side, winner: r.actual_winner };
      }
    }
    if (mlPicks.length === 0 && bestMl) {
      mlPicks.push({ gamePk: bestMl.gamePk, side: bestMl.side, winner: bestMl.winner });
    }
    for (const p of mlPicks) {
      mlPlaysGraded++;
      const o = mlOddsByKey.get(`${dayRows[0]?.date}|${p.gamePk}`);
      const odds = p.side === "away" ? o?.away_ml_odds : o?.home_ml_odds;
      if (odds == null) continue;
      mlPlaysWithOdds++;
      mlStaked += stake;
      if (p.side === p.winner) mlProfit += stake * americanToProfitMultiplier(odds);
      else mlProfit -= stake;
    }

    // ── NRFI ───────────────────────────────────────────────────────
    type NrfiPick = { gamePk: number; pickNrfi: boolean; actual: boolean };
    const nrfiPicks: NrfiPick[] = [];
    let bestNrfi: { gamePk: number; dev: number; pickNrfi: boolean; actual: boolean } | null = null;
    for (const r of dayRows) {
      if (r.nrfi_correct === null || r.actual_nrfi === null) continue;
      const p = Number(r.nrfi_pct);
      let pickNrfi: boolean | null = null;
      if (p >= NRFI_PLAY_THRESHOLD) pickNrfi = true;
      else if (p <= 1 - NRFI_PLAY_THRESHOLD) pickNrfi = false;
      if (pickNrfi !== null) {
        nrfiPicks.push({ gamePk: r.game_pk, pickNrfi, actual: r.actual_nrfi });
      }
      const dev = Math.abs(p - 0.5);
      if (!bestNrfi || dev > bestNrfi.dev) {
        bestNrfi = { gamePk: r.game_pk, dev, pickNrfi: p >= 0.5, actual: r.actual_nrfi };
      }
    }
    if (nrfiPicks.length === 0 && bestNrfi) {
      nrfiPicks.push({ gamePk: bestNrfi.gamePk, pickNrfi: bestNrfi.pickNrfi, actual: bestNrfi.actual });
    }
    for (const p of nrfiPicks) {
      nrfiPlaysGraded++;
      const o = nrfiOddsByKey.get(`${dayRows[0]?.date}|${p.gamePk}`);
      const odds = p.pickNrfi ? o?.nrfi_odds : o?.yrfi_odds;
      if (odds == null) continue;
      nrfiPlaysWithOdds++;
      nrfiStaked += stake;
      if (p.pickNrfi === p.actual) nrfiProfit += stake * americanToProfitMultiplier(odds);
      else nrfiProfit -= stake;
    }
  }

  return {
    stake,
    mlPlaysGraded, mlPlaysWithOdds,
    mlStaked,  mlProfit,  mlRoi:   mlStaked  > 0 ? mlProfit  / mlStaked  : null,
    nrfiPlaysGraded, nrfiPlaysWithOdds,
    nrfiStaked, nrfiProfit, nrfiRoi: nrfiStaked > 0 ? nrfiProfit / nrfiStaked : null,
  };
}

// ─── Season history (for the table on /mlb/predictions) ────────────────

export type SeasonHistoryLinescore = {
  innings: Array<{ a: number | null; h: number | null }>;
  away: { r: number | null; h: number | null; e: number | null };
  home: { r: number | null; h: number | null; e: number | null };
};
export type SeasonHistoryGame = {
  gamePk:    number;
  awayAbbr:  string;
  homeAbbr:  string;
  status:    string;
  linescore: SeasonHistoryLinescore | null;
  mlPick:    { label: string; strong: boolean; hit: boolean | null } | null;
  nrfiPick:  { label: string; strong: boolean; hit: boolean | null } | null;
};
export type SeasonHistoryDay = {
  date:  string;
  games: SeasonHistoryGame[];
};

/** Returns one row per graded day in the window, each with the
 *  day's ML play + NRFI play (threshold OR always-pick fallback).
 *  Newest first. Used by the season history table on the page. */
export async function loadSeasonHistory(startIso: string, endIso: string): Promise<SeasonHistoryDay[]> {
  const sb = supabaseAdmin();

  type ResRowRaw = {
    date: string; game_pk: number;
    away_win_pct: number; home_win_pct: number; nrfi_pct: number;
    status: string; away_score: number | null; home_score: number | null;
    away_first_inning: number | null; home_first_inning: number | null;
    actual_winner: "away" | "home" | null; actual_nrfi: boolean | null;
    win_correct: boolean | null; nrfi_correct: boolean | null;
    win_brier: number | null; nrfi_brier: number | null;
    linescore: SeasonHistoryLinescore | null;
  };
  type PredRowRaw = { date: string; game_pk: number; away_team_id: number; home_team_id: number };

  const [resultsRows, predsRows, dkOddsRows] = await Promise.all([
    paginateSelect<ResRowRaw>((from, to) => sb.from("prediction_results")
      .select(
        "date, game_pk, away_win_pct, home_win_pct, nrfi_pct, status, " +
        "away_score, home_score, away_first_inning, home_first_inning, " +
        "actual_winner, actual_nrfi, win_correct, nrfi_correct, win_brier, nrfi_brier, " +
        "linescore",
      )
      .eq("sport", "mlb")
      .eq("model_version", PREDICTIONS_MODEL_VERSION)
      .gte("date", startIso)
      .lte("date", endIso)
      .order("date", { ascending: false })
      .order("game_pk", { ascending: true })
      .range(from, to)),
    // Team IDs are model-agnostic — see the note in
    // loadPredictionOutcomesForDate for why we skip the version filter.
    paginateSelect<PredRowRaw>((from, to) => sb.from("daily_predictions")
      .select("date, game_pk, away_team_id, home_team_id")
      .eq("sport", "mlb")
      .gte("date", startIso)
      .lte("date", endIso)
      .range(from, to)),
    paginateSelect<{ date: string; game_pk: number; home_ml_odds: number | null }>((from, to) =>
      sb.from("daily_odds_first")
        .select("date, game_pk, home_ml_odds")
        .eq("sport", "mlb").eq("book", "DraftKings")
        .gte("date", startIso).lte("date", endIso)
        .range(from, to)),
  ]);

  // Reuse the date-by-date outcome assembly we already have so the
  // same threshold + best-of-day logic applies.
  const teamMap = new Map<string, { away_team_id: number; home_team_id: number }>();
  for (const p of predsRows) {
    teamMap.set(`${p.date}|${p.game_pk}`, { away_team_id: p.away_team_id, home_team_id: p.home_team_id });
  }

  // Build the GamePredictionOutcome[] per date so we can reuse the
  // outcomeWinPlay / outcomeNrfiPlay / best-of-day helpers above. Also
  // stash the linescore beside each outcome row.
  const outcomesByDate = new Map<string, GamePredictionOutcome[]>();
  const linescoreByKey = new Map<string, SeasonHistoryLinescore | null>();
  for (const r of resultsRows) {
    const teams = teamMap.get(`${r.date}|${r.game_pk}`);
    const o: GamePredictionOutcome = {
      gamePk: r.game_pk,
      date:   r.date,
      awayAbbr: teams ? teamAbbr(teams, "away") : "—",
      homeAbbr: teams ? teamAbbr(teams, "home") : "—",
      awayWinPct: Number(r.away_win_pct),
      homeWinPct: Number(r.home_win_pct),
      nrfiPct:    Number(r.nrfi_pct),
      status: r.status,
      awayScore: r.away_score, homeScore: r.home_score,
      awayFirstInning: r.away_first_inning, homeFirstInning: r.home_first_inning,
      predictedWinner: predictedWinnerOf(Number(r.away_win_pct), Number(r.home_win_pct)),
      actualWinner:    r.actual_winner,
      winCorrect:      r.win_correct,
      predictedNrfi:   Number(r.nrfi_pct) >= 0.5,
      actualNrfi:      r.actual_nrfi,
      nrfiCorrect:     r.nrfi_correct,
    };
    const list = outcomesByDate.get(r.date) ?? [];
    list.push(o);
    outcomesByDate.set(r.date, list);
    linescoreByKey.set(`${r.date}|${r.game_pk}`, r.linescore ?? null);
  }

  const dkHomeOddsByKey = new Map<string, number | null>();
  for (const r of dkOddsRows) dkHomeOddsByKey.set(`${r.date}|${r.game_pk}`, r.home_ml_odds);

  // One row per game (rowspanned per day in the renderer). Days with
  // no threshold qualifier still get exactly one best-of-day fallback
  // pick per market so the season history has no empty days.
  const days: SeasonHistoryDay[] = [];
  const dateKeys = [...outcomesByDate.keys()].sort((a, b) => b.localeCompare(a));
  for (const date of dateKeys) {
    const outcomes = outcomesByDate.get(date) ?? [];
    const outcomesByPk = new Map(outcomes.map((o) => [o.gamePk, o]));

    const mlPlaysByPk = new Map<number, WinPlay>();
    const nrfiPlaysByPk = new Map<number, NrfiPlay>();
    for (const o of outcomes) {
      const homeOdds = dkHomeOddsByKey.get(`${date}|${o.gamePk}`) ?? null;
      const ml = outcomeWinPlay(o, homeOdds);
      if (ml) mlPlaysByPk.set(o.gamePk, ml);
      const nrfi = outcomeNrfiPlay(o);
      if (nrfi) nrfiPlaysByPk.set(o.gamePk, nrfi);
    }
    if (mlPlaysByPk.size === 0) {
      const fb = bestOfDayWinPlay(outcomes);
      if (fb) mlPlaysByPk.set(fb.gamePk, fb.play);
    }
    if (nrfiPlaysByPk.size === 0) {
      const fb = bestOfDayNrfiPlay(outcomes);
      if (fb) nrfiPlaysByPk.set(fb.gamePk, fb.play);
    }

    // Any game touched by an ML or NRFI pick gets a row for the day.
    const gamePks = new Set<number>([...mlPlaysByPk.keys(), ...nrfiPlaysByPk.keys()]);
    const games: SeasonHistoryGame[] = [];
    for (const pk of [...gamePks].sort((a, b) => a - b)) {
      const o = outcomesByPk.get(pk);
      if (!o) continue;
      const ml   = mlPlaysByPk.get(pk);
      const nrfi = nrfiPlaysByPk.get(pk);
      games.push({
        gamePk:   o.gamePk,
        awayAbbr: o.awayAbbr,
        homeAbbr: o.homeAbbr,
        status:   o.status,
        linescore: linescoreByKey.get(`${date}|${pk}`) ?? null,
        mlPick: ml
          ? { label: ml.side === "away" ? o.awayAbbr : o.homeAbbr, strong: ml.strong, hit: o.winCorrect }
          : null,
        nrfiPick: nrfi
          ? { label: nrfiSideLabel(nrfi.side), strong: nrfi.strong, hit: o.nrfiCorrect }
          : null,
      });
    }

    if (games.length > 0) days.push({ date, games });
  }
  return days;
}
