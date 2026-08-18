import { supabaseAdmin } from "./supabase";
import { cachedRead } from "./data-cache";

export type Digest = {
  sport: string;
  date: string;
  generated_at: string;
  game_count: number;
  mode: string | null;
  html: string;
  email_html: string | null;
};

// The /[sport] and /[sport]/[date] pages render pre-built digest HTML and are
// the highest-traffic surfaces on the site, so their digest reads run on nearly
// every request. A digest changes at most once a day (when the generate cron
// rewrites it), so serve it from the Next Data Cache with a short TTL: a burst
// of requests collapses to one Postgres read per interval, at most
// DIGEST_REVALIDATE_S stale — immaterial for once-a-day content. (TTL rather
// than tag invalidation because Next 16's revalidateTag belongs to the Cache
// Components model this app hasn't adopted.)
const DIGEST_REVALIDATE_S = 300;

export function getDigest(sport: string, date: string): Promise<Digest | null> {
  return cachedRead(
    async () => {
      const { data, error } = await supabaseAdmin()
        .from("daily_digests")
        .select("sport, date, generated_at, game_count, mode, html, email_html")
        .eq("sport", sport)
        .eq("date", date)
        .maybeSingle<Digest>();
      if (error) throw new Error(`getDigest: ${error.message}`);
      return data ?? null;
    },
    ["digest", sport, date],
    DIGEST_REVALIDATE_S,
  );
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
export function getLatestDigest(sport: string): Promise<Digest | null> {
  return cachedRead(
    async () => {
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
    },
    ["digest-latest", sport],
    DIGEST_REVALIDATE_S,
  );
}

// In-season modes — preseason and offseason rows exist in the cache but
// represent placeholder pages, not navigable content. The All-Star break
// editions (preview / recap / mid-season) are real content and belong here.
// Exported so the RSS feed (app/rss/[sport]) surfaces exactly the editions the
// site treats as navigable, for every sport.
export const IN_SEASON_MODES = ["regular", "no-games", "all-star-preview", "all-star", "mid-season", "postseason"];

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
