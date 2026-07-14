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

// All-Star rosters for the "all-star-preview" edition (day before the ASG).
// Each player carries a display-ready first-half season line — the ASG game's
// own boxscore seasonStats is just the game line, so these come from a real
// per-player season-stats fetch at raw-build time. Rate stats stay as display
// strings (".247", "2.21") like the rest of the canonical model.
export type AsgHitter = {
  name: string; mlbId: number | null; pos: string; team: string; // team = abbreviation
  order: number | null; // 1-9 batting-order slot once the lineup is announced; null = reserve
  hr: number | null; rbi: number | null; ab: number | null;
  avg: string | null; ops: string | null;
};
export type AsgPitcher = {
  name: string; mlbId: number | null; role: "SP" | "RP"; team: string; // role derived from gamesStarted
  starter: boolean; // true = announced ASG starting pitcher
  ip: string | null; er: number | null; bb: number | null; k: number | null; era: string | null;
};
export type AsgSide = { hitters: AsgHitter[]; pitchers: AsgPitcher[] };
export type AsgRosters = { AL: AsgSide; NL: AsgSide };

// All-Star Game MVP (Ted Williams Award) — present on the recap edition once
// statsapi records the recipient.
export type AsgMvp = { name: string; mlbId: number | null };

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
  // Present only on the day before the All-Star Game (all-star-preview mode).
  allStarRosters?: AsgRosters | null;
  // Present on the All-Star recap edition once the MVP is recorded.
  allStarMvp?: AsgMvp | null;
};
