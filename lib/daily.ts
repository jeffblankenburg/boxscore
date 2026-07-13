import {
  fetchScheduleRaw, parseSchedule,
  fetchStandingsRaw, parseStandings,
  fetchWildCardRaw, parseWildCard,
  fetchLeadersRaw, parseLeaders,
  fetchBoxscoreRaw, parseBoxscore,
  fetchPlayByPlayRaw, parseScoringPlays,
  fetchTeamsRaw, parseTeams,
  fetchPersonSeasonPitchingRaw, parsePersonWL,
  fetchPersonSeasonStatsRaw, parsePersonSeasonStat,
  fetchTransactionsRaw, parseTransactions,
} from "./mlb";
import type { AsgRosters, AsgSide, AsgHitter, AsgPitcher } from "./sports/mlb/canonical";
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
// ─── All-Star rosters (all-star-preview edition) ─────────────────────────
// Built only on the day before the ASG (when nextDaySchedule holds the ASG
// game). The ASG boxscore gives the player pool + parentTeamId; the per-player
// season line comes from a real season-stats fetch (the boxscore's own
// seasonStats is the ASG game line, not season totals). Role (SP/RP) is
// derived from gamesStarted — statsapi's position field is only "P".
type AsgBoxPlayer = {
  person?: { id?: number; fullName?: string };
  position?: { abbreviation?: string };
  parentTeamId?: number;
};
type AsgBoxSide = {
  players?: Record<string, AsgBoxPlayer>;
  battingOrder?: number[]; // starter person IDs, in batting order (once announced)
};

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" ? v
  : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v)
  : null;
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : null;

const ASG_POS_ORDER: Record<string, number> = {
  C: 1, "1B": 2, "2B": 3, "3B": 4, SS: 5, LF: 6, CF: 6, RF: 6, OF: 6, DH: 7,
};

// One player's season line, resilient to a statsapi hiccup on any single
// call — a failed fetch yields empty stats (rendered as "—") rather than
// rejecting the whole roster batch.
async function safeSeasonStat(personId: number, season: number, group: "hitting" | "pitching"): Promise<Record<string, unknown>> {
  try {
    return parsePersonSeasonStat(await fetchPersonSeasonStatsRaw(personId, season, group));
  } catch {
    return {};
  }
}

async function buildAsgSide(side: AsgBoxSide | undefined, abbrev: Map<number, string>, season: number, starterPitcherId: number | null): Promise<AsgSide> {
  // Batting-order slot (1-9) per starter id, populated once MLB posts the
  // lineup. The announced starting pitcher is the game's probable (exactly one
  // per side) — NOT the boxscore `pitchers` array, which for a completed game
  // lists everyone who appeared.
  const orderOf = new Map<number, number>();
  (side?.battingOrder ?? []).forEach((id, i) => orderOf.set(id, i + 1));

  const pool = (side?.players ? Object.values(side.players) : [])
    .map((p) => ({
      id: p.person?.id,
      name: p.person?.fullName ?? "",
      pos: p.position?.abbreviation ?? "",
      team: p.parentTeamId != null ? (abbrev.get(p.parentTeamId) ?? "") : "",
    }))
    // Drop the "American League"/"National League" placeholder slots the ASG
    // boxscore includes for the TBD probable-pitcher entries.
    .filter((p): p is { id: number; name: string; pos: string; team: string } =>
      typeof p.id === "number" && !p.name.includes("League"));

  const built = await Promise.all(pool.map(async (p) => {
    if (p.pos === "P") {
      const s = await safeSeasonStat(p.id, season, "pitching");
      const gs = numOrNull(s.gamesStarted) ?? 0;
      const gp = numOrNull(s.gamesPlayed) ?? 0;
      const role: "SP" | "RP" = gs > 0 && gs >= gp * 0.5 ? "SP" : "RP";
      const pitcher: AsgPitcher = {
        name: p.name, mlbId: p.id, role, team: p.team, starter: p.id === starterPitcherId,
        ip: strOrNull(s.inningsPitched), er: numOrNull(s.earnedRuns),
        bb: numOrNull(s.baseOnBalls), k: numOrNull(s.strikeOuts), era: strOrNull(s.era),
      };
      return { kind: "P" as const, pitcher };
    }
    const s = await safeSeasonStat(p.id, season, "hitting");
    const hitter: AsgHitter = {
      name: p.name, mlbId: p.id, pos: p.pos, team: p.team, order: orderOf.get(p.id) ?? null,
      hr: numOrNull(s.homeRuns), rbi: numOrNull(s.rbi), ab: numOrNull(s.atBats),
      avg: strOrNull(s.avg), ops: strOrNull(s.ops),
    };
    return { kind: "H" as const, hitter };
  }));

  // Starters first (batting order), then reserves by position then power.
  const hitters = built.flatMap((b) => (b.kind === "H" ? [b.hitter] : []))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100)
      || (ASG_POS_ORDER[a.pos] ?? 8) - (ASG_POS_ORDER[b.pos] ?? 8)
      || (b.hr ?? 0) - (a.hr ?? 0));
  // Announced starter first, then SP before RP, then by strikeouts.
  const pitchers = built.flatMap((b) => (b.kind === "P" ? [b.pitcher] : []))
    .sort((a, b) => (Number(b.starter) - Number(a.starter))
      || (a.role === b.role ? 0 : a.role === "SP" ? -1 : 1)
      || (b.k ?? 0) - (a.k ?? 0));
  return { hitters, pitchers };
}

async function buildAllStarRosters(nextDayScheduleRaw: unknown, teamsRaw: unknown, season: number): Promise<AsgRosters | undefined> {
  if (!nextDayScheduleRaw) return undefined;
  const asg = parseSchedule(nextDayScheduleRaw).find((g) => g.gameType === "A");
  if (!asg) return undefined;
  // Isolated so a statsapi failure here degrades to a preview WITHOUT rosters
  // (masthead + matchup + standings still ship) rather than failing the whole
  // digest generation. The extra roster fetches are the riskiest part of the
  // preview-day cron; never let them take down the send.
  try {
    const box = (await fetchBoxscoreRaw(asg.gamePk)) as { teams?: { away?: AsgBoxSide; home?: AsgBoxSide } };
    const abbrev = new Map<number, string>();
    for (const t of parseTeams(teamsRaw)) if (t.abbreviation) abbrev.set(t.id, t.abbreviation);
    // ASG convention: away = American League All-Stars, home = National League.
    // The announced starter per side is that side's probable pitcher.
    const alStarterId = asg.teams.away.probablePitcher?.id ?? null;
    const nlStarterId = asg.teams.home.probablePitcher?.id ?? null;
    const [AL, NL] = await Promise.all([
      buildAsgSide(box.teams?.away, abbrev, season, alStarterId),
      buildAsgSide(box.teams?.home, abbrev, season, nlStarterId),
    ]);
    return { AL, NL };
  } catch (err) {
    console.error("buildAllStarRosters failed; preview will render without rosters:", err);
    return undefined;
  }
}

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

  // Only does real work on the ASG-preview day (nextDaySchedule has gameType
  // "A"); otherwise a cheap schedule parse that returns undefined.
  const allStarRosters = await buildAllStarRosters(nextDayScheduleRaw, teamsRaw, season);

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
    ...(allStarRosters ? { allStarRosters } : {}),
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
export function rawToDailyData(raw: DailyRaw, date: string): DailyData {
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
    mode: classifyDigestMode(schedule, date, raw.nextDaySchedule ? parseSchedule(raw.nextDaySchedule) : []),
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
// Pulls the maintained DailyRaw — same refetch/lazy-patch behavior that
// loadDailyData has always had, just factored out so the canonical path
// can adapt the same raw payload without duplicating the maintenance.
export async function loadDailyRaw(date: string, opts?: { refetch?: boolean }): Promise<DailyRaw> {
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
    // Preview-day rows cached before ASG rosters existed — or cached with an
    // older roster shape (pre-mlbId, so no player links) — get rebuilt so a
    // re-render (admin preview, regen) shows current rosters.
    const firstHitter = raw.allStarRosters?.AL.hitters[0];
    const asgRostersStale = !raw.allStarRosters
      || (firstHitter != null && (!("mlbId" in firstHitter) || !("order" in firstHitter)));
    if (asgRostersStale && raw.nextDaySchedule != null && parseSchedule(raw.nextDaySchedule).some((g) => g.gameType === "A")) {
      const season = Number(date.slice(0, 4));
      const allStarRosters = await buildAllStarRosters(raw.nextDaySchedule, raw.teams, season);
      if (allStarRosters) { raw = { ...raw, allStarRosters }; dirty = true; }
    }
    if (dirty) await upsertDailyRaw("mlb", date, raw);
  }
  return raw;
}

export async function loadDailyData(date: string, opts?: { refetch?: boolean }): Promise<DailyData> {
  const raw = await loadDailyRaw(date, opts);
  return rawToDailyData(raw, date);
}
