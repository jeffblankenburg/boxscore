import { supabaseAdmin } from "./supabase";

export type Digest = {
  sport: string;
  date: string;
  generated_at: string;
  game_count: number;
  html: string;
};

export async function getDigest(sport: string, date: string): Promise<Digest | null> {
  const { data, error } = await supabaseAdmin()
    .from("daily_digests")
    .select("sport, date, generated_at, game_count, html")
    .eq("sport", sport)
    .eq("date", date)
    .maybeSingle<Digest>();
  if (error) throw new Error(`getDigest: ${error.message}`);
  return data ?? null;
}

export async function upsertDigest(
  sport: string, date: string, html: string, game_count: number,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("daily_digests")
    .upsert(
      { sport, date, html, game_count, generated_at: new Date().toISOString() },
      { onConflict: "sport,date" },
    );
  if (error) throw new Error(`upsertDigest: ${error.message}`);
}
