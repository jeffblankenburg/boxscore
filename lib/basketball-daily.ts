// Basketball orchestrator: fetches all the ESPN endpoints needed for one
// date's digest, bundles them as a single JSON blob in daily_raw (same
// table MLB uses, keyed by (sport, date)), and exposes a pure transform
// from raw → BasketballData for the renderer.
//
// Parallels lib/daily.ts for MLB. The shape diverges from DailyData because
// basketball has different concepts (quarters not innings, single per-player
// line not batter/pitcher split, conferences not divisions).

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
  fetchRankingsRaw,
  parseScoreboard,
  parseBoxscore,
  parseStandings,
  parseLeaders,
  parseTransactions,
  parseRankings,
  isCollegeBasketball,
  type BasketballLeagueSlug,
  type BasketballScoreboardEvent,
  type BasketballBoxscore,
  type BasketballStandings,
  type BasketballLeaders,
  type BasketballTransaction,
  type BasketballRanking,
} from "./basketball";
import { assembleBracket, eventToBracketRow, type Bracket, type BracketGameRow, type BracketLeague } from "./playoff-bracket";

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
  // AP Top 25 (+ Coaches) rankings envelope — college only; undefined for the
  // pro leagues (and when the fetch failed).
  rankings?: unknown;
  // Keyed by event id (stringified). Only final games are fetched; in-
  // progress/scheduled games have no summary yet.
  games: Record<string, unknown>;
  // Season number used for the standings fetch. Stored so a future
  // re-render can reason about which season the blob represents without
  // re-running the league's seasonForDate logic.
  season: number;
  // ESPN seasontype the standings/leaders were fetched under (1=preseason,
  // 2=regular). Stored so a cached preseason row fetched before this field
  // existed (all-0-0 regular-season standings) can be detected and refetched
  // against the preseason standings. Undefined on pre-fix rows.
  standingsSeasonType?: number;
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
  // True when the whole slate is exhibition (ESPN seasonType=1), before
  // opening night. The renderer labels the digest "Preseason" and the
  // standings carry real preseason W-L (fetched under seasontype=1) rather
  // than the all-0-0 regular-season table.
  isPreseason: boolean;
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
  // The full postseason bracket, reconstructed from every seasonType=3 series
  // seen across the persisted daily_raw this postseason. Only populated on the
  // league digest during the playoffs (isPlayoffs); null otherwise.
  bracket?: Bracket | null;
  // AP Top 25 (+ Coaches) polls — college only; empty for the pro leagues.
  rankings: BasketballRanking[];
};

// ---- Cache helpers (same table as MLB, different payload shape) -----------

function getBasketballRaw(
  sport: BasketballLeagueSlug,
  date: string,
): Promise<BasketballRaw | null> {
  // Served from the Next Data Cache (see getCachedDailyRawPayload) so the big
  // payload isn't re-read from Postgres on every render; the generate cron
  // busts the (sport, date) tag when it rewrites the row.
  return getCachedDailyRawPayload<BasketballRaw>(sport, date);
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
  // Five league-wide pulls in parallel. Two are required (a failure should
  // 500 the cron so we retry): scoreboard, standings.
  // Three are best-effort (upcoming window + leaders + transactions): wrap in
  // .catch so an ESPN endpoint hiccup doesn't take down the whole digest — the
  // renderer just hides the affected section. The upcoming-window RANGE endpoint
  // 400s in the offseason (a date range with zero scheduled events is rejected,
  // unlike the single-date scoreboard which returns an empty list), so it can't
  // be required or every offseason tick fails and pages oncall.
  // Fetch the scoreboard first: its games tell us whether this is a preseason
  // slate, which decides the seasontype for the standings + leaders pulls.
  // ESPN's regular-season (seasontype=2) standings read all-0-0 until opening
  // night, and preseason exhibition W-L only lives under seasontype=1 — so a
  // preseason digest must scope those two pulls to type 1 or the standings are
  // meaningless. A mixed or empty slate falls back to regular season.
  const scoreboardRaw = await fetchScoreboardRaw(sport, date);
  const events = parseScoreboard(scoreboardRaw);
  const preseason = events.length > 0 && events.every((e) => e.seasonType === 1);
  const statSeasonType = preseason ? 1 : 2;

  const upcomingStart = addDays(date, 1);
  const upcomingEnd = addDays(date, UPCOMING_WINDOW_DAYS);
  const [
    upcomingScoreboardRaw,
    standingsRaw,
    athleteStatsRaw,
    transactionsRaw,
    rankingsRaw,
  ] = await Promise.all([
    fetchScoreboardRangeRaw(sport, upcomingStart, upcomingEnd).catch((e: unknown) => {
      console.error(
        `[basketball] upcoming-window fetch failed for ${sport}/${date}: ${(e as Error).message}`,
      );
      return null;
    }),
    fetchStandingsRaw(sport, season, statSeasonType),
    // limit=600 covers every player who's logged minutes (NBA ~500, WNBA ~180)
    // so the same payload feeds both the top-5 league leaders AND full per-team
    // rosters for the team digests — no separate roster fetch. Top-100 (the old
    // limit) only held the league's leading scorers, ~3 per team. ESPN doesn't
    // aggregate preseason into byathlete (type 1 returns zero athletes), so the
    // leaders section is simply empty until the regular season — expected.
    fetchAthleteStatsRaw(sport, season, statSeasonType, 600).catch((e: unknown) => {
      console.error(
        `[basketball] leaders fetch failed for ${sport}/${date}: ${(e as Error).message}`,
      );
      return null;
    }),
    fetchTransactionsRaw(sport, date).catch((e: unknown) => {
      console.error(
        `[basketball] transactions fetch failed for ${sport}/${date}: ${(e as Error).message}`,
      );
      return null;
    }),
    // AP Top 25 (+ Coaches) — college only; pro leagues skip the fetch entirely.
    isCollegeBasketball(sport)
      ? fetchRankingsRaw(sport).catch((e: unknown) => {
          console.error(`[basketball] rankings fetch failed for ${sport}/${date}: ${(e as Error).message}`);
          return null;
        })
      : Promise.resolve(null),
  ]);

  // Per-final-game summaries in parallel. ESPN tolerates burst requests at
  // basketball-sized fan-outs (NBA peaks at ~15 games/day in the regular
  // season; postseason is 1–4). If it ever becomes a problem, swap in a
  // small concurrency limiter.
  const finalEventIds = events.filter((e) => e.status === "final").map((e) => e.id);
  const summaryResults = await Promise.all(
    finalEventIds.map(async (id) => [id, await fetchSummaryRaw(sport, id)] as const),
  );

  const games: Record<string, unknown> = {};
  for (const [id, raw] of summaryResults) games[id] = raw;

  return {
    scoreboard: scoreboardRaw,
    upcomingScoreboard: upcomingScoreboardRaw ?? undefined,
    standings: standingsRaw,
    athleteStats: athleteStatsRaw ?? undefined,
    transactions: transactionsRaw ?? undefined,
    rankings: rankingsRaw ?? undefined,
    games,
    season,
    standingsSeasonType: statSeasonType,
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
  // Preseason when every game on the slate is exhibition (type 1). Scoped to
  // today's games only (not the upcoming window) — the label describes what
  // this edition recaps.
  const isPreseason =
    games.length > 0 && games.every((g) => g.event.seasonType === 1);
  const leaders = parseLeaders(raw.athleteStats ?? {});
  const transactions = raw.transactions ? parseTransactions(raw.transactions) : [];
  const rankings = raw.rankings ? parseRankings(raw.rankings) : [];
  return {
    sport,
    date,
    prettyDate: prettyDate(date),
    games,
    standings: parseStandings(raw.standings),
    season: raw.season,
    isPlayoffs,
    isPreseason,
    upcomingEvents,
    leaders,
    transactions,
    rankings,
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
  if (raw.upcomingScoreboard === undefined || raw.athleteStats === undefined) {
    return true;
  }
  // Preseason rows fetched before the preseason-standings fix carry the
  // regular-season (all-0-0) standings table. Detect them from the cached
  // scoreboard and force a refetch so the table shows real exhibition W-L.
  const events = parseScoreboard(raw.scoreboard);
  const preseason = events.length > 0 && events.every((e) => e.seasonType === 1);
  if (preseason && raw.standingsSeasonType !== 1) return true;
  return false;
}

/**
 * Read-through for the raw payload. If raw is missing, in the old shape, or
 * refetch=true was passed, hit ESPN and write through. Shared by the daily
 * loader and the team-digest loader — the latter needs raw.athleteStats to
 * build a team's roster, which the parsed BasketballData doesn't carry.
 */
export async function loadBasketballRawFor(
  sport: BasketballLeagueSlug,
  date: string,
  season: number,
  opts?: { refetch?: boolean },
): Promise<BasketballRaw> {
  let raw = opts?.refetch ? null : await getBasketballRaw(sport, date);
  if (raw && isOldShape(raw)) raw = null;
  if (!raw) {
    raw = await fetchBasketballRaw(sport, date, season);
    await upsertBasketballRaw(sport, date, raw);
  }
  return raw;
}

// ---- Transactions across editions -----------------------------------------
//
// A digest ships to a reader only on the days their edition runs — the league
// digest on league game days, a team digest the morning after THAT team plays.
// But roster moves happen every day, and basketball has frequent off days (a
// team's 2-3 day gaps; the All-Star break; dark league days). If each digest
// only showed its own date's moves, an off-day signing would never reach a
// reader. We already persist a daily_raw payload every day (loadBasketballRawFor
// write-through, including 0-game days), each carrying that date's ESPN
// transactions — so we union the persisted payloads since the reader's previous
// edition, dedup, and let the renderer date each move.
//
// Hard floor so a long cron outage (or the first edition of a season, whose
// previous game is months back) can't dump an unbounded backlog.
const MAX_TX_LOOKBACK_DAYS = 14;

function sinceBound(prev: string | null, date: string): string {
  const floor = addDays(date, -MAX_TX_LOOKBACK_DAYS);
  return prev && prev > floor ? prev : floor;
}

async function previousLeagueGameDate(sport: BasketballLeagueSlug, date: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("daily_digests")
    .select("date")
    .eq("sport", sport)
    .lt("date", date)
    .gt("game_count", 0)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle<{ date: string }>();
  if (error) throw new Error(`previousLeagueGameDate: ${error.message}`);
  return data?.date ?? null;
}

async function previousTeamGameDate(
  sport: BasketballLeagueSlug,
  teamSlug: string,
  date: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("team_digests")
    .select("date")
    .eq("sport", sport)
    .eq("team_slug", teamSlug)
    .eq("has_game", true)
    .lt("date", date)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle<{ date: string }>();
  if (error) throw new Error(`previousTeamGameDate: ${error.message}`);
  return data?.date ?? null;
}

// Union transactions from every persisted daily_raw payload dated in
// (sinceExclusive, uptoDate], deduped on (ET date, team, text) since each
// day's ESPN pull spills into the next ET date. Optional teamAbbr filter for
// team editions. Newest day first.
async function aggregateTransactions(
  sport: BasketballLeagueSlug,
  sinceExclusive: string,
  uptoDate: string,
  teamAbbr?: string,
): Promise<BasketballTransaction[]> {
  // Project just payload->transactions, not the whole payload blob — this
  // scans a multi-day range, so pulling only the transactions envelope keeps
  // the read small (same trick the /[sport]/transactions page uses).
  const { data, error } = await supabaseAdmin()
    .from("daily_raw")
    .select("txns:payload->transactions")
    .eq("sport", sport)
    .gt("date", sinceExclusive)
    .lte("date", uptoDate)
    .order("date", { ascending: false });
  if (error) throw new Error(`aggregateTransactions: ${error.message}`);

  const byKey = new Map<string, BasketballTransaction>();
  for (const row of (data ?? []) as Array<{ txns: BasketballRaw["transactions"] }>) {
    if (!row.txns) continue;
    for (const t of parseTransactions(row.txns)) {
      const txDate = etDateFromISO(t.date);
      if (!txDate || txDate <= sinceExclusive || txDate > uptoDate) continue; // (since, upto]
      if (teamAbbr && t.teamAbbr !== teamAbbr) continue;
      const key = `${txDate}|${t.teamAbbr ?? ""}|${t.description}`;
      if (!byKey.has(key)) byKey.set(key, t);
    }
  }
  return [...byKey.values()].sort((a, b) => etDateFromISO(b.date).localeCompare(etDateFromISO(a.date)));
}

/** League-edition transactions: every move since the previous league game day. */
export async function transactionsSinceLastLeagueGame(
  sport: BasketballLeagueSlug,
  date: string,
): Promise<BasketballTransaction[]> {
  const since = sinceBound(await previousLeagueGameDate(sport, date), date);
  return aggregateTransactions(sport, since, date);
}

/** Team-edition transactions: that team's moves since its own previous game. */
export async function transactionsSinceLastTeamGame(
  sport: BasketballLeagueSlug,
  teamSlug: string,
  teamAbbr: string,
  date: string,
): Promise<BasketballTransaction[]> {
  const since = sinceBound(await previousTeamGameDate(sport, teamSlug, date), date);
  return aggregateTransactions(sport, since, date, teamAbbr);
}

/**
 * Read-through: stored raw → BasketballData. League-specific entry points
 * (loadNbaData, loadWnbaData) call this with their own season-for-date logic.
 *
 * Transactions are the one section NOT taken from the single-day payload: they
 * union every league move since the previous league game day so off-day moves
 * aren't lost between editions (see transactionsSinceLastLeagueGame).
 */
export async function loadBasketballDataFor(
  sport: BasketballLeagueSlug,
  date: string,
  season: number,
  opts?: { refetch?: boolean },
): Promise<BasketballData> {
  const raw = await loadBasketballRawFor(sport, date, season, opts);
  const data = rawToBasketballData(raw, sport, date);
  data.transactions = await transactionsSinceLastLeagueGame(sport, date);
  // Reconstruct the postseason bracket from the persisted daily_raw only while
  // we're in the playoffs — off-season/regular-season digests skip the scan.
  // Feed today's games + the upcoming window too, so a matchup that's set but
  // not yet played (e.g. a Finals whose Game 1 is days out) still shows.
  if (data.isPlayoffs) {
    const live = [...data.games.map((g) => g.event), ...data.upcomingEvents];
    data.bracket = await loadPlayoffBracket(sport, date, live);
  }
  return data;
}

// How far back to scan daily_raw for postseason series. Comfortably covers an
// NBA/NHL playoff run (~2 months); a new postseason's series never collide
// with the prior one (10 months apart). WNBA's ~3-week run is well inside it.
const POSTSEASON_LOOKBACK_DAYS = 80;

// Reconstruct the full bracket by unioning every seasonType=3 series across the
// persisted daily_raw from (date − 80d, date]. Projects just the scoreboard
// subtree (not the whole payload) to keep the multi-day read small, mirroring
// aggregateTransactions. Returns null when no postseason games are found.
async function loadPlayoffBracket(
  sport: BasketballLeagueSlug,
  date: string,
  liveEvents: BasketballScoreboardEvent[] = [],
): Promise<Bracket | null> {
  const since = addDays(date, -POSTSEASON_LOOKBACK_DAYS);
  const { data, error } = await supabaseAdmin()
    .from("daily_raw")
    .select("sb:payload->scoreboard")
    .eq("sport", sport)
    .gte("date", since)
    .lte("date", date);
  if (error) throw new Error(`loadPlayoffBracket: ${error.message}`);

  const rows: BracketGameRow[] = [];
  for (const r of (data ?? []) as Array<{ sb: unknown }>) {
    for (const e of parseScoreboard(r.sb)) {
      const row = eventToBracketRow(e);
      if (row) rows.push(row);
    }
  }
  // Today's games + upcoming window: catches a matchup that's set but not yet
  // played, which the historical daily_raw scan can't see.
  for (const e of liveEvents) {
    const row = eventToBracketRow(e);
    if (row) rows.push(row);
  }
  if (rows.length === 0) return null;
  return assembleBracket(sport as BracketLeague, rows);
}

// Exposed so the team-digest loader can turn one raw read into both the daily
// BasketballData (games/standings/upcoming/transactions) and the team roster.
export { rawToBasketballData };
