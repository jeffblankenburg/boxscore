// Hand-authored mapping: statsapi.mlb.com fields → canonical types.
// Sourced from the wip/sdio-canonical-model adapter code (lib/sports/mlb/
// sources/statsapi.ts) since it's the closest thing we have to a real
// mapping spec. Update when canonical types or statsapi feed change.
//
// Status values:
//   "direct"      — canonical field reads vendor value without transform
//   "transformed" — adapter applies an enum map, parse, or one-step rename
//   "derived"     — adapter computes the canonical field from multiple
//                   vendor inputs (or guesses; see notes)
//   "degraded"    — canonical field is filled but with reduced fidelity
//   "missing"     — vendor doesn't provide it; canonical field is null/0/""

import type { MlbSourceMapping } from "./mapping-shape";

export const STATSAPI_MAPPING: MlbSourceMapping = {
  vendor: "statsapi.mlb.com",
  baseUrl: "https://statsapi.mlb.com/api",
  notes: [
    "Primary feed since project launch. Public, no key, generous rate limit.",
    "Most stats arrive as strings (\"3.42\", \".289\"); adapter parses with strToFloat.",
    "Box score lineup keyed by \"ID{personId}\"; adapter reshapes to ordered arrays.",
    "Standings: divisions identified by numeric id (200/203 East, 201/204 Central, 202/205 West).",
  ],

  types: [
    // ─── References ──────────────────────────────────────────────────
    {
      canonicalType: "MlbTeamRef",
      endpoint: "schedule, boxscore, standings (varies)",
      fields: [
        { canonical: "id", vendor: "team.id", status: "direct" },
        { canonical: "name", vendor: "team.name", status: "direct" },
        { canonical: "abbr", vendor: "team.abbreviation", status: "direct", notes: "may be missing on standings — adapter defaults to empty string" },
      ],
    },
    {
      canonicalType: "MlbPlayerRef",
      endpoint: "boxscore, decisions, transactions",
      fields: [
        { canonical: "id", vendor: "person.id (or .id at root)", status: "direct" },
        { canonical: "fullName", vendor: "person.fullName", status: "direct" },
      ],
    },

    // ─── Game ────────────────────────────────────────────────────────
    {
      canonicalType: "MlbInningLine",
      endpoint: "/v1/schedule — linescore.innings[]",
      fields: [
        { canonical: "num", vendor: "innings[].num", status: "direct" },
        { canonical: "awayRuns", vendor: "innings[].away.runs", status: "direct", notes: "?? null for future innings" },
        { canonical: "homeRuns", vendor: "innings[].home.runs", status: "direct" },
      ],
    },
    {
      canonicalType: "MlbDecisions",
      endpoint: "/v1/schedule — decisions (requires hydrate=decisions)",
      fields: [
        { canonical: "winner", vendor: "decisions.winner", status: "transformed", notes: "shaped to MlbPlayerRef; null on non-final" },
        { canonical: "loser", vendor: "decisions.loser", status: "transformed" },
        { canonical: "save", vendor: "decisions.save", status: "transformed", notes: "null when no save awarded" },
      ],
    },
    {
      canonicalType: "MlbGame",
      endpoint: "/v1/schedule?sportId=1&date={d}&hydrate=linescore,team,decisions,probablePitcher",
      fields: [
        { canonical: "id", vendor: "gamePk", status: "direct" },
        { canonical: "startTime", vendor: "gameDate", status: "direct" },
        { canonical: "gameType", vendor: "gameType", status: "transformed", notes: 'enum: R→regular, S→spring, E→exhibition, A→all-star, F→wild-card, D→division-series, L→lcs, W→world-series; default→regular' },
        { canonical: "status", vendor: "status.abstractGameState", status: "transformed", notes: "Final→final, Live→live, Preview→scheduled, Postponed/Suspended/Cancelled mapped; else→unknown" },
        { canonical: "statusDetail", vendor: "status.detailedState", status: "direct" },
        { canonical: "awayTeam", vendor: "teams.away.team", status: "transformed", notes: "shaped into MlbTeamRef" },
        { canonical: "homeTeam", vendor: "teams.home.team", status: "transformed" },
        { canonical: "awayScore", vendor: "teams.away.score", status: "direct", notes: "?? null when missing" },
        { canonical: "homeScore", vendor: "teams.home.score", status: "direct" },
        { canonical: "innings", vendor: "linescore.innings[]", status: "transformed", notes: "shaped to {num, awayRuns, homeRuns}" },
        { canonical: "awayHits", vendor: "linescore.teams.away.hits", status: "direct" },
        { canonical: "homeHits", vendor: "linescore.teams.home.hits", status: "direct" },
        { canonical: "awayErrors", vendor: "linescore.teams.away.errors", status: "direct" },
        { canonical: "homeErrors", vendor: "linescore.teams.home.errors", status: "direct" },
        { canonical: "awayProbablePitcher", vendor: "teams.away.probablePitcher", status: "transformed", notes: "requires hydrate=probablePitcher" },
        { canonical: "homeProbablePitcher", vendor: "teams.home.probablePitcher", status: "transformed" },
        { canonical: "decisions.winner", vendor: "decisions.winner", status: "transformed", notes: "requires hydrate=decisions; null on non-final games" },
        { canonical: "decisions.loser", vendor: "decisions.loser", status: "transformed" },
        { canonical: "decisions.save", vendor: "decisions.save", status: "transformed" },
        { canonical: "venueName", vendor: "venue.name", status: "direct" },
      ],
    },

    // ─── Box score ───────────────────────────────────────────────────
    {
      canonicalType: "MlbBoxBatting",
      endpoint: "/v1/game/{gamePk}/boxscore — teams.{side}.players[ID*].stats.batting",
      fields: [
        { canonical: "atBats", vendor: "stats.batting.atBats", status: "direct" },
        { canonical: "runs", vendor: "stats.batting.runs", status: "direct" },
        { canonical: "hits", vendor: "stats.batting.hits", status: "direct" },
        { canonical: "rbi", vendor: "stats.batting.rbi", status: "direct" },
        { canonical: "baseOnBalls", vendor: "stats.batting.baseOnBalls", status: "direct" },
        { canonical: "strikeOuts", vendor: "stats.batting.strikeOuts", status: "direct" },
        { canonical: "homeRuns", vendor: "stats.batting.homeRuns", status: "direct" },
        { canonical: "doubles", vendor: "stats.batting.doubles", status: "direct" },
        { canonical: "triples", vendor: "stats.batting.triples", status: "direct" },
        { canonical: "stolenBases", vendor: "stats.batting.stolenBases", status: "direct" },
        { canonical: "battingAverage", vendor: "stats.batting.avg", status: "transformed", notes: "string → float" },
        { canonical: "ops", vendor: "stats.batting.ops", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbBoxPitching",
      endpoint: "/v1/game/{gamePk}/boxscore — teams.{side}.players[ID*].stats.pitching",
      fields: [
        { canonical: "inningsPitched", vendor: "stats.pitching.inningsPitched", status: "transformed", notes: 'string "5.2" → 5.2 (5⅔ innings)' },
        { canonical: "hits", vendor: "stats.pitching.hits", status: "direct" },
        { canonical: "runs", vendor: "stats.pitching.runs", status: "direct" },
        { canonical: "earnedRuns", vendor: "stats.pitching.earnedRuns", status: "direct" },
        { canonical: "baseOnBalls", vendor: "stats.pitching.baseOnBalls", status: "direct" },
        { canonical: "strikeOuts", vendor: "stats.pitching.strikeOuts", status: "direct" },
        { canonical: "homeRuns", vendor: "stats.pitching.homeRuns", status: "direct" },
        { canonical: "pitchesThrown", vendor: "stats.pitching.numberOfPitches", status: "direct", notes: "falls back to .pitchesThrown" },
        { canonical: "strikes", vendor: "stats.pitching.strikes", status: "direct" },
        { canonical: "battersFaced", vendor: "stats.pitching.battersFaced", status: "direct" },
        { canonical: "era", vendor: "stats.pitching.era", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbSeasonBattingSummary",
      endpoint: "/v1/game/{gamePk}/boxscore — players[ID*].seasonStats.batting",
      fields: [
        { canonical: "battingAverage", vendor: "seasonStats.batting.avg", status: "transformed", notes: "string → float" },
        { canonical: "ops", vendor: "seasonStats.batting.ops", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbSeasonPitchingSummary",
      endpoint: "/v1/game/{gamePk}/boxscore — players[ID*].seasonStats.pitching",
      fields: [
        { canonical: "era", vendor: "seasonStats.pitching.era", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbBoxInfo",
      endpoint: "/v1/game/{gamePk}/boxscore — info[]",
      fields: [
        { canonical: "label", vendor: "info[].label", status: "direct", notes: 'e.g. "Att", "Weather", "T", "Umpires"' },
        { canonical: "value", vendor: "info[].value", status: "direct", notes: "?? empty string when missing" },
      ],
    },
    {
      canonicalType: "MlbBoxPlayer",
      endpoint: "/v1/game/{gamePk}/boxscore — teams.{side}.players[ID*]",
      fields: [
        { canonical: "player", vendor: "person", status: "transformed" },
        { canonical: "positionAbbr", vendor: "position.abbreviation", status: "direct" },
        { canonical: "jerseyNumber", vendor: "jerseyNumber", status: "direct" },
        { canonical: "startingOrder", vendor: "battingOrder", status: "derived", notes: 'string "100"/"101" — adapter does Math.floor(n/100); null for pitchers/bench' },
        { canonical: "isStarter", vendor: "battingOrder", status: "derived", notes: 'true when battingOrder ends with "00"' },
        { canonical: "batting", vendor: "stats.batting", status: "transformed", notes: "null when empty object" },
        { canonical: "pitching", vendor: "stats.pitching", status: "transformed" },
        { canonical: "seasonBatting.battingAverage", vendor: "seasonStats.batting.avg", status: "transformed" },
        { canonical: "seasonBatting.ops", vendor: "seasonStats.batting.ops", status: "transformed" },
        { canonical: "seasonPitching.era", vendor: "seasonStats.pitching.era", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbBoxTeamTotals",
      endpoint: "/v1/game/{gamePk}/boxscore — teams.{side}.teamStats.batting",
      fields: [
        { canonical: "atBats", vendor: "teamStats.batting.atBats", status: "direct" },
        { canonical: "runs", vendor: "teamStats.batting.runs", status: "direct" },
        { canonical: "hits", vendor: "teamStats.batting.hits", status: "direct" },
        { canonical: "homeRuns", vendor: "teamStats.batting.homeRuns", status: "direct" },
        { canonical: "baseOnBalls", vendor: "teamStats.batting.baseOnBalls", status: "direct" },
        { canonical: "strikeOuts", vendor: "teamStats.batting.strikeOuts", status: "direct" },
      ],
    },
    {
      canonicalType: "MlbBoxTeam",
      endpoint: "/v1/game/{gamePk}/boxscore — teams.{away|home}",
      fields: [
        { canonical: "team", vendor: "team", status: "transformed" },
        { canonical: "totals", vendor: "teamStats.batting", status: "transformed" },
        { canonical: "batters", vendor: "batters[]", status: "transformed", notes: "id list → players[ID*] lookup → MlbBoxPlayer[]" },
        { canonical: "pitchers", vendor: "pitchers[]", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbBoxScore",
      endpoint: "/v1/game/{gamePk}/boxscore",
      fields: [
        { canonical: "game", vendor: "(joined from /v1/schedule entry)", status: "derived" },
        { canonical: "away", vendor: "teams.away", status: "transformed" },
        { canonical: "home", vendor: "teams.home", status: "transformed" },
        { canonical: "info", vendor: "info[]", status: "direct" },
      ],
    },

    // ─── Scoring plays ───────────────────────────────────────────────
    {
      canonicalType: "MlbScoringPlay",
      endpoint: "/v1/game/{gamePk}/playByPlay — allPlays[]",
      fields: [
        { canonical: "inning", vendor: "about.inning", status: "direct" },
        { canonical: "half", vendor: "about.halfInning", status: "direct" },
        { canonical: "event", vendor: "result.event", status: "derived", notes: "for mid-AB runner-scoring plays (wild pitch, etc.), adapter substitutes runner's details.event" },
        { canonical: "description", vendor: "result.description", status: "derived", notes: 'mid-AB scoring plays get a synthesized "{runner} scores on {event}" string' },
        { canonical: "awayScore", vendor: "result.awayScore", status: "direct" },
        { canonical: "homeScore", vendor: "result.homeScore", status: "direct" },
        { canonical: "rbi", vendor: "result.rbi", status: "direct" },
      ],
    },

    // ─── Standings ───────────────────────────────────────────────────
    {
      canonicalType: "MlbRecord",
      endpoint: "/v1/standings — records.splitRecords[] entries",
      fields: [
        { canonical: "wins", vendor: "wins", status: "direct" },
        { canonical: "losses", vendor: "losses", status: "direct" },
        { canonical: "pct", vendor: "pct", status: "transformed", notes: "string → float; 0 when empty" },
      ],
    },
    {
      canonicalType: "MlbStandingRow",
      endpoint: "/v1/standings?leagueId=103,104&season={s}&date={d} — records[].teamRecords[]",
      fields: [
        { canonical: "team", vendor: "team", status: "degraded", notes: "no abbreviation in standings payload — adapter sets abbr to empty string" },
        { canonical: "wins", vendor: "wins", status: "direct" },
        { canonical: "losses", vendor: "losses", status: "direct" },
        { canonical: "gamesBehind", vendor: "gamesBack", status: "transformed", notes: '"-" → 0, else parseFloat' },
        { canonical: "divisionRank", vendor: "divisionRank", status: "transformed", notes: "string → number" },
        { canonical: "wildCardRank", vendor: "wildCardRank", status: "transformed", notes: "string → number; null on division leaders" },
        { canonical: "wildCardGamesBehind", vendor: "wildCardGamesBack", status: "transformed" },
        { canonical: "streak", vendor: "streak.streakCode", status: "direct" },
        { canonical: "runsScored", vendor: "runsScored", status: "direct" },
        { canonical: "runsAllowed", vendor: "runsAllowed", status: "direct" },
        { canonical: "homeRecord", vendor: 'records.splitRecords[type="home"]', status: "transformed" },
        { canonical: "awayRecord", vendor: 'records.splitRecords[type="away"]', status: "transformed" },
        { canonical: "lastTenRecord", vendor: 'records.splitRecords[type="lastTen"]', status: "transformed" },
        { canonical: "leagueRecord", vendor: "leagueRecord", status: "transformed" },
        { canonical: "clinchedDivision", vendor: "clinchIndicator", status: "derived", notes: 'true when "z" or "y", or divisionLeader && indicator present' },
        { canonical: "clinchedWildCard", vendor: "clinchIndicator + hasWildcard", status: "derived" },
        { canonical: "eliminatedFromPlayoffs", vendor: 'eliminationNumber=="E"', status: "derived" },
      ],
    },
    {
      canonicalType: "MlbDivisionStandings",
      endpoint: "/v1/standings?leagueId=103,104 — records[]",
      fields: [
        { canonical: "league", vendor: "league.id", status: "transformed", notes: "103→AL, 104→NL" },
        { canonical: "division", vendor: "division.id", status: "transformed", notes: "200/203→East, 201/204→Central, 202/205→West" },
        { canonical: "teams", vendor: "teamRecords[]", status: "transformed", notes: "sorted by divisionRank ascending" },
      ],
    },
    {
      canonicalType: "MlbWildCardStandings",
      endpoint: "/v1/standings?...&standingsTypes=wildCard",
      fields: [
        { canonical: "league", vendor: "league.id", status: "transformed" },
        { canonical: "teams", vendor: "teamRecords[]", status: "transformed" },
      ],
    },

    // ─── Leaders ─────────────────────────────────────────────────────
    {
      canonicalType: "MlbLeaderboard",
      endpoint: "/v1/stats/leaders — leagueLeaders[0] wrapper",
      fields: [
        { canonical: "league", vendor: "(query arg leagueId: 103→AL, 104→NL)", status: "derived" },
        { canonical: "category", vendor: "(query arg leaderCategories)", status: "derived" },
        { canonical: "entries", vendor: "leagueLeaders[0].leaders[]", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbLeaderEntry",
      endpoint: "/v1/stats/leaders?leaderCategories={cat}&season={s}&sportId=1&leagueId={l}",
      fields: [
        { canonical: "rank", vendor: "leagueLeaders[0].leaders[].rank", status: "direct" },
        { canonical: "value", vendor: "leagueLeaders[0].leaders[].value", status: "transformed", notes: "parseFloat; fallback 0" },
        { canonical: "player", vendor: "leagueLeaders[0].leaders[].person", status: "transformed" },
        { canonical: "team", vendor: "leagueLeaders[0].leaders[].team", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbLeaderCategory",
      endpoint: "(query param mapping)",
      fields: [
        { canonical: "battingAverage", vendor: "battingAverage", status: "direct" },
        { canonical: "homeRuns", vendor: "homeRuns", status: "direct" },
        { canonical: "runsBattedIn", vendor: "runsBattedIn", status: "direct" },
        { canonical: "stolenBases", vendor: "stolenBases", status: "direct" },
        { canonical: "wins", vendor: "wins", status: "direct" },
        { canonical: "earnedRunAverage", vendor: "earnedRunAverage", status: "direct" },
        { canonical: "strikeoutsPitching", vendor: "strikeouts", status: "transformed", notes: "different name in vendor" },
        { canonical: "saves", vendor: "saves", status: "direct" },
        { canonical: "hits", vendor: "hits", status: "direct" },
        { canonical: "ops", vendor: "onBasePlusSlugging", status: "transformed" },
        { canonical: "onBasePercentage", vendor: "onBasePercentage", status: "direct" },
        { canonical: "sluggingPercentage", vendor: "sluggingPercentage", status: "direct" },
        { canonical: "whip", vendor: "whip", status: "direct" },
        { canonical: "inningsPitched", vendor: "inningsPitched", status: "direct" },
      ],
    },

    // ─── Teams meta ──────────────────────────────────────────────────
    {
      canonicalType: "MlbTeam",
      endpoint: "/v1/teams?sportId=1&season={s} — teams[]",
      fields: [
        { canonical: "id", vendor: "id", status: "direct" },
        { canonical: "abbr", vendor: "abbreviation", status: "direct" },
        { canonical: "name", vendor: "name", status: "direct" },
        { canonical: "city", vendor: "locationName", status: "direct" },
        { canonical: "league", vendor: "league.name", status: "transformed", notes: 'contains "American" → AL, else NL' },
        { canonical: "division", vendor: "division.name", status: "transformed", notes: 'East/Central/West substring match' },
        { canonical: "active", vendor: "active", status: "direct" },
        { canonical: "primaryColor", vendor: "(not in feed)", status: "missing" },
        { canonical: "secondaryColor", vendor: "(not in feed)", status: "missing" },
      ],
    },

    // ─── Transactions ────────────────────────────────────────────────
    {
      canonicalType: "MlbTransaction",
      endpoint: "/v1/transactions?sportId=1&startDate={d}&endDate={d}",
      fields: [
        { canonical: "date", vendor: "date", status: "direct" },
        { canonical: "typeLabel", vendor: "typeDesc", status: "direct", notes: 'human label ("Trade", "Designated for Assignment")' },
        { canonical: "description", vendor: "description", status: "direct", notes: "filter rows where missing" },
        { canonical: "player", vendor: "person", status: "transformed" },
        { canonical: "fromTeam", vendor: "fromTeam", status: "transformed" },
        { canonical: "toTeam", vendor: "toTeam", status: "transformed" },
      ],
    },

    // ─── Roster + season stats ───────────────────────────────────────
    {
      canonicalType: "MlbHittingSeason",
      endpoint: "/v1/teams/{teamId}/roster + hydrate=person(stats(group=hitting,type=season,season={s}))",
      fields: [
        { canonical: "gamesPlayed", vendor: "stat.gamesPlayed", status: "direct" },
        { canonical: "plateAppearances", vendor: "stat.plateAppearances", status: "direct" },
        { canonical: "atBats", vendor: "stat.atBats", status: "direct" },
        { canonical: "runs", vendor: "stat.runs", status: "direct" },
        { canonical: "hits", vendor: "stat.hits", status: "direct" },
        { canonical: "doubles", vendor: "stat.doubles", status: "direct" },
        { canonical: "triples", vendor: "stat.triples", status: "direct" },
        { canonical: "homeRuns", vendor: "stat.homeRuns", status: "direct" },
        { canonical: "rbi", vendor: "stat.rbi", status: "direct" },
        { canonical: "baseOnBalls", vendor: "stat.baseOnBalls", status: "direct" },
        { canonical: "strikeOuts", vendor: "stat.strikeOuts", status: "direct" },
        { canonical: "stolenBases", vendor: "stat.stolenBases", status: "direct" },
        { canonical: "battingAverage", vendor: "stat.avg", status: "transformed" },
        { canonical: "onBasePercentage", vendor: "stat.obp", status: "transformed" },
        { canonical: "sluggingPercentage", vendor: "stat.slg", status: "transformed" },
        { canonical: "ops", vendor: "stat.ops", status: "transformed" },
        { canonical: "babip", vendor: "stat.babip", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbPitchingSeason",
      endpoint: "/v1/teams/{teamId}/roster + hydrate=person(stats(group=pitching,type=[season,seasonAdvanced],season={s}))",
      fields: [
        { canonical: "gamesPlayed", vendor: "stat.gamesPlayed", status: "direct" },
        { canonical: "gamesStarted", vendor: "stat.gamesStarted", status: "direct" },
        { canonical: "wins", vendor: "stat.wins", status: "direct" },
        { canonical: "losses", vendor: "stat.losses", status: "direct" },
        { canonical: "saves", vendor: "stat.saves", status: "direct" },
        { canonical: "inningsPitched", vendor: "stat.inningsPitched", status: "transformed" },
        { canonical: "strikeOuts", vendor: "stat.strikeOuts", status: "direct" },
        { canonical: "baseOnBalls", vendor: "stat.baseOnBalls", status: "direct" },
        { canonical: "earnedRuns", vendor: "stat.earnedRuns", status: "direct" },
        { canonical: "hits", vendor: "stat.hits", status: "direct" },
        { canonical: "homeRuns", vendor: "stat.homeRuns", status: "direct" },
        { canonical: "era", vendor: "stat.era", status: "transformed" },
        { canonical: "whip", vendor: "stat.whip", status: "transformed" },
        { canonical: "babip", vendor: "seasonAdvanced.babip (fallback stat.babip)", status: "transformed", notes: "advanced type required to populate for pitchers" },
        { canonical: "strikeoutsPer9Inn", vendor: "stat.strikeoutsPer9Inn", status: "transformed" },
        { canonical: "walksPer9Inn", vendor: "stat.walksPer9Inn", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbRosterPlayer",
      endpoint: "/v1/teams/{teamId}/roster?rosterType=active",
      fields: [
        { canonical: "player", vendor: "person", status: "transformed" },
        { canonical: "jerseyNumber", vendor: "jerseyNumber", status: "direct" },
        { canonical: "positionAbbr", vendor: "position.abbreviation", status: "direct" },
        { canonical: "hitting", vendor: "person.stats[group=hitting,type=season]", status: "transformed" },
        { canonical: "pitching", vendor: "person.stats[group=pitching,type=season]", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbTeamRoster",
      endpoint: "/v1/teams/{teamId}/roster",
      fields: [
        { canonical: "teamId", vendor: "(passed in by caller)", status: "derived" },
        { canonical: "players", vendor: "roster[]", status: "transformed" },
      ],
    },

    // ─── Player + splits ─────────────────────────────────────────────
    {
      canonicalType: "MlbPlayer",
      endpoint: "/v1/people/{personId}?hydrate=currentTeam — people[0]",
      fields: [
        { canonical: "id", vendor: "id", status: "direct" },
        { canonical: "fullName", vendor: "fullName", status: "direct" },
        { canonical: "primaryPositionAbbr", vendor: "primaryPosition.abbreviation", status: "direct" },
        { canonical: "jerseyNumber", vendor: "primaryNumber", status: "direct" },
        { canonical: "active", vendor: "active", status: "direct" },
        { canonical: "currentTeam", vendor: "currentTeam", status: "transformed", notes: "abbr empty (not in /people response)" },
      ],
    },
    {
      canonicalType: "MlbGameLogEntry",
      endpoint: "/v1/people/{personId}/stats?stats=gameLog&group={hitting|pitching}",
      fields: [
        { canonical: "date", vendor: "splits[].date", status: "direct" },
        { canonical: "gameId", vendor: "splits[].game.gamePk", status: "direct" },
        { canonical: "isHome", vendor: "splits[].isHome", status: "direct" },
        { canonical: "isWin", vendor: "splits[].isWin", status: "direct" },
        { canonical: "isLoss", vendor: "splits[].isLoss", status: "direct" },
        { canonical: "team", vendor: "splits[].team", status: "degraded", notes: "abbr empty" },
        { canonical: "opponent", vendor: "splits[].opponent", status: "degraded" },
        { canonical: "batting", vendor: "splits[].stat (when group=hitting)", status: "transformed" },
        { canonical: "pitching", vendor: "splits[].stat (when group=pitching)", status: "transformed" },
      ],
    },
    {
      canonicalType: "MlbSplitsBundle",
      endpoint: "/v1/people/{personId}/stats?stats=season,seasonAdvanced,gameLog",
      fields: [
        { canonical: "group", vendor: "(arg)", status: "derived" },
        { canonical: "hittingSeason", vendor: 'stats[type="season"].splits[0].stat (when hitting)', status: "transformed" },
        { canonical: "pitchingSeason", vendor: 'stats[type="season"].splits[0].stat (when pitching)', status: "transformed" },
        { canonical: "gameLog", vendor: 'stats[type="gameLog"].splits[]', status: "transformed" },
      ],
    },

    // ─── Fielding ────────────────────────────────────────────────────
    {
      canonicalType: "MlbFieldingSplit",
      endpoint: "/v1/people/{personId}/stats?stats=season&group=fielding",
      fields: [
        { canonical: "positionAbbr", vendor: "splits[].position.abbreviation", status: "direct" },
        { canonical: "games", vendor: "splits[].stat.games", status: "direct" },
        { canonical: "gamesStarted", vendor: "splits[].stat.gamesStarted", status: "direct" },
        { canonical: "innings", vendor: "splits[].stat.innings", status: "transformed" },
        { canonical: "chances", vendor: "splits[].stat.chances", status: "direct" },
        { canonical: "putOuts", vendor: "splits[].stat.putOuts", status: "direct" },
        { canonical: "assists", vendor: "splits[].stat.assists", status: "direct" },
        { canonical: "errors", vendor: "splits[].stat.errors", status: "direct" },
        { canonical: "doublePlays", vendor: "splits[].stat.doublePlays", status: "direct" },
        { canonical: "fieldingPercentage", vendor: "splits[].stat.fielding", status: "transformed" },
      ],
    },
  ],

  // ─── Vendor fields statsapi provides that we don't use ────────────
  unmappedVendor: [
    {
      type: "schedule envelope",
      fields: [
        { vendor: "status.codedGameState", notes: "single-letter status code (F, I, P, etc.); we use abstractGameState instead" },
        { vendor: "teams.{side}.isWinner", notes: "redundant with decisions.winner.id" },
        { vendor: "dayNight", notes: "day vs night designation; not surfaced" },
        { vendor: "doubleHeader", notes: "Y/N flag; not surfaced" },
        { vendor: "venue.id", notes: "we only carry venue name" },
        { vendor: "gamesInSeries / seriesGameNumber", notes: "series context; not surfaced" },
        { vendor: "linescore.currentInning", notes: "1-based current inning during live games; canonical doesn't carry it" },
        { vendor: "linescore.scheduledInnings", notes: "9 for regulation, 7 for DH game 1; canonical doesn't carry it" },
      ],
    },
    {
      type: "boxscore envelope",
      fields: [
        { vendor: "teams.{side}.teamStats.pitching", notes: "team pitching aggregates (we render per-pitcher)" },
        { vendor: "teams.{side}.teamStats.fielding", notes: "team fielding totals" },
        { vendor: "teams.{side}.players[*].stats.fielding", notes: "per-player fielding line in this game" },
        { vendor: "teams.{side}.players[*].gameStatus", notes: "DNP/active flags per game" },
        { vendor: "teams.{side}.players[*].allPositions[]", notes: "all positions played in the game" },
        { vendor: "teams.{side}.players[*].stats.batting.leftOnBase", notes: "per-player LOB; canonical dropped it (no current renderer)" },
        { vendor: "teams.{side}.teamStats.batting.leftOnBase", notes: "team LOB; canonical dropped it (no current renderer)" },
        { vendor: "pitchingNotes[]", notes: "vendor-supplied summary lines; canonical dropped (no current renderer)" },
        { vendor: "officials[]", notes: "umpire crew" },
        { vendor: "weather (inside info[] sometimes)", notes: "we pass info[] through unfiltered, but never highlight weather" },
      ],
    },
    {
      type: "play-by-play envelope",
      fields: [
        { vendor: "allPlays[].pitchData", notes: "pitch-level data (velocity, spin)" },
        { vendor: "allPlays[].count", notes: "balls/strikes/outs at play" },
        { vendor: "allPlays[].matchup", notes: "batter/pitcher/runners pre-play" },
        { vendor: "allPlays[].runners[].credits[]", notes: "fielding credits" },
        { vendor: "scoringPlays index", notes: "pre-filtered scoring play ids — we filter ourselves" },
      ],
    },
    {
      type: "standings envelope",
      fields: [
        { vendor: "team.locationName / clubName", notes: "we only carry name + id" },
        { vendor: "magicNumber / wildCardMagicNumber", notes: "clinch math" },
        { vendor: "pct", notes: "team-level winning pct; we derive from W/L" },
        { vendor: "runDifferential / runsScoredPerGame / runsAllowedPerGame", notes: "derivable from runsScored/Allowed and games" },
      ],
    },
    {
      type: "leaders envelope",
      fields: [
        { vendor: "leaderCategory.name / leaderCategory.code", notes: "category metadata; we know the category we asked for" },
        { vendor: "league.id / league.name", notes: "echoed back; we know what we queried" },
      ],
    },
    {
      type: "transactions envelope",
      fields: [
        { vendor: "id", notes: "transaction id; not surfaced" },
        { vendor: "typeCode", notes: "short code (TR, SC, DFA, etc.); canonical uses typeDesc display string" },
        { vendor: "effectiveDate / resolutionDate", notes: "we use single date field" },
      ],
    },
    {
      type: "roster envelope",
      fields: [
        { vendor: "person.birthDate / birthCity / birthCountry", notes: "demographic" },
        { vendor: "person.height / weight", notes: "demographic" },
        { vendor: "person.draftYear", notes: "career history" },
        { vendor: "person.mlbDebutDate", notes: "career history" },
        { vendor: "person.stats[type='careerRegularSeason']", notes: "career totals; we focus on current season" },
      ],
    },
    {
      type: "player profile envelope",
      fields: [
        { vendor: "batSide.code", notes: "L/R/S batting handedness; canonical dropped (no current renderer)" },
        { vendor: "pitchHand.code", notes: "L/R throwing handedness; canonical dropped" },
      ],
    },
    {
      type: "fielding envelope",
      fields: [
        { vendor: "splits[].stat.triplePlays", notes: "season triple plays at position; canonical dropped (extremely rare)" },
        { vendor: "splits[].stat.passedBall", notes: "catcher-specific stat" },
        { vendor: "splits[].stat.caughtStealing / stolenBases", notes: "catcher SB+CS" },
        { vendor: "splits[].stat.pickoffs", notes: "pickoff totals" },
        { vendor: "splits[].stat.rangeFactorPerGame / per9Inn", notes: "advanced fielding" },
      ],
    },
  ],
};
