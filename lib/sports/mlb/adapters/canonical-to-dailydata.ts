// Bridge: CanonicalDailyData → DailyData (the statsapi-shaped struct the
// production renderer in lib/render.ts + lib/render-email.ts consumes).
//
// Why this exists: per the canonical-preview design, we want to validate
// SDIO end-to-end by piping it through the SAME renderer the production
// digest uses. The production renderer takes statsapi shapes today; this
// bridge re-encodes canonical → statsapi shapes so renderContent and
// renderEmailContent can render either source without modification.
//
// Lossiness: canonical is the lossy direction in some places (e.g. SDIO
// doesn't carry per-position fielding splits, doesn't expose a separate
// "today's games" envelope). The bridge fills those holes with empty
// arrays or sane defaults; previewed pages will show the gap rather than
// crash. That's intentional — surfacing missing data is the whole point
// of the side-by-side.
//
// Once the production renderer is migrated to consume canonical types
// directly (the wip/sdio-canonical-model endpoint), this file goes away.

import type { CanonicalDailyData } from "../canonical";
import type {
  MlbGame,
  MlbGameStatus,
  MlbGameType,
  MlbLeague,
  MlbDivision,
  MlbBoxScore,
  MlbBoxPlayer,
  MlbScoringPlay,
  MlbStandingRow,
  MlbLeaderCategory,
  MlbTransaction,
} from "../types";

import { classifyDigestMode } from "@/lib/mlb-digest-mode";
import { findTeam } from "@/lib/teams";
import { prettyDate, timeInET } from "@/lib/dates";

// Reverse-lookup helper: canonical slug → statsapi (MLB Stats API) numeric
// team id. The production renderer is still statsapi-shaped, so the
// bridge has to thread this id through. Falls back to 0 for teams that
// aren't in lib/teams.ts (currently every MLB team is, so this should
// never fire in practice).
function mlbApiIdForSlug(slug: string): number {
  return findTeam("mlb", slug)?.mlbApiId ?? 0;
}
import type { DailyData, LeaderGroup, UpcomingGame } from "@/lib/render";
import type {
  ScheduleGame,
  Boxscore,
  BoxTeam,
  BoxPlayer,
  TeamRecord,
  DivisionStandings,
  WildCardLeagueStandings,
  Leader,
  ScoringPlay,
  Transaction,
  TeamMeta,
} from "@/lib/mlb";

// ─── Enum inverses ──────────────────────────────────────────────────────

const GAME_TYPE_CODE: Record<MlbGameType, string> = {
  "regular":         "R",
  "spring":          "S",
  "exhibition":      "E",
  "all-star":        "A",
  "wild-card":       "F",
  "division-series": "D",
  "lcs":             "L",
  "world-series":    "W",
};

// Translate canonical status into the three statsapi status fields. Only
// codedGameState is actually load-bearing in the renderer (it gates the
// "show box score" branch); the other two are display strings.
function expandStatus(status: MlbGameStatus, detail: string): ScheduleGame["status"] {
  switch (status) {
    case "final":
      return { abstractGameState: "Final",   detailedState: detail || "Final",     codedGameState: "F" };
    case "live":
      return { abstractGameState: "Live",    detailedState: detail || "In Progress", codedGameState: "I" };
    case "scheduled":
      return { abstractGameState: "Preview", detailedState: detail || "Scheduled", codedGameState: "S" };
    case "postponed":
      return { abstractGameState: "Final",   detailedState: detail || "Postponed", codedGameState: "D" };
    case "suspended":
      return { abstractGameState: "Final",   detailedState: detail || "Suspended", codedGameState: "D" };
    case "cancelled":
      return { abstractGameState: "Final",   detailedState: detail || "Cancelled", codedGameState: "D" };
    case "unknown":
    default:
      return { abstractGameState: "Unknown", detailedState: detail || "Unknown",   codedGameState: "U" };
  }
}

// statsapi-aligned league + division IDs. Mirrors lib/render.ts:DIVISIONS.
const LEAGUE_ID: Record<MlbLeague, number> = { AL: 103, NL: 104 };
const DIVISION_ID: Record<MlbLeague, Record<MlbDivision, number>> = {
  AL: { East: 201, Central: 202, West: 200 },
  NL: { East: 204, Central: 205, West: 203 },
};

// Categories the production digest renders. Map canonical category id to
// the statsapi-style label / valueLabel pair the renderer attaches to a
// LeaderGroup. Categories outside this set are filtered out.
const LEADER_DISPLAY: Partial<Record<MlbLeaderCategory, { label: string; valueLabel: string; category: string }>> = {
  battingAverage:     { label: "Batting Average",     valueLabel: "AVG", category: "battingAverage"   },
  homeRuns:           { label: "Home Runs",           valueLabel: "HR",  category: "homeRuns"         },
  runsBattedIn:       { label: "RBI",                 valueLabel: "RBI", category: "runsBattedIn"     },
  stolenBases:        { label: "Stolen Bases",        valueLabel: "SB",  category: "stolenBases"      },
  wins:               { label: "Wins",                valueLabel: "W",   category: "wins"             },
  earnedRunAverage:   { label: "ERA",                 valueLabel: "ERA", category: "earnedRunAverage" },
  strikeoutsPitching: { label: "Strikeouts (Pitching)", valueLabel: "SO", category: "strikeouts"      },
  saves:              { label: "Saves",               valueLabel: "SV",  category: "saves"            },
};

// Order leaders the same way LEADER_CATEGORIES does in lib/daily.ts so
// AL/NL panels render in the production order.
const LEADER_ORDER: MlbLeaderCategory[] = [
  "battingAverage", "homeRuns", "runsBattedIn", "stolenBases",
  "wins", "earnedRunAverage", "strikeoutsPitching", "saves",
];

// ─── Stat formatting (canonical numbers → statsapi-shape strings) ────────

function fmtRate3(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-.--";
  return v.toFixed(3);
}
function fmtRate2(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-.--";
  return v.toFixed(2);
}
function fmtIp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "0.0";
  // statsapi inningsPitched is a decimal string ("5.2" = 5⅔). Canonical
  // matches that convention so we can pass through.
  return v.toFixed(1);
}

// ─── Schedule game ───────────────────────────────────────────────────────

function gameToSchedule(g: MlbGame): ScheduleGame {
  return {
    gamePk:   g.id,
    gameDate: g.startTime,
    gameType: GAME_TYPE_CODE[g.gameType],
    status:   expandStatus(g.status, g.statusDetail),
    teams: {
      away: {
        team: { id: mlbApiIdForSlug(g.awayTeam.id), name: g.awayTeam.name, abbreviation: g.awayTeam.abbr },
        score: g.awayScore ?? undefined,
        isWinner: g.decisions?.winner ? (g.awayScore ?? -1) > (g.homeScore ?? -1) : undefined,
        probablePitcher: g.awayProbablePitcher && g.awayProbablePitcher.mlbId != null
          ? { id: g.awayProbablePitcher.mlbId, fullName: g.awayProbablePitcher.fullName }
          : undefined,
      },
      home: {
        team: { id: mlbApiIdForSlug(g.homeTeam.id), name: g.homeTeam.name, abbreviation: g.homeTeam.abbr },
        score: g.homeScore ?? undefined,
        isWinner: g.decisions?.winner ? (g.homeScore ?? -1) > (g.awayScore ?? -1) : undefined,
        probablePitcher: g.homeProbablePitcher && g.homeProbablePitcher.mlbId != null
          ? { id: g.homeProbablePitcher.mlbId, fullName: g.homeProbablePitcher.fullName }
          : undefined,
      },
    },
    linescore: g.innings.length > 0
      ? {
          innings: g.innings.map((i) => ({
            num: i.num,
            away: { runs: i.awayRuns ?? undefined },
            home: { runs: i.homeRuns ?? undefined },
          })),
          teams: {
            away: {
              runs:   g.awayScore  ?? undefined,
              hits:   g.awayHits   ?? undefined,
              errors: g.awayErrors ?? undefined,
            },
            home: {
              runs:   g.homeScore  ?? undefined,
              hits:   g.homeHits   ?? undefined,
              errors: g.homeErrors ?? undefined,
            },
          },
        }
      : undefined,
    decisions: g.decisions
      ? {
          winner: g.decisions.winner?.mlbId != null ? { id: g.decisions.winner.mlbId, fullName: g.decisions.winner.fullName } : undefined,
          loser:  g.decisions.loser?.mlbId  != null ? { id: g.decisions.loser.mlbId,  fullName: g.decisions.loser.fullName  } : undefined,
          save:   g.decisions.save?.mlbId   != null ? { id: g.decisions.save.mlbId,   fullName: g.decisions.save.fullName   } : undefined,
        }
      : undefined,
    venue: g.venueName ? { name: g.venueName } : undefined,
  };
}

// ─── Box score ───────────────────────────────────────────────────────────

function boxPlayer(p: MlbBoxPlayer): BoxPlayer {
  const b = p.batting;
  const pi = p.pitching;
  // Encode lineup slot as the statsapi "100"/"200"/... pattern so the
  // renderer's `.endsWith("00")` starter check fires correctly.
  const battingOrder = p.startingOrder
    ? `${p.startingOrder}00`
    : undefined;
  return {
    person: { id: p.player.mlbId ?? 0, fullName: p.player.fullName },
    jerseyNumber: p.jerseyNumber ?? undefined,
    position: { abbreviation: p.positionAbbr },
    battingOrder,
    stats: {
      batting: b
        ? {
            atBats:      b.atBats,
            runs:        b.runs,
            hits:        b.hits,
            rbi:         b.rbi,
            baseOnBalls: b.baseOnBalls,
            strikeOuts:  b.strikeOuts,
            homeRuns:    b.homeRuns,
            doubles:     b.doubles,
            triples:     b.triples,
            stolenBases: b.stolenBases,
          }
        : {},
      pitching: pi
        ? {
            inningsPitched: fmtIp(pi.inningsPitched),
            hits:           pi.hits,
            runs:           pi.runs,
            earnedRuns:     pi.earnedRuns,
            baseOnBalls:    pi.baseOnBalls,
            strikeOuts:     pi.strikeOuts,
            homeRuns:       pi.homeRuns,
            pitchesThrown:  pi.pitchesThrown,
            strikes:        pi.strikes,
            battersFaced:   pi.battersFaced,
          }
        : {},
      fielding: { errors: p.errors },
    },
    seasonStats: {
      batting: {
        avg: b ? fmtRate3(p.seasonBatting?.battingAverage) : undefined,
        ops: b ? fmtRate3(p.seasonBatting?.ops)            : undefined,
      },
      pitching: {
        era: pi ? fmtRate2(p.seasonPitching?.era) : undefined,
      },
      fielding: { errors: p.seasonErrors },
    },
  };
}

function boxTeam(team: MlbBoxScore["away"]): BoxTeam {
  const players: Record<string, BoxPlayer> = {};
  const battingOrder: number[] = [];
  const batters: number[] = [];
  const pitchers: number[] = [];
  for (const p of team.batters) {
    const pid = p.player.mlbId ?? 0;
    players[`ID${pid}`] = boxPlayer(p);
    batters.push(pid);
    if (p.startingOrder) battingOrder.push(pid);
  }
  for (const p of team.pitchers) {
    const pid = p.player.mlbId ?? 0;
    if (!players[`ID${pid}`]) {
      players[`ID${pid}`] = boxPlayer(p);
    }
    pitchers.push(pid);
  }
  return {
    team: { id: mlbApiIdForSlug(team.team.id), name: team.team.name, abbreviation: team.team.abbr },
    teamStats: {
      batting: {
        atBats:      team.totals.atBats,
        runs:        team.totals.runs,
        hits:        team.totals.hits,
        homeRuns:    team.totals.homeRuns,
        baseOnBalls: team.totals.baseOnBalls,
        strikeOuts:  team.totals.strikeOuts,
      },
      pitching: {},
      fielding: {},
    },
    players,
    batters,
    pitchers,
    battingOrder,
  };
}

function boxFromCanonical(box: MlbBoxScore): Boxscore {
  return {
    teams: { away: boxTeam(box.away), home: boxTeam(box.home) },
    info: box.info.map((row) => ({ label: row.label, value: row.value })),
    pitchingNotes: [],
  };
}

// ─── Standings ───────────────────────────────────────────────────────────

function gbDisplay(v: number): string {
  if (v <= 0) return "-";
  // statsapi uses "1.5" / "10" / "0.5" (no leading "+"). Match that.
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function teamRecord(row: MlbStandingRow): TeamRecord {
  const splits = [
    { type: "home",    wins: row.homeRecord.wins,    losses: row.homeRecord.losses,    pct: fmtRate3(row.homeRecord.pct).replace(/^0/, "") },
    { type: "away",    wins: row.awayRecord.wins,    losses: row.awayRecord.losses,    pct: fmtRate3(row.awayRecord.pct).replace(/^0/, "") },
    { type: "lastTen", wins: row.lastTenRecord.wins, losses: row.lastTenRecord.losses, pct: fmtRate3(row.lastTenRecord.pct).replace(/^0/, "") },
  ];
  return {
    team:               { id: mlbApiIdForSlug(row.team.id), name: row.team.name },
    wins:               row.wins,
    losses:             row.losses,
    runsScored:         row.runsScored,
    runsAllowed:        row.runsAllowed,
    gamesBack:          gbDisplay(row.gamesBehind),
    divisionRank:       String(row.divisionRank),
    wildCardRank:       row.wildCardRank != null ? String(row.wildCardRank) : undefined,
    wildCardGamesBack:  row.wildCardGamesBehind != null ? gbDisplay(row.wildCardGamesBehind) : undefined,
    streak:             { streakCode: row.streak },
    records:            { splitRecords: splits },
    leagueRecord:       {
      wins:   row.leagueRecord.wins,
      losses: row.leagueRecord.losses,
      pct:    fmtRate3(row.leagueRecord.pct).replace(/^0/, ""),
    },
  };
}

function standingsFromCanonical(d: CanonicalDailyData): DivisionStandings[] {
  return d.standings.map((g) => ({
    league:      { id: LEAGUE_ID[g.league] },
    division:    { id: DIVISION_ID[g.league][g.division] },
    teamRecords: g.teams.map(teamRecord),
  }));
}

function wildCardFromCanonical(d: CanonicalDailyData): WildCardLeagueStandings[] {
  return d.wildCard.map((g) => ({
    league:      { id: LEAGUE_ID[g.league] },
    teamRecords: g.teams.map(teamRecord),
  }));
}

// ─── Leaders ─────────────────────────────────────────────────────────────

function leaderGroupsFromCanonical(d: CanonicalDailyData, league: MlbLeague): LeaderGroup[] {
  const groups: LeaderGroup[] = [];
  for (const cat of LEADER_ORDER) {
    const meta = LEADER_DISPLAY[cat];
    if (!meta) continue;
    const board = d.leaderboards.find((b) => b.league === league && b.category === cat);
    const rows: Leader[] = (board?.entries ?? []).map<Leader>((e) => ({
      rank:   e.rank,
      value:  formatLeaderValue(cat, e.value),
      person: { id: e.player.mlbId ?? 0, fullName: e.player.fullName },
      team:   e.team ? { id: mlbApiIdForSlug(e.team.id), name: e.team.name } : undefined,
    }));
    groups.push({ label: meta.label, valueLabel: meta.valueLabel, rows });
  }
  return groups;
}

function formatLeaderValue(category: MlbLeaderCategory, v: number): string {
  switch (category) {
    case "battingAverage":
    case "ops":
    case "onBasePercentage":
    case "sluggingPercentage":
    case "whip":
      return fmtRate3(v);
    case "earnedRunAverage":
      return fmtRate2(v);
    default:
      return String(Math.round(v));
  }
}

// ─── Transactions ────────────────────────────────────────────────────────

// statsapi descriptions already begin with the team name ("Cleveland
// Guardians selected the contract of ..."). SDIO's Note field doesn't;
// the team is only available on the relational fields. To get identical
// rendering for both sources, prepend the team name when the description
// doesn't already include it.
function describeTransaction(t: MlbTransaction): string {
  const desc = t.description.trim();
  const team = t.toTeam ?? t.fromTeam;
  if (!team) return desc;
  // Already mentions either the full name or the short city — leave it alone.
  if (desc.startsWith(team.name)) return desc;
  const shortName = team.name.split(" ").pop() ?? team.name;
  if (shortName.length > 2 && desc.startsWith(shortName)) return desc;
  // Otherwise add a "Team Name: ..." prefix so the line reads like the
  // statsapi version even when the vendor only gave us a bare action.
  return `${team.name}: ${desc}`;
}

function transactionsFromCanonical(d: CanonicalDailyData): Transaction[] {
  return d.transactions.map<Transaction>((t) => ({
    typeCode:    "",
    typeDesc:    t.typeLabel,
    description: describeTransaction(t),
    fromTeamId:  t.fromTeam ? mlbApiIdForSlug(t.fromTeam.id) : undefined,
    toTeamId:    t.toTeam   ? mlbApiIdForSlug(t.toTeam.id)   : undefined,
    personId:    t.player?.mlbId ?? undefined,
  }));
}

// ─── Scoring plays + Today's Games ──────────────────────────────────────

function scoringPlayToStatsapi(p: MlbScoringPlay): ScoringPlay {
  return {
    inning:     p.inning,
    halfInning: p.half,
    event:      p.event,
    description:p.description,
    awayScore:  p.awayScore,
    homeScore:  p.homeScore,
    rbi:        p.rbi,
  };
}

function todaysGamesFromCanonical(c: CanonicalDailyData): UpcomingGame[] {
  return c.nextDayGames.map<UpcomingGame>((g) => ({
    gamePk:    g.id,
    awayName:  g.awayTeam.name,
    homeName:  g.homeTeam.name,
    awayTeamId: mlbApiIdForSlug(g.awayTeam.id),
    homeTeamId: mlbApiIdForSlug(g.homeTeam.id),
    awayProbable: g.awayProbablePitcher?.fullName,
    homeProbable: g.homeProbablePitcher?.fullName,
    // Probable W-L / ERA aren't part of the canonical bundle yet (would
    // need a per-pitcher season-stats lookup). Renderer handles missing
    // fields by collapsing the record column — preview won't crash.
    awayProbableRecord: undefined,
    homeProbableRecord: undefined,
    awayProbableEra: null,
    homeProbableEra: null,
    startTime: g.startTime ? timeInET(g.startTime) : "TBD",
    status:    g.statusDetail || g.status,
  }));
}

// ─── teamAbbrev map ─────────────────────────────────────────────────────

function teamAbbrevFromCanonical(d: CanonicalDailyData): Record<string, string> {
  const out: Record<string, string> = {};
  const stamp = (slug: string, name: string, abbr: string) => {
    if (!abbr) return;
    out[String(mlbApiIdForSlug(slug))] = abbr;
    out[name] = abbr;
  };
  for (const game of d.games) {
    stamp(game.awayTeam.id, game.awayTeam.name, game.awayTeam.abbr);
    stamp(game.homeTeam.id, game.homeTeam.name, game.homeTeam.abbr);
  }
  for (const div of d.standings) {
    for (const row of div.teams) stamp(row.team.id, row.team.name, row.team.abbr);
  }
  return out;
}

// teams envelope for the production renderer's static lookup table. Empty
// is fine — buildTeamAbbrevMap falls back to TLA_OF when no teams envelope
// rides along; we already populated teamAbbrev directly above.
function teamsEnvelope(d: CanonicalDailyData): TeamMeta[] {
  const seen = new Map<number, TeamMeta>();
  const visit = (slug: string, name: string, abbr: string) => {
    const id = mlbApiIdForSlug(slug);
    if (!seen.has(id)) seen.set(id, { id, name, abbreviation: abbr });
  };
  for (const g of d.games) {
    visit(g.awayTeam.id, g.awayTeam.name, g.awayTeam.abbr);
    visit(g.homeTeam.id, g.homeTeam.name, g.homeTeam.abbr);
  }
  for (const s of d.standings) for (const r of s.teams) visit(r.team.id, r.team.name, r.team.abbr);
  return Array.from(seen.values());
}

// ─── Public ──────────────────────────────────────────────────────────────

export function canonicalToDailyData(c: CanonicalDailyData): DailyData {
  const schedule: ScheduleGame[] = c.games.map(gameToSchedule);

  const games = schedule.map((g) => {
    const box = c.boxScores.get(g.gamePk);
    const scoring = (c.scoringPlays.get(g.gamePk) ?? []).map(scoringPlayToStatsapi);
    if (g.status.codedGameState !== "F" || !box) return { game: g };
    return { game: g, box: boxFromCanonical(box), scoring };
  });

  return {
    date:        c.date,
    prettyDate:  prettyDate(c.date),
    mode:        classifyDigestMode(schedule, c.date),
    games,
    standings:   standingsFromCanonical(c),
    wildCard:    wildCardFromCanonical(c),
    leaders: {
      AL: leaderGroupsFromCanonical(c, "AL"),
      NL: leaderGroupsFromCanonical(c, "NL"),
    },
    todaysGames: todaysGamesFromCanonical(c),
    teamAbbrev:  teamAbbrevFromCanonical(c),
    transactions: transactionsFromCanonical(c),
    // teams envelope is reconstructed for completeness; the renderer
    // reads teamAbbrev directly so this stays unused in practice.
    ...(teamsEnvelope(c).length === 0 ? {} : {}),
  };
}
