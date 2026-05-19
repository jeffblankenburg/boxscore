// Basketball orchestrator: fetches all the ESPN endpoints needed for one
// date's digest, bundles them as a single JSON blob in daily_raw (same
// table MLB uses, keyed by (sport, date)), and exposes a pure transform
// from raw → BasketballData for the renderer.
//
// Parallels lib/daily.ts for MLB. The shape diverges from DailyData because
// basketball has different concepts (quarters not innings, single per-player
// line not batter/pitcher split, conferences not divisions).

import { supabaseAdmin } from "./supabase";
import { prettyDate } from "./dates";
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
  type BasketballLeagueSlug,
  type BasketballScoreboardEvent,
  type BasketballBoxscore,
  type BasketballStandings,
  type BasketballLeaders,
  type BasketballTransaction,
} from "./basketball";

// How many days past the digest date the upcoming-events window covers.
// 14 catches the typical Conference Finals → Finals transition; bumps up
// if we ever need to surface a deeper bracket.
const UPCOMING_WINDOW_DAYS = 14;

// Add `days` to an ISO date (YYYY-MM-DD), returns ISO date. Pure math, no
// timezone weirdness because we treat the date as UTC midnight.
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y!, m! - 1, d!) + days * 86_400_000;
  const r = new Date(ms);
  return `${r.getUTCFullYear()}-${String(r.getUTCMonth() + 1).padStart(2, "0")}-${String(r.getUTCDate()).padStart(2, "0")}`;
}

// ---- Raw cache shape ------------------------------------------------------

export type BasketballRaw = {
  // Raw /scoreboard?dates= envelope for the digest's date.
  scoreboard: unknown;
  // Raw /scoreboard?dates=START-END envelope covering the
  // UPCOMING_WINDOW_DAYS after the digest date. Used by both the playoff
  // series renderer (catches series that haven't started yet) and the
  // upcoming games section. Optional because older cached rows predate the
  // field; renderer falls back gracefully when missing.
  upcomingScoreboard?: unknown;
  // Raw /standings? envelope.
  standings: unknown;
  // Per-athlete season stats — one envelope carrying every category bucket
  // (general/offensive/defensive). null when the fetch failed (ESPN endpoint
  // hiccup); renderer just hides the leaders section.
  athleteStats?: unknown;
  // Recent league transactions envelope. null when the fetch failed.
  transactions?: unknown;
  // Keyed by event id (stringified). Only final games are fetched; in-
  // progress/scheduled games have no summary yet.
  games: Record<string, unknown>;
  // Season number used for the standings fetch. Stored so a future
  // re-render can reason about which season the blob represents without
  // re-running the league's seasonForDate logic.
  season: number;
};

// ---- Renderer-ready shape -------------------------------------------------

export type BasketballGameDetail = {
  event: BasketballScoreboardEvent;
  // Only populated for finished games. Scheduled/in-progress games render
  // from the scoreboard event alone (matchup + tipoff time / current score).
  box?: BasketballBoxscore;
};

export type BasketballData = {
  sport: BasketballLeagueSlug;
  date: string;
  prettyDate: string;
  games: BasketballGameDetail[];
  standings: BasketballStandings;
  season: number;
  // Derived from any game's seasonType (ESPN type=3 means post-season). When
  // true the renderer shows a playoff series section in place of standings.
  isPlayoffs: boolean;
  // Scoreboard events from the UPCOMING_WINDOW_DAYS window after the digest
  // date. Drives both the playoff series view (catches series that haven't
  // started yet) and the Upcoming games section (next chronological events
  // with status=scheduled).
  upcomingEvents: BasketballScoreboardEvent[];
  // League-wide top-5 per counting stat (PTS, REB, AST, STL, BLK). Computed
  // by merging offensive + defensive byathlete responses. Empty categories
  // means we didn't get enough data in the response.
  leaders: BasketballLeaders;
  // Recent transactions across the league. Each row carries the raw
  // description text from ESPN (e.g. "New Orleans hired Jamahl Mosley as
  // head coach"). Empty array means none returned.
  transactions: BasketballTransaction[];
};

// ---- Cache helpers (same table as MLB, different payload shape) -----------

async function getBasketballRaw(
  sport: BasketballLeagueSlug,
  date: string,
): Promise<BasketballRaw | null> {
  const { data, error } = await supabaseAdmin()
    .from("daily_raw")
    .select("payload")
    .eq("sport", sport)
    .eq("date", date)
    .maybeSingle<{ payload: BasketballRaw }>();
  if (error) throw new Error(`getBasketballRaw: ${error.message}`);
  return data?.payload ?? null;
}

async function upsertBasketballRaw(
  sport: BasketballLeagueSlug,
  date: string,
  payload: BasketballRaw,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("daily_raw")
    .upsert(
      {
        sport,
        date,
        payload,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "sport,date" },
    );
  if (error) throw new Error(`upsertBasketballRaw: ${error.message}`);
}

// ---- Fetch + transform ----------------------------------------------------

async function fetchBasketballRaw(
  sport: BasketballLeagueSlug,
  date: string,
  season: number,
): Promise<BasketballRaw> {
  // Five league-wide pulls in parallel. Three are required (a failure should
  // 500 the cron so we retry): scoreboard, upcoming window, standings.
  // Two are best-effort (leaders + transactions): wrap in .catch so an ESPN
  // endpoint hiccup doesn't take down the whole digest — the renderer just
  // hides the affected section.
  const upcomingStart = addDays(date, 1);
  const upcomingEnd = addDays(date, UPCOMING_WINDOW_DAYS);
  // Seasontype 2 = regular season; the leaders endpoint requires it for
  // per-game averages to be meaningful. During postseason the regular-
  // season averages still apply (no separate playoff leaderboard).
  const [
    scoreboardRaw,
    upcomingScoreboardRaw,
    standingsRaw,
    athleteStatsRaw,
    transactionsRaw,
  ] = await Promise.all([
    fetchScoreboardRaw(sport, date),
    fetchScoreboardRangeRaw(sport, upcomingStart, upcomingEnd),
    fetchStandingsRaw(sport, season),
    fetchAthleteStatsRaw(sport, season, 2, 100).catch((e: unknown) => {
      console.error(
        `[basketball] leaders fetch failed for ${sport}/${date}: ${(e as Error).message}`,
      );
      return null;
    }),
    fetchTransactionsRaw(sport).catch((e: unknown) => {
      console.error(
        `[basketball] transactions fetch failed for ${sport}/${date}: ${(e as Error).message}`,
      );
      return null;
    }),
  ]);

  // Per-final-game summaries in parallel. ESPN tolerates burst requests at
  // basketball-sized fan-outs (NBA peaks at ~15 games/day in the regular
  // season; postseason is 1–4). If it ever becomes a problem, swap in a
  // small concurrency limiter.
  const events = parseScoreboard(scoreboardRaw);
  const finalEventIds = events.filter((e) => e.status === "final").map((e) => e.id);
  const summaryResults = await Promise.all(
    finalEventIds.map(async (id) => [id, await fetchSummaryRaw(sport, id)] as const),
  );

  const games: Record<string, unknown> = {};
  for (const [id, raw] of summaryResults) games[id] = raw;

  return {
    scoreboard: scoreboardRaw,
    upcomingScoreboard: upcomingScoreboardRaw,
    standings: standingsRaw,
    athleteStats: athleteStatsRaw ?? undefined,
    transactions: transactionsRaw ?? undefined,
    games,
    season,
  };
}

function rawToBasketballData(
  raw: BasketballRaw,
  sport: BasketballLeagueSlug,
  date: string,
): BasketballData {
  const events = parseScoreboard(raw.scoreboard);
  const games: BasketballGameDetail[] = events.map((event) => {
    const summaryRaw = raw.games[event.id];
    const box = summaryRaw ? parseBoxscore(summaryRaw, event.id) ?? undefined : undefined;
    return { event, box };
  });
  // Postseason if any game in the digest's date OR the upcoming window is
  // tagged seasonType=3. On a true off-day with no games today, the
  // upcoming window still tells us we're in playoff mode (Cavs/Knicks G1
  // five days out, etc.).
  const upcomingEvents = raw.upcomingScoreboard
    ? parseScoreboard(raw.upcomingScoreboard)
    : [];
  const isPlayoffs =
    games.some((g) => g.event.seasonType === 3) ||
    upcomingEvents.some((e) => e.seasonType === 3);
  const leaders = parseLeaders(raw.athleteStats ?? {});
  const transactions = raw.transactions ? parseTransactions(raw.transactions) : [];
  return {
    sport,
    date,
    prettyDate: prettyDate(date),
    games,
    standings: parseStandings(raw.standings),
    season: raw.season,
    isPlayoffs,
    upcomingEvents,
    leaders,
    transactions,
  };
}

// Pre-shape cached rows lack fields added in later schema bumps:
//   • upcomingScoreboard — widened "next day" → 14-day window
//   • athleteStats — league leaders (single-fetch shape)
// Either missing → treat as a cache miss so loadBasketballDataFor refetches
// and stores the new shape. Gating on athleteStats has a side effect: rows
// where ESPN's stats endpoint was down at fetch time will retry on the
// next load. That's actually desirable (try ESPN again until it comes
// back) and the cost is tiny at boxscore's scale.
function isOldShape(raw: BasketballRaw): boolean {
  return raw.upcomingScoreboard === undefined ||
         raw.athleteStats === undefined;
}

/**
 * Read-through: stored raw → BasketballData. If raw is missing, in the old
 * shape, or refetch=true was passed, hit ESPN and write through. League-
 * specific entry points (loadNbaData, loadWnbaData) call this with their
 * own season-for-date logic.
 */
export async function loadBasketballDataFor(
  sport: BasketballLeagueSlug,
  date: string,
  season: number,
  opts?: { refetch?: boolean },
): Promise<BasketballData> {
  let raw = opts?.refetch ? null : await getBasketballRaw(sport, date);
  if (raw && isOldShape(raw)) raw = null;
  if (!raw) {
    raw = await fetchBasketballRaw(sport, date, season);
    await upsertBasketballRaw(sport, date, raw);
  }
  return rawToBasketballData(raw, sport, date);
}
