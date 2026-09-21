// Backfill football_team_game_stats from already-persisted daily_raw box scores.
// Idempotent (upsert by PK), no ESPN calls — it replays each stored football
// day through recordTeamGameStats, which folds both teams' sides into the store.
//
// Run AFTER applying migration 0088:
//   npx tsx --env-file=.env.local scripts/backfill-football-season-stats.ts
//
// Optional args: a subset of leagues, e.g. `... nfl` or `... ncaaf`.

import { supabaseAdmin } from "../lib/supabase";
import { loadFootballData } from "../lib/sports/football/data";
import { recordTeamGameStats } from "../lib/sports/football/season-stats";
import type { FootballLeague } from "../lib/sports/football/types";

async function main() {
  const leagues = process.argv.slice(2).filter((a) => a && !a.startsWith("--")) as FootballLeague[];
  const targets: FootballLeague[] = leagues.length ? leagues : ["nfl", "ncaaf"];

  // `--reset` clears each target league first — use it after a filter change
  // (e.g. excluding preseason) so stale rows don't linger. Requires the delete
  // grant from migration 0088.
  const reset = process.argv.includes("--reset");

  let grandRows = 0;
  for (const league of targets) {
    if (reset) {
      const { error } = await supabaseAdmin()
        .from("football_team_game_stats").delete().eq("league", league);
      if (error) throw new Error(`reset (${league}): ${error.message}`);
      console.log(`[${league}] reset (cleared existing rows)`);
    }
    // Every persisted football day for this league, oldest first.
    const { data, error } = await supabaseAdmin()
      .from("daily_raw")
      .select("date")
      .eq("sport", league)
      .order("date", { ascending: true });
    if (error) throw new Error(`list dates (${league}): ${error.message}`);
    const dates = (data ?? []).map((r) => (r as { date: string }).date);
    console.log(`[${league}] ${dates.length} persisted days`);

    let rows = 0, days = 0;
    for (const date of dates) {
      try {
        const bundle = await loadFootballData(league, date); // reads stored raw, no refetch
        const n = await recordTeamGameStats(league, bundle);
        if (n > 0) { rows += n; days++; }
      } catch (e) {
        console.warn(`  ${date}: ${(e as Error).message}`);
      }
    }
    console.log(`[${league}] recorded ${rows} team-game rows across ${days} game days`);
    grandRows += rows;
  }
  console.log(`\nDone. ${grandRows} team-game rows total.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
