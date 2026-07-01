// Persists ESPN odds into daily_odds, joined to our predictions on
// (date, awayAbbr, homeAbbr). Used by both the predictions-snapshot
// cron (capture today's odds going forward) and the historical
// backfill script.
//
// The join key is the (away abbr, home abbr) pair, normalized through
// ESPN_TO_CANONICAL_ABBR in odds-espn.ts. That avoids depending on
// ESPN event IDs matching MLB statsapi gamePks (they don't), but it
// breaks down on doubleheaders — two games same day with the same
// matchup will end up sharing one odds row. Doubleheaders are rare
// enough that we'll accept the loss for v1; if the missed-game count
// rises above noise we'll switch to a (date, abbr, abbr, startTime)
// match instead.

import { supabaseAdmin } from "@/lib/supabase";
import { findTeamByMlbApiId, TEAMS } from "@/lib/teams";
import { fetchEspnOddsForDate, indexOddsByMatchup, type EspnOddsRow } from "./odds-espn";
import { fetchFanDuelNrfiForDate, indexFanDuelByMatchup } from "./odds-fanduel";

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
  upserted: number;      // rows actually written to daily_odds
  unmatched: Array<{ awayAbbr: string; homeAbbr: string }>;
};

/** Fetches ESPN ML odds for a date and upserts one daily_odds row per
 *  matched daily_prediction. Silent skips on unmatched games (logged
 *  in the return value, never throws). Idempotent — same date can be
 *  rerun to refresh odds for late lines. */
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

  const upsertRows: Array<{
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
    upsertRows.push({
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

  if (upsertRows.length > 0) {
    const { error } = await sb
      .from("daily_odds")
      .upsert(upsertRows, { onConflict: "sport,date,game_pk,book" });
    if (error) {
      throw new Error(`captureEspnOddsForDate(${date}): upsert: ${error.message}`);
    }
  }

  return {
    date,
    scheduled: predictions.length,
    espnGames: espnRows.length,
    matched,
    withMl,
    upserted: upsertRows.length,
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
  upserted: number;        // rows written
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
  const byMatchup = indexFanDuelByMatchup(fdRows);

  // Reindex predictions by (away mlbApiId, home mlbApiId) so we can
  // probe with FanDuel's team-name → mlbApiId resolution.
  const predByPair = new Map<string, number>();
  for (const p of predictions) {
    predByPair.set(`${p.away_team_id}|${p.home_team_id}`, p.game_pk);
  }

  const upsertRows: Array<{
    sport: string; date: string; game_pk: number;
    book: string; source: string;
    away_ml_odds: number | null; home_ml_odds: number | null;
    nrfi_odds: number | null; yrfi_odds: number | null;
    raw: Record<string, unknown>;
  }> = [];
  const unmatched: FanDuelNrfiReport["unmatched"] = [];
  let matched = 0;
  let withNrfi = 0;

  for (const fd of fdRows) {
    const awayId = NAME_TO_TEAM_ID.get(fd.awayTeamName.toLowerCase());
    const homeId = NAME_TO_TEAM_ID.get(fd.homeTeamName.toLowerCase());
    if (typeof awayId !== "number" || typeof homeId !== "number") {
      unmatched.push({ awayName: fd.awayTeamName, homeName: fd.homeTeamName });
      continue;
    }
    const gamePk = predByPair.get(`${awayId}|${homeId}`);
    if (typeof gamePk !== "number") {
      unmatched.push({ awayName: fd.awayTeamName, homeName: fd.homeTeamName });
      continue;
    }
    matched++;
    if (typeof fd.nrfiOdds === "number" && typeof fd.yrfiOdds === "number") withNrfi++;
    upsertRows.push({
      sport: "mlb",
      date,
      game_pk: gamePk,
      book: "FanDuel",
      source: "fanduel-event-page",
      away_ml_odds: null,
      home_ml_odds: null,
      nrfi_odds: fd.nrfiOdds,
      yrfi_odds: fd.yrfiOdds,
      raw: fd.raw,
    });
    void byMatchup; // index built but iterating fdRows directly is fine here
  }

  if (upsertRows.length > 0) {
    const { error } = await sb
      .from("daily_odds")
      .upsert(upsertRows, { onConflict: "sport,date,game_pk,book" });
    if (error) {
      throw new Error(`captureFanDuelNrfiForDate(${date}): upsert: ${error.message}`);
    }
  }

  return {
    date,
    scheduled: predictions.length,
    fanDuelGames: fdRows.length,
    matched,
    withNrfi,
    upserted: upsertRows.length,
    unmatched,
  };
}
