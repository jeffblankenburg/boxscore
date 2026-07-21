// Per-league football config — the only place NFL-vs-NCAAF specifics that
// aren't game data live. Pure config: the ESPN slug, how to compute the
// season year for a date, the scoreboard query knobs, and whether the
// league has poll rankings. Everything else is shared canonical code.
//
// Parallels lib/nba.ts (which does the same for the two basketball
// leagues). The fetch layer (./sources/espn.ts) and adapter read these.

import type { FootballLeague } from "./types";

export type FootballLeagueConfig = {
  league: FootballLeague;
  /** ESPN's path slug under /sports/football/{slug}/. */
  espnSlug: "nfl" | "college-football";
  name: string;
  /** ESPN scoreboard `groups` filter. 80 = FBS (I-A) for college; NFL
   *  needs no group filter. */
  scoreboardGroups: number | null;
  /** How many events to request per scoreboard page. NFL tops out ~16 a
   *  day; a full FBS Saturday is ~60–80, so college asks for more. */
  scoreboardLimit: number;
  /** NCAAF has AP/CFP/Coaches polls; the NFL has none. */
  hasRankings: boolean;
  /** ESPN standings grouping depth. 3 = divisions (NFL: AFC East, …);
   *  omitted = the feed's default, which is conference-level for both
   *  leagues (right for NCAAF, which has no divisions). */
  standingsLevel?: number;
};

// ESPN labels both football seasons by their START year: the 2025 season
// runs Sept 2025 → Feb 2026 and is season.year 2025 throughout. So a date
// in Jan/Feb belongs to the PRIOR calendar year's season; every other
// month (including the Mar–Jul offseason, which looks ahead to the coming
// season) resolves to its own calendar year.
export function seasonForDate(date: string): number {
  const [yearStr, monthStr] = date.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  return month <= 2 ? year - 1 : year;
}

export const NFL: FootballLeagueConfig = {
  league: "nfl",
  espnSlug: "nfl",
  name: "NFL",
  scoreboardGroups: null,
  scoreboardLimit: 100,
  hasRankings: false,
  standingsLevel: 3, // divisions (AFC/NFC × East/North/South/West)
};

export const NCAAF: FootballLeagueConfig = {
  league: "ncaaf",
  espnSlug: "college-football",
  name: "College Football",
  scoreboardGroups: 80, // FBS
  scoreboardLimit: 300,
  hasRankings: true,
};

export const FOOTBALL_LEAGUES: Record<FootballLeague, FootballLeagueConfig> = {
  nfl: NFL,
  ncaaf: NCAAF,
};

export function footballLeagueConfig(league: FootballLeague): FootballLeagueConfig {
  return FOOTBALL_LEAGUES[league];
}
