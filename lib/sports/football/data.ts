// Football orchestrator. Read-through cache over daily_raw (keyed by
// (sport, date) — same table MLB and basketball use) plus the pure adapter.
// This is the server-side entry point the generate cron and admin preview
// call; the fetch (sources/espn.ts) and transform (adapters/from-espn.ts)
// stay I/O-free and testable. Parallels lib/basketball-daily.ts.

import { supabaseAdmin } from "../../supabase";
import { footballLeagueConfig, seasonForDate } from "./leagues";
import { fetchFootballRaw, FOOTBALL_LEADER_STATS, type FootballRaw } from "./sources/espn";
import { adaptEspnFootball, adaptTransactions } from "./adapters/from-espn";
import type { CanonicalFootballDailyData } from "./canonical";
import type { FootballLeague, FootballTransaction } from "./types";
import { addDaysToISO } from "../../dates";

async function getFootballRaw(
  league: FootballLeague,
  date: string,
): Promise<FootballRaw | null> {
  const { data, error } = await supabaseAdmin()
    .from("daily_raw")
    .select("payload")
    .eq("sport", league)
    .eq("date", date)
    .maybeSingle<{ payload: FootballRaw }>();
  if (error) throw new Error(`getFootballRaw: ${error.message}`);
  return data?.payload ?? null;
}

async function upsertFootballRaw(
  league: FootballLeague,
  date: string,
  payload: FootballRaw,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("daily_raw")
    .upsert(
      { sport: league, date, payload, fetched_at: new Date().toISOString() },
      { onConflict: "sport,date" },
    );
  if (error) throw new Error(`upsertFootballRaw: ${error.message}`);
}

// A cached row predating a shape change (missing `summaries`, or stored under
// the wrong league) is treated as a miss so the next load refetches and
// rewrites. Cheap insurance at boxscore's scale.
function isStaleShape(raw: FootballRaw, league: FootballLeague): boolean {
  if (raw.summaries === undefined || raw.league !== league) return true;
  // `leaders` was added with the MLB-style multi-section digest, then reshaped
  // to a per-stat array whose athletes carry a season `teamAbbr`. Rows from an
  // earlier shape (missing leaders, the old byathlete object, or the pre-
  // teamAbbr athlete) must refetch so old cached dates self-heal.
  if (raw.leaders === undefined || !Array.isArray(raw.leaders)) return true;
  const firstAthlete = (raw.leaders[0] as { athletes?: Array<{ athlete?: { teamAbbr?: unknown } }> } | undefined)
    ?.athletes?.[0]?.athlete;
  if (firstAthlete && firstAthlete.teamAbbr === undefined) return true;
  // The set of leader stats changed (e.g. Interceptions → Tackles For Loss).
  // Any date whose cache holds a different stat set refetches on next load, so
  // an old edition can't keep showing a retired leader category.
  const cached = new Set((raw.leaders as Array<{ stat?: unknown }>).map((e) => String(e?.stat)));
  const want = FOOTBALL_LEADER_STATS.map((s) => s.stat);
  if (cached.size !== want.length || !want.every((s) => cached.has(s))) return true;
  return false;
}

// The Transactions section aggregates every roster move since the PREVIOUS
// edition, not just the day's ESPN window. Two facts make this necessary and
// possible:
//   - Football only ships a digest on game days, so a move on a game-less
//     Tuesday would otherwise fall out of ESPN's small rolling window before
//     Friday's digest and never be seen.
//   - We persist a daily_raw payload EVERY day regardless of games (the
//     write-through above runs even when hasPlayedGames is false), so those
//     moves are already on disk — we just union the persisted payloads across
//     the gap, dedup, and keep the ones dated after the previous edition so
//     each move surfaces exactly once, in the next digest.
// Hard floor so a long cron outage (no prior edition found nearby) can't dump
// weeks of ancient moves into one digest.
const MAX_TX_LOOKBACK_DAYS = 14;

async function previousEditionDate(league: FootballLeague, date: string): Promise<string | null> {
  // Football persists a digest only on game days, so the most recent
  // daily_digests row before `date` IS the previous edition's games date.
  const { data, error } = await supabaseAdmin()
    .from("daily_digests")
    .select("date")
    .eq("sport", league)
    .lt("date", date)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle<{ date: string }>();
  if (error) throw new Error(`previousEditionDate: ${error.message}`);
  return data?.date ?? null;
}

async function transactionsSincePrevEdition(
  league: FootballLeague,
  date: string,
): Promise<FootballTransaction[]> {
  const prev = await previousEditionDate(league, date);
  const floor = addDaysToISO(date, -MAX_TX_LOOKBACK_DAYS);
  // Show moves dated strictly after the previous edition (so each appears once,
  // in the next digest), bounded below by the lookback floor. ISO date strings
  // compare lexicographically, so `>` / `<=` are correct calendar comparisons.
  const sinceExclusive = prev && prev > floor ? prev : floor;

  const { data, error } = await supabaseAdmin()
    .from("daily_raw")
    .select("payload")
    .eq("sport", league)
    .gt("date", sinceExclusive)
    .lte("date", date)
    .order("date", { ascending: false });
  if (error) throw new Error(`transactionsSincePrevEdition: ${error.message}`);

  // Each day's payload carries a rolling multi-day window, so a given move
  // recurs across consecutive days' payloads — dedup on (date, team, text).
  const byKey = new Map<string, FootballTransaction>();
  for (const row of (data ?? []) as Array<{ payload: FootballRaw }>) {
    if (!row.payload?.transactions) continue;
    for (const t of adaptTransactions(row.payload)) {
      const txDate = t.date.slice(0, 10);
      if (txDate <= sinceExclusive || txDate > date) continue; // (prev, date]
      const key = `${txDate}|${t.teamAbbr ?? ""}|${t.description}`;
      if (!byKey.has(key)) byKey.set(key, t);
    }
  }
  return [...byKey.values()].sort((a, b) => b.date.slice(0, 10).localeCompare(a.date.slice(0, 10)));
}

/**
 * Read-through: stored raw → CanonicalFootballDailyData. Refetches from ESPN
 * and writes through when the row is missing, stale, or refetch=true.
 *
 * Transactions are the one section NOT taken from the single-day payload: they
 * union every move since the previous edition so game-less-day moves aren't
 * lost between digests (see transactionsSincePrevEdition).
 */
export async function loadFootballData(
  league: FootballLeague,
  date: string,
  opts?: { refetch?: boolean },
): Promise<CanonicalFootballDailyData> {
  const cfg = footballLeagueConfig(league);
  let raw = opts?.refetch ? null : await getFootballRaw(league, date);
  if (raw && isStaleShape(raw, league)) raw = null;
  if (!raw) {
    raw = await fetchFootballRaw(cfg, date, seasonForDate(date));
    await upsertFootballRaw(league, date, raw);
  }
  const data = adaptEspnFootball(cfg, raw);
  data.transactions = await transactionsSincePrevEdition(league, date);
  return data;
}

// A recap only ships on days that actually had games. Callers (the generate
// cron) use this to decide whether to persist a digest at all.
export function hasPlayedGames(data: CanonicalFootballDailyData): boolean {
  return data.games.some((g) => g.status === "final" || g.status === "live");
}
