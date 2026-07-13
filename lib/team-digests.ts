import { supabaseAdmin } from "./supabase";

// Per-team cached digest. Mirror of lib/digests.ts but keyed on
// (sport, team_slug, date). Reads happen on the public web page and from
// the send-team-email cron; writes happen in /api/cron/generate after the
// league digest is done.

export type TeamDigest = {
  sport: string;
  team_slug: string;
  date: string;
  generated_at: string;
  has_game: boolean;
  mode: string | null;
  html: string;
  email_html: string;
};

export async function getTeamDigest(
  sport: string,
  teamSlug: string,
  date: string,
): Promise<TeamDigest | null> {
  const { data, error } = await supabaseAdmin()
    .from("team_digests")
    .select("sport, team_slug, date, generated_at, has_game, mode, html, email_html")
    .eq("sport", sport)
    .eq("team_slug", teamSlug)
    .eq("date", date)
    .maybeSingle<TeamDigest>();
  if (error) throw new Error(`getTeamDigest: ${error.message}`);
  return data ?? null;
}

/**
 * Most recent (any date) cached team digest. Used by /[sport]/[slug] (no date)
 * to render the latest available without forcing the caller to know yesterday's
 * date in ET. Returns null if the team has never been generated.
 */
export async function getLatestTeamDigest(
  sport: string,
  teamSlug: string,
): Promise<TeamDigest | null> {
  const { data, error } = await supabaseAdmin()
    .from("team_digests")
    .select("sport, team_slug, date, generated_at, has_game, mode, html, email_html")
    .eq("sport", sport)
    .eq("team_slug", teamSlug)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle<TeamDigest>();
  if (error) throw new Error(`getLatestTeamDigest: ${error.message}`);
  return data ?? null;
}

const IN_SEASON_MODES = ["regular", "no-games", "all-star-preview", "all-star", "mid-season", "postseason"];

/**
 * Every in-season (team_slug, date) pair for the sport, newest first.
 * Paginated to escape the 1000-row Supabase cap. Powers app/sitemap.ts —
 * MLB alone generates ~30 teams × 180 game days ≈ 5400 rows per season,
 * so a single unpaginated select would silently truncate.
 */
export async function listAllTeamDigestKeys(
  sport: string,
): Promise<{ team_slug: string; date: string }[]> {
  const keys: { team_slug: string; date: string }[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin()
      .from("team_digests")
      .select("team_slug, date")
      .eq("sport", sport)
      .in("mode", IN_SEASON_MODES)
      .order("date", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`listAllTeamDigestKeys: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) keys.push(row as { team_slug: string; date: string });
    if (data.length < pageSize) break;
  }
  return keys;
}

export async function upsertTeamDigest(args: {
  sport: string;
  team_slug: string;
  date: string;
  has_game: boolean;
  html: string;
  email_html: string;
  mode?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("team_digests")
    .upsert(
      {
        sport: args.sport,
        team_slug: args.team_slug,
        date: args.date,
        has_game: args.has_game,
        mode: args.mode ?? null,
        html: args.html,
        email_html: args.email_html,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "sport,team_slug,date" },
    );
  if (error) throw new Error(`upsertTeamDigest: ${error.message}`);
}
