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

/**
 * Returns the most recent in-season digest for a sport. Used by the
 * bookmarkable /[sport] landing page so it stays fresh between midnight
 * ET and the ~5 AM ET generate cron — the yesterday-in-ET row doesn't
 * exist yet during that window, and returning a 404 for a bookmarkable
 * URL is worse than showing the previous day's content.
 *
 * Filters on IN_SEASON_MODES so the page doesn't fall back to a stale
 * preseason placeholder during the offseason. Callers that want the
 * placeholder should ask for it explicitly by date via getDigest.
 */
export async function getLatestDigest(sport: string): Promise<Digest | null> {
  const { data, error } = await supabaseAdmin()
    .from("daily_digests")
    .select("sport, date, generated_at, game_count, mode, html, email_html")
    .eq("sport", sport)
    .in("mode", IN_SEASON_MODES)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle<Digest>();
  if (error) throw new Error(`getLatestDigest: ${error.message}`);
  return data ?? null;
}

// In-season modes — preseason and offseason rows exist in the cache but
// represent placeholder pages, not navigable content.
const IN_SEASON_MODES = ["regular", "no-games", "all-star", "postseason"];

/**
 * Every in-season games_date for the sport, newest first. Paginates around
 * Supabase's 1000-row cap. Powers app/sitemap.ts and the Wave 2 calendar
 * dropdown — both want the full list of dates that have a real digest, not
 * a placeholder preseason/offseason row.
 */
export async function listAllDigestDates(sport: string): Promise<string[]> {
  const dates: string[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin()
      .from("daily_digests")
      .select("date")
      .eq("sport", sport)
      .in("mode", IN_SEASON_MODES)
      .order("date", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`listAllDigestDates: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) dates.push(row.date);
    if (data.length < pageSize) break;
  }
  return dates;
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
