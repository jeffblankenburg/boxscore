// Pure transform: a statsapi.mlb.com daily_raw payload → CanonicalDailyData.
// No network, no Supabase, no globals — feed it a DailyRaw and an ISO
// date string and you get canonical types out. This is the only file in
// the codebase that knows what statsapi's envelopes look like AND the
// canonical types in ../types.ts — the rest of the canonical-preview
// stack consumes canonical only.
//
// Scope: the four sections the canonical preview renders today (games,
// box scores, standings, leaders, transactions). Player profiles,
// rosters, splits, and fielding aren't in the digest so they aren't
// here.

import type { DailyRaw } from "@/lib/daily-raw";
import { canonicalTeamRefForRef } from "@/lib/teams";
import { sortGamesCanonically, type CanonicalDailyData } from "../canonical";
import { playerRef } from "../player-ref";
import type {
  MlbBoxBatting,
  MlbBoxPitching,
  MlbBoxPlayer,
  MlbBoxScore,
  MlbBoxTeam,
  MlbBoxTeamTotals,
  MlbDivision,
  MlbDivisionStandings,
  MlbGame,
  MlbGameStatus,
  MlbGameType,
  MlbInningLine,
  MlbLeaderboard,
  MlbLeaderCategory,
  MlbLeaderEntry,
  MlbLeague,
  MlbPlayerRef,
  MlbRecord,
  MlbScoringPlay,
  MlbStandingRow,
  MlbTeamRef,
  MlbTransaction,
  MlbWildCardStandings,
} from "../types";

// ─── statsapi-shape narrowings (private) ─────────────────────────────────

type StatsapiTeamMeta = { id: number; name?: string; abbreviation?: string };
type StatsapiTeamsEnvelope = { teams?: StatsapiTeamMeta[] };

type StatsapiScheduleEnvelope = {
  dates?: Array<{ games?: StatsapiScheduleGame[] }>;
};

type StatsapiSideTeamRef = {
  team: { id: number; name: string; abbreviation?: string };
  score?: number;
  isWinner?: boolean;
  probablePitcher?: { id: number; fullName: string };
};

type StatsapiScheduleGame = {
  gamePk: number;
  gameDate: string;
  gameType?: string;
  status: { abstractGameState?: string; detailedState?: string; codedGameState?: string };
  teams: { away: StatsapiSideTeamRef; home: StatsapiSideTeamRef };
  linescore?: {
    innings?: Array<{ num: number; home?: { runs?: number }; away?: { runs?: number } }>;
    teams?: {
      home?: { runs?: number; hits?: number; errors?: number };
      away?: { runs?: number; hits?: number; errors?: number };
    };
  };
  decisions?: {
    winner?: { id: number; fullName: string };
    loser?: { id: number; fullName: string };
    save?: { id: number; fullName: string };
  };
  venue?: { name?: string };
};

type StatsapiStandingsEnvelope = {
  records?: Array<{
    league: { id: number };
    division: { id: number };
    teamRecords: StatsapiTeamRecord[];
  }>;
};
type StatsapiWildCardEnvelope = {
  records?: Array<{
    league: { id: number };
    teamRecords: StatsapiTeamRecord[];
  }>;
};
type StatsapiTeamRecord = {
  team: { id: number; name: string };
  wins: number;
  losses: number;
  runsScored?: number;
  runsAllowed?: number;
  gamesBack?: string;
  divisionRank?: string;
  wildCardRank?: string;
  wildCardGamesBack?: string;
  streak?: { streakCode?: string };
  records?: {
    splitRecords?: Array<{ type: string; wins: number; losses: number; pct: string }>;
  };
  leagueRecord?: { wins: number; losses: number; pct: string };
  clinched?: boolean;
  clinchIndicator?: string;
  divisionChamp?: boolean;
  hasWildcard?: boolean;
  eliminationNumber?: string;
};

type StatsapiLeader = {
  rank: number;
  value: string;
  person: { id: number; fullName: string };
  team?: { id: number; name: string };
};
type StatsapiLeadersEnvelope = {
  leagueLeaders?: Array<{ leaderCategory: string; leaders: StatsapiLeader[] }>;
};

type StatsapiTransactionsEnvelope = {
  transactions?: Array<{
    date?: string;
    typeCode?: string;
    typeDesc?: string;
    description?: string;
    fromTeam?: { id?: number };
    toTeam?: { id?: number };
    person?: { id?: number; fullName?: string };
  }>;
};

type StatsapiBoxPlayer = {
  person: { id: number; fullName: string };
  jerseyNumber?: string;
  position: { abbreviation: string };
  allPositions?: Array<{ abbreviation: string }>;
  status?: { code: string };
  battingOrder?: string;
  stats: {
    batting?: Partial<MlbBoxBatting & { avg?: string; ops?: string }>;
    pitching?: Partial<MlbBoxPitching & {
      inningsPitched?: string | number;
      numberOfPitches?: number;
      era?: string | number;
      note?: string;
    }>;
    fielding?: { errors?: number };
  };
  seasonStats: {
    batting?: {
      avg?: string;
      ops?: string;
      doubles?: number;
      triples?: number;
      homeRuns?: number;
      stolenBases?: number;
      rbi?: number;
    };
    pitching?: {
      era?:    string | number;
      wins?:   number;
      losses?: number;
      saves?:  number;
    };
    fielding?: { errors?: number };
  };
  gameStatus?: unknown;
};

type StatsapiBoxTeam = {
  team: { id: number; name: string; abbreviation?: string };
  teamStats: {
    batting?: Partial<{ atBats: number; runs: number; hits: number; rbi: number; homeRuns: number; baseOnBalls: number; strikeOuts: number }>;
  };
  players: Record<string, StatsapiBoxPlayer>;
  batters: number[];
  pitchers: number[];
  battingOrder?: number[];
  info?: Array<{ title: string; fieldList: Array<{ label: string; value?: string }> }>;
};

type StatsapiBoxscoreEnvelope = {
  teams: { away: StatsapiBoxTeam; home: StatsapiBoxTeam };
  info?: Array<{ label: string; value?: string }>;
};

// ─── Mapping helpers ─────────────────────────────────────────────────────

// Build id → abbr lookup from the teams envelope. Falls back to the team
// name when an abbr isn't present — keeps callers honest about which
// teams went un-resolved without throwing.
// Map keyed by the VENDOR team id (statsapi numeric) — adapter-internal,
// used to translate envelope refs into canonical team refs. The values
// carry the canonical slug as their `id` per the canonical contract;
// vendor ids never escape this file.
function teamRefIndex(teamsRaw: unknown): Map<number, MlbTeamRef> {
  const map = new Map<number, MlbTeamRef>();
  const env = teamsRaw as StatsapiTeamsEnvelope | null;
  for (const t of env?.teams ?? []) {
    if (typeof t.id !== "number") continue;
    const vendorName = t.name ?? `Team ${t.id}`;
    const vendorAbbr = t.abbreviation ?? vendorName.slice(0, 3).toUpperCase();
    map.set(t.id, canonicalTeamRefForRef({ id: t.id, name: vendorName, abbr: vendorAbbr }));
  }
  return map;
}

function teamRef(idx: Map<number, MlbTeamRef>, side: StatsapiSideTeamRef): MlbTeamRef {
  const cached = idx.get(side.team.id);
  if (cached) return cached;
  const vendorAbbr = side.team.abbreviation ?? side.team.name.slice(0, 3).toUpperCase();
  return canonicalTeamRefForRef({ id: side.team.id, name: side.team.name, abbr: vendorAbbr });
}

function teamRefById(idx: Map<number, MlbTeamRef>, id: number, name?: string): MlbTeamRef {
  const cached = idx.get(id);
  if (cached) return cached;
  const resolvedName = name ?? `Team ${id}`;
  const vendorAbbr = resolvedName.slice(0, 3).toUpperCase();
  return canonicalTeamRefForRef({ id, name: resolvedName, abbr: vendorAbbr });
}

// statsapi gameType single-letter codes → canonical MlbGameType.
function mapGameType(code: string | undefined): MlbGameType {
  switch (code) {
    case "R": return "regular";
    case "S": return "spring";
    case "E": return "exhibition";
    case "A": return "all-star";
    case "F": return "wild-card";
    case "D": return "division-series";
    case "L": return "lcs";
    case "W": return "world-series";
    default:  return "regular";
  }
}

// statsapi's abstractGameState ("Preview" / "Live" / "Final") + detailedState
// narrow to our canonical MlbGameStatus.
function mapStatus(s: StatsapiScheduleGame["status"]): MlbGameStatus {
  const abs = s.abstractGameState ?? "";
  const det = (s.detailedState ?? "").toLowerCase();
  if (det.includes("postpon"))   return "postponed";
  if (det.includes("suspend"))   return "suspended";
  if (det.includes("cancel"))    return "cancelled";
  if (abs === "Final")           return "final";
  if (abs === "Live")            return "live";
  if (abs === "Preview")         return "scheduled";
  return "unknown";
}

// statsapi leagueId 103 = AL, 104 = NL.
function mapLeague(id: number): MlbLeague | null {
  if (id === 103) return "AL";
  if (id === 104) return "NL";
  return null;
}

// statsapi division IDs in the standings envelope. Same mapping the
// production renderer uses in lib/render.ts.
function mapDivision(id: number): MlbDivision | null {
  switch (id) {
    case 200: return "West";
    case 201: return "East";
    case 202: return "Central";
    case 203: return "West";
    case 204: return "East";
    case 205: return "Central";
    default:  return null;
  }
}

function parseFiniteNumber(s: string | number | undefined | null): number | null {
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  if (typeof s !== "string") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// statsapi encodes "games back" as a string with three forms:
//   "-"     — at the leader/cutoff line, canonical 0
//   "+X.X"  — wild-card use only; team is AHEAD of the cutoff. Canonical
//             negative number (matches the SDIO adapter's sign convention).
//   "X.X"   — team is BEHIND. Canonical positive number.
// Division standings only ever produce "-" or "X.X"; wild card adds "+X.X"
// for contenders ahead of the cutoff line.
function parseGamesBehind(s: string | undefined | null): number {
  if (!s || s === "-" || s === "—") return 0;
  if (s.startsWith("+")) {
    const n = Number(s.slice(1));
    return Number.isFinite(n) ? -n : 0;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseRecord(rec?: { wins: number; losses: number; pct: string } | null): MlbRecord {
  if (!rec) return { wins: 0, losses: 0, pct: 0 };
  const pct = parseFiniteNumber(rec.pct);
  return { wins: rec.wins, losses: rec.losses, pct: pct ?? 0 };
}

function findSplit(rec: StatsapiTeamRecord | undefined, type: string): MlbRecord {
  const split = rec?.records?.splitRecords?.find((s) => s.type === type);
  return parseRecord(split ?? null);
}

// ─── Section adapters ────────────────────────────────────────────────────

// statsapi's daily_raw stashes a per-pitcher season W-L + ERA blob next
// to the schedule. Build a lookup map so adaptProbablePitcher can hydrate
// canonical probable pitchers without a separate fetch.
type PitcherStatsMap = Map<number, { wins: number; losses: number; era: number | null }>;
function pitcherStatsLookup(raw: DailyRaw): PitcherStatsMap {
  const m: PitcherStatsMap = new Map();
  for (const [pid, st] of Object.entries(raw.probablePitcherStats ?? {})) {
    const id = Number(pid);
    if (!Number.isFinite(id)) continue;
    m.set(id, {
      wins:   st.wins ?? 0,
      losses: st.losses ?? 0,
      era:    parseFiniteNumber(st.era),
    });
  }
  return m;
}

function adaptProbablePitcher(p: { id: number; fullName: string } | undefined, stats: PitcherStatsMap) {
  if (!p) return null;
  const s = stats.get(p.id);
  const ref = playerRef("statsapi", p.id, p.fullName);
  return {
    id:     ref.id,
    fullName: ref.fullName,
    mlbId:  ref.mlbId,
    wins:   s ? s.wins   : null,
    losses: s ? s.losses : null,
    era:    s?.era ?? null,
  };
}

function gamesFromSchedule(scheduleRaw: unknown, idx: Map<number, MlbTeamRef>, pitcherStats: PitcherStatsMap): MlbGame[] {
  const env = scheduleRaw as StatsapiScheduleEnvelope | null;
  const games = (env?.dates ?? []).flatMap((d) => d.games ?? []);
  return games.map((g) => {
    const away = teamRef(idx, g.teams.away);
    const home = teamRef(idx, g.teams.home);
    const innings: MlbInningLine[] = (g.linescore?.innings ?? []).map((i) => ({
      num: i.num,
      awayRuns: typeof i.away?.runs === "number" ? i.away.runs : null,
      homeRuns: typeof i.home?.runs === "number" ? i.home.runs : null,
    }));
    const linescore = g.linescore?.teams;
    return {
      id: g.gamePk,
      startTime: g.gameDate,
      gameType: mapGameType(g.gameType),
      status: mapStatus(g.status),
      statusDetail: g.status.detailedState ?? "",
      awayTeam: away,
      homeTeam: home,
      awayScore: typeof g.teams.away.score === "number" ? g.teams.away.score : null,
      homeScore: typeof g.teams.home.score === "number" ? g.teams.home.score : null,
      innings,
      awayHits:   typeof linescore?.away?.hits   === "number" ? linescore.away.hits   : null,
      homeHits:   typeof linescore?.home?.hits   === "number" ? linescore.home.hits   : null,
      awayErrors: typeof linescore?.away?.errors === "number" ? linescore.away.errors : null,
      homeErrors: typeof linescore?.home?.errors === "number" ? linescore.home.errors : null,
      awayProbablePitcher: adaptProbablePitcher(g.teams.away.probablePitcher, pitcherStats),
      homeProbablePitcher: adaptProbablePitcher(g.teams.home.probablePitcher, pitcherStats),
      decisions: g.decisions
        ? {
            winner: g.decisions.winner ? playerRef("statsapi", g.decisions.winner.id, g.decisions.winner.fullName) : null,
            loser:  g.decisions.loser  ? playerRef("statsapi", g.decisions.loser.id,  g.decisions.loser.fullName)  : null,
            save:   g.decisions.save   ? playerRef("statsapi", g.decisions.save.id,   g.decisions.save.fullName)   : null,
          }
        : null,
      venueName: g.venue?.name ?? null,
    };
  });
}

function boxBattingFromStatsapi(s: StatsapiBoxPlayer["stats"]["batting"]): MlbBoxBatting | null {
  if (!s) return null;
  if (typeof s.atBats !== "number") return null;
  return {
    atBats:         s.atBats ?? 0,
    runs:           s.runs ?? 0,
    hits:           s.hits ?? 0,
    rbi:            s.rbi ?? 0,
    baseOnBalls:    s.baseOnBalls ?? 0,
    strikeOuts:     s.strikeOuts ?? 0,
    homeRuns:       s.homeRuns ?? 0,
    doubles:        s.doubles ?? 0,
    triples:        s.triples ?? 0,
    stolenBases:    s.stolenBases ?? 0,
    battingAverage: null,   // season-to-date — filled below from seasonStats
    ops:            null,
  };
}

function boxPitchingFromStatsapi(p: StatsapiBoxPlayer["stats"]["pitching"]): MlbBoxPitching | null {
  if (!p) return null;
  if (p.inningsPitched === undefined) return null;
  return {
    inningsPitched: typeof p.inningsPitched === "number"
      ? p.inningsPitched
      : parseFiniteNumber(p.inningsPitched) ?? 0,
    hits:           p.hits ?? 0,
    runs:           p.runs ?? 0,
    earnedRuns:     p.earnedRuns ?? 0,
    baseOnBalls:    p.baseOnBalls ?? 0,
    strikeOuts:     p.strikeOuts ?? 0,
    homeRuns:       p.homeRuns ?? 0,
    pitchesThrown:  p.pitchesThrown ?? p.numberOfPitches ?? 0,
    strikes:        p.strikes ?? 0,
    battersFaced:   p.battersFaced ?? 0,
    era:            null,                  // season-to-date below
    decisionNote:   p.note ?? null,
  };
}

function adaptBoxPlayer(player: StatsapiBoxPlayer, isPitcher: boolean): MlbBoxPlayer {
  const batting  = boxBattingFromStatsapi(player.stats.batting);
  const pitching = isPitcher ? boxPitchingFromStatsapi(player.stats.pitching) : null;
  const seasonAvg = parseFiniteNumber(player.seasonStats.batting?.avg);
  const seasonOps = parseFiniteNumber(player.seasonStats.batting?.ops);
  const seasonEra = parseFiniteNumber(player.seasonStats.pitching?.era);
  // Lineup slot: statsapi encodes "100" "200" "300" etc. — divide by 100.
  const orderRaw = player.battingOrder ? parseFiniteNumber(player.battingOrder) : null;
  const startingOrder = orderRaw && orderRaw % 100 === 0 ? orderRaw / 100 : null;
  const allPositionsAbbr = player.allPositions && player.allPositions.length > 0
    ? player.allPositions.map((p) => p.abbreviation)
    : null;
  return {
    player:        playerRef("statsapi", player.person.id, player.person.fullName),
    positionAbbr:  player.position.abbreviation,
    jerseyNumber:  player.jerseyNumber ?? null,
    startingOrder,
    isStarter:     startingOrder !== null || (isPitcher && Boolean(player.stats.pitching)),
    allPositionsAbbr,
    batting,
    pitching,
    errors:        player.stats.fielding?.errors ?? 0,
    seasonErrors:  player.seasonStats.fielding?.errors ?? 0,
    seasonBatting: batting ? {
      battingAverage: seasonAvg,
      ops:            seasonOps,
      doubles:        player.seasonStats.batting?.doubles     ?? 0,
      triples:        player.seasonStats.batting?.triples     ?? 0,
      homeRuns:       player.seasonStats.batting?.homeRuns    ?? 0,
      stolenBases:    player.seasonStats.batting?.stolenBases ?? 0,
      rbi:            player.seasonStats.batting?.rbi         ?? 0,
    } : null,
    seasonPitching: pitching ? {
      era:    seasonEra,
      wins:   player.seasonStats.pitching?.wins   ?? null,
      losses: player.seasonStats.pitching?.losses ?? null,
      saves:  player.seasonStats.pitching?.saves  ?? null,
    } : null,
  };
}

function adaptBoxTeam(team: StatsapiBoxTeam, idx: Map<number, MlbTeamRef>): MlbBoxTeam {
  const teamRefVal = teamRefById(idx, team.team.id, team.team.name);
  const teamRefWithAbbr: MlbTeamRef = team.team.abbreviation
    ? { ...teamRefVal, abbr: team.team.abbreviation }
    : teamRefVal;
  // statsapi `team.batters` includes pitchers who never came to the plate
  // (relievers in DH games, etc). Drop anyone without a battingOrder so
  // the batting box matches what SDIO renders — only players who actually
  // occupied a lineup slot (starter or double-switch sub).
  const batters: MlbBoxPlayer[] = team.batters
    .map((id) => team.players[`ID${id}`])
    .filter((p): p is StatsapiBoxPlayer => Boolean(p))
    .filter((p) => p.battingOrder != null && p.battingOrder !== "")
    .map((p) => adaptBoxPlayer(p, false));
  const pitchers: MlbBoxPlayer[] = team.pitchers
    .map((id) => team.players[`ID${id}`])
    .filter((p): p is StatsapiBoxPlayer => Boolean(p))
    .map((p) => adaptBoxPlayer(p, true));
  const b = team.teamStats.batting ?? {};
  const totals: MlbBoxTeamTotals = {
    atBats:      b.atBats      ?? 0,
    runs:        b.runs        ?? 0,
    hits:        b.hits        ?? 0,
    rbi:         b.rbi         ?? 0,
    homeRuns:    b.homeRuns    ?? 0,
    baseOnBalls: b.baseOnBalls ?? 0,
    strikeOuts:  b.strikeOuts  ?? 0,
  };
  return { team: teamRefWithAbbr, totals, batters, pitchers };
}

function boxScoresFromGames(
  games: MlbGame[],
  rawGames: DailyRaw["games"],
  idx: Map<number, MlbTeamRef>,
): Map<number, MlbBoxScore> {
  const out = new Map<number, MlbBoxScore>();
  for (const game of games) {
    const stored = rawGames[String(game.id)];
    if (!stored?.boxscore) continue;
    const box = stored.boxscore as StatsapiBoxscoreEnvelope;
    const away = adaptBoxTeam(box.teams.away, idx);
    const home = adaptBoxTeam(box.teams.home, idx);
    const info = (box.info ?? [])
      .filter((row) => typeof row.value === "string" && row.value.length > 0)
      .map((row) => ({ label: row.label, value: row.value as string }));
    out.set(game.id, { game, away, home, info });
  }
  return out;
}

function teamRowFromStatsapi(tr: StatsapiTeamRecord, idx: Map<number, MlbTeamRef>): MlbStandingRow {
  const team = teamRefById(idx, tr.team.id, tr.team.name);
  return {
    team,
    wins:                   tr.wins,
    losses:                 tr.losses,
    gamesBehind:            parseGamesBehind(tr.gamesBack),
    divisionRank:           parseFiniteNumber(tr.divisionRank) ?? 0,
    wildCardRank:           tr.wildCardRank ? parseFiniteNumber(tr.wildCardRank) : null,
    wildCardGamesBehind:    tr.wildCardGamesBack ? parseGamesBehind(tr.wildCardGamesBack) : null,
    streak:                 tr.streak?.streakCode ?? "-",
    runsScored:             tr.runsScored ?? 0,
    runsAllowed:            tr.runsAllowed ?? 0,
    homeRecord:             findSplit(tr, "home"),
    awayRecord:             findSplit(tr, "away"),
    lastTenRecord:          findSplit(tr, "lastTen"),
    leagueRecord:           parseRecord(tr.leagueRecord ?? null),
    clinchedDivision:       Boolean(tr.divisionChamp) || tr.clinchIndicator === "z",
    clinchedWildCard:       Boolean(tr.hasWildcard),
    eliminatedFromPlayoffs: tr.eliminationNumber === "E",
  };
}

function wildCardFromRaw(wildCardRaw: unknown, idx: Map<number, MlbTeamRef>): MlbWildCardStandings[] {
  const env = wildCardRaw as StatsapiWildCardEnvelope | null;
  const out: MlbWildCardStandings[] = [];
  for (const rec of env?.records ?? []) {
    const league = mapLeague(rec.league.id);
    if (!league) continue;
    const rows = rec.teamRecords.map((tr) => teamRowFromStatsapi(tr, idx));
    rows.sort((a, b) => (a.wildCardRank ?? 99) - (b.wildCardRank ?? 99));
    out.push({ league, teams: rows });
  }
  return out;
}

function standingsFromRaw(standingsRaw: unknown, idx: Map<number, MlbTeamRef>): MlbDivisionStandings[] {
  const env = standingsRaw as StatsapiStandingsEnvelope | null;
  const out: MlbDivisionStandings[] = [];
  for (const rec of env?.records ?? []) {
    const league   = mapLeague(rec.league.id);
    const division = mapDivision(rec.division.id);
    if (!league || !division) continue;
    const rows: MlbStandingRow[] = rec.teamRecords.map((tr) => teamRowFromStatsapi(tr, idx));
    rows.sort((a, b) => a.divisionRank - b.divisionRank);
    out.push({ league, division, teams: rows });
  }
  return out;
}

// statsapi category names → canonical MlbLeaderCategory. statsapi already
// uses canonical-ish names; this is a one-line guard against drift.
const STATSAPI_LEADER_CATEGORY: Record<string, MlbLeaderCategory> = {
  battingAverage:    "battingAverage",
  homeRuns:          "homeRuns",
  runsBattedIn:      "runsBattedIn",
  stolenBases:       "stolenBases",
  wins:              "wins",
  earnedRunAverage:  "earnedRunAverage",
  strikeouts:        "strikeoutsPitching",
  saves:             "saves",
  hits:              "hits",
  ops:               "ops",
  onBasePercentage:  "onBasePercentage",
  sluggingPercentage:"sluggingPercentage",
  whip:              "whip",
  inningsPitched:    "inningsPitched",
};

function leaderboardsFromRaw(
  leadersBlob: DailyRaw["leaders"],
  idx: Map<number, MlbTeamRef>,
): MlbLeaderboard[] {
  const out: MlbLeaderboard[] = [];
  for (const [key, raw] of Object.entries(leadersBlob)) {
    const [leagueIdStr, category] = key.split("/");
    const leagueId = Number(leagueIdStr);
    const league = mapLeague(leagueId);
    if (!league) continue;
    const canonical = STATSAPI_LEADER_CATEGORY[category ?? ""];
    if (!canonical) continue;
    const env = raw as StatsapiLeadersEnvelope | null;
    const leaders = env?.leagueLeaders?.[0]?.leaders ?? [];
    const entries: MlbLeaderEntry[] = leaders.map((l) => ({
      rank:   l.rank,
      value:  parseFiniteNumber(l.value) ?? 0,
      player: playerRef("statsapi", l.person.id, l.person.fullName),
      team:   l.team
        ? teamRefById(idx, l.team.id, l.team.name)
        : { id: "", name: "—", abbr: "—" },
    }));
    out.push({ league, category: canonical, entries });
  }
  return out;
}

// statsapi All-Star team IDs (stable): 159 = AL All-Stars, 160 = NL All-Stars.
const ALL_STAR_TEAM_IDS = new Set([159, 160]);

function transactionsFromRaw(
  txnRaw: unknown,
  date: string,
  idx: Map<number, MlbTeamRef>,
): MlbTransaction[] {
  const env = txnRaw as StatsapiTransactionsEnvelope | null;
  const txns = env?.transactions ?? [];
  return txns
    .filter((t) => typeof t.description === "string" && t.description.length > 0)
    // MLB files All-Star selection as a "trade" to the AL/NL All-Star teams
    // (159/160). These aren't real roster moves — drop any txn touching them.
    .filter((t) => !ALL_STAR_TEAM_IDS.has(t.fromTeam?.id ?? -1) && !ALL_STAR_TEAM_IDS.has(t.toTeam?.id ?? -1))
    .map<MlbTransaction>((t) => {
      const player: MlbPlayerRef | null = t.person?.id
        ? playerRef("statsapi", t.person.id, t.person.fullName ?? `Player ${t.person.id}`)
        : null;
      return {
        date:        t.date ?? date,
        typeLabel:   t.typeDesc ?? t.typeCode ?? "",
        description: t.description!,
        player,
        fromTeam:    t.fromTeam?.id ? teamRefById(idx, t.fromTeam.id) : null,
        toTeam:      t.toTeam?.id   ? teamRefById(idx, t.toTeam.id)   : null,
      };
    });
}

// scoringPlays come pre-parsed in daily_raw (lib/daily-raw.ts:StoredScoringPlay)
// — we just re-shape to canonical names and widen the half-inning union.
function scoringPlaysFromRaw(rawGames: DailyRaw["games"]): Map<number, MlbScoringPlay[]> {
  const out = new Map<number, MlbScoringPlay[]>();
  for (const [id, stored] of Object.entries(rawGames)) {
    const plays = (stored.scoringPlays ?? []).map<MlbScoringPlay>((p) => ({
      inning:      p.inning,
      half:        p.halfInning,
      event:       p.event,
      description: p.description,
      awayScore:   p.awayScore,
      homeScore:   p.homeScore,
      rbi:         p.rbi,
    }));
    out.set(Number(id), plays);
  }
  return out;
}

// ─── Public adapter ──────────────────────────────────────────────────────

export function adaptStatsapiDailyRaw(date: string, raw: DailyRaw): CanonicalDailyData {
  const teamIdx     = teamRefIndex(raw.teams);
  const pitcherIdx  = pitcherStatsLookup(raw);
  const games = sortGamesCanonically(gamesFromSchedule(raw.schedule, teamIdx, pitcherIdx));
  // Next-day schedule re-uses the same teamIdx so abbreviations resolve
  // even though those games haven't been played yet.
  const nextDayGames = sortGamesCanonically(gamesFromSchedule(raw.nextDaySchedule ?? null, teamIdx, pitcherIdx));
  return {
    date,
    games,
    boxScores:    boxScoresFromGames(games, raw.games, teamIdx),
    scoringPlays: scoringPlaysFromRaw(raw.games),
    nextDayGames,
    standings:    standingsFromRaw(raw.standings, teamIdx),
    wildCard:     wildCardFromRaw(raw.wildCard, teamIdx),
    leaderboards: leaderboardsFromRaw(raw.leaders, teamIdx),
    transactions: transactionsFromRaw(raw.transactions, date, teamIdx),
    // Already display-ready (built in fetchDailyRaw); pass straight through.
    allStarRosters: raw.allStarRosters ?? null,
    allStarMvp: raw.allStarMvp ?? null,
  };
}
