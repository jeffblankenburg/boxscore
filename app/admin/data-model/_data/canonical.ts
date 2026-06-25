// Hand-authored description of the canonical MLB data model for the
// /admin/data-model page. This file mirrors lib/sports/mlb/types.ts as
// data so the page can render type-by-type cards without TypeScript
// reflection. When types.ts changes, update this file by hand.
//
// `type` strings use the canonical type names (MlbGame, MlbTeamRef, etc.)
// or primitives ("number", "string | null", "MlbInningLine[]"). The page
// turns TypeName references into anchor links automatically.

export type CanonicalField = {
  name: string;
  type: string;
  notes?: string;
};

export type CanonicalType = {
  name: string;
  kind: "object" | "union" | "alias";
  purpose: string;
  // For "object" kind: fields. For "union": the union members as strings.
  fields?: CanonicalField[];
  unionMembers?: string[];
  aliasOf?: string;
};

export type CanonicalSection = {
  label: string;
  types: CanonicalType[];
};

export const CANONICAL_SECTIONS: CanonicalSection[] = [
  {
    label: "References",
    types: [
      {
        name: "MlbTeamRef",
        kind: "object",
        purpose: "Lightweight team reference used inside game/standings/leader rows.",
        fields: [
          { name: "id", type: "number", notes: "vendor-stable team identifier" },
          { name: "name", type: "string", notes: '"New York Yankees"' },
          { name: "abbr", type: "string", notes: '"NYY"' },
        ],
      },
      {
        name: "MlbPlayerRef",
        kind: "object",
        purpose: "Lightweight player reference used inside leader/decision rows.",
        fields: [
          { name: "id", type: "number", notes: "vendor-stable player identifier" },
          { name: "fullName", type: "string" },
        ],
      },
    ],
  },
  {
    label: "Game",
    types: [
      {
        name: "MlbGameStatus",
        kind: "union",
        purpose: "High-level game state. Adapters map vendor status codes to one of these.",
        unionMembers: ['"scheduled"', '"live"', '"final"', '"postponed"', '"suspended"', '"cancelled"', '"unknown"'],
      },
      {
        name: "MlbGameType",
        kind: "union",
        purpose: "Schedule context (regular season, spring training, postseason round).",
        unionMembers: [
          '"regular"', '"spring"', '"exhibition"', '"all-star"',
          '"wild-card"', '"division-series"', '"lcs"', '"world-series"',
        ],
      },
      {
        name: "MlbInningLine",
        kind: "object",
        purpose: "Runs scored in a single inning of one game.",
        fields: [
          { name: "num", type: "number" },
          { name: "awayRuns", type: "number | null", notes: "null for half-innings not yet played" },
          { name: "homeRuns", type: "number | null" },
        ],
      },
      {
        name: "MlbDecisions",
        kind: "object",
        purpose: "Win/loss/save decisions. Absent fields = decision not awarded.",
        fields: [
          { name: "winner", type: "MlbPlayerRef | null" },
          { name: "loser", type: "MlbPlayerRef | null" },
          { name: "save", type: "MlbPlayerRef | null" },
        ],
      },
      {
        name: "MlbGame",
        kind: "object",
        purpose: "A scheduled MLB game in any state — covers scheduled, in-progress, and final.",
        fields: [
          { name: "id", type: "number" },
          { name: "startTime", type: "string", notes: "ISO datetime" },
          { name: "gameType", type: "MlbGameType" },
          { name: "status", type: "MlbGameStatus" },
          { name: "statusDetail", type: "string", notes: 'vendor-supplied human label ("Final", "Top 7th", "Postponed - Rain")' },
          { name: "awayTeam", type: "MlbTeamRef" },
          { name: "homeTeam", type: "MlbTeamRef" },
          { name: "awayScore", type: "number | null", notes: "null on scheduled games" },
          { name: "homeScore", type: "number | null" },
          { name: "innings", type: "MlbInningLine[]", notes: "empty array on scheduled games" },
          { name: "awayHits", type: "number | null" },
          { name: "homeHits", type: "number | null" },
          { name: "awayErrors", type: "number | null" },
          { name: "homeErrors", type: "number | null" },
          { name: "awayProbablePitcher", type: "MlbPlayerRef | null", notes: "null when TBD or in-progress" },
          { name: "homeProbablePitcher", type: "MlbPlayerRef | null" },
          { name: "decisions", type: "MlbDecisions | null", notes: "all null on non-final games" },
          { name: "venueName", type: "string | null" },
        ],
      },
    ],
  },
  {
    label: "Box score",
    types: [
      {
        name: "MlbBoxBatting",
        kind: "object",
        purpose: "Per-player batting line within a single game.",
        fields: [
          { name: "atBats", type: "number" },
          { name: "runs", type: "number" },
          { name: "hits", type: "number" },
          { name: "rbi", type: "number" },
          { name: "baseOnBalls", type: "number" },
          { name: "strikeOuts", type: "number" },
          { name: "homeRuns", type: "number" },
          { name: "doubles", type: "number" },
          { name: "triples", type: "number" },
          { name: "stolenBases", type: "number" },
          { name: "battingAverage", type: "number | null", notes: "season-to-date through this game" },
          { name: "ops", type: "number | null" },
        ],
      },
      {
        name: "MlbBoxPitching",
        kind: "object",
        purpose: "Per-player pitching line within a single game.",
        fields: [
          { name: "inningsPitched", type: "number", notes: "decimal: 5.2 = 5⅔ innings (vendor convention)" },
          { name: "hits", type: "number" },
          { name: "runs", type: "number" },
          { name: "earnedRuns", type: "number" },
          { name: "baseOnBalls", type: "number" },
          { name: "strikeOuts", type: "number" },
          { name: "homeRuns", type: "number" },
          { name: "pitchesThrown", type: "number" },
          { name: "strikes", type: "number" },
          { name: "battersFaced", type: "number" },
          { name: "era", type: "number | null", notes: "season-to-date through this game" },
        ],
      },
      {
        name: "MlbSeasonBattingSummary",
        kind: "object",
        purpose: "Season-to-date batting summary shown next to a player's game line.",
        fields: [
          { name: "battingAverage", type: "number | null" },
          { name: "ops", type: "number | null" },
        ],
      },
      {
        name: "MlbSeasonPitchingSummary",
        kind: "object",
        purpose: "Season-to-date pitching summary shown next to a player's game line.",
        fields: [
          { name: "era", type: "number | null" },
        ],
      },
      {
        name: "MlbLineupSlot",
        kind: "alias",
        purpose: "Lineup slot for a starting position player. 1–9 = lineup order; null = pitcher/sub.",
        aliasOf: "number | null",
      },
      {
        name: "MlbBoxPlayer",
        kind: "object",
        purpose: "Per-player row in a box score.",
        fields: [
          { name: "player", type: "MlbPlayerRef" },
          { name: "positionAbbr", type: "string", notes: 'primary position ("CF", "SP", "3B")' },
          { name: "jerseyNumber", type: "string | null" },
          { name: "startingOrder", type: "MlbLineupSlot", notes: "lineup order 1–9 for starters; null for pitchers and subs" },
          { name: "isStarter", type: "boolean" },
          { name: "batting", type: "MlbBoxBatting | null", notes: "null for pitchers who didn't bat (AL DH games)" },
          { name: "pitching", type: "MlbBoxPitching | null", notes: "null for non-pitchers" },
          { name: "errors", type: "number", notes: "per-game fielding errors" },
          { name: "seasonErrors", type: "number", notes: "season-to-date fielding errors through this game" },
          { name: "seasonBatting", type: "MlbSeasonBattingSummary | null", notes: "null when source can't hydrate" },
          { name: "seasonPitching", type: "MlbSeasonPitchingSummary | null" },
        ],
      },
      {
        name: "MlbBoxTeamTotals",
        kind: "object",
        purpose: "Team-level totals within a single game.",
        fields: [
          { name: "atBats", type: "number" },
          { name: "runs", type: "number" },
          { name: "hits", type: "number" },
          { name: "homeRuns", type: "number" },
          { name: "baseOnBalls", type: "number" },
          { name: "strikeOuts", type: "number" },
        ],
      },
      {
        name: "MlbBoxTeam",
        kind: "object",
        purpose: "One side of a box score: team identity + lineup + pitchers + totals.",
        fields: [
          { name: "team", type: "MlbTeamRef" },
          { name: "totals", type: "MlbBoxTeamTotals" },
          { name: "batters", type: "MlbBoxPlayer[]", notes: "starters by lineup slot 1–9, then subs by appearance" },
          { name: "pitchers", type: "MlbBoxPlayer[]", notes: "starter first, then relievers by inning of appearance" },
        ],
      },
      {
        name: "MlbBoxInfo",
        kind: "object",
        purpose: "Game-info key/value pair for the box-score footer (attendance, weather, etc.).",
        fields: [
          { name: "label", type: "string" },
          { name: "value", type: "string" },
        ],
      },
      {
        name: "MlbBoxScore",
        kind: "object",
        purpose: "Complete box score for a single completed game.",
        fields: [
          { name: "game", type: "MlbGame" },
          { name: "away", type: "MlbBoxTeam" },
          { name: "home", type: "MlbBoxTeam" },
          { name: "info", type: "MlbBoxInfo[]", notes: "empty when source doesn't carry it" },
        ],
      },
    ],
  },
  {
    label: "Scoring plays",
    types: [
      {
        name: "MlbHalfInning",
        kind: "union",
        purpose: "Which half of an inning a play occurred in.",
        unionMembers: ['"top"', '"bottom"'],
      },
      {
        name: "MlbScoringPlay",
        kind: "object",
        purpose: "A play that resulted in at least one run.",
        fields: [
          { name: "inning", type: "number" },
          { name: "half", type: "MlbHalfInning" },
          { name: "event", type: "string", notes: 'canonical event label ("Home Run", "Double", "Wild Pitch")' },
          { name: "description", type: "string", notes: "human-readable narration" },
          { name: "awayScore", type: "number", notes: "post-play" },
          { name: "homeScore", type: "number", notes: "post-play" },
          { name: "rbi", type: "number" },
        ],
      },
    ],
  },
  {
    label: "Standings",
    types: [
      {
        name: "MlbLeague",
        kind: "union",
        purpose: "MLB league.",
        unionMembers: ['"AL"', '"NL"'],
      },
      {
        name: "MlbDivision",
        kind: "union",
        purpose: "MLB division. Combine with league for full name ('AL East').",
        unionMembers: ['"East"', '"Central"', '"West"'],
      },
      {
        name: "MlbRecord",
        kind: "object",
        purpose: "Win-loss-pct triple used for split records (home, away, last-10).",
        fields: [
          { name: "wins", type: "number" },
          { name: "losses", type: "number" },
          { name: "pct", type: "number" },
        ],
      },
      {
        name: "MlbStandingRow",
        kind: "object",
        purpose: "A single team's standings row.",
        fields: [
          { name: "team", type: "MlbTeamRef" },
          { name: "wins", type: "number" },
          { name: "losses", type: "number" },
          { name: "gamesBehind", type: "number", notes: "0 for the division leader" },
          { name: "divisionRank", type: "number", notes: "1 = division leader" },
          { name: "wildCardRank", type: "number | null", notes: "1–3 in the picture, higher = out; null for division leaders" },
          { name: "wildCardGamesBehind", type: "number | null" },
          { name: "streak", type: "string", notes: '"W3" / "L2" / "-"' },
          { name: "runsScored", type: "number" },
          { name: "runsAllowed", type: "number" },
          { name: "homeRecord", type: "MlbRecord" },
          { name: "awayRecord", type: "MlbRecord" },
          { name: "lastTenRecord", type: "MlbRecord" },
          { name: "leagueRecord", type: "MlbRecord" },
          { name: "clinchedDivision", type: "boolean" },
          { name: "clinchedWildCard", type: "boolean" },
          { name: "eliminatedFromPlayoffs", type: "boolean" },
        ],
      },
      {
        name: "MlbDivisionStandings",
        kind: "object",
        purpose: "Standings grouped by division for the divisional view.",
        fields: [
          { name: "league", type: "MlbLeague" },
          { name: "division", type: "MlbDivision" },
          { name: "teams", type: "MlbStandingRow[]", notes: "sorted by divisionRank ascending" },
        ],
      },
      {
        name: "MlbWildCardStandings",
        kind: "object",
        purpose: "Wild-card standings grouped by league.",
        fields: [
          { name: "league", type: "MlbLeague" },
          { name: "teams", type: "MlbStandingRow[]", notes: "sorted by wildCardRank ascending" },
        ],
      },
    ],
  },
  {
    label: "Leaders",
    types: [
      {
        name: "MlbLeaderCategory",
        kind: "union",
        purpose: "Stat categories the digest tracks. Source adapters map vendor category codes to these.",
        unionMembers: [
          '"battingAverage"', '"homeRuns"', '"runsBattedIn"', '"stolenBases"',
          '"wins"', '"earnedRunAverage"', '"strikeoutsPitching"', '"saves"',
          '"hits"', '"ops"', '"onBasePercentage"', '"sluggingPercentage"',
          '"whip"', '"inningsPitched"',
        ],
      },
      {
        name: "MlbLeaderEntry",
        kind: "object",
        purpose: "One ranked entry in a leaderboard.",
        fields: [
          { name: "rank", type: "number" },
          { name: "value", type: "number", notes: "numeric — formatting is renderer's job" },
          { name: "player", type: "MlbPlayerRef" },
          { name: "team", type: "MlbTeamRef" },
        ],
      },
      {
        name: "MlbLeaderboard",
        kind: "object",
        purpose: "Full leaderboard for one (league, category) pair.",
        fields: [
          { name: "league", type: "MlbLeague" },
          { name: "category", type: "MlbLeaderCategory" },
          { name: "entries", type: "MlbLeaderEntry[]", notes: "sorted by rank ascending" },
        ],
      },
    ],
  },
  {
    label: "Teams meta",
    types: [
      {
        name: "MlbTeam",
        kind: "object",
        purpose: "Static team metadata: identity, league, division, colors.",
        fields: [
          { name: "id", type: "number" },
          { name: "abbr", type: "string" },
          { name: "name", type: "string" },
          { name: "city", type: "string" },
          { name: "league", type: "MlbLeague" },
          { name: "division", type: "MlbDivision" },
          { name: "active", type: "boolean" },
          { name: "primaryColor", type: "string | null" },
          { name: "secondaryColor", type: "string | null" },
        ],
      },
    ],
  },
  {
    label: "Transactions",
    types: [
      {
        name: "MlbTransaction",
        kind: "object",
        purpose: "A single roster transaction (signing, trade, IL move, etc.).",
        fields: [
          { name: "date", type: "string", notes: "ISO date" },
          { name: "typeLabel", type: "string", notes: 'vendor short label ("Trade", "15-Day IL"); display-only' },
          { name: "description", type: "string", notes: "vendor's free-text; use for display" },
          { name: "player", type: "MlbPlayerRef | null" },
          { name: "fromTeam", type: "MlbTeamRef | null" },
          { name: "toTeam", type: "MlbTeamRef | null" },
        ],
      },
    ],
  },
  {
    label: "Roster + season stats",
    types: [
      {
        name: "MlbHittingSeason",
        kind: "object",
        purpose: "Season-to-date hitting stat line for a roster player.",
        fields: [
          { name: "gamesPlayed", type: "number" },
          { name: "plateAppearances", type: "number" },
          { name: "atBats", type: "number" },
          { name: "runs", type: "number" },
          { name: "hits", type: "number" },
          { name: "doubles", type: "number" },
          { name: "triples", type: "number" },
          { name: "homeRuns", type: "number" },
          { name: "rbi", type: "number" },
          { name: "baseOnBalls", type: "number" },
          { name: "strikeOuts", type: "number" },
          { name: "stolenBases", type: "number" },
          { name: "battingAverage", type: "number | null" },
          { name: "onBasePercentage", type: "number | null" },
          { name: "sluggingPercentage", type: "number | null" },
          { name: "ops", type: "number | null" },
          { name: "babip", type: "number | null" },
        ],
      },
      {
        name: "MlbPitchingSeason",
        kind: "object",
        purpose: "Season-to-date pitching stat line for a roster player.",
        fields: [
          { name: "gamesPlayed", type: "number" },
          { name: "gamesStarted", type: "number" },
          { name: "wins", type: "number" },
          { name: "losses", type: "number" },
          { name: "saves", type: "number" },
          { name: "inningsPitched", type: "number" },
          { name: "strikeOuts", type: "number" },
          { name: "baseOnBalls", type: "number" },
          { name: "earnedRuns", type: "number" },
          { name: "hits", type: "number" },
          { name: "homeRuns", type: "number" },
          { name: "era", type: "number | null" },
          { name: "whip", type: "number | null" },
          { name: "babip", type: "number | null" },
          { name: "strikeoutsPer9Inn", type: "number | null" },
          { name: "walksPer9Inn", type: "number | null" },
        ],
      },
      {
        name: "MlbRosterPlayer",
        kind: "object",
        purpose: "A roster entry with optional hitting and pitching season totals.",
        fields: [
          { name: "player", type: "MlbPlayerRef" },
          { name: "jerseyNumber", type: "string | null" },
          { name: "positionAbbr", type: "string" },
          { name: "hitting", type: "MlbHittingSeason | null" },
          { name: "pitching", type: "MlbPitchingSeason | null" },
        ],
      },
      {
        name: "MlbTeamRoster",
        kind: "object",
        purpose: "Active roster for a single team, with player season stats hydrated.",
        fields: [
          { name: "teamId", type: "number" },
          { name: "players", type: "MlbRosterPlayer[]" },
        ],
      },
    ],
  },
  {
    label: "Player profile + splits",
    types: [
      {
        name: "MlbPlayer",
        kind: "object",
        purpose: "Static profile for a single player.",
        fields: [
          { name: "id", type: "number" },
          { name: "fullName", type: "string" },
          { name: "primaryPositionAbbr", type: "string" },
          { name: "jerseyNumber", type: "string | null", notes: "rendered on player detail page header" },
          { name: "active", type: "boolean" },
          { name: "currentTeam", type: "MlbTeamRef | null" },
        ],
      },
      {
        name: "MlbGameLogEntry",
        kind: "object",
        purpose: "One game in a player's per-game log.",
        fields: [
          { name: "date", type: "string", notes: "ISO date" },
          { name: "gameId", type: "number" },
          { name: "isHome", type: "boolean" },
          { name: "isWin", type: "boolean | null", notes: "null when no decision or not a pitcher" },
          { name: "isLoss", type: "boolean | null" },
          { name: "team", type: "MlbTeamRef" },
          { name: "opponent", type: "MlbTeamRef" },
          { name: "batting", type: "MlbBoxBatting | null" },
          { name: "pitching", type: "MlbBoxPitching | null" },
        ],
      },
      {
        name: "MlbSplitsBundle",
        kind: "object",
        purpose: "A player's season totals + per-game log for one stat group (hitting or pitching).",
        fields: [
          { name: "group", type: '"hitting" | "pitching"' },
          { name: "hittingSeason", type: "MlbHittingSeason | null" },
          { name: "pitchingSeason", type: "MlbPitchingSeason | null" },
          { name: "gameLog", type: "MlbGameLogEntry[]", notes: "most-recent-first" },
        ],
      },
    ],
  },
  {
    label: "Fielding",
    types: [
      {
        name: "MlbFieldingSplit",
        kind: "object",
        purpose: "Fielding totals for one position the player has appeared at this season. statsapi returns one row per position (Judge: RF + DH); SDIO collapses to a single primary-position row.",
        fields: [
          { name: "positionAbbr", type: "string" },
          { name: "games", type: "number" },
          { name: "gamesStarted", type: "number" },
          { name: "innings", type: "number" },
          { name: "chances", type: "number" },
          { name: "putOuts", type: "number" },
          { name: "assists", type: "number" },
          { name: "errors", type: "number" },
          { name: "doublePlays", type: "number" },
          { name: "fieldingPercentage", type: "number | null" },
        ],
      },
    ],
  },
  {
    label: "Source contract",
    types: [
      {
        name: "MlbSource",
        kind: "object",
        purpose: "Contract every source adapter implements. Call sites consume canonical types and never see vendor schemas — adapters in lib/sports/mlb/sources/* are the only code that touches vendor-shaped data.",
        fields: [
          { name: "id", type: '"statsapi" | "sportsdata"', notes: "readonly source identifier" },
          { name: "getSchedule(date)", type: "Promise<MlbGame[]>" },
          { name: "getScheduleRange(startDate, endDate)", type: "Promise<MlbGame[]>" },
          { name: "getBoxScoresForDate(date)", type: "Promise<Map<number, MlbBoxScore>>", notes: "bulk — one call returns all games for the date" },
          { name: "getScoringPlays(gameId)", type: "Promise<MlbScoringPlay[]>" },
          { name: "getStandings(season, date)", type: "Promise<MlbDivisionStandings[]>" },
          { name: "getWildCardStandings(season, date)", type: "Promise<MlbWildCardStandings[]>" },
          { name: "getLeaders(category, season, league, limit)", type: "Promise<MlbLeaderEntry[]>" },
          { name: "getProbablePitcherRecord(personId, season)", type: "Promise<{wins, losses, era} | null>" },
          { name: "getTeams(season)", type: "Promise<MlbTeam[]>" },
          { name: "getTransactions(date)", type: "Promise<MlbTransaction[]>" },
          { name: "getTeamRoster(teamId, season)", type: "Promise<MlbTeamRoster>" },
          { name: "getPlayer(personId)", type: "Promise<MlbPlayer | null>" },
          { name: "getSplits(personId, season, group)", type: "Promise<MlbSplitsBundle>" },
          { name: "getFielding(personId, season)", type: "Promise<MlbFieldingSplit[]>" },
        ],
      },
    ],
  },
];

// Flat lookup: canonical type name → section/index, so the page can resolve
// type-name references in field types and turn them into anchor links.
export const CANONICAL_TYPE_NAMES: Set<string> = new Set(
  CANONICAL_SECTIONS.flatMap((s) => s.types.map((t) => t.name))
);
