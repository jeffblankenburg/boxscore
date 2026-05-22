import {
  fetchScheduleRaw, parseSchedule,
  fetchStandingsRaw, parseStandings,
  fetchWildCardRaw, parseWildCard,
  fetchLeadersRaw, parseLeaders,
  fetchBoxscoreRaw, parseBoxscore,
  fetchPlayByPlayRaw, parseScoringPlays,
  fetchTeamsRaw, parseTeams,
  fetchPersonSeasonPitchingRaw, parsePersonWL,
  fetchTransactionsRaw, parseTransactions,
} from "./mlb";
import type { GameDetail, DailyData, UpcomingGame } from "./render";
import { classifyDigestMode } from "./mlb-digest-mode";
import { prettyDate, nextDay, timeInET } from "./dates";
import {
  getDailyRaw, upsertDailyRaw,
  type DailyRaw, type StoredScoringPlay, type ProbablePitcherStats,
} from "./daily-raw";

const LEADER_CATEGORIES = [
  { category: "battingAverage", label: "Batting Average", valueLabel: "AVG" },
  { category: "homeRuns", label: "Home Runs", valueLabel: "HR" },
  { category: "runsBattedIn", label: "RBI", valueLabel: "RBI" },
  { category: "stolenBases", label: "Stolen Bases", valueLabel: "SB" },
  { category: "wins", label: "Wins", valueLabel: "W" },
  { category: "earnedRunAverage", label: "ERA", valueLabel: "ERA" },
  { category: "strikeouts", label: "Strikeouts (Pitching)", valueLabel: "SO" },
  { category: "saves", label: "Saves", valueLabel: "SV" },
] as const;

// Extract probable pitcher IDs from a parsed schedule.
function probablePitcherIds(scheduleRaw: unknown): number[] {
  if (!scheduleRaw) return [];
  const games = parseSchedule(scheduleRaw);
  const ids = new Set<number>();
  for (const g of games) {
    if (g.teams.away.probablePitcher?.id) ids.add(g.teams.away.probablePitcher.id);
    if (g.teams.home.probablePitcher?.id) ids.add(g.teams.home.probablePitcher.id);
  }
  return Array.from(ids);
}

// Fetch every MLB endpoint needed for a single date, returning the unmodified
// envelopes plus pre-parsed scoring plays and probable-pitcher records. This
// is the only function that hits MLB; everything else parses what we already
// have in daily_raw.
async function fetchDailyRaw(date: string): Promise<DailyRaw> {
  const season = Number(date.slice(0, 4));

  // First wave: schedules + standings + leaders + teams, in parallel. Fetch
  // 20 even though regular game days render only 5 — gives the renderer
  // headroom to extend through ties beyond both the top-5 (regular) and
  // top-15 (ASG) cutoffs without re-fetching. Marginal storage cost is trivial.
  const leaderCalls = LEADER_CATEGORIES.flatMap((c) => [
    fetchLeadersRaw(c.category, season, 103, 20),
    fetchLeadersRaw(c.category, season, 104, 20),
  ]);
  const [
    scheduleRaw, standingsRaw, wildCardRaw, nextDayScheduleRaw, teamsRaw, transactionsRaw,
    ...leaderResults
  ] = await Promise.all([
    fetchScheduleRaw(date),
    fetchStandingsRaw(season, date),
    fetchWildCardRaw(season, date),
    fetchScheduleRaw(nextDay(date)),
    fetchTeamsRaw(season),
    fetchTransactionsRaw(date),
    ...leaderCalls,
  ]);

  const leaders: DailyRaw["leaders"] = {};
  for (let i = 0; i < LEADER_CATEGORIES.length; i++) {
    const c = LEADER_CATEGORIES[i]!;
    leaders[`103/${c.category}`] = leaderResults[i * 2];
    leaders[`104/${c.category}`] = leaderResults[i * 2 + 1];
  }

  // Second wave: per-game boxscore + scoringPlays for completed games, and
  // season W-L for each probable pitcher on the next day's schedule.
  const schedule = parseSchedule(scheduleRaw);
  const finalGamePks = schedule
    .filter((g) => g.status.codedGameState === "F")
    .map((g) => g.gamePk);

  const pitcherIds = probablePitcherIds(nextDayScheduleRaw);

  const [gameResults, pitcherResults] = await Promise.all([
    Promise.all(
      finalGamePks.map(async (pk) => {
        const [boxscore, playByPlay] = await Promise.all([
          fetchBoxscoreRaw(pk),
          fetchPlayByPlayRaw(pk),
        ]);
        const scoringPlays: StoredScoringPlay[] = parseScoringPlays(playByPlay);
        return [pk, { boxscore, scoringPlays }] as const;
      }),
    ),
    Promise.all(
      pitcherIds.map(async (id) => {
        const wl = parsePersonWL(await fetchPersonSeasonPitchingRaw(id, season));
        return [String(id), wl] as const;
      }),
    ),
  ]);

  const games: DailyRaw["games"] = {};
  for (const [pk, g] of gameResults) games[String(pk)] = g;

  const probablePitcherStats: Record<string, ProbablePitcherStats> = {};
  for (const [id, wl] of pitcherResults) probablePitcherStats[id] = wl;

  return {
    schedule: scheduleRaw,
    standings: standingsRaw,
    wildCard: wildCardRaw,
    leaders,
    games,
    nextDaySchedule: nextDayScheduleRaw,
    teams: teamsRaw,
    probablePitcherStats,
    transactions: transactionsRaw,
  };
}

function upcomingFromRaw(
  scheduleRaw: unknown,
  pitcherStats: Record<string, ProbablePitcherStats> | undefined,
): UpcomingGame[] {
  if (!scheduleRaw) return [];
  return parseSchedule(scheduleRaw).map((g) => {
    const ap = g.teams.away.probablePitcher;
    const hp = g.teams.home.probablePitcher;
    const apStats = ap ? pitcherStats?.[String(ap.id)] : undefined;
    const hpStats = hp ? pitcherStats?.[String(hp.id)] : undefined;
    return {
      gamePk: g.gamePk,
      awayName: g.teams.away.team.name,
      homeName: g.teams.home.team.name,
      awayTeamId: g.teams.away.team.id,
      homeTeamId: g.teams.home.team.id,
      awayProbable: ap?.fullName,
      homeProbable: hp?.fullName,
      awayProbableRecord: apStats ? `${apStats.wins}-${apStats.losses}` : undefined,
      homeProbableRecord: hpStats ? `${hpStats.wins}-${hpStats.losses}` : undefined,
      awayProbableEra: apStats?.era ?? null,
      homeProbableEra: hpStats?.era ?? null,
      startTime: timeInET(g.gameDate),
      status: g.status.detailedState,
    };
  });
}

function buildTeamAbbrevMap(teamsRaw: unknown): Record<string, string> {
  if (!teamsRaw) return {};
  const out: Record<string, string> = {};
  for (const t of parseTeams(teamsRaw)) {
    if (t.abbreviation) out[t.name] = t.abbreviation;
  }
  return out;
}

// Pure transform: raw payloads → DailyData. No network.
function rawToDailyData(raw: DailyRaw, date: string): DailyData {
  const schedule = parseSchedule(raw.schedule);
  const games: GameDetail[] = schedule.map((game): GameDetail => {
    if (game.status.codedGameState !== "F") return { game };
    const stored = raw.games[String(game.gamePk)];
    if (!stored) return { game };
    return {
      game,
      box: parseBoxscore(stored.boxscore),
      scoring: stored.scoringPlays,
    };
  });

  return {
    date,
    prettyDate: prettyDate(date),
    mode: classifyDigestMode(schedule, date),
    games,
    standings: parseStandings(raw.standings),
    wildCard: parseWildCard(raw.wildCard),
    leaders: {
      AL: LEADER_CATEGORIES.map((c) => ({
        label: c.label, valueLabel: c.valueLabel,
        rows: parseLeaders(raw.leaders[`103/${c.category}`]),
      })),
      NL: LEADER_CATEGORIES.map((c) => ({
        label: c.label, valueLabel: c.valueLabel,
        rows: parseLeaders(raw.leaders[`104/${c.category}`]),
      })),
    },
    todaysGames: upcomingFromRaw(raw.nextDaySchedule, raw.probablePitcherStats),
    teamAbbrev: buildTeamAbbrevMap(raw.teams),
    transactions: raw.transactions ? parseTransactions(raw.transactions) : [],
  };
}

// Pre-shape rows lack `teams` and store playByPlay instead of scoringPlays.
// Treat those as cache misses so the next load refetches.
function isOldShape(raw: DailyRaw): boolean {
  if (!raw.teams) return true;
  for (const g of Object.values(raw.games)) {
    if (!Array.isArray((g as { scoringPlays?: unknown }).scoringPlays)) return true;
  }
  return false;
}

// Older probablePitcherStats rows captured only {wins, losses} — ERA was
// added later. Re-fetch the per-pitcher stats batch when any stored row lacks
// the era field.
function probableStatsMissingEra(raw: DailyRaw): boolean {
  const stats = raw.probablePitcherStats;
  if (!stats) return false;
  for (const v of Object.values(stats)) {
    if (typeof (v as { era?: unknown }).era === "undefined") return true;
  }
  return false;
}

async function refetchProbablePitcherStats(scheduleRaw: unknown, season: number): Promise<Record<string, ProbablePitcherStats>> {
  if (!scheduleRaw) return {};
  const ids = new Set<number>();
  for (const g of parseSchedule(scheduleRaw)) {
    if (g.teams.away.probablePitcher?.id) ids.add(g.teams.away.probablePitcher.id);
    if (g.teams.home.probablePitcher?.id) ids.add(g.teams.home.probablePitcher.id);
  }
  const results = await Promise.all(
    Array.from(ids).map(async (id) => {
      const wl = parsePersonWL(await fetchPersonSeasonPitchingRaw(id, season));
      return [String(id), wl] as const;
    }),
  );
  const out: Record<string, ProbablePitcherStats> = {};
  for (const [id, wl] of results) out[id] = wl;
  return out;
}

// Read-through: stored raw → DailyData. If raw is missing, in the old shape,
// or refetch=true was passed, fetch from MLB and write through. For rows that
// just lack newer fields (transactions, ERA on probables), lazy-patch with
// the minimum extra fetches.
//
// Leaders preservation: the /v1/stats/leaders endpoint has no point-in-time
// query — it always returns CURRENT season state. So on any refetch of an
// old date, we keep the originally-cached `leaders` block rather than
// stomping it with today's leader board. Historical accuracy beats freshness
// here; the leaders shown on a 2026-03-25 page should be from late March
// 2026, not whatever's current today.
export async function loadDailyData(date: string, opts?: { refetch?: boolean }): Promise<DailyData> {
  const existing = await getDailyRaw("mlb", date);
  const stale = !existing || isOldShape(existing) || opts?.refetch === true;

  let raw: DailyRaw;
  if (stale) {
    raw = await fetchDailyRaw(date);
    if (existing?.leaders && Object.keys(existing.leaders).length > 0) {
      raw = { ...raw, leaders: existing.leaders };
    }
    await upsertDailyRaw("mlb", date, raw);
  } else {
    raw = existing;
    let dirty = false;
    if (!raw.transactions) {
      raw = { ...raw, transactions: await fetchTransactionsRaw(date) };
      dirty = true;
    }
    if (probableStatsMissingEra(raw)) {
      const season = Number(date.slice(0, 4));
      raw = { ...raw, probablePitcherStats: await refetchProbablePitcherStats(raw.nextDaySchedule, season) };
      dirty = true;
    }
    if (dirty) await upsertDailyRaw("mlb", date, raw);
  }
  return rawToDailyData(raw, date);
}
