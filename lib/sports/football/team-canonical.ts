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

// One roster stat table (Passing / Rushing / …), each row a player with season
// totals-to-date for that unit. `columns` are display headers; each row's
// `values` align to them positionally (the first column is the player name).
export type FootballRosterTable = {
  label: string;
  columns: string[];
  rows: Array<{
    player: { id: string; slug: string; fullName: string };
    values: Array<string | number>;
  }>;
};

// One game on the team's full-season schedule. Completed games carry the
// result; future games carry the kickoff. Vendor-neutral (structurally matches
// the schedule source's TeamScheduleEvent).
export type FootballScheduleEntry = {
  eventId: string;
  isoDate: string;
  week: number | null;
  completed: boolean;
  isHome: boolean;
  opponent: { abbr: string; name: string; location: string | null } | null;
  teamScore: number | null;
  oppScore: number | null;
  won: boolean | null;
  statusDetail: string;
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

  // Point-in-time W-L-T + streak from games played through the page's as-of
  // date (the heading prefers this over the standings row, which ESPN serves
  // only as current). Absent on the cron path, where the bundle IS as-of.
  asOfRecord?: { wins: number; losses: number; ties: number; streak: string };

  lastGame: FootballGame | null;                // most recent completed game
  lastBox: FootballBoxScore | undefined;        // its box score, if graded

  upcoming: FootballGame[];                      // the team's next scheduled games
  teamLeaders: FootballTeamLeaderGroup[];        // team players in the league leaders

  // Live-web-only sections (heavier fetches the nightly cron skips, so the
  // email digest omits them): the full schedule with results, and the roster's
  // season-to-date stat tables aggregated from box scores.
  schedule?: FootballScheduleEntry[];
  roster?: FootballRosterTable[];
};
