import { supabaseAdmin } from "./supabase";

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
export type ProbablePitcherStats = { wins: number; losses: number };

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
