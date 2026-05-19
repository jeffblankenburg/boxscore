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
  fetchSummaryRaw,
  fetchStandingsRaw,
  parseScoreboard,
  parseBoxscore,
  parseStandings,
  type BasketballLeagueSlug,
  type BasketballScoreboardEvent,
  type BasketballBoxscore,
  type BasketballStandings,
} from "./basketball";

// ---- Raw cache shape ------------------------------------------------------

export type BasketballRaw = {
  // Raw /scoreboard?dates= envelope.
  scoreboard: unknown;
  // Raw /standings? envelope.
  standings: unknown;
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
  // Scoreboard + standings in parallel — both are league-wide single calls.
  const [scoreboardRaw, standingsRaw] = await Promise.all([
    fetchScoreboardRaw(sport, date),
    fetchStandingsRaw(sport, season),
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

  return { scoreboard: scoreboardRaw, standings: standingsRaw, games, season };
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
  return {
    sport,
    date,
    prettyDate: prettyDate(date),
    games,
    standings: parseStandings(raw.standings),
    season: raw.season,
  };
}

/**
 * Read-through: stored raw → BasketballData. If raw is missing or refetch=true,
 * hit ESPN and write through. League-specific entry points (loadNbaData,
 * loadWnbaData) call this with their own season-for-date logic.
 */
export async function loadBasketballDataFor(
  sport: BasketballLeagueSlug,
  date: string,
  season: number,
  opts?: { refetch?: boolean },
): Promise<BasketballData> {
  let raw = opts?.refetch ? null : await getBasketballRaw(sport, date);
  if (!raw) {
    raw = await fetchBasketballRaw(sport, date, season);
    await upsertBasketballRaw(sport, date, raw);
  }
  return rawToBasketballData(raw, sport, date);
}
