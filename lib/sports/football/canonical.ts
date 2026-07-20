// The unit a canonical football adapter produces and the canonical
// football renderer consumes. A single date's digest reduces to this
// bundle — games for the scoreboard/box, boxScores for the per-game
// tables, rankings for the NCAAF poll header, standings for the tables.
//
// Shared by NFL and NCAAF; `league` distinguishes them and controls which
// optional sections (rankings, conference standings) the renderer shows.
// Mirrors lib/sports/mlb/canonical.ts in spirit; the football-specific
// concepts (quarters, drives, polls) live in ./types.

import type {
  FootballLeague,
  FootballGame,
  FootballBoxScore,
  FootballRanking,
  FootballStandingsGroup,
} from "./types";

export type CanonicalFootballDailyData = {
  date:      string;                        // ISO YYYY-MM-DD (the day being recapped)
  league:    FootballLeague;
  games:     FootballGame[];                // every game whose local date is `date`
  boxScores: Map<string, FootballBoxScore>; // keyed by game id; only finals/in-progress
  rankings:  FootballRanking[];             // NCAAF polls; empty for NFL
  standings: FootballStandingsGroup[];      // division (NFL) / conference (NCAAF) groups
};

// Canonical display order for a game list. Sort by start time ascending,
// then by away-team abbreviation as a deterministic tiebreaker for the
// many simultaneous kickoffs (1pm ET Sundays, noon-ET Saturdays). The
// adapter calls this before returning so the renderer never sees vendor
// ordering noise.
export function sortGamesCanonically(games: FootballGame[]): FootballGame[] {
  return [...games].sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
    return a.awayTeam.abbr.localeCompare(b.awayTeam.abbr);
  });
}
