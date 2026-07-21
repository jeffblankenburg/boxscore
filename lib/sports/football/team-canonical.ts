// Canonical model for a football team page. Composed from the daily bundle
// (standings/leaders/box, all already fetched + cached) plus the team's most
// recent completed game located via the schedule endpoint. The renderer
// (./render/team.ts) reuses the daily digest's game-block and standings-group
// renderers, so it needs the full bundle alongside the picked pieces.

import type { CanonicalFootballDailyData } from "./canonical";
import type {
  FootballLeague,
  FootballGame,
  FootballBoxScore,
  FootballStandingsGroup,
  FootballStandingsRow,
  FootballLeaderEntry,
} from "./types";

export type FootballTeamLeaderGroup = {
  label: string;                 // "Passing Yards"
  entries: FootballLeaderEntry[]; // this team's players in that league leaderboard
};

export type FootballTeamPageData = {
  league: FootballLeague;
  slug: string;                  // canonical team slug (lib/teams.ts)
  name: string;                  // "Buffalo Bills"
  abbr: string;                  // canonical abbreviation ("BUF")

  // The daily bundle at the last-game date — kept whole so the renderer can
  // call the shared renderGameBlock/renderStandingsGroup helpers.
  bundle: CanonicalFootballDailyData;

  divisionGroup: FootballStandingsGroup | null; // the team's division block
  record: FootballStandingsRow | null;          // the team's own standings row
  divisionRank: number | null;                  // 1-based place within the division

  lastGame: FootballGame | null;                // most recent completed game
  lastBox: FootballBoxScore | undefined;        // its box score, if graded

  upcoming: FootballGame[];                      // the team's next scheduled games
  teamLeaders: FootballTeamLeaderGroup[];        // team players in the league leaders
};
