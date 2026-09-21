// Incremental per-team season stat store (football_team_game_stats).
//
// Each game day the generate cron folds that day's finished box-score sides
// into one slim row per (league, season, team, game) — reusing the box scores
// already fetched for the league digest, so zero extra ESPN calls. Team digests
// and web pages then read a team's season rows and aggregate them, instead of
// re-fetching every game summary from ESPN (which didn't scale to a ~120-team
// college Saturday). See migration 0088.

import { supabaseAdmin } from "@/lib/supabase";
import { aggregateSides } from "./roster";
import type { CanonicalFootballDailyData } from "./canonical";
import type { FootballRosterTable } from "./team-canonical";
import type { FootballLeague, FootballTeamBox } from "./types";

// Fold a day's finished games into the store. Both sides of each game are
// recorded, so every team that played is captured (not just teams with
// digests). Upsert by the primary key makes a cron re-run idempotent.
export async function recordTeamGameStats(
  league: FootballLeague,
  data: CanonicalFootballDailyData,
): Promise<number> {
  const rows = [];
  for (const g of data.games) {
    if (g.status !== "final") continue;
    // Regular season only — preseason inflates season totals, and postseason is
    // tracked separately. Mirrors the league leaders (ESPN seasontype=2).
    if (g.seasonType !== "regular") continue;
    const box = data.boxScores.get(g.id);
    if (!box) continue;
    for (const side of [box.home, box.away]) {
      rows.push({
        league,
        season: g.seasonYear, // ESPN's authoritative season.year for this game
        team_abbr: side.team.abbr.toUpperCase(),
        game_id: g.id,
        game_date: data.date,
        side,
      });
    }
  }
  if (rows.length === 0) return 0;
  const { error } = await supabaseAdmin()
    .from("football_team_game_stats")
    .upsert(rows, { onConflict: "league,season,team_abbr,game_id" });
  if (error) throw new Error(`recordTeamGameStats: ${error.message}`);
  return rows.length;
}

// A team's season roster tables, aggregated from the stored per-game sides
// through the as-of date (point-in-time via game_date <= asOf). Empty until the
// store has rows for the team (before backfill / first game of the season).
export async function loadTeamSeasonRosterTables(
  league: FootballLeague,
  season: number,
  teamAbbr: string,
  asOf: string,
): Promise<FootballRosterTable[]> {
  const { data, error } = await supabaseAdmin()
    .from("football_team_game_stats")
    .select("side")
    .eq("league", league)
    .eq("season", season)
    .eq("team_abbr", teamAbbr.toUpperCase())
    .lte("game_date", asOf);
  if (error) throw new Error(`loadTeamSeasonRosterTables: ${error.message}`);
  const sides = (data ?? []).map((r) => (r as { side: FootballTeamBox }).side);
  return aggregateSides(sides);
}
