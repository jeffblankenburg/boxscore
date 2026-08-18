import { supabaseAdmin } from "./supabase";
import { cachedRead } from "./data-cache";
import type { AsgRosters, AsgMvp } from "./sports/mlb/canonical";

// ─── daily_raw payload cache ────────────────────────────────────────────────
//
// Every uncached page render used to read the full ~650kB `daily_raw.payload`
// JSONB blob straight from Postgres — the top query by CPU and the driver of
// the 2026-08-18 OOM crash loop. These payloads change at most once a day (a
// past date never changes; today's is rewritten only by the ~5am ET generate
// cron), so we serve the read from Next's Data Cache with a short TTL. That
// collapses a burst of requests for the same (sport, date) into one Postgres
// read per interval — the fix for the per-request read storm — while staying at
// most DAILY_RAW_REVALIDATE_S stale, which is immaterial for once-a-day content.
// (We use a TTL rather than tag invalidation because Next 16's revalidateTag
// belongs to the Cache Components model this app hasn't adopted.)
const DAILY_RAW_REVALIDATE_S = 300;

/**
 * Cached read of a daily_raw payload for (sport, date). Returns null when no
 * row exists. Generic over the sport's payload shape (DailyRaw / FootballRaw /
 * BasketballRaw). Pure read — the fetch-on-miss write-through stays uncached in
 * each sport's loader, and the cron passes refetch:true so it always bypasses
 * this cache and writes fresh.
 */
export function getCachedDailyRawPayload<T>(sport: string, date: string): Promise<T | null> {
  return cachedRead(
    async () => {
      const { data, error } = await supabaseAdmin()
        .from("daily_raw")
        .select("payload")
        .eq("sport", sport)
        .eq("date", date)
        .maybeSingle<{ payload: T }>();
      if (error) throw new Error(`getCachedDailyRawPayload: ${error.message}`);
      return data?.payload ?? null;
    },
    ["daily_raw", sport, date],
    DAILY_RAW_REVALIDATE_S,
  );
}

// The raw MLB payloads for a single date. Stored as a single JSON blob in
// daily_raw; consumed by lib/daily.ts to produce a DailyData without re-
// hitting the MLB API. Any future renderer change can replay against stored
// raw rather than refetching.
// Pre-parsed scoring play. Stored already-trimmed because we never use any
// non-scoring play, and keeping the raw playByPlay was blowing past Supabase's
// statement-timeout limits on upsert.
export type StoredScoringPlay = {
  inning: number;
  halfInning: "top" | "bottom";
  event: string;
  description: string;
  awayScore: number;
  homeScore: number;
  rbi: number;
};

// Season-to-date pitching record for a probable pitcher. Looked up once at
// fetch time and stored so the renderer doesn't need any extra API calls.
// ERA is a string from MLB (e.g. "3.42", "—", "-.--") — keep it as-is and let
// the renderer format. null when MLB returned no stats for the pitcher yet.
export type ProbablePitcherStats = { wins: number; losses: number; era: string | null };

export type DailyRaw = {
  schedule: unknown;
  standings: unknown;
  wildCard: unknown;
  // Keyed by `${leagueId}/${category}`, e.g. "103/battingAverage", "104/wins".
  leaders: Record<string, unknown>;
  // Keyed by gamePk (as a string, since JSON object keys are strings).
  // playByPlay was removed in favor of pre-parsed scoringPlays to shrink the
  // blob; we don't render anything from non-scoring plays.
  games: Record<string, { boxscore: unknown; scoringPlays: StoredScoringPlay[] }>;
  // Schedule for the day AFTER this digest's date — used to render the
  // "Today's Games" preview.
  nextDaySchedule?: unknown;
  // Raw /v1/teams envelope for this season. Used at render time to build a
  // current id→abbreviation map (handles Athletics-to-Vegas, expansion).
  teams?: unknown;
  // Season pitching W-L for each probable pitcher in nextDaySchedule, keyed by
  // pitcher ID (stringified).
  probablePitcherStats?: Record<string, ProbablePitcherStats>;
  // Raw /v1/transactions envelope for this date. One fetch per date; renders
  // as a "Transactions" section at the bottom of the digest.
  transactions?: unknown;
  // Built only on the day before the All-Star Game (when nextDaySchedule holds
  // the ASG): full AL/NL rosters with first-half season lines. See
  // fetchDailyRaw. The canonical adapter passes this straight through.
  allStarRosters?: AsgRosters;
  // Set on the ASG day (recap edition) once the MVP is recorded; null if not
  // yet available at fetch time.
  allStarMvp?: AsgMvp | null;
};

export async function getDailyRaw(sport: string, date: string): Promise<DailyRaw | null> {
  const { data, error } = await supabaseAdmin()
    .from("daily_raw")
    .select("payload")
    .eq("sport", sport)
    .eq("date", date)
    .maybeSingle<{ payload: DailyRaw }>();
  if (error) throw new Error(`getDailyRaw: ${error.message}`);
  return data?.payload ?? null;
}

export async function upsertDailyRaw(sport: string, date: string, payload: DailyRaw): Promise<void> {
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
  if (error) throw new Error(`upsertDailyRaw: ${error.message}`);
}
