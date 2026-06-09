// Queries for the /admin/historical viewer. Two access patterns:
//
//   listHistoricalGames(filters) — index page, returns thin summary rows.
//     Always paginate. Supabase silently truncates unbounded selects at
//     1000 rows, which would hide ~99% of the store once the backfill is
//     done.
//
//   getHistoricalGameWithRaw(gamePk) — detail page, joins the summary
//     with the raw boxscore + linescore payloads.

import { supabaseAdmin } from "../supabase";

export type HistoricalGameSummary = {
  game_pk: number;
  game_date: string;        // YYYY-MM-DD
  season: number;
  game_type: string | null;
  away_team_id: number | null;
  away_team_abbr: string | null;
  away_score: number | null;
  home_team_id: number | null;
  home_team_abbr: string | null;
  home_score: number | null;
  innings: number | null;
  venue: string | null;
  excitement_score: number | null;
  excitement_notes: Record<string, number> | null;
};

export type HistoricalListFilters = {
  season?: number;
  fromDate?: string;        // YYYY-MM-DD inclusive
  toDate?: string;          // YYYY-MM-DD inclusive
  team?: string;            // matches either away_team_abbr or home_team_abbr
  minScore?: number;
  gameType?: string;        // exact match on game_type column
  calendarDay?: string;     // "MM-DD" — match this calendar day across every year
  sort?: "excitement" | "date_desc" | "date_asc";
  limit?: number;
  offset?: number;
};

// Build the list of YYYY-MM-DD dates for a given MM-DD across every season
// from MIN_HISTORICAL_SEASON to the current year. PostgREST's .in() takes
// this list and the planner picks an index scan on game_date — fine for
// ~80 dates against a 200k-row table.
const MIN_HISTORICAL_SEASON = 1950;
function calendarDayDates(mmdd: string): string[] {
  // Permissive parse — accept "MM-DD" or "M-D" or even " mm-dd ".
  const [mRaw, dRaw] = mmdd.trim().split("-");
  const m = String(Number(mRaw ?? "0")).padStart(2, "0");
  const d = String(Number(dRaw ?? "0")).padStart(2, "0");
  if (m === "00" || d === "00") return [];
  const out: string[] = [];
  const currentYear = new Date().getUTCFullYear();
  for (let y = MIN_HISTORICAL_SEASON; y <= currentYear; y++) {
    out.push(`${y}-${m}-${d}`);
  }
  return out;
}

export async function listHistoricalGames(
  filters: HistoricalListFilters = {},
): Promise<{ rows: HistoricalGameSummary[]; total: number }> {
  const supa = supabaseAdmin();
  const limit  = Math.min(filters.limit  ?? 50, 200);
  const offset = filters.offset ?? 0;
  const teamUpper = filters.team?.toUpperCase();
  const calDates  = filters.calendarDay ? calendarDayDates(filters.calendarDay) : null;

  // Count query — same filter set, head: true so no data shipped.
  let cQ = supa.from("historical_games").select("game_pk", { count: "exact", head: true });
  if (filters.season   != null) cQ = cQ.eq("season", filters.season);
  if (filters.fromDate)         cQ = cQ.gte("game_date", filters.fromDate);
  if (filters.toDate)           cQ = cQ.lte("game_date", filters.toDate);
  if (filters.minScore != null) cQ = cQ.gte("excitement_score", filters.minScore);
  if (filters.gameType)         cQ = cQ.eq("game_type", filters.gameType);
  if (calDates && calDates.length > 0) cQ = cQ.in("game_date", calDates);
  if (teamUpper) cQ = cQ.or(`away_team_abbr.eq.${teamUpper},home_team_abbr.eq.${teamUpper}`);
  const { count, error: cErr } = await cQ;
  if (cErr) throw new Error(`listHistoricalGames count: ${cErr.message}`);

  // Data query.
  let q = supa.from("historical_games").select(
    "game_pk,game_date,season,game_type,away_team_id,away_team_abbr,away_score," +
    "home_team_id,home_team_abbr,home_score,innings,venue," +
    "excitement_score,excitement_notes",
  );
  if (filters.season   != null) q = q.eq("season", filters.season);
  if (filters.fromDate)         q = q.gte("game_date", filters.fromDate);
  if (filters.toDate)           q = q.lte("game_date", filters.toDate);
  if (filters.minScore != null) q = q.gte("excitement_score", filters.minScore);
  if (filters.gameType)         q = q.eq("game_type", filters.gameType);
  if (calDates && calDates.length > 0) q = q.in("game_date", calDates);
  if (teamUpper) q = q.or(`away_team_abbr.eq.${teamUpper},home_team_abbr.eq.${teamUpper}`);

  switch (filters.sort ?? "excitement") {
    case "date_desc":  q = q.order("game_date", { ascending: false }); break;
    case "date_asc":   q = q.order("game_date", { ascending: true  }); break;
    default:           q = q.order("excitement_score", { ascending: false, nullsFirst: false }); break;
  }
  q = q.range(offset, offset + limit - 1);

  const { data, error } = await q;
  if (error) throw new Error(`listHistoricalGames data: ${error.message}`);
  return { rows: (data ?? []) as unknown as HistoricalGameSummary[], total: count ?? 0 };
}

export type HistoricalGameDetail = HistoricalGameSummary & {
  boxscore_raw: unknown;
  linescore_raw: unknown;
};

export async function getHistoricalGameWithRaw(
  gamePk: number,
): Promise<HistoricalGameDetail | null> {
  const supa = supabaseAdmin();
  const { data: summary, error: sErr } = await supa
    .from("historical_games")
    .select("*")
    .eq("game_pk", gamePk)
    .maybeSingle();
  if (sErr) throw new Error(`getHistoricalGameWithRaw summary: ${sErr.message}`);
  if (!summary) return null;

  const { data: raw, error: rErr } = await supa
    .from("historical_boxscores")
    .select("boxscore_raw,linescore_raw")
    .eq("game_pk", gamePk)
    .maybeSingle();
  if (rErr) throw new Error(`getHistoricalGameWithRaw raw: ${rErr.message}`);

  return {
    ...(summary as HistoricalGameSummary),
    boxscore_raw:  raw?.boxscore_raw  ?? null,
    linescore_raw: raw?.linescore_raw ?? null,
  };
}
