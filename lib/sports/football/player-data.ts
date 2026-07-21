// Orchestrator for football player pages: fetch the ESPN athlete envelope,
// adapt to canonical. Live (no daily_raw cache) — the /[sport]/player/[id]
// route wraps this in ISR (revalidate), mirroring MLB's loadPlayerPageData.

import { footballLeagueConfig, seasonForDate } from "./leagues";
import { fetchAthleteRaw } from "./sources/espn-athlete";
import { adaptAthlete } from "./adapters/athlete-from-espn";
import { yesterdayInET } from "../../dates";
import type { FootballLeague } from "./types";
import type { FootballPlayerPageData } from "./player-canonical";

/**
 * Load a player page for the most relevant season. Defaults to the current
 * season for today's date; if that season has no games yet (the offseason,
 * or the first days of a new season), falls back one year so the page shows
 * the player's most recent real production instead of an empty shell.
 */
export async function loadFootballPlayerData(
  league: FootballLeague,
  athleteId: string,
  seasonHint?: number,
): Promise<FootballPlayerPageData | null> {
  const cfg = footballLeagueConfig(league);
  const season = seasonHint ?? seasonForDate(yesterdayInET());

  const data = adaptAthlete(cfg, await fetchAthleteRaw(cfg, athleteId, season));
  if (!data) return null;

  // The gamelog is the season signal: the overview's statsSummary always
  // reflects the player's latest real season, so it can't tell us whether the
  // *requested* season has been played. An empty gamelog with no explicit
  // season means we're ahead of the schedule (offseason / pre-Week-1) — fall
  // back a year so the page shows the most recent games actually played.
  if (data.sections.length === 0 && seasonHint == null) {
    const prev = adaptAthlete(cfg, await fetchAthleteRaw(cfg, athleteId, season - 1));
    if (prev && prev.sections.length > 0) return prev;
  }
  return data;
}
