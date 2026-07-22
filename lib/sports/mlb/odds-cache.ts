// Appends ESPN + FanDuel odds captures into daily_odds (append-only
// since migration 0071). Used by:
//   * predictions-snapshot cron — first capture of the day, ~10:30 ET
//   * predictions-odds-poll cron — every 30 min through game hours
//   * backfill scripts for historical dates
//
// daily_odds is append-only: PK is (sport, date, game_pk, book,
// captured_at). Every call writes a NEW row rather than overwriting the
// existing (sport, date, game_pk, book) row. Readers that used to see
// one row per (game, book) go through the daily_odds_first view, which
// returns the earliest capture ("opening price"). The predictions-
// comparator scans the full history to find the "latest capture before
// first pitch" per game for CLV closing prices.
//
// The join key is the (away abbr, home abbr) pair, normalized through
// ESPN_TO_CANONICAL_ABBR in odds-espn.ts. That avoids depending on
// ESPN event IDs matching MLB statsapi gamePks (they don't), but it
// breaks down on doubleheaders — two games same day with the same
// matchup will end up sharing one odds row per capture. Doubleheaders
// are rare enough that we'll accept the loss for v1; if the missed-
// game count rises above noise we'll switch to a (date, abbr, abbr,
// startTime) match instead.

import { supabaseAdmin } from "@/lib/supabase";
import { findTeamByMlbApiId, TEAMS } from "@/lib/teams";
import { fetchEspnOddsForDate, indexOddsByMatchup, type EspnOddsRow } from "./odds-espn";
import { fetchFanDuelNrfiForDate, type FanDuelNrfiRow } from "./odds-fanduel";

type PredictionGameKey = {
  game_pk: number;
  away_team_id: number;
  home_team_id: number;
};

export type OddsUpsertReport = {
  date: string;
  scheduled: number;     // predictions on the slate for this date
  espnGames: number;     // games ESPN returned for this date
  matched: number;       // predictions joined to an ESPN row
  withMl: number;        // matched rows with both ML values present
  upserted: number;      // rows appended to daily_odds
  unmatched: Array<{ awayAbbr: string; homeAbbr: string }>;
};

/** Fetches ESPN ML odds for a date and appends one row per matched
 *  daily_prediction into daily_odds. Silent skips on unmatched games
 *  (logged in the return value, never throws). */
export async function captureEspnOddsForDate(
  date: string,
): Promise<OddsUpsertReport> {
  const sb = supabaseAdmin();

  const { data: preds, error: predsErr } = await sb
    .from("daily_predictions")
    .select("game_pk, away_team_id, home_team_id")
    .eq("sport", "mlb")
    .eq("date", date);
  if (predsErr) {
    throw new Error(`captureEspnOddsForDate(${date}): predictions read: ${predsErr.message}`);
  }
  const predictions = (preds ?? []) as PredictionGameKey[];

  if (predictions.length === 0) {
    return { date, scheduled: 0, espnGames: 0, matched: 0, withMl: 0, upserted: 0, unmatched: [] };
  }

  const espnRows = await fetchEspnOddsForDate(date);
  const byMatchup = indexOddsByMatchup(espnRows);

  const insertRows: Array<{
    sport: string; date: string; game_pk: number;
    book: string; source: string;
    away_ml_odds: number | null; home_ml_odds: number | null;
    nrfi_odds: number | null; yrfi_odds: number | null;
    raw: Record<string, unknown>;
  }> = [];
  const unmatched: Array<{ awayAbbr: string; homeAbbr: string }> = [];
  let matched = 0;
  let withMl = 0;

  for (const p of predictions) {
    const awayTeam = findTeamByMlbApiId(p.away_team_id);
    const homeTeam = findTeamByMlbApiId(p.home_team_id);
    if (!awayTeam || !homeTeam) continue;
    const key = `${awayTeam.abbreviation}|${homeTeam.abbreviation}`;
    const odds = byMatchup.get(key);
    if (!odds) {
      unmatched.push({ awayAbbr: awayTeam.abbreviation, homeAbbr: homeTeam.abbreviation });
      continue;
    }
    matched++;
    if (typeof odds.awayMl === "number" && typeof odds.homeMl === "number") withMl++;
    insertRows.push({
      sport: "mlb",
      date,
      game_pk: p.game_pk,
      book: odds.book,
      source: "espn-core",
      away_ml_odds: odds.awayMl,
      home_ml_odds: odds.homeMl,
      nrfi_odds: null,
      yrfi_odds: null,
      raw: odds.raw,
    });
  }

  if (insertRows.length > 0) {
    const { error } = await sb.from("daily_odds").insert(insertRows);
    if (error) {
      throw new Error(`captureEspnOddsForDate(${date}): insert: ${error.message}`);
    }
  }

  return {
    date,
    scheduled: predictions.length,
    espnGames: espnRows.length,
    matched,
    withMl,
    upserted: insertRows.length,
    unmatched,
  };
}

// ── FanDuel NRFI capture ──────────────────────────────────────────────

// FanDuel returns full team names ("Tampa Bay Rays"); we key our
// predictions on MLB IDs. Build a name → MLB team_id index once at
// import so the per-game lookup is O(1).
const NAME_TO_TEAM_ID: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const t of TEAMS) {
    if (t.sport === "mlb" && typeof t.mlbApiId === "number") {
      m.set(t.name.toLowerCase(), t.mlbApiId);
      // Tolerate the "St Louis" vs "St. Louis" trap.
      m.set(t.name.toLowerCase().replace(/\./g, ""), t.mlbApiId);
    }
  }
  return m;
})();

export type FanDuelNrfiReport = {
  date: string;
  scheduled: number;       // predictions on the slate for this date
  fanDuelGames: number;    // games FanDuel returned for this date
  matched: number;         // matched to a prediction by team-name pair
  withNrfi: number;        // matched rows with non-null NRFI + YRFI odds
  upserted: number;        // rows appended
  unmatched: Array<{ awayName: string; homeName: string }>;
};

export async function captureFanDuelNrfiForDate(
  date: string,
): Promise<FanDuelNrfiReport> {
  const sb = supabaseAdmin();

  const { data: preds, error: predsErr } = await sb
    .from("daily_predictions")
    .select("game_pk, away_team_id, home_team_id")
    .eq("sport", "mlb")
    .eq("date", date);
  if (predsErr) {
    throw new Error(`captureFanDuelNrfiForDate(${date}): predictions read: ${predsErr.message}`);
  }
  const predictions = (preds ?? []) as PredictionGameKey[];

  if (predictions.length === 0) {
    return { date, scheduled: 0, fanDuelGames: 0, matched: 0, withNrfi: 0, upserted: 0, unmatched: [] };
  }

  const fdRows = await fetchFanDuelNrfiForDate(date);

  // Reindex predictions by (away mlbApiId, home mlbApiId). A doubleheader
  // shares a team-pair across TWO game_pks, so the value is a LIST, sorted
  // ascending (game_pk order ≈ chronological, game 1 first).
  const predByPair = new Map<string, number[]>();
  for (const p of predictions) {
    const k = `${p.away_team_id}|${p.home_team_id}`;
    const list = predByPair.get(k) ?? [];
    list.push(p.game_pk);
    predByPair.set(k, list);
  }
  for (const list of predByPair.values()) list.sort((a, b) => a - b);

  const insertRows: Array<{
    sport: string; date: string; game_pk: number;
    book: string; source: string;
    away_ml_odds: number | null; home_ml_odds: number | null;
    nrfi_odds: number | null; yrfi_odds: number | null;
    raw: Record<string, unknown>;
  }> = [];
  const unmatched: FanDuelNrfiReport["unmatched"] = [];
  let matched = 0;
  let withNrfi = 0;

  // Group FanDuel rows by resolved team-pair so a doubleheader's two events
  // map to its two game_pks instead of collapsing onto one. Both events
  // carry identical team names, so without this they'd produce two insert
  // rows with the same (game_pk, book, captured_at) and the whole append
  // batch would fail on the daily_odds PK (a real prod bug: FanDuel capture
  // died on every doubleheader day). Aligned by start time = game_pk order.
  const fdByPair = new Map<string, FanDuelNrfiRow[]>();
  for (const fd of fdRows) {
    const awayId = NAME_TO_TEAM_ID.get(fd.awayTeamName.toLowerCase());
    const homeId = NAME_TO_TEAM_ID.get(fd.homeTeamName.toLowerCase());
    const pair = `${awayId}|${homeId}`;
    if (typeof awayId !== "number" || typeof homeId !== "number" || !predByPair.has(pair)) {
      unmatched.push({ awayName: fd.awayTeamName, homeName: fd.homeTeamName });
      continue;
    }
    const group = fdByPair.get(pair) ?? [];
    group.push(fd);
    fdByPair.set(pair, group);
  }

  for (const [pair, group] of fdByPair) {
    const gamePks = predByPair.get(pair)!;
    group.sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));
    // Zip events → game_pks in order; extras (either side) are dropped so
    // the batch never carries a duplicate game_pk.
    for (let i = 0; i < group.length && i < gamePks.length; i++) {
      const fd = group[i]!;
      matched++;
      if (typeof fd.nrfiOdds === "number" && typeof fd.yrfiOdds === "number") withNrfi++;
      insertRows.push({
        sport: "mlb",
        date,
        game_pk: gamePks[i]!,
        book: "FanDuel",
        source: "fanduel-event-page",
        away_ml_odds: null,
        home_ml_odds: null,
        nrfi_odds: fd.nrfiOdds,
        yrfi_odds: fd.yrfiOdds,
        raw: fd.raw,
      });
    }
  }

  if (insertRows.length > 0) {
    const { error } = await sb.from("daily_odds").insert(insertRows);
    if (error) {
      throw new Error(`captureFanDuelNrfiForDate(${date}): insert: ${error.message}`);
    }
  }

  return {
    date,
    scheduled: predictions.length,
    fanDuelGames: fdRows.length,
    matched,
    withNrfi,
    upserted: insertRows.length,
    unmatched,
  };
}
