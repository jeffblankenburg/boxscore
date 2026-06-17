// The unit a canonical adapter produces and the canonical renderer
// consumes. A single date's digest reduces to this bundle — games for
// scoreboard/box, standings for tables, leaderboards for the leaders
// strip, transactions for the footer block. Anything outside these four
// sections (rosters, splits, player profiles) belongs in a separate
// bundle when we expand the canonical preview's coverage.

import type {
  MlbGame,
  MlbBoxScore,
  MlbDivisionStandings,
  MlbLeaderboard,
  MlbScoringPlay,
  MlbTransaction,
  MlbWildCardStandings,
} from "./types";

// Canonical display order for any game list (yesterday's results,
// today's slate, the all-star game tile, etc). Sort by startTime
// ascending, then alphabetical by away team abbr as a deterministic
// tiebreaker for games at the same start time. Both adapters call this
// before returning the bundle so the renderer never sees vendor-specific
// ordering noise.
export function sortGamesCanonically(games: MlbGame[]): MlbGame[] {
  return [...games].sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
    return a.awayTeam.abbr.localeCompare(b.awayTeam.abbr);
  });
}

export type CanonicalDailyData = {
  date:         string;                       // ISO YYYY-MM-DD
  games:        MlbGame[];
  boxScores:    Map<number, MlbBoxScore>;     // keyed by game id
  scoringPlays: Map<number, MlbScoringPlay[]>;// keyed by game id
  nextDayGames: MlbGame[];                    // tomorrow's slate (for the "Today's Games" preview)
  standings:    MlbDivisionStandings[];
  wildCard:     MlbWildCardStandings[];       // one entry per league (AL, NL)
  leaderboards: MlbLeaderboard[];
  transactions: MlbTransaction[];
};
