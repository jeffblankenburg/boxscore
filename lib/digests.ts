import { supabaseAdmin } from "./supabase";

export type Digest = {
  sport: string;
  date: string;
  generated_at: string;
  game_count: number;
  mode: string | null;
  html: string;
  email_html: string | null;
};

export async function getDigest(sport: string, date: string): Promise<Digest | null> {
  const { data, error } = await supabaseAdmin()
    .from("daily_digests")
    .select("sport, date, generated_at, game_count, mode, html, email_html")
    .eq("sport", sport)
    .eq("date", date)
    .maybeSingle<Digest>();
  if (error) throw new Error(`getDigest: ${error.message}`);
  return data ?? null;
}

// In-season modes — preseason and offseason rows exist in the cache but
// represent placeholder pages, not navigable content.
const IN_SEASON_MODES = ["regular", "no-games", "all-star", "postseason"];

/**
 * Does an in-season cached digest exist for this exact (sport, date)?
 * Used to decide whether the dateline's prev/next arrow points somewhere
 * meaningful. Bounds-based logic doesn't work here because the calendar
 * gap between seasons (Nov–Mar) means the global min/max is far from the
 * date the user is actually on; what matters is whether *yesterday* (or
 * *tomorrow*) is a real day, not the absolute season edge.
 */
export async function hasInSeasonDigest(
  sport: string,
  date: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("daily_digests")
    .select("date")
    .eq("sport", sport)
    .eq("date", date)
    .in("mode", IN_SEASON_MODES)
    .maybeSingle<{ date: string }>();
  if (error) throw new Error(`hasInSeasonDigest: ${error.message}`);
  return !!data;
}

export async function upsertDigest(args: {
  sport: string;
  date: string;
  html: string;
  email_html: string;
  game_count: number;
  mode?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("daily_digests")
    .upsert(
      {
        sport: args.sport,
        date: args.date,
        html: args.html,
        email_html: args.email_html,
        game_count: args.game_count,
        mode: args.mode ?? null,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "sport,date" },
    );
  if (error) throw new Error(`upsertDigest: ${error.message}`);
}
