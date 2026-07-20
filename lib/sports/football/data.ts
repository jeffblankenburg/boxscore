// Football orchestrator. Read-through cache over daily_raw (keyed by
// (sport, date) — same table MLB and basketball use) plus the pure adapter.
// This is the server-side entry point the generate cron and admin preview
// call; the fetch (sources/espn.ts) and transform (adapters/from-espn.ts)
// stay I/O-free and testable. Parallels lib/basketball-daily.ts.

import { supabaseAdmin } from "../../supabase";
import { footballLeagueConfig, seasonForDate } from "./leagues";
import { fetchFootballRaw, type FootballRaw } from "./sources/espn";
import { adaptEspnFootball } from "./adapters/from-espn";
import type { CanonicalFootballDailyData } from "./canonical";
import type { FootballLeague } from "./types";

async function getFootballRaw(
  league: FootballLeague,
  date: string,
): Promise<FootballRaw | null> {
  const { data, error } = await supabaseAdmin()
    .from("daily_raw")
    .select("payload")
    .eq("sport", league)
    .eq("date", date)
    .maybeSingle<{ payload: FootballRaw }>();
  if (error) throw new Error(`getFootballRaw: ${error.message}`);
  return data?.payload ?? null;
}

async function upsertFootballRaw(
  league: FootballLeague,
  date: string,
  payload: FootballRaw,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("daily_raw")
    .upsert(
      { sport: league, date, payload, fetched_at: new Date().toISOString() },
      { onConflict: "sport,date" },
    );
  if (error) throw new Error(`upsertFootballRaw: ${error.message}`);
}

// A cached row predating a shape change (missing `summaries`, or stored under
// the wrong league) is treated as a miss so the next load refetches and
// rewrites. Cheap insurance at boxscore's scale.
function isStaleShape(raw: FootballRaw, league: FootballLeague): boolean {
  return raw.summaries === undefined || raw.league !== league;
}

/**
 * Read-through: stored raw → CanonicalFootballDailyData. Refetches from ESPN
 * and writes through when the row is missing, stale, or refetch=true.
 */
export async function loadFootballData(
  league: FootballLeague,
  date: string,
  opts?: { refetch?: boolean },
): Promise<CanonicalFootballDailyData> {
  const cfg = footballLeagueConfig(league);
  let raw = opts?.refetch ? null : await getFootballRaw(league, date);
  if (raw && isStaleShape(raw, league)) raw = null;
  if (!raw) {
    raw = await fetchFootballRaw(cfg, date, seasonForDate(date));
    await upsertFootballRaw(league, date, raw);
  }
  return adaptEspnFootball(cfg, raw);
}

// A recap only ships on days that actually had games. Callers (the generate
// cron) use this to decide whether to persist a digest at all.
export function hasPlayedGames(data: CanonicalFootballDailyData): boolean {
  return data.games.some((g) => g.status === "final" || g.status === "live");
}
