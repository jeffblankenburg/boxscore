import { supabaseAdmin } from "./supabase";

// The raw MLB payloads for a single date. Stored as a single JSON blob in
// daily_raw; consumed by lib/daily.ts to produce a DailyData without re-
// hitting the MLB API. Any future renderer change can replay against stored
// raw rather than refetching.
export type DailyRaw = {
  schedule: unknown;
  standings: unknown;
  wildCard: unknown;
  // Keyed by `${leagueId}/${category}`, e.g. "103/battingAverage", "104/wins".
  leaders: Record<string, unknown>;
  // Keyed by gamePk (as a string, since JSON object keys are strings).
  games: Record<string, { boxscore: unknown; playByPlay: unknown }>;
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
