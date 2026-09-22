// NHL orchestrator: fetches the ESPN endpoints for one date's digest, bundles
// them as a single JSON blob in daily_raw (keyed by (sport="nhl", date)), and
// exposes a pure transform raw → HockeyData. Mirrors lib/basketball-daily.ts,
// minus the league-slug param (the NHL is a single league).

import { supabaseAdmin } from "./supabase";
import { getCachedDailyRawPayload } from "./daily-raw";
import { prettyDate, etDateFromISO } from "./dates";
import {
  fetchScoreboardRaw,
  fetchScoreboardRangeRaw,
  fetchSummaryRaw,
  fetchStandingsRaw,
  fetchAthleteStatsRaw,
  fetchTransactionsRaw,
  parseScoreboard,
  parseBoxscore,
  parseStandings,
  parseLeaders,
  parseTransactions,
  type HockeyScoreboardEvent,
  type HockeyBoxscore,
  type HockeyStandings,
  type HockeyLeaders,
  type HockeyTransaction,
} from "./hockey";

const SPORT = "nhl";
const UPCOMING_WINDOW_DAYS = 14;
const MAX_TX_LOOKBACK_DAYS = 14;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const r = new Date(Date.UTC(y!, m! - 1, d!) + days * 86_400_000);
  return `${r.getUTCFullYear()}-${String(r.getUTCMonth() + 1).padStart(2, "0")}-${String(r.getUTCDate()).padStart(2, "0")}`;
}

// ---- Raw cache shape ------------------------------------------------------

export type HockeyRaw = {
  scoreboard: unknown;
  upcomingScoreboard?: unknown;
  standings: unknown;
  athleteStats?: unknown;
  transactions?: unknown;
  games: Record<string, unknown>;   // event id → /summary
  season: number;
};

// ---- Renderer-ready shape -------------------------------------------------

export type HockeyGameDetail = {
  event: HockeyScoreboardEvent;
  box?: HockeyBoxscore;   // finals only
};

export type HockeyData = {
  date: string;
  prettyDate: string;
  games: HockeyGameDetail[];
  standings: HockeyStandings;
  season: number;
  isPlayoffs: boolean;
  upcomingEvents: HockeyScoreboardEvent[];
  leaders: HockeyLeaders;
  transactions: HockeyTransaction[];
};

// ---- Cache helpers --------------------------------------------------------

function getHockeyRaw(date: string): Promise<HockeyRaw | null> {
  return getCachedDailyRawPayload<HockeyRaw>(SPORT, date);
}

async function upsertHockeyRaw(date: string, payload: HockeyRaw): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("daily_raw")
    .upsert(
      { sport: SPORT, date, payload, fetched_at: new Date().toISOString() },
      { onConflict: "sport,date" },
    );
  if (error) throw new Error(`upsertHockeyRaw: ${error.message}`);
}

// ---- Fetch + transform ----------------------------------------------------

// The scoreboard labels the day's games with their season year AND type
// (1=preseason, 2=regular, 3=postseason). We fetch standings + leaders with that
// same season/type so the digest shows PRESEASON standings during the preseason
// and REGULAR standings once the season starts — each resetting at its boundary.
// Postseason keeps the regular-season standings/leaders (there's no separate
// playoff table). Falls back to the calendar season when there are no games.
function resolveSeason(scoreboardRaw: unknown, fallbackSeason: number): { season: number; type: number } {
  const sb = scoreboardRaw as {
    leagues?: Array<{ season?: { year?: number; type?: { type?: number } } }>;
    events?: Array<{ season?: { type?: number } }>;
  };
  const lgSeason = sb?.leagues?.[0]?.season;
  const season = typeof lgSeason?.year === "number" ? lgSeason.year : fallbackSeason;
  const rawType = sb?.events?.[0]?.season?.type ?? lgSeason?.type?.type ?? 2;
  // Standings/leaders exist for preseason (1) and regular (2); postseason (3)
  // reads the regular table.
  const type = rawType === 1 ? 1 : 2;
  return { season, type };
}

async function fetchHockeyRaw(date: string, fallbackSeason: number): Promise<HockeyRaw> {
  const upcomingStart = addDays(date, 1);
  const upcomingEnd = addDays(date, UPCOMING_WINDOW_DAYS);
  // Scoreboard first so the day's season + type drive the standings/leaders.
  const scoreboardRaw = await fetchScoreboardRaw(date);
  const { season, type: seasonType } = resolveSeason(scoreboardRaw, fallbackSeason);
  const [upcomingScoreboardRaw, standingsRaw, athleteStatsRaw, transactionsRaw] =
    await Promise.all([
      fetchScoreboardRangeRaw(upcomingStart, upcomingEnd).catch((e: unknown) => {
        console.error(`[hockey] upcoming-window fetch failed for ${date}: ${(e as Error).message}`);
        return null;
      }),
      fetchStandingsRaw(season, seasonType),
      // Standings + leaders both follow the day's phase. Preseason has no ESPN
      // leaderboard (byathlete returns empty), so the leaders section simply
      // stays hidden until the regular season — we never backfill last season's.
      fetchAthleteStatsRaw(season, seasonType, 1000).catch((e: unknown) => {
        console.error(`[hockey] leaders fetch failed for ${date}: ${(e as Error).message}`);
        return null;
      }),
      fetchTransactionsRaw(date).catch((e: unknown) => {
        console.error(`[hockey] transactions fetch failed for ${date}: ${(e as Error).message}`);
        return null;
      }),
    ]);

  const events = parseScoreboard(scoreboardRaw);
  const finalEventIds = events.filter((e) => e.status === "final").map((e) => e.id);
  const summaryResults = await Promise.all(
    finalEventIds.map(async (id) => [id, await fetchSummaryRaw(id)] as const),
  );
  const games: Record<string, unknown> = {};
  for (const [id, raw] of summaryResults) games[id] = raw;

  return {
    scoreboard: scoreboardRaw,
    upcomingScoreboard: upcomingScoreboardRaw ?? undefined,
    standings: standingsRaw,
    athleteStats: athleteStatsRaw ?? undefined,
    transactions: transactionsRaw ?? undefined,
    games,
    season,
  };
}

function rawToHockeyData(raw: HockeyRaw, date: string): HockeyData {
  const events = parseScoreboard(raw.scoreboard);
  const games: HockeyGameDetail[] = events.map((event) => {
    const summaryRaw = raw.games[event.id];
    const box = summaryRaw ? parseBoxscore(summaryRaw, event.id) ?? undefined : undefined;
    return { event, box };
  });
  const upcomingEvents = raw.upcomingScoreboard ? parseScoreboard(raw.upcomingScoreboard) : [];
  const isPlayoffs =
    games.some((g) => g.event.seasonType === 3) || upcomingEvents.some((e) => e.seasonType === 3);
  return {
    date,
    prettyDate: prettyDate(date),
    games,
    standings: parseStandings(raw.standings),
    season: raw.season,
    isPlayoffs,
    upcomingEvents,
    leaders: parseLeaders(raw.athleteStats ?? {}),
    transactions: raw.transactions ? parseTransactions(raw.transactions) : [],
  };
}

function isOldShape(raw: HockeyRaw): boolean {
  return raw.upcomingScoreboard === undefined || raw.athleteStats === undefined;
}

export async function loadHockeyRaw(
  date: string,
  season: number,
  opts?: { refetch?: boolean },
): Promise<HockeyRaw> {
  let raw = opts?.refetch ? null : await getHockeyRaw(date);
  if (raw && isOldShape(raw)) raw = null;
  if (!raw) {
    raw = await fetchHockeyRaw(date, season);
    await upsertHockeyRaw(date, raw);
  }
  return raw;
}

// ---- Transactions across editions -----------------------------------------

function sinceBound(prev: string | null, date: string): string {
  const floor = addDays(date, -MAX_TX_LOOKBACK_DAYS);
  return prev && prev > floor ? prev : floor;
}

async function previousLeagueGameDate(date: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("daily_digests").select("date")
    .eq("sport", SPORT).lt("date", date).gt("game_count", 0)
    .order("date", { ascending: false }).limit(1).maybeSingle<{ date: string }>();
  if (error) throw new Error(`previousLeagueGameDate: ${error.message}`);
  return data?.date ?? null;
}

async function previousTeamGameDate(teamSlug: string, date: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("team_digests").select("date")
    .eq("sport", SPORT).eq("team_slug", teamSlug).eq("has_game", true).lt("date", date)
    .order("date", { ascending: false }).limit(1).maybeSingle<{ date: string }>();
  if (error) throw new Error(`previousTeamGameDate: ${error.message}`);
  return data?.date ?? null;
}

async function aggregateTransactions(
  sinceExclusive: string,
  uptoDate: string,
  teamAbbr?: string,
): Promise<HockeyTransaction[]> {
  const { data, error } = await supabaseAdmin()
    .from("daily_raw").select("txns:payload->transactions")
    .eq("sport", SPORT).gt("date", sinceExclusive).lte("date", uptoDate)
    .order("date", { ascending: false });
  if (error) throw new Error(`aggregateTransactions: ${error.message}`);
  const byKey = new Map<string, HockeyTransaction>();
  for (const row of (data ?? []) as Array<{ txns: HockeyRaw["transactions"] }>) {
    if (!row.txns) continue;
    for (const t of parseTransactions(row.txns)) {
      const txDate = etDateFromISO(t.date);
      if (!txDate || txDate <= sinceExclusive || txDate > uptoDate) continue;
      if (teamAbbr && t.teamAbbr !== teamAbbr) continue;
      const key = `${txDate}|${t.teamAbbr ?? ""}|${t.description}`;
      if (!byKey.has(key)) byKey.set(key, t);
    }
  }
  return [...byKey.values()].sort((a, b) => etDateFromISO(b.date).localeCompare(etDateFromISO(a.date)));
}

export async function transactionsSinceLastLeagueGame(date: string): Promise<HockeyTransaction[]> {
  const since = sinceBound(await previousLeagueGameDate(date), date);
  return aggregateTransactions(since, date);
}

export async function transactionsSinceLastTeamGame(
  teamSlug: string,
  teamAbbr: string,
  date: string,
): Promise<HockeyTransaction[]> {
  const since = sinceBound(await previousTeamGameDate(teamSlug, date), date);
  return aggregateTransactions(since, date, teamAbbr);
}

export async function loadHockeyData(
  date: string,
  season: number,
  opts?: { refetch?: boolean },
): Promise<HockeyData> {
  const raw = await loadHockeyRaw(date, season, opts);
  const data = rawToHockeyData(raw, date);
  data.transactions = await transactionsSinceLastLeagueGame(date);
  return data;
}

export { rawToHockeyData };
