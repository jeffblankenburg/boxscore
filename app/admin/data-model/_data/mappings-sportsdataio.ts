// Hand-authored mapping: SportsDataIO MLB endpoints → canonical types.
// Sourced from the wip/sdio-canonical-model adapter (lib/sports/mlb/sources/
// sportsdata.ts). Update when canonical types or SDIO surface change.
//
// SDIO uses PascalCase property names and YYYY-MMM-DD date paths
// (2026-JUN-04). Date format conversion isn't shown in the field tables —
// it's an artifact of how the adapter builds URLs, not a data mapping.

import type { MlbSourceMapping } from "./mapping-shape";

export const SPORTSDATAIO_MAPPING: MlbSourceMapping = {
  vendor: "SportsDataIO (api.sportsdata.io/v3/mlb)",
  baseUrl: "https://api.sportsdata.io/v3/mlb",
  notes: [
    "Paid feed (~$15K/season quoted). Parked behind statsapi as primary.",
    "PascalCase field names; ISO datetime for current games, YYYY-MMM-DD for path params.",
    "Bulk-heavy: PlayerSeasonStats is ~1,179 rows × 117 fields — adapter caches per-season.",
    "Unwired (quick wins, not real gaps): venueName via /Stadiums; seasonBatting/seasonPitching via PlayerSeasonStatsByTeam join; jerseyNumber via PlayersBasic.Jersey; info[] partial via Game.Attendance + Game.ForecastDescription; gamesStarted + pitcher BABIP both already on PlayerSeason.",
    "Confirmed real gaps (no SDIO source anywhere in catalog): per-position fielding splits (innings, chances, putOuts, assists), umpires, AL-vs-AL standings split, postponement-reason narrative.",
  ],

  types: [
    // ─── References ──────────────────────────────────────────────────
    {
      canonicalType: "MlbTeamRef",
      endpoint: "Resolved via cached /scores/json/teams lookup (teamRefForId)",
      fields: [
        { canonical: "id", vendor: "TeamID", status: "direct" },
        { canonical: "name", vendor: "Name (via teams cache)", status: "derived", notes: "looked up from the teams meta cache by id" },
        { canonical: "abbr", vendor: "Key (via teams cache)", status: "derived", notes: 'SDIO calls the abbreviation "Key" (e.g. "NYY")' },
      ],
    },
    {
      canonicalType: "MlbPlayerRef",
      endpoint: "PlayerGame / PlayerSeason / Transaction rows",
      fields: [
        { canonical: "id", vendor: "PlayerID", status: "direct" },
        { canonical: "fullName", vendor: "Name (or FirstName + LastName)", status: "transformed", notes: "PlayersBasic gives separate first/last; PlayerGame gives concatenated Name" },
      ],
    },

    // ─── Game ────────────────────────────────────────────────────────
    {
      canonicalType: "MlbInningLine",
      endpoint: "GamesByDateFinal — Game.Innings[]",
      fields: [
        { canonical: "num", vendor: "Innings[].InningNumber", status: "transformed" },
        { canonical: "awayRuns", vendor: "Innings[].AwayTeamRuns", status: "direct" },
        { canonical: "homeRuns", vendor: "Innings[].HomeTeamRuns", status: "direct" },
      ],
    },
    {
      canonicalType: "MlbDecisions",
      endpoint: "Game — Winning/Losing/SavingPitcher{ID, name}",
      fields: [
        { canonical: "winner", vendor: "WinningPitcherID + WinningPitcher", status: "derived", notes: "shaped to MlbPlayerRef; null when not awarded" },
        { canonical: "loser", vendor: "LosingPitcherID + LosingPitcher", status: "derived" },
        { canonical: "save", vendor: "SavingPitcherID + SavingPitcher", status: "derived" },
      ],
    },
    {
      canonicalType: "MlbGame",
      endpoint: "/scores/json/GamesByDateFinal/{date} (or Games/{season} for ranges)",
      fields: [
        { canonical: "id", vendor: "GameID", status: "direct" },
        { canonical: "startTime", vendor: "DateTime (fallback Day)", status: "transformed", notes: "DateTime preferred; Day fallback when null" },
        { canonical: "gameType", vendor: "SeasonType", status: "transformed", notes: "1→regular, 2→spring, 5→all-star, 3→world-series (SDIO collapses all postseason under 3)" },
        { canonical: "status", vendor: "Status", status: "transformed", notes: "Final→final, InProgress→live, Scheduled→scheduled, Postponed/Suspended/Canceled mapped" },
        { canonical: "statusDetail", vendor: "Status (Game.InningDescription available for live games)", status: "degraded", notes: "For live games, InningDescription (\"Bottom of the 7th\") would beat reusing Status. No SDIO field carries postponement reasons (\"Postponed - Rain\") — that piece is a real gap." },
        { canonical: "awayTeam", vendor: "AwayTeamID (via teams cache)", status: "derived" },
        { canonical: "homeTeam", vendor: "HomeTeamID (via teams cache)", status: "derived" },
        { canonical: "awayScore", vendor: "AwayTeamRuns", status: "direct" },
        { canonical: "homeScore", vendor: "HomeTeamRuns", status: "direct" },
        { canonical: "innings", vendor: "Innings[]", status: "transformed", notes: "InningNumber/AwayTeamRuns/HomeTeamRuns → MlbInningLine[]" },
        { canonical: "awayHits", vendor: "AwayTeamHits", status: "direct" },
        { canonical: "homeHits", vendor: "HomeTeamHits", status: "direct" },
        { canonical: "awayErrors", vendor: "AwayTeamErrors", status: "direct" },
        { canonical: "homeErrors", vendor: "HomeTeamErrors", status: "direct" },
        { canonical: "awayProbablePitcher", vendor: "AwayTeamProbablePitcherID + AwayTeamStartingPitcher", status: "derived" },
        { canonical: "homeProbablePitcher", vendor: "HomeTeamProbablePitcherID + HomeTeamStartingPitcher", status: "derived" },
        { canonical: "decisions.winner", vendor: "WinningPitcherID + WinningPitcher", status: "derived" },
        { canonical: "decisions.loser", vendor: "LosingPitcherID + LosingPitcher", status: "derived" },
        { canonical: "decisions.save", vendor: "SavingPitcherID + SavingPitcher", status: "derived" },
        { canonical: "venueName", vendor: "Game.StadiumID → /scores/json/Stadiums (Stadium.Name)", status: "unwired", notes: "Stadiums endpoint exists; cache per season and join on StadiumID. Adapter doesn't hydrate yet." },
      ],
    },

    // ─── Box score ───────────────────────────────────────────────────
    {
      canonicalType: "MlbBoxBatting",
      endpoint: "/stats/json/BoxScoresFinal/{date} — PlayerGames[]",
      fields: [
        { canonical: "atBats", vendor: "AtBats", status: "direct" },
        { canonical: "runs", vendor: "Runs", status: "direct" },
        { canonical: "hits", vendor: "Hits", status: "direct" },
        { canonical: "rbi", vendor: "RunsBattedIn", status: "direct" },
        { canonical: "baseOnBalls", vendor: "Walks", status: "transformed", notes: "renamed from Walks → baseOnBalls" },
        { canonical: "strikeOuts", vendor: "Strikeouts", status: "direct" },
        { canonical: "homeRuns", vendor: "HomeRuns", status: "direct" },
        { canonical: "doubles", vendor: "Doubles", status: "direct" },
        { canonical: "triples", vendor: "Triples", status: "direct" },
        { canonical: "stolenBases", vendor: "StolenBases", status: "direct" },
        { canonical: "battingAverage", vendor: "BattingAverage", status: "direct", notes: "already a number, no parse needed" },
        { canonical: "ops", vendor: "OnBasePlusSlugging", status: "transformed", notes: "renamed" },
      ],
    },
    {
      canonicalType: "MlbBoxPitching",
      endpoint: "/stats/json/BoxScoresFinal/{date} — PlayerGames[]",
      fields: [
        { canonical: "inningsPitched", vendor: "InningsPitchedDecimal", status: "direct" },
        { canonical: "hits", vendor: "PitchingHits", status: "transformed" },
        { canonical: "runs", vendor: "PitchingRuns", status: "transformed" },
        { canonical: "earnedRuns", vendor: "PitchingEarnedRuns", status: "transformed" },
        { canonical: "baseOnBalls", vendor: "PitchingWalks", status: "transformed" },
        { canonical: "strikeOuts", vendor: "PitchingStrikeouts", status: "transformed" },
        { canonical: "homeRuns", vendor: "PitchingHomeRuns", status: "transformed" },
        { canonical: "pitchesThrown", vendor: "PitchesThrown", status: "direct" },
        { canonical: "strikes", vendor: "PitchesThrownStrikes", status: "transformed" },
        { canonical: "battersFaced", vendor: "PitchingPlateAppearances", status: "transformed" },
        { canonical: "era", vendor: "EarnedRunAverage", status: "direct" },
      ],
    },
    {
      canonicalType: "MlbSeasonBattingSummary",
      endpoint: "Join PlayerID → PlayerSeasonStatsByTeam.{BattingAverage, OnBasePlusSlugging}",
      fields: [
        { canonical: "battingAverage", vendor: "PlayerSeason.BattingAverage", status: "unwired", notes: "Adapter doesn't join box players to season stats; would need same cache used elsewhere." },
        { canonical: "ops", vendor: "PlayerSeason.OnBasePlusSlugging", status: "unwired" },
      ],
    },
    {
      canonicalType: "MlbSeasonPitchingSummary",
      endpoint: "Join PlayerID → PlayerSeasonStatsByTeam.EarnedRunAverage",
      fields: [
        { canonical: "era", vendor: "PlayerSeason.EarnedRunAverage", status: "unwired" },
      ],
    },
    {
      canonicalType: "MlbBoxInfo",
      endpoint: "Game.Attendance + Game.ForecastDescription (umpires: no SDIO source)",
      fields: [
        { canonical: "label", vendor: '(synthesized from Game fields, e.g. "Att", "Weather")', status: "unwired", notes: "Adapter would construct label/value pairs from Game envelope; no native info[] structure." },
        { canonical: "value", vendor: "Game.Attendance / Game.ForecastDescription", status: "unwired" },
      ],
    },
    {
      canonicalType: "MlbBoxPlayer",
      endpoint: "/stats/json/BoxScoresFinal/{date} — PlayerGames[]",
      fields: [
        { canonical: "player", vendor: "PlayerID + Name", status: "transformed" },
        { canonical: "positionAbbr", vendor: "Position", status: "direct" },
        { canonical: "jerseyNumber", vendor: "Join PlayerID → /scores/json/PlayersBasic/{team}.Jersey", status: "unwired", notes: "Jersey is on PlayersBasic; adapter already calls that endpoint for roster — could cache the map and join here." },
        { canonical: "startingOrder", vendor: "BattingOrder", status: "direct", notes: "1–9 directly; null for non-starters" },
        { canonical: "isStarter", vendor: "Started", status: "transformed", notes: "1 → true" },
        { canonical: "batting", vendor: "batting fields when PA or AB > 0", status: "derived" },
        { canonical: "pitching", vendor: "pitching fields when PitchesThrown or InningsPitchedOuts > 0", status: "derived" },
        { canonical: "errors", vendor: "PlayerGames[].Errors", status: "direct" },
        { canonical: "seasonErrors", vendor: "Join PlayerID → PlayerSeasonStatsByTeam.Errors", status: "transformed" },
        { canonical: "seasonBatting", vendor: "Join PlayerID → PlayerSeasonStatsByTeam.{BattingAverage, OnBasePlusSlugging}", status: "unwired", notes: "Season stats already cached per season; join inline when building MlbBoxPlayer." },
        { canonical: "seasonPitching", vendor: "Join PlayerID → PlayerSeasonStatsByTeam.EarnedRunAverage", status: "unwired" },
      ],
    },
    {
      canonicalType: "MlbBoxTeamTotals",
      endpoint: "/stats/json/BoxScoresFinal/{date} — TeamGames[]",
      fields: [
        { canonical: "atBats", vendor: "TeamGames[].AtBats", status: "direct" },
        { canonical: "runs", vendor: "TeamGames[].Runs", status: "direct" },
        { canonical: "hits", vendor: "TeamGames[].Hits", status: "direct" },
        { canonical: "homeRuns", vendor: "TeamGames[].HomeRuns", status: "direct" },
        { canonical: "baseOnBalls", vendor: "TeamGames[].Walks", status: "transformed" },
        { canonical: "strikeOuts", vendor: "TeamGames[].Strikeouts", status: "direct" },
      ],
    },
    {
      canonicalType: "MlbBoxTeam",
      endpoint: "/stats/json/BoxScoresFinal/{date}",
      fields: [
        { canonical: "team", vendor: "Game.{Away|Home}TeamID (via cache)", status: "derived" },
        { canonical: "totals", vendor: "TeamGames row for team id", status: "transformed" },
        { canonical: "batters", vendor: "PlayerGames filtered by TeamID + sort by Started/BattingOrder", status: "derived" },
        { canonical: "pitchers", vendor: "PlayerGames filtered by TeamID + sort by Position==SP / InningsPitchedOuts desc", status: "derived" },
      ],
    },
    {
      canonicalType: "MlbBoxScore",
      endpoint: "/stats/json/BoxScoresFinal/{date}",
      fields: [
        { canonical: "game", vendor: "Game", status: "transformed" },
        { canonical: "away", vendor: "PlayerGames + TeamGames filtered to AwayTeamID", status: "derived" },
        { canonical: "home", vendor: "PlayerGames + TeamGames filtered to HomeTeamID", status: "derived" },
        { canonical: "info", vendor: "Game.Attendance + Game.ForecastDescription (umpires: no SDIO source)", status: "unwired", notes: "Attendance + weather already in Game envelope; surface as info[] rows. Umpire data is a real gap." },
      ],
    },

    // ─── Scoring plays ───────────────────────────────────────────────
    {
      canonicalType: "MlbScoringPlay",
      endpoint: "/pbp/json/PlayByPlayFinal/{gameId} — Plays[]",
      fields: [
        { canonical: "inning", vendor: "InningNumber", status: "direct" },
        { canonical: "half", vendor: "InningHalf", status: "transformed", notes: 'T→top, B→bottom' },
        { canonical: "event", vendor: "Result", status: "derived", notes: 'falls back to "Hit"/"Walk"/"Play" if Result is empty' },
        { canonical: "description", vendor: "Description", status: "direct" },
        { canonical: "awayScore", vendor: "AwayTeamRuns", status: "direct" },
        { canonical: "homeScore", vendor: "HomeTeamRuns", status: "direct" },
        { canonical: "rbi", vendor: "RunsBattedIn", status: "direct" },
        { canonical: "(filter)", vendor: "AwayTeamRuns/HomeTeamRuns delta vs prior PlayNumber", status: "derived", notes: "SDIO has no isScoringPlay flag — adapter computes by walking sorted plays" },
      ],
    },

    // ─── Standings ───────────────────────────────────────────────────
    {
      canonicalType: "MlbRecord",
      endpoint: "Standing — split-specific W/L pairs (HomeWins/HomeLosses, AwayWins/AwayLosses, etc.)",
      fields: [
        { canonical: "wins", vendor: "(split-specific Wins field, e.g. HomeWins)", status: "derived" },
        { canonical: "losses", vendor: "(split-specific Losses field)", status: "derived" },
        { canonical: "pct", vendor: "(computed wins / (wins+losses))", status: "derived", notes: "SDIO doesn't carry per-split pct; adapter derives it" },
      ],
    },
    {
      canonicalType: "MlbStandingRow",
      endpoint: "/scores/json/Standings/{season}",
      fields: [
        { canonical: "team", vendor: "TeamID (via cache)", status: "derived" },
        { canonical: "wins", vendor: "Wins", status: "direct" },
        { canonical: "losses", vendor: "Losses", status: "direct" },
        { canonical: "gamesBehind", vendor: "GamesBehind", status: "direct", notes: "numeric, not vendor's display string" },
        { canonical: "divisionRank", vendor: "DivisionRank", status: "direct" },
        { canonical: "wildCardRank", vendor: "WildCardRank", status: "direct" },
        { canonical: "wildCardGamesBehind", vendor: "WildCardGamesBehind", status: "direct" },
        { canonical: "streak", vendor: "Streak (integer)", status: "transformed", notes: "0→\"-\", >0→\"W{n}\", <0→\"L{n}\"" },
        { canonical: "runsScored", vendor: "RunsScored", status: "direct" },
        { canonical: "runsAllowed", vendor: "RunsAgainst", status: "transformed", notes: "renamed" },
        { canonical: "homeRecord", vendor: "HomeWins + HomeLosses", status: "derived", notes: "pct computed from W/L" },
        { canonical: "awayRecord", vendor: "AwayWins + AwayLosses", status: "derived" },
        { canonical: "lastTenRecord", vendor: "LastTenGamesWins + LastTenGamesLosses", status: "derived" },
        { canonical: "leagueRecord", vendor: "(overall W/L; AL-vs-AL split not in catalog)", status: "degraded", notes: "Confirmed real gap: SDIO Standing exposes home/away/division/night splits but no intra-league (AL-vs-AL, NL-vs-NL) split. Adapter substitutes the overall record." },
        { canonical: "clinchedDivision", vendor: "ClinchedDivision", status: "direct" },
        { canonical: "clinchedWildCard", vendor: "ClinchedWildCard", status: "direct" },
        { canonical: "eliminatedFromPlayoffs", vendor: "EliminatedFromPlayoffContention", status: "direct" },
      ],
    },
    {
      canonicalType: "MlbDivisionStandings",
      endpoint: "/scores/json/Standings/{season} (grouped client-side)",
      fields: [
        { canonical: "league", vendor: "League", status: "transformed", notes: '"AL"|"NL" directly' },
        { canonical: "division", vendor: "Division", status: "transformed", notes: '"East"/"Central"/"West"' },
        { canonical: "teams", vendor: "rows grouped by League-Division", status: "derived" },
      ],
    },
    {
      canonicalType: "MlbWildCardStandings",
      endpoint: "/scores/json/Standings/{season} (filtered by WildCardRank != null)",
      fields: [
        { canonical: "league", vendor: "League", status: "transformed" },
        { canonical: "teams", vendor: "rows with WildCardRank, grouped by league, sorted by rank", status: "derived" },
      ],
    },

    // ─── Leaders ─────────────────────────────────────────────────────
    {
      canonicalType: "MlbLeaderboard",
      endpoint: "Computed from /stats/json/PlayerSeasonStats/{season}",
      fields: [
        { canonical: "league", vendor: "(filter on teams cache lookup)", status: "derived" },
        { canonical: "category", vendor: "(arg → field selector via LEADER_SPECS)", status: "derived" },
        { canonical: "entries", vendor: "(sorted/sliced PlayerSeasonStats rows)", status: "derived", notes: "SDIO has no native leaders endpoint — adapter computes from season stats" },
      ],
    },
    {
      canonicalType: "MlbLeaderEntry",
      endpoint: "Computed from cached /stats/json/PlayerSeasonStats/{season}",
      fields: [
        { canonical: "rank", vendor: "(adapter-assigned)", status: "derived", notes: "SDIO has no leaders endpoint — adapter sorts PlayerSeasonStats and assigns 1..limit" },
        { canonical: "value", vendor: "row[<spec.field>]", status: "derived", notes: "category-specific field (BattingAverage, HomeRuns, EarnedRunAverage, etc.)" },
        { canonical: "player", vendor: "PlayerID + Name", status: "transformed" },
        { canonical: "team", vendor: "TeamID (via cache)", status: "derived" },
      ],
    },
    {
      canonicalType: "MlbLeaderCategory",
      endpoint: "(category → SDIO field name)",
      fields: [
        { canonical: "battingAverage", vendor: "BattingAverage", status: "transformed" },
        { canonical: "homeRuns", vendor: "HomeRuns", status: "transformed" },
        { canonical: "runsBattedIn", vendor: "RunsBattedIn", status: "transformed" },
        { canonical: "stolenBases", vendor: "StolenBases", status: "transformed" },
        { canonical: "wins", vendor: "Wins", status: "transformed" },
        { canonical: "earnedRunAverage", vendor: "EarnedRunAverage (sorted ascending)", status: "transformed" },
        { canonical: "strikeoutsPitching", vendor: "PitchingStrikeouts", status: "transformed" },
        { canonical: "saves", vendor: "Saves", status: "transformed" },
        { canonical: "hits", vendor: "Hits", status: "transformed" },
        { canonical: "ops", vendor: "OnBasePlusSlugging", status: "transformed" },
        { canonical: "onBasePercentage", vendor: "OnBasePercentage", status: "transformed" },
        { canonical: "sluggingPercentage", vendor: "SluggingPercentage", status: "transformed" },
        { canonical: "whip", vendor: "WalksHitsPerInningsPitched (sorted ascending)", status: "transformed" },
        { canonical: "inningsPitched", vendor: "InningsPitchedDecimal", status: "transformed" },
      ],
    },

    // ─── Teams meta ──────────────────────────────────────────────────
    {
      canonicalType: "MlbTeam",
      endpoint: "/scores/json/teams",
      fields: [
        { canonical: "id", vendor: "TeamID", status: "direct" },
        { canonical: "abbr", vendor: "Key", status: "transformed" },
        { canonical: "name", vendor: "Name", status: "direct" },
        { canonical: "city", vendor: "City", status: "direct" },
        { canonical: "league", vendor: "League", status: "transformed" },
        { canonical: "division", vendor: "Division", status: "transformed" },
        { canonical: "active", vendor: "Active", status: "direct" },
        { canonical: "primaryColor", vendor: "PrimaryColor", status: "direct", notes: "SDIO advantage: statsapi doesn't carry team colors" },
        { canonical: "secondaryColor", vendor: "SecondaryColor", status: "direct" },
      ],
    },

    // ─── Transactions ────────────────────────────────────────────────
    {
      canonicalType: "MlbTransaction",
      endpoint: "/scores/json/TransactionsByDate/{date}",
      fields: [
        { canonical: "date", vendor: "Date", status: "transformed", notes: "sliced to YYYY-MM-DD" },
        { canonical: "typeLabel", vendor: "Type", status: "direct", notes: 'vendor short label ("Trade", "15-Day IL"); display-only' },
        { canonical: "description", vendor: "Note (fallback Type + Name)", status: "derived" },
        { canonical: "player", vendor: "PlayerID + Name", status: "transformed" },
        { canonical: "fromTeam", vendor: "FormerTeamID (via cache)", status: "derived" },
        { canonical: "toTeam", vendor: "TeamID (via cache)", status: "derived" },
      ],
    },

    // ─── Roster + season stats ───────────────────────────────────────
    {
      canonicalType: "MlbHittingSeason",
      endpoint: "/stats/json/PlayerSeasonStatsByTeam/{season}/{teamKey}",
      fields: [
        { canonical: "gamesPlayed", vendor: "Games", status: "transformed" },
        { canonical: "plateAppearances", vendor: "PlateAppearances", status: "direct" },
        { canonical: "atBats", vendor: "AtBats", status: "direct" },
        { canonical: "runs", vendor: "Runs", status: "direct" },
        { canonical: "hits", vendor: "Hits", status: "direct" },
        { canonical: "doubles", vendor: "Doubles", status: "direct" },
        { canonical: "triples", vendor: "Triples", status: "direct" },
        { canonical: "homeRuns", vendor: "HomeRuns", status: "direct" },
        { canonical: "rbi", vendor: "RunsBattedIn", status: "transformed" },
        { canonical: "baseOnBalls", vendor: "Walks", status: "transformed" },
        { canonical: "strikeOuts", vendor: "Strikeouts", status: "direct" },
        { canonical: "stolenBases", vendor: "StolenBases", status: "direct" },
        { canonical: "battingAverage", vendor: "BattingAverage", status: "direct" },
        { canonical: "onBasePercentage", vendor: "OnBasePercentage", status: "direct" },
        { canonical: "sluggingPercentage", vendor: "SluggingPercentage", status: "direct" },
        { canonical: "ops", vendor: "OnBasePlusSlugging", status: "transformed" },
        { canonical: "babip", vendor: "BattingAverageOnBallsInPlay", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbPitchingSeason",
      endpoint: "/stats/json/PlayerSeasonStatsByTeam/{season}/{teamKey}",
      fields: [
        { canonical: "gamesPlayed", vendor: "Games", status: "transformed" },
        { canonical: "gamesStarted", vendor: "PlayerSeason.Started", status: "unwired", notes: "Field exists on PlayerSeasonStatsByTeam; wip adapter just didn't map it. One-line fix." },
        { canonical: "wins", vendor: "Wins", status: "direct" },
        { canonical: "losses", vendor: "Losses", status: "direct" },
        { canonical: "saves", vendor: "Saves", status: "direct" },
        { canonical: "inningsPitched", vendor: "InningsPitchedDecimal", status: "direct" },
        { canonical: "strikeOuts", vendor: "PitchingStrikeouts", status: "transformed" },
        { canonical: "baseOnBalls", vendor: "PitchingWalks", status: "transformed" },
        { canonical: "earnedRuns", vendor: "PitchingEarnedRuns", status: "transformed" },
        { canonical: "hits", vendor: "PitchingHits", status: "transformed" },
        { canonical: "homeRuns", vendor: "PitchingHomeRuns", status: "transformed" },
        { canonical: "era", vendor: "EarnedRunAverage", status: "direct" },
        { canonical: "whip", vendor: "WalksHitsPerInningsPitched", status: "transformed" },
        { canonical: "babip", vendor: "PlayerSeason.PitchingBattingAverageOnBallsInPlay", status: "unwired", notes: "Field exists; wip adapter mapped to null. One-line fix." },
        { canonical: "strikeoutsPer9Inn", vendor: "PitchingStrikeoutsPerNineInnings", status: "transformed" },
        { canonical: "walksPer9Inn", vendor: "PitchingWalksPerNineInnings", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbRosterPlayer",
      endpoint: "/scores/json/PlayersBasic/{teamKey} + season stats join",
      fields: [
        { canonical: "player", vendor: "PlayerID + FirstName + LastName", status: "transformed" },
        { canonical: "jerseyNumber", vendor: "Jersey", status: "transformed" },
        { canonical: "positionAbbr", vendor: "Position", status: "direct" },
        { canonical: "hitting", vendor: "PlayerSeasonStatsByTeam row (when PositionCategory != P)", status: "derived" },
        { canonical: "pitching", vendor: "PlayerSeasonStatsByTeam row (when PositionCategory == P)", status: "derived" },
      ],
    },
    {
      canonicalType: "MlbTeamRoster",
      endpoint: "/scores/json/PlayersBasic/{teamKey}",
      fields: [
        { canonical: "teamId", vendor: "(passed in by caller)", status: "derived" },
        { canonical: "players", vendor: "PlayersBasic[] + PlayerSeasonStatsByTeam join", status: "derived" },
      ],
    },

    // ─── Player + splits ─────────────────────────────────────────────
    {
      canonicalType: "MlbPlayer",
      endpoint: "/scores/json/PlayersByActive",
      fields: [
        { canonical: "id", vendor: "PlayerID", status: "direct" },
        { canonical: "fullName", vendor: "FirstName + LastName", status: "transformed" },
        { canonical: "primaryPositionAbbr", vendor: "Position", status: "direct" },
        { canonical: "jerseyNumber", vendor: "Jersey", status: "transformed" },
        { canonical: "active", vendor: 'Status == "Active"', status: "derived" },
        { canonical: "currentTeam", vendor: "TeamID (via cache)", status: "derived" },
      ],
    },
    {
      canonicalType: "MlbGameLogEntry",
      endpoint: "/stats/json/PlayerGameStatsBySeason/{season}/{personId}/all",
      fields: [
        { canonical: "date", vendor: "DateTime or Day", status: "transformed", notes: "sliced to YYYY-MM-DD" },
        { canonical: "gameId", vendor: "GameID", status: "direct" },
        { canonical: "isHome", vendor: 'HomeOrAway == "HOME"', status: "derived" },
        { canonical: "isWin", vendor: "Wins > 0", status: "derived" },
        { canonical: "isLoss", vendor: "Losses > 0", status: "derived" },
        { canonical: "team", vendor: "TeamID (via cache)", status: "derived" },
        { canonical: "opponent", vendor: "OpponentID (via cache)", status: "derived" },
        { canonical: "batting", vendor: "batting fields", status: "transformed" },
        { canonical: "pitching", vendor: "pitching fields", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbSplitsBundle",
      endpoint: "PlayerGameStatsBySeason + PlayerSeasonStats join",
      fields: [
        { canonical: "group", vendor: "(arg)", status: "derived" },
        { canonical: "hittingSeason", vendor: "PlayerSeasonStats row (when hitting)", status: "derived" },
        { canonical: "pitchingSeason", vendor: "PlayerSeasonStats row (when pitching)", status: "derived" },
        { canonical: "gameLog", vendor: "PlayerGameStatsBySeason[]", status: "derived" },
      ],
    },

    // ─── Fielding ────────────────────────────────────────────────────
    {
      canonicalType: "MlbFieldingSplit",
      endpoint: "PlayerSeasonStats row — single primary-position synthesis",
      fields: [
        { canonical: "positionAbbr", vendor: "Position", status: "degraded", notes: "single primary position only — no per-position splits" },
        { canonical: "games", vendor: "Games", status: "degraded", notes: "total team games, not games-at-position" },
        { canonical: "gamesStarted", vendor: "(no SDIO source for fielding-position GS)", status: "missing", notes: "Confirmed real gap: SDIO has no per-position fielding splits anywhere in the catalog." },
        { canonical: "innings", vendor: "(no SDIO source)", status: "missing", notes: "Confirmed real gap. Renderer should treat zero-innings as 'data unavailable'." },
        { canonical: "chances", vendor: "(no SDIO source)", status: "missing", notes: "Confirmed real gap." },
        { canonical: "putOuts", vendor: "(no SDIO source)", status: "missing", notes: "Confirmed real gap." },
        { canonical: "assists", vendor: "(no SDIO source)", status: "missing", notes: "Confirmed real gap." },
        { canonical: "errors", vendor: "Errors", status: "direct" },
        { canonical: "doublePlays", vendor: "DoublePlays", status: "direct" },
        { canonical: "fieldingPercentage", vendor: "(no SDIO source)", status: "missing", notes: "Confirmed real gap." },
      ],
    },
  ],

  // ─── Vendor fields SDIO provides that we don't use ────────────────
  unmappedVendor: [
    {
      type: "SdioGame",
      fields: [
        { vendor: "Season / SeasonType (numeric)", notes: "season metadata — adapter uses for game type, doesn't surface" },
        { vendor: "StadiumID", notes: "stadium link; canonical venueName left null" },
        { vendor: "AwayTeam / HomeTeam (string keys)", notes: "redundant with AwayTeamID + cache" },
        { vendor: "Inning", notes: "current inning during live games; canonical dropped (no live-inning renderer)" },
      ],
    },
    {
      type: "SdioPlayerGame (box-score row)",
      fields: [
        { vendor: "StatID", notes: "SDIO stat row id" },
        { vendor: "Team / Opponent (string keys)", notes: "redundant with TeamID/OpponentID" },
        { vendor: "InningsPitchedOuts", notes: "we use the decimal form" },
        { vendor: "PlateAppearances (player game)", notes: "used as a starter-filter signal, not surfaced" },
        { vendor: "LeftOnBase (player + team)", notes: "per-player and team LOB; canonical dropped (no current renderer)" },
        { vendor: "Errors / DoublePlays (per-game)", notes: "fielding info exists per-game but canonical only carries season totals" },
        { vendor: "Wins / Losses / Saves (per-game)", notes: "used to set isWin/isLoss in game log, not surfaced elsewhere" },
        { vendor: "117 stat columns total", notes: "SDIO is wide; adapter pulls ~30 of them" },
      ],
    },
    {
      type: "SdioStanding",
      fields: [
        { vendor: "Percentage", notes: "we recompute pct for split records" },
        { vendor: "Key / Name / City / League / Division", notes: "redundant with teams cache" },
      ],
    },
    {
      type: "SdioPlay (PBP)",
      fields: [
        { vendor: "PlayID / PlayNumber", notes: "used to compute scoring delta, not surfaced" },
        { vendor: "Hit / Walk / Strikeout / Sacrifice / Error / Out (bool flags)", notes: "flag flags for event classification" },
      ],
    },
    {
      type: "SdioTransaction",
      fields: [
        { vendor: "Created / Updated timestamps", notes: "audit metadata" },
      ],
    },
    {
      type: "SdioTeam",
      fields: [
        { vendor: "Key (also used as abbr in MlbTeam.abbr)", notes: "consumed but not separately surfaced" },
      ],
    },
    {
      type: "SdioPlayerSeason",
      fields: [
        { vendor: "~80 additional season stat columns", notes: "SDIO PlayerSeason is very wide — adapter pulls hitting/pitching/fielding basics, drops advanced derivative stats (HitByPitch, GroundOuts, FlyOuts, Pickoffs, etc.)" },
      ],
    },
    {
      type: "SdioPlayerBasic",
      fields: [
        { vendor: "Status", notes: 'used as active=Active check, not surfaced as enum' },
        { vendor: "PositionCategory", notes: "used to decide hitting vs pitching stats; not surfaced" },
        { vendor: "BatHand / ThrowHand", notes: "L/R/S handedness; canonical dropped (no current renderer)" },
      ],
    },
  ],
};
