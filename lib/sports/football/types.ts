// Canonical football data model for boxscore.email. Source-agnostic and
// shared by both gridiron leagues — NFL and NCAAF (FBS) come back as the
// same types. Adapters in ./adapters/* are the only code that touches
// vendor-shaped data (ESPN today, SportsDataIO once revenue funds the
// feed); everything downstream — the orchestrator, renderers, page
// handlers — consumes these types and never sees a vendor schema.
//
// The two leagues differ in exactly three places, all modeled as optional
// fields rather than separate types:
//   - NCAAF teams carry a poll `rank` and a `conference`; NFL teams don't.
//   - NCAAF has AP/CFP/Coaches ranking tables; NFL has none.
//   - Season/postseason vocabulary ("bowl", "CFP" vs "wild-card",
//     "super-bowl") differs, captured in FootballSeasonType.
//
// Design principles (inherited from the MLB canonical model in
// lib/sports/mlb/types.ts):
//   - Field names are domain words, not vendor words ("abbr" not ESPN's
//     "abbreviation"; "yards" not "displayValue").
//   - Stats are numbers in the model. Compound vendor strings ("17/32",
//     "1-8", "7-14") are split into their numeric parts here so the
//     renderer never re-parses. Formatting back to display strings
//     happens at the renderer.
//   - When a value can legitimately be absent (QBR before a game, poll
//     rank for an unranked team, weather indoors) it's `null`, not
//     `undefined` — cleaner JSON round-trips through daily_raw.

// ─── League + reference types ─────────────────────────────────────────────

/** Which gridiron league a bundle describes. Drives the ESPN slug, the
 *  season-year math, and whether rankings/conferences are populated. */
export type FootballLeague = "nfl" | "ncaaf";

/** Lightweight team reference used inside game/box/ranking rows.
 *
 *  `id` is the CANONICAL slug — source-agnostic, matching lib/teams.ts
 *  Team.slug. For the NFL's 32 teams the adapter resolves ESPN's
 *  abbreviation to a hand-maintained slug. For NCAAF's 130+ FBS teams a
 *  full hand-built registry is impractical for a first pass, so the slug
 *  is derived deterministically from ESPN's abbreviation (lowercased);
 *  `espnId` is kept as provenance so a real cross-vendor registry can
 *  backfill slugs later without reprocessing history. */
export type FootballTeamRef = {
  id: string;        // canonical slug — matches lib/teams.ts Team.slug
  name: string;      // "Dallas Cowboys" / "Georgia Bulldogs"
  abbr: string;      // "DAL" / "UGA"
  espnId: string;    // vendor id, kept for provenance / future slug backfill

  // NCAAF only. null/absent for NFL and for unranked college teams.
  rank?: number | null;          // AP/CFP curated rank at kickoff (1–25)
  conference?: string | null;    // "SEC", "Big Ten", … (display string)
};

/** Player reference inside a box-score stat row. `id` is ESPN's athlete
 *  id today — the one vendor value we leak through canonical, mirroring
 *  the MLB model's honest note that a cross-vendor player registry
 *  doesn't exist yet. `slug` is a URL-safe form of the name for
 *  /nfl/player/{slug} routes; it is NOT guaranteed unique across the
 *  whole league in a first pass (name collisions), only stable per id. */
export type FootballPlayerRef = {
  id: string;        // ESPN athlete id (provenance)
  fullName: string;  // "Dak Prescott"
  slug: string;      // "dak-prescott"
};

// ─── Game (schedule entry — scheduled, in-progress, or final) ─────────────

export type FootballGameStatus =
  | "scheduled"
  | "live"
  | "final"
  | "postponed"
  | "canceled"
  | "unknown";

/** Coarse season phase, from ESPN's season.type (1=pre, 2=regular,
 *  3=post). Postseason sub-rounds (wild-card … super-bowl for the NFL;
 *  bowls / CFP for college) aren't distinguished by the scoreboard feed;
 *  `postseasonLabel` carries the vendor's human round name when present
 *  ("Wild Card", "CFP Semifinal - Rose Bowl"). */
export type FootballSeasonType = "pre" | "regular" | "post" | "unknown";

/** Per-quarter scoring. `period` is 1–4 for quarters, 5+ for overtime
 *  periods (college can stack several). `points` is null for periods not
 *  yet played. */
export type FootballPeriodLine = {
  period: number;
  points: number | null;
};

/** A scheduled football game in any state. */
export type FootballGame = {
  id: string;                    // ESPN event id (canonical primary key for the game)
  league: FootballLeague;
  startTime: string;             // ISO datetime
  seasonType: FootballSeasonType;
  seasonYear: number;            // ESPN's season.year (the season this game belongs to)
  week: number | null;           // week number; null for bowls / non-week games
  postseasonLabel: string | null;// human round name for postseason games, else null

  status: FootballGameStatus;
  statusDetail: string;          // vendor human label ("Final", "Final/OT", "3rd 4:12")

  awayTeam: FootballTeamRef;
  homeTeam: FootballTeamRef;

  awayScore: number | null;      // both null on scheduled games
  homeScore: number | null;
  awayLine: FootballPeriodLine[];// per-quarter; empty on scheduled games
  homeLine: FootballPeriodLine[];

  neutralSite: boolean;
  conferenceGame: boolean;       // divisional (NFL) / in-conference (NCAAF) matchup
  venueName: string | null;
};

// ─── Box score: per-player stat lines ─────────────────────────────────────
//
// One line type per ESPN stat group we render. Every group is optional on
// a team box because not all appear in every game (a team with no field
// goals has no kicking line, etc.). Compound vendor stats are pre-split.

/** Passing. ESPN group `passing`, labels C/ATT YDS AVG TD INT SACKS QBR RTG.
 *  `sacks`/`sackYards` come from the "SACKS" cell ("1-8" → 1 sack, 8 yds). */
export type FootballPassingLine = {
  player: FootballPlayerRef;
  completions: number;
  attempts: number;
  yards: number;
  touchdowns: number;
  interceptions: number;
  sacks: number;
  sackYards: number;
  qbr: number | null;            // ESPN QBR — NFL only, null for college
  rating: number | null;         // passer rating
};

/** Rushing. ESPN group `rushing`, labels CAR YDS AVG TD LONG. */
export type FootballRushingLine = {
  player: FootballPlayerRef;
  carries: number;
  yards: number;
  touchdowns: number;
  long: number;
};

/** Receiving. ESPN group `receiving`, labels REC YDS AVG TD LONG TGTS. */
export type FootballReceivingLine = {
  player: FootballPlayerRef;
  receptions: number;
  yards: number;
  touchdowns: number;
  long: number;
  targets: number | null;        // absent in some college feeds
};

/** Defense. ESPN group `defensive`, labels TOT SOLO SACKS TFL PD QB HTS TD. */
export type FootballDefensiveLine = {
  player: FootballPlayerRef;
  tackles: number;
  soloTackles: number;
  sacks: number;
  tacklesForLoss: number;
  passesDefended: number;
  qbHits: number;
  touchdowns: number;            // defensive/return TDs
};

/** Kicking. ESPN group `kicking`, labels FG PCT LONG XP PTS.
 *  FG/XP come as "made/att" strings, split into the numeric pairs. */
export type FootballKickingLine = {
  player: FootballPlayerRef;
  fgMade: number;
  fgAttempts: number;
  longFg: number;
  xpMade: number;
  xpAttempts: number;
  points: number;
};

/** A single scoring play, in game order. From ESPN summary `scoringPlays`. */
export type FootballScoringPlay = {
  period: number;
  clock: string;                 // "4:12" display
  team: FootballTeamRef;         // scoring team
  scoringType: string;           // "touchdown" | "field-goal" | "safety" | …
  text: string;                  // "Bijan Robinson 50 Yd pass from Michael Penix Jr. (Younghoe Koo Kick)"
  awayScore: number;             // running score after the play
  homeScore: number;
};

/** One offensive drive. From ESPN summary `drives.previous`. Optional in
 *  the box — some feeds omit drives; the renderer degrades gracefully. */
export type FootballDrive = {
  team: FootballTeamRef;
  result: string;                // "TD", "PUNT", "FG", "INT", "DOWNS", …
  description: string;           // "3 plays, 65 yards, 1:46"
  plays: number;
  yards: number;
  scored: boolean;
};

/** Curated team-level totals for the box header. Kept to the numbers the
 *  renderer actually shows; the raw ESPN feed carries ~25 team stats. */
export type FootballTeamTotals = {
  firstDowns: number | null;
  totalPlays: number | null;
  totalYards: number | null;
  passingYards: number | null;
  rushingYards: number | null;
  turnovers: number | null;
  thirdDownConversions: number | null;
  thirdDownAttempts: number | null;
  penalties: number | null;
  penaltyYards: number | null;
  possession: string | null;     // "31:24" — inherently a clock string, kept as-is
};

/** One team's complete side of a box score. */
export type FootballTeamBox = {
  team: FootballTeamRef;
  totals: FootballTeamTotals;
  passing: FootballPassingLine[];
  rushing: FootballRushingLine[];
  receiving: FootballReceivingLine[];
  defense: FootballDefensiveLine[];
  kicking: FootballKickingLine[];
};

/** Everything about a single completed/in-progress game beyond the
 *  schedule row. Keyed by game id in the daily bundle. */
export type FootballBoxScore = {
  gameId: string;
  away: FootballTeamBox;
  home: FootballTeamBox;
  scoringPlays: FootballScoringPlay[];
  drives: FootballDrive[];       // empty when the feed omits them
  venueName: string | null;
  attendance: number | null;
  weather: string | null;        // display string, null indoors / when absent
};

// ─── Rankings (NCAAF only) ────────────────────────────────────────────────

export type FootballRankingEntry = {
  rank: number;
  team: FootballTeamRef;
  record: string | null;         // "5-0"
  points: number | null;         // poll points
  firstPlaceVotes: number | null;
  previousRank: number | null;   // null for teams newly ranked
};

/** One poll's Top 25. `poll` is the display name ("AP Top 25",
 *  "CFP Rankings", "AFCA Coaches Poll"). CFP only exists mid-season on. */
export type FootballRanking = {
  poll: string;
  entries: FootballRankingEntry[];
};

// ─── Season leaders ───────────────────────────────────────────────────────

export type FootballLeaderEntry = {
  player: FootballPlayerRef;
  teamAbbr: string;
  value: number;                 // sortable numeric (4394)
  displayValue: string;          // formatted for display ("4,394")
};

/** One statistical category's top players (passing yards, sacks, …). */
export type FootballLeaderboard = {
  category: string;              // schema key, e.g. "passingYards"
  label: string;                // "Passing Yards"
  entries: FootballLeaderEntry[]; // sorted desc, top N
};

// ─── Transactions ─────────────────────────────────────────────────────────

/** A roster transaction. ESPN puts the whole thing in `description`
 *  ("Signed WR …"), like baseball; the renderer surfaces it as-is. */
export type FootballTransaction = {
  date: string;                 // ISO 8601
  description: string;
  teamAbbr: string | null;
};

// ─── Standings ────────────────────────────────────────────────────────────
//
// NFL groups by division inside a conference (AFC East, …). NCAAF groups
// by conference (SEC, Big Ten, …) with no divisions since 2024 realignment.
// Both reduce to "a named group of ranked team rows", so one shape covers
// both — `group` is the division or conference display name.

export type FootballStandingsRow = {
  team: FootballTeamRef;
  wins: number;
  losses: number;
  ties: number;
  pct: number | null;               // win percentage (0.588 → renderer shows ".588")
  streak: string | null;            // "W3", "L1"
  pointsFor: number | null;
  pointsAgainst: number | null;
  // Split records kept as display strings ("6-3") — they're inherently
  // W-L pairs, not scalars. null when the feed doesn't split them (some
  // college conferences).
  home: string | null;              // home record "6-3"
  road: string | null;              // road/away record "4-4"
  divisionRecord: string | null;    // in-division record "4-2" (NFL)
  conferenceRecord: string | null;  // in-conference record "8-4"
};

export type FootballStandingsGroup = {
  group: string;                 // "AFC East" (NFL divisions) / "SEC" (NCAAF)
  conference: string | null;     // "American Football Conference" (NFL); null/self for college
  rows: FootballStandingsRow[];  // pre-sorted by standing
};
