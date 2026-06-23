import { supabaseAdmin } from "./supabase";
import { prevDay } from "./dates";
import { getActiveSubscribersForSport } from "./subscribers";

// Per-(sport, edition date) headline metrics for the admin dashboard's stock-
// style ticker cards. One row per day, keyed by edition date (the day the
// digest was delivered and the URL `/{sport}/{date}` rendered to web).
//
// Two scopes share each row: the original columns are LEAGUE digest values
// (team_id IS NULL); team_* columns aggregate every team digest for the
// sport on that day. "ALL" is computed in JS by summing league + team.
//
// Why per-day history alongside the singleton `ad_stats_snapshot`:
//   The singleton is a rolling window for the public /advertise page. The
//   dashboard cards need history to compute all-time hi/lo and to draw a
//   sparkline. Trades a small daily write for a cheap O(days) read.

export type DailyMetric = {
  sport: string;
  date: string;
  // League digest (team_id IS NULL).
  delivered: number | null;
  opened: number | null;
  clicked: number | null;
  web_pageviews: number | null;
  active_subscribers: number | null;
  // Aggregate across every team digest for the sport that day.
  team_delivered: number | null;
  team_opened: number | null;
  team_clicked: number | null;
  team_web_pageviews: number | null;
  team_active_subscribers: number | null;
};

// resend_id IN (...) URL has to fit under PostgREST's ~8KB GET cap. UUIDs are
// 36 chars + commas + percent-escapes ≈ 40 chars each. 100 per chunk stays
// comfortably under the limit and the (resend_id, event_type) index handles
// each chunk in single-digit milliseconds — way faster than the event_at
// window scan that was hitting the 60s statement_timeout.
const RESEND_ID_CHUNK = 100;

type EventTotals = { delivered: number; opened: number; clicked: number };

// Pull resend_ids for one digest_date scope (league or team). `teamScope`:
//   - "league" → team_id IS NULL
//   - "team"   → team_id IS NOT NULL (aggregate across every team)
async function fetchSendResendIds(
  sport: string,
  digestDate: string,
  teamScope: "league" | "team",
): Promise<string[]> {
  const db = supabaseAdmin();
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db
      .from("sends")
      .select("resend_id")
      .eq("digest_sport", sport)
      .eq("digest_date", digestDate)
      .is("error", null)
      .order("id", { ascending: true })
      .range(from, from + 999);
    q = teamScope === "league" ? q.is("team_id", null) : q.not("team_id", "is", null);
    const { data, error } = await q;
    if (error) throw new Error(`fetchSendResendIds(${teamScope}): ${error.message}`);
    const page = (data ?? []) as Array<{ resend_id: string | null }>;
    for (const r of page) if (r.resend_id) out.push(r.resend_id);
    if (page.length < 1000) break;
  }
  return out;
}

// Dedup-by-resend_id totals for delivered/opened/clicked across a set of
// resend_ids. Chunked IN-list lookup so the URL stays under PostgREST's cap
// and the (resend_id, event_type) index handles each chunk fast.
async function aggregateEventsForResendIds(ids: string[]): Promise<EventTotals> {
  if (ids.length === 0) return { delivered: 0, opened: 0, clicked: 0 };
  const db = supabaseAdmin();
  const deliveredSet = new Set<string>();
  const openedSet    = new Set<string>();
  const clickedSet   = new Set<string>();
  for (let i = 0; i < ids.length; i += RESEND_ID_CHUNK) {
    const chunk = ids.slice(i, i + RESEND_ID_CHUNK);
    const { data, error } = await db
      .from("email_events")
      .select("resend_id, event_type")
      .in("resend_id", chunk)
      .in("event_type", ["email.delivered", "email.opened", "email.clicked", "boxscore.opened"]);
    if (error) throw new Error(`aggregateEventsForResendIds: ${error.message}`);
    for (const e of (data ?? []) as Array<{ resend_id: string | null; event_type: string }>) {
      if (!e.resend_id) continue;
      if (e.event_type === "email.delivered") deliveredSet.add(e.resend_id);
      // Either pixel firing counts as one open — set dedupes by resend_id
      // so we never double-count even if Resend's pixel and ours both fire.
      else if (e.event_type === "email.opened" || e.event_type === "boxscore.opened") {
        openedSet.add(e.resend_id);
      }
      else if (e.event_type === "email.clicked") clickedSet.add(e.resend_id);
    }
  }
  return {
    delivered: deliveredSet.size,
    opened:    openedSet.size,
    clicked:   clickedSet.size,
  };
}

// Distinct active subscribers with at least one team subscription for this
// sport. Sums every subscriber_id from email_subscriptions where scope=team
// and active=true, then dedupes — a subscriber opted into N teams counts
// once toward the "Teams" audience.
async function countActiveTeamSubscribers(sport: string): Promise<number> {
  const db = supabaseAdmin();
  const seen = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("email_subscriptions")
      .select("subscriber_id")
      .eq("sport", sport)
      .eq("scope", "team")
      .eq("active", true)
      .range(from, from + 999);
    if (error) throw new Error(`countActiveTeamSubscribers: ${error.message}`);
    const page = (data ?? []) as Array<{ subscriber_id: string }>;
    for (const r of page) seen.add(r.subscriber_id);
    if (page.length < 1000) break;
  }
  return seen.size;
}

/**
 * Compute the metric for one (sport, edition date) pair. Pulls fresh from
 * sends, email_events, page_views; doesn't write anything. `includeActiveSubscribers`
 * defaults to false — sport-scoped active counts can't be reconstructed for
 * historical days, so backfill leaves the field null and only the daily cron
 * sets it (with the current count).
 */
export async function computeDailyMetric(
  sport: string,
  editionDate: string,
  options: { includeActiveSubscribers?: boolean } = {},
): Promise<Omit<DailyMetric, "sport" | "date">> {
  const db = supabaseAdmin();
  const digestDate = prevDay(editionDate);

  // League: resend_ids + events.
  const leagueIds = await fetchSendResendIds(sport, digestDate, "league");
  const leagueEvents = leagueIds.length > 0
    ? await aggregateEventsForResendIds(leagueIds)
    : null;

  // Team aggregate: every team's resend_ids in one list, deduped.
  const teamIds = await fetchSendResendIds(sport, digestDate, "team");
  const teamEvents = teamIds.length > 0
    ? await aggregateEventsForResendIds(teamIds)
    : null;

  // Web pageviews on the dated league digest path. Team digest URLs use
  // slugs (/{sport}/{teamSlug}) that don't fit a simple path-equality
  // filter — left null for v1; can come back as a regex/IN-list later.
  const path = `/${sport}/${editionDate}`;
  let webPageviews = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("page_views")
      .select("id")
      .eq("event_type", "pageview")
      .eq("vercel_environment", "production")
      .eq("path", path)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`computeDailyMetric pageviews: ${error.message}`);
    const page = data ?? [];
    webPageviews += page.length;
    if (page.length < 1000) break;
  }

  let activeSubscribers:     number | null = null;
  let teamActiveSubscribers: number | null = null;
  if (options.includeActiveSubscribers) {
    activeSubscribers     = (await getActiveSubscribersForSport(sport)).length;
    teamActiveSubscribers = await countActiveTeamSubscribers(sport);
  }

  return {
    delivered:               leagueEvents?.delivered ?? null,
    opened:                  leagueEvents?.opened    ?? null,
    clicked:                 leagueEvents?.clicked   ?? null,
    web_pageviews:           webPageviews,
    active_subscribers:      activeSubscribers,
    team_delivered:          teamEvents?.delivered ?? null,
    team_opened:             teamEvents?.opened    ?? null,
    team_clicked:            teamEvents?.clicked   ?? null,
    team_web_pageviews:      null,
    team_active_subscribers: teamActiveSubscribers,
  };
}

export async function writeDailyMetric(
  sport: string,
  editionDate: string,
  metric: Omit<DailyMetric, "sport" | "date">,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("daily_metrics")
    .upsert(
      {
        sport,
        date: editionDate,
        delivered:               metric.delivered,
        opened:                  metric.opened,
        clicked:                 metric.clicked,
        web_pageviews:           metric.web_pageviews,
        active_subscribers:      metric.active_subscribers,
        team_delivered:          metric.team_delivered,
        team_opened:             metric.team_opened,
        team_clicked:            metric.team_clicked,
        team_web_pageviews:      metric.team_web_pageviews,
        team_active_subscribers: metric.team_active_subscribers,
        computed_at:             new Date().toISOString(),
      },
      { onConflict: "sport,date" },
    );
  if (error) throw new Error(`writeDailyMetric: ${error.message}`);
}

/**
 * Load the full per-day history for a sport. Ordered ascending so callers
 * can scan once for hi/lo + sparkline + recency calculations without sorting.
 */
export async function loadDailyMetrics(sport: string): Promise<DailyMetric[]> {
  const { data, error } = await supabaseAdmin()
    .from("daily_metrics")
    .select(
      "sport, date, delivered, opened, clicked, web_pageviews, active_subscribers, " +
      "team_delivered, team_opened, team_clicked, team_web_pageviews, team_active_subscribers",
    )
    .eq("sport", sport)
    .order("date", { ascending: true });
  if (error) throw new Error(`loadDailyMetrics: ${error.message}`);
  return (data ?? []) as unknown as DailyMetric[];
}
