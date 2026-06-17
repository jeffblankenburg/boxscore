// Canonical MLB data model for boxscore.email. Source-agnostic — the same
// types come back whether the underlying feed is statsapi.mlb.com or
// SportsDataIO. Adapters in ./sources/* are the only code that touches
// vendor-shaped data; everything downstream (daily.ts, renderers, page
// handlers) consumes these types and never sees a vendor schema.
//
// Design principles:
//   - Field names are domain words, not vendor words ("abbr" not "Key"
//     or "abbreviation"; "id" not "gamePk" or "GameID").
//   - One-level-deep references where statsapi nested two: the canonical
//     shape is `game.awayTeam.id`, not `game.teams.away.team.id`.
//   - Stats are numbers in the model. Formatting to strings ("3.42",
//     ".289") happens at the renderer, not here.
//   - Lineup is an ordered array, not a keyed map. statsapi's
//     `players["ID592450"]` shape is a vendor artifact, not a domain shape.
//   - League / division are display strings ("AL East") not numeric IDs
//     unique to one vendor.
//   - When a value can legitimately be absent (probable pitcher TBD,
//     decision not yet made), it's `null` — not `undefined`. Easier to
//     reason about in JSON round-trips through daily_raw.

// ─── Reference types ──────────────────────────────────────────────────────

/** Lightweight team reference used inside game/standings/leader rows.
 *  `id` is the CANONICAL slug from lib/teams.ts ("nyy", "cws", "lad") —
 *  source-agnostic. Vendor team ids never make it past the adapter
 *  boundary. Adapters resolve via canonicalTeamSlugForRef. */
export type MlbTeamRef = {
  id: string;       // canonical slug — matches lib/teams.ts Team.slug
  name: string;     // "New York Yankees"
  abbr: string;     // "NYY"
};

/** Lightweight player reference used inside leader/decision rows.
 *  TODO: build a canonical player registry (cross-vendor id mapping)
 *  and rename this to a slug-style canonical id, mirroring MlbTeamRef.
 *  Today the id is the vendor's player id — the only field we leak
 *  through canonical from the adapter, and the reason cross-vendor
 *  player matching in the diff is brittle. */
export type MlbPlayerRef = {
  /** Canonical player slug — the `name_slug` value from the players
   *  table. Cross-vendor; both statsapi and SDIO adapters resolve their
   *  native PlayerID to this slug at the canonical boundary. Used as
   *  the URL component for /mlb/player/{slug}. */
  id: string;
  fullName: string;
  /** MLBAMID, populated for any player we have in the players table.
   *  Null only for players the lookup didn't resolve (e.g. a SDIO sub
   *  we haven't backfilled yet). Used by the legacy DailyData bridge
   *  to populate its numeric playerId; once that bridge is deleted the
   *  field can come out. */
  mlbId?: number | null;
};

/** Probable starting pitcher with season-to-date W-L and ERA. Renderer
 *  shows the trailing "(W-L, ERA)" pair after the pitcher's name in the
 *  Today's Games strip. Any stat is null when the pitcher has no stats
 *  yet — rookie callups, opening day, etc. */
export type MlbProbablePitcher = MlbPlayerRef & {
  wins:   number | null;
  losses: number | null;
  era:    number | null;
};

// ─── Game (schedule entry — covers scheduled, in-progress, and final) ─────

export type MlbGameStatus =
  | "scheduled"     // future / today, not started
  | "live"          // in progress
  | "final"         // completed
  | "postponed"
  | "suspended"
  | "cancelled"
  | "unknown";

export type MlbGameType =
  | "regular"
  | "spring"
  | "exhibition"
  | "all-star"
  | "wild-card"
  | "division-series"
  | "lcs"
  | "world-series";

/** A run scored in a single half-inning. */
export type MlbInningLine = {
  num: number;
  awayRuns: number | null;     // null for half-innings not yet played
  homeRuns: number | null;
};

/** Win/loss/save decisions; absent fields = decision not awarded. */
export type MlbDecisions = {
  winner: MlbPlayerRef | null;
  loser: MlbPlayerRef | null;
  save: MlbPlayerRef | null;
};

/** A scheduled MLB game in any state. */
export type MlbGame = {
  id: number;
  startTime: string;            // ISO datetime
  gameType: MlbGameType;
  status: MlbGameStatus;
  statusDetail: string;         // vendor-supplied human label ("Final", "Top 7th", "Postponed - Rain")

  awayTeam: MlbTeamRef;
  homeTeam: MlbTeamRef;

  // Final / in-progress score. Both null on scheduled games.
  awayScore: number | null;
  homeScore: number | null;

  // Linescore. Empty array on scheduled games. R/H/E totals from the
  // teams stats line — separate from the per-inning runs.
  innings: MlbInningLine[];
  awayHits: number | null;
  homeHits: number | null;
  awayErrors: number | null;
  homeErrors: number | null;

  // Probable starters for scheduled games. Null when TBD or in-progress
  // (use boxscore for in-progress starters). Carries season W-L + ERA
  // so the Today's Games strip can render "LastName (W-L, ERA)".
  awayProbablePitcher: MlbProbablePitcher | null;
  homeProbablePitcher: MlbProbablePitcher | null;

  // Decisions. All null on non-final games.
  decisions: MlbDecisions | null;

  venueName: string | null;
};

// ─── Box score ────────────────────────────────────────────────────────────

/** Per-player batting line within a single game. */
export type MlbBoxBatting = {
  atBats: number;
  runs: number;
  hits: number;
  rbi: number;
  baseOnBalls: number;
  strikeOuts: number;
  homeRuns: number;
  doubles: number;
  triples: number;
  stolenBases: number;
  battingAverage: number | null;    // season-to-date avg through this game
  ops: number | null;
};

/** Per-player pitching line within a single game. */
export type MlbBoxPitching = {
  inningsPitched: number;           // decimal: 5.2 = 5⅔ innings (statsapi/SDIO convention)
  hits: number;
  runs: number;
  earnedRuns: number;
  baseOnBalls: number;
  strikeOuts: number;
  homeRuns: number;
  pitchesThrown: number;
  strikes: number;
  battersFaced: number;
  era: number | null;               // season-to-date ERA through this game
  /** Pre-formatted decision note: "(W, 2-1)", "(L, 0-3)", "(S, 7)", "(H, 4)",
   *  "(BS, 2)". Renders next to the pitcher's name in the box score. Null
   *  when no decision applied. Sources that don't carry it (SDIO) leave null. */
  decisionNote: string | null;
};

/** Season-to-date batting summary shown next to a player's game line.
 *  The counting stats (doubles / triples / homeRuns / stolenBases) are
 *  used by the renderer's "Player (N)" running-total annotation in the
 *  box-score extras block. Sources that don't carry season counting
 *  stats on the box-score line leave them at 0 — the renderer renders
 *  `Player (0)` rather than crashing. */
export type MlbSeasonBattingSummary = {
  battingAverage: number | null;
  ops: number | null;
  doubles: number;
  triples: number;
  homeRuns: number;
  stolenBases: number;
  rbi: number;
};

/** Season-to-date pitching summary shown next to a player's game line.
 *  Wins/losses/saves let decision-pitcher labels render "Wacha (4-5)"
 *  for W/L and "Clase (12)" for SV without a separate lookup. */
export type MlbSeasonPitchingSummary = {
  era:    number | null;
  wins:   number | null;
  losses: number | null;
  saves:  number | null;
};

/** Lineup slot for a starting position player. 1–9 = lineup order; null = pitcher/sub. */
export type MlbLineupSlot = number | null;

/** Per-player row in a box score. */
export type MlbBoxPlayer = {
  player: MlbPlayerRef;
  positionAbbr: string;            // primary position abbreviation ("CF", "SP", "3B")
  jerseyNumber: string | null;

  /** Lineup order 1-9 for starting position players; null for pitchers and substitutes. */
  startingOrder: MlbLineupSlot;
  /** True if this player started the game (in starting lineup or starting pitcher). */
  isStarter: boolean;

  /** Every position the player played in this game, in appearance order
   *  ("CF", then "LF" after a switch). Empty/null when source only carries
   *  the primary position — renderer falls back to positionAbbr. */
  allPositionsAbbr: string[] | null;

  batting: MlbBoxBatting | null;    // null for pitchers who didn't bat (AL DH games)
  pitching: MlbBoxPitching | null;  // null for non-pitchers

  /** Season-to-date averages shown beside the game line. Null when source can't hydrate. */
  seasonBatting: MlbSeasonBattingSummary | null;
  seasonPitching: MlbSeasonPitchingSummary | null;
};

/** Team-level totals within a single game. */
export type MlbBoxTeamTotals = {
  atBats: number;
  runs: number;
  hits: number;
  rbi: number;
  homeRuns: number;
  baseOnBalls: number;
  strikeOuts: number;
};

/** One side of a box score: team identity + lineup + pitchers + totals. */
export type MlbBoxTeam = {
  team: MlbTeamRef;
  totals: MlbBoxTeamTotals;
  /** Batters in display order: starters by lineup slot 1–9, then substitutes by appearance. */
  batters: MlbBoxPlayer[];
  /** Pitchers in display order: starter first, then relievers by inning of appearance. */
  pitchers: MlbBoxPlayer[];
};

/** Game-info key/value pair for the box-score footer (attendance, weather, etc.). */
export type MlbBoxInfo = { label: string; value: string };

/** Complete box score for a single completed game. */
export type MlbBoxScore = {
  game: MlbGame;
  away: MlbBoxTeam;
  home: MlbBoxTeam;
  /** Game-info rows (start time, attendance, weather, umps). Empty when source doesn't carry it. */
  info: MlbBoxInfo[];
};

// ─── Scoring plays ────────────────────────────────────────────────────────

export type MlbHalfInning = "top" | "bottom";

/** A play that resulted in at least one run. */
export type MlbScoringPlay = {
  inning: number;
  half: MlbHalfInning;
  event: string;              // canonical event label ("Home Run", "Double", "Wild Pitch")
  description: string;        // human-readable narration
  awayScore: number;          // post-play
  homeScore: number;          // post-play
  rbi: number;
};

// ─── Standings ────────────────────────────────────────────────────────────

export type MlbLeague = "AL" | "NL";
export type MlbDivision = "East" | "Central" | "West";

/** Win-loss-pct triple used for split records (home, away, last-10). */
export type MlbRecord = { wins: number; losses: number; pct: number };

/** A single team's standings row. */
export type MlbStandingRow = {
  team: MlbTeamRef;
  wins: number;
  losses: number;
  /** Games behind division leader. 0 for the leader. */
  gamesBehind: number;
  /** Division rank (1 = division leader). */
  divisionRank: number;
  /** Wild-card rank (1–3 in the picture, higher means out). Null for division leaders. */
  wildCardRank: number | null;
  /** Games behind the wild-card line. Null when not applicable. */
  wildCardGamesBehind: number | null;
  /** "W3" / "L2" / "-" — vendor-supplied display string. */
  streak: string;
  runsScored: number;
  runsAllowed: number;
  homeRecord: MlbRecord;
  awayRecord: MlbRecord;
  lastTenRecord: MlbRecord;
  leagueRecord: MlbRecord;
  clinchedDivision: boolean;
  clinchedWildCard: boolean;
  eliminatedFromPlayoffs: boolean;
};

/** Standings grouped by division for the divisional view. */
export type MlbDivisionStandings = {
  league: MlbLeague;
  division: MlbDivision;
  teams: MlbStandingRow[];    // sorted by divisionRank ascending
};

/** Wild-card standings grouped by league. */
export type MlbWildCardStandings = {
  league: MlbLeague;
  teams: MlbStandingRow[];    // sorted by wildCardRank ascending
};

// ─── Leaders ──────────────────────────────────────────────────────────────

/** Stat categories the digest tracks. Source adapters map vendor category codes to these. */
export type MlbLeaderCategory =
  | "battingAverage"
  | "homeRuns"
  | "runsBattedIn"
  | "stolenBases"
  | "wins"
  | "earnedRunAverage"
  | "strikeoutsPitching"
  | "saves"
  | "hits"
  | "ops"
  | "onBasePercentage"
  | "sluggingPercentage"
  | "whip"
  | "inningsPitched";

/** One ranked entry in a leaderboard. */
export type MlbLeaderEntry = {
  rank: number;
  value: number;              // numeric — formatting (3-decimal avg vs. integer HR) is renderer's job
  player: MlbPlayerRef;
  team: MlbTeamRef;
};

/** Full leaderboard for one (league, category) pair. */
export type MlbLeaderboard = {
  league: MlbLeague;
  category: MlbLeaderCategory;
  entries: MlbLeaderEntry[];   // sorted by rank ascending
};

// ─── Teams meta ───────────────────────────────────────────────────────────

/** Static team metadata: identity, league, division, colors, coaches. */
export type MlbTeam = {
  id: number;
  abbr: string;
  name: string;
  city: string;
  league: MlbLeague;
  division: MlbDivision;
  active: boolean;
  primaryColor: string | null;
  secondaryColor: string | null;
};

// ─── Transactions ────────────────────────────────────────────────────────

/** A single roster transaction (signing, trade, IL move, etc.). */
export type MlbTransaction = {
  date: string;                // ISO date
  /** Vendor's short type label ("Trade", "Free Agent Signing", "15-Day IL"). Display-only. */
  typeLabel: string;
  /** Vendor's free-text description. Always present; use this for display. */
  description: string;
  player: MlbPlayerRef | null;
  fromTeam: MlbTeamRef | null;
  toTeam: MlbTeamRef | null;
};

// ─── Roster + season stats ───────────────────────────────────────────────

/** Season-to-date hitting stat line for a roster player. */
export type MlbHittingSeason = {
  gamesPlayed: number;
  plateAppearances: number;
  atBats: number;
  runs: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  rbi: number;
  baseOnBalls: number;
  strikeOuts: number;
  stolenBases: number;
  battingAverage: number | null;
  onBasePercentage: number | null;
  sluggingPercentage: number | null;
  ops: number | null;
  babip: number | null;
};

/** Season-to-date pitching stat line for a roster player. */
export type MlbPitchingSeason = {
  gamesPlayed: number;
  gamesStarted: number;
  wins: number;
  losses: number;
  saves: number;
  inningsPitched: number;
  strikeOuts: number;
  baseOnBalls: number;
  earnedRuns: number;
  hits: number;
  homeRuns: number;
  era: number | null;
  whip: number | null;
  babip: number | null;
  strikeoutsPer9Inn: number | null;
  walksPer9Inn: number | null;
};

/** A roster entry with optional hitting and pitching season totals. */
export type MlbRosterPlayer = {
  player: MlbPlayerRef;
  jerseyNumber: string | null;
  positionAbbr: string;
  hitting: MlbHittingSeason | null;
  pitching: MlbPitchingSeason | null;
};

/** Active roster for a single team, with player season stats hydrated. */
export type MlbTeamRoster = {
  teamId: number;
  players: MlbRosterPlayer[];
};

// ─── Player profile + game log + splits ──────────────────────────────────

/** Static profile for a single player. */
export type MlbPlayer = {
  id: number;
  fullName: string;
  primaryPositionAbbr: string;
  jerseyNumber: string | null;
  active: boolean;
  currentTeam: MlbTeamRef | null;
};

/** One game in a player's per-game log. */
export type MlbGameLogEntry = {
  date: string;                 // ISO date
  gameId: number;
  isHome: boolean;
  /** Pitcher's win/loss on this date; null when no decision or not a pitcher. */
  isWin: boolean | null;
  isLoss: boolean | null;
  team: MlbTeamRef;
  opponent: MlbTeamRef;
  batting: MlbBoxBatting | null;
  pitching: MlbBoxPitching | null;
};

/** A player's season totals + per-game log for one stat group (hitting or pitching). */
export type MlbSplitsBundle = {
  group: "hitting" | "pitching";
  /** Season totals — typed as the right summary for the group; null when the player didn't play. */
  hittingSeason: MlbHittingSeason | null;
  pitchingSeason: MlbPitchingSeason | null;
  gameLog: MlbGameLogEntry[];   // most-recent-first
};

// ─── Fielding ────────────────────────────────────────────────────────────

/** Fielding totals for one position the player has appeared at this season.
 *
 * statsapi.mlb.com returns one row per position (Judge: RF + DH).
 * SportsDataIO carries only Errors and DoublePlays attached to the player's
 * single primary Position, with no per-position splits — SDIO adapter
 * returns a single-element array (the primary position) with putOuts /
 * assists / chances / fielding all zero/null. Renderer should treat
 * zero-innings rows as a known degradation, not real data. */
export type MlbFieldingSplit = {
  positionAbbr: string;
  games: number;
  gamesStarted: number;
  innings: number;
  chances: number;
  putOuts: number;
  assists: number;
  errors: number;
  doublePlays: number;
  fieldingPercentage: number | null;
};

// ─── Source interface ─────────────────────────────────────────────────────
// Each source adapter (statsapi.ts, sportsdata.ts) implements this. The
// facade picks a source based on admin_settings.mlb_feed and returns it
// to the caller — call sites pass the source object through rather than
// re-querying admin_settings inside each function.

export type MlbSource = {
  readonly id: "statsapi" | "sportsdata";

  // Schedule + box scores
  getSchedule(date: string): Promise<MlbGame[]>;
  getScheduleRange(startDate: string, endDate: string): Promise<MlbGame[]>;
  /** Bulk box scores for a date — one call, returns a map keyed by game id. */
  getBoxScoresForDate(date: string): Promise<Map<number, MlbBoxScore>>;
  getScoringPlays(gameId: number): Promise<MlbScoringPlay[]>;

  // Standings
  getStandings(season: number, date: string): Promise<MlbDivisionStandings[]>;
  getWildCardStandings(season: number, date: string): Promise<MlbWildCardStandings[]>;

  // Leaders + player season stats
  getLeaders(category: MlbLeaderCategory, season: number, league: MlbLeague, limit: number): Promise<MlbLeaderEntry[]>;
  /** Season W/L for a probable pitcher. Returns null if the player has no stats yet. */
  getProbablePitcherRecord(personId: number, season: number): Promise<{ wins: number; losses: number; era: number | null } | null>;

  // Teams meta
  getTeams(season: number): Promise<MlbTeam[]>;

  // Transactions
  getTransactions(date: string): Promise<MlbTransaction[]>;

  // Roster + splits + profile + fielding
  getTeamRoster(teamId: number, season: number): Promise<MlbTeamRoster>;
  getPlayer(personId: number): Promise<MlbPlayer | null>;
  getSplits(personId: number, season: number, group: "hitting" | "pitching"): Promise<MlbSplitsBundle>;
  getFielding(personId: number, season: number): Promise<MlbFieldingSplit[]>;
};
