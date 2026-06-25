import { supabaseAdmin } from "./supabase";
import { yesterdayInET } from "./dates";
import { getVisibleSports } from "./sports";
import { featuresFor, SPORTLESS_ROUTES, type CronRoute as SportCronRoute } from "./sport-features";
import { getActiveSubscriberIdSet, getActiveSubscriberIdSetAt, getActiveSubscribersForSport } from "./subscribers";
import { findTeam, type Sport } from "./teams";

// Supabase's JS client caps un-paginated `select` at 1000 rows. The `sends`
// and `subscribers` tables both grow past that, so any aggregation that needs
// the actual rows must page through with .range().
const PAGE_SIZE = 1000;

type QueryBuilder<T> = {
  range(from: number, to: number): Promise<{ data: T[] | null; error: { message: string } | null }>;
};

async function fetchAll<T>(
  build: () => QueryBuilder<T>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return out;
}

export type Window = "24h" | "3d" | "7d" | "30d" | "60d" | "90d";

export const WINDOW_OPTIONS: { value: Window; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "3d", label: "3d" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "60d", label: "60d" },
  { value: "90d", label: "90d" },
];

export function parseWindow(s: string | undefined): Window {
  const valid = WINDOW_OPTIONS.map((o) => o.value) as string[];
  return (valid.includes(s ?? "") ? s : "7d") as Window;
}

export function windowHours(w: Window): number {
  return { "24h": 24, "3d": 72, "7d": 168, "30d": 720, "60d": 1440, "90d": 2160 }[w];
}

// Bucket size for time-series within a window. Smaller windows use finer buckets
// so the chart has enough resolution to be useful.
export function bucketHours(w: Window): number {
  if (w === "24h") return 1;
  if (w === "3d") return 6;
  return 24;
}

export function bucketCount(w: Window): number {
  return Math.ceil(windowHours(w) / bucketHours(w));
}

// Format a bucket's start time as a short axis label.
export function bucketLabel(start: Date, w: Window): string {
  if (w === "24h") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour: "numeric", hour12: true,
    }).format(start);
  }
  if (w === "3d") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", weekday: "short", hour: "numeric", hour12: true,
    }).format(start);
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "numeric", day: "numeric",
  }).format(start);
}

// Build aligned bucket boundaries ending at `now` (exclusive end).
export function buildBuckets(w: Window, now: Date = new Date()): Date[] {
  const size = bucketHours(w) * 3600 * 1000;
  const count = bucketCount(w);
  // Align end to the current bucket boundary so labels line up cleanly.
  const endMs = Math.ceil(now.getTime() / size) * size;
  const buckets: Date[] = [];
  for (let i = count - 1; i >= 0; i--) {
    buckets.push(new Date(endMs - (i + 1) * size));
  }
  return buckets;
}

// Find the bucket index a timestamp falls into; -1 if outside the window.
function bucketIndex(buckets: Date[], sizeMs: number, ts: Date): number {
  if (buckets.length === 0) return -1;
  const startMs = buckets[0]!.getTime();
  const i = Math.floor((ts.getTime() - startMs) / sizeMs);
  return i >= 0 && i < buckets.length ? i : -1;
}

// ---- KPIs ---------------------------------------------------------------

export type DashboardKpis = {
  activeSubscribers: number;
  activeSubscribersDelta: number;
  sendSuccess: { ok: number; failed: number; total: number; rate: number };
  netGrowth: { newSubs: number; unsubs: number; net: number };
  // Churn: % of subscribers active at window start who unsubscribed during the window.
  churn: { rate: number; unsubs: number; activeAtStart: number };
  // Pending: subscribers still stuck at 'pending' (signed up, never confirmed),
  // with delta vs. window-ago to surface confirmation-funnel degradation.
  pending: { count: number; delta: number };
  // Open rate: distinct sends in window that got at least one open event.
  // `tracked` is false when there's never been an open event recorded — used
  // to show "—" instead of "0.0%" before open tracking is configured at Resend.
  openRate: { rate: number; opened: number; sends: number; tracked: boolean };
  // Lifetime successful digest sends — vanity counter, not windowed.
  totalDigestsShipped: number;
};

export async function getKpis(w: Window): Promise<DashboardKpis> {
  // Aggregate-backed. Two cheap live queries (active_now, pending_now,
  // all-time digest count) + indexed reads of daily_send_stats and
  // daily_subscriber_events for the window. See migration 0062 +
  // /api/cron/aggregate-stats.
  //
  // Window granularity is one day. "24h" reads one row; longer windows
  // sum N rows ending yesterday. Today's partial day is excluded since
  // it isn't aggregated yet.
  const db = supabaseAdmin();
  const days = Math.max(1, Math.ceil(windowHours(w) / 24));
  const startDate = aggregateDateNDaysAgo(days);
  const endDate   = aggregateDateNDaysAgo(1);
  // Snapshot date for "active/pending at start of window" — end-of-day
  // immediately before the window starts. days+1 ago.
  const snapshotDate = aggregateDateNDaysAgo(days + 1);

  const [
    activeNowQ,
    pendingNowQ,
    totalDigestsQ,
    sendRowsQ,
    snapshotQ,
    eventRowsQ,
  ] = await Promise.all([
    db.from("subscribers").select("id", { count: "exact", head: true }).eq("status", "active"),
    db.from("subscribers").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("sends").select("id", { count: "exact", head: true }).is("error", null),
    db.from("daily_send_stats")
      .select("sends, failed_send, delivered, bounced, delayed, pending, opens_unique")
      .gte("date", startDate).lte("date", endDate),
    db.from("daily_subscriber_events")
      .select("active_at_end, pending_at_end")
      .eq("date", snapshotDate)
      .maybeSingle<{ active_at_end: number; pending_at_end: number }>(),
    db.from("daily_subscriber_events")
      .select("new_subs, unsubs")
      .gte("date", startDate).lte("date", endDate),
  ]);

  const activeNow      = activeNowQ.count ?? 0;
  const pendingNow     = pendingNowQ.count ?? 0;
  const totalDigests   = totalDigestsQ.count ?? 0;
  const activeAtStart  = snapshotQ.data?.active_at_end ?? 0;
  const pendingAtStart = snapshotQ.data?.pending_at_end ?? 0;

  let totalSends = 0, failedSends = 0, openDenominator = 0, openedInWindow = 0;
  for (const r of (sendRowsQ.data ?? []) as Array<{
    sends: number; failed_send: number; delivered: number;
    bounced: number; delayed: number; pending: number; opens_unique: number;
  }>) {
    totalSends      += r.sends;
    failedSends     += r.failed_send;
    // "ok sends with a resend id" matches the old getKpis open-rate denominator.
    openDenominator += r.sends - r.failed_send;
    openedInWindow  += r.opens_unique;
  }
  const okSends = totalSends - failedSends;

  let newSubs = 0, unsubs = 0;
  for (const r of (eventRowsQ.data ?? []) as Array<{ new_subs: number; unsubs: number }>) {
    newSubs += r.new_subs;
    unsubs  += r.unsubs;
  }

  // "Tracked" = at least one open event in the window OR at least one
  // open event ever (preserves the old "tracked but no sends" check).
  let openTracked = openedInWindow > 0;
  if (!openTracked) {
    const { count } = await db.from("email_events")
      .select("id", { count: "exact", head: true })
      .in("event_type", ["email.opened", "boxscore.opened"])
      .limit(1);
    openTracked = (count ?? 0) > 0;
  }
  const openRate = openDenominator === 0 ? 0 : openedInWindow / openDenominator;

  return {
    activeSubscribers: activeNow,
    activeSubscribersDelta: activeNow - activeAtStart,
    sendSuccess: {
      ok: okSends,
      failed: failedSends,
      total: totalSends,
      rate: totalSends === 0 ? 1 : okSends / totalSends,
    },
    netGrowth: { newSubs, unsubs, net: newSubs - unsubs },
    churn: {
      // % of subs who were active at the start of the window and unsubscribed during it.
      // Empty list → 0%, not NaN.
      rate: activeAtStart === 0 ? 0 : unsubs / activeAtStart,
      unsubs,
      activeAtStart,
    },
    pending: { count: pendingNow, delta: pendingNow - pendingAtStart },
    openRate: {
      rate: openRate,
      opened: openedInWindow,
      sends: openDenominator,
      tracked: openTracked,
    },
    totalDigestsShipped: totalDigests,
  };
}

// ---- Subscriber growth series ------------------------------------------

export type SubscriberSeries = {
  buckets: Date[];
  active: number[];     // cumulative active count at end of each bucket
  newSubs: number[];    // confirmed_at landing in each bucket
  unsubs: number[];     // unsubscribed_at landing in each bucket (total)
  unsubsReal: number[]; // subset of unsubs: user-driven (reason=null or "user")
  unsubsAuto: number[]; // subset of unsubs: bounce/complaint/manual (system-driven)
};

export async function getSubscriberSeries(w: Window): Promise<SubscriberSeries> {
  const buckets = buildBuckets(w);
  const sizeMs = bucketHours(w) * 3600 * 1000;
  const count = buckets.length;
  const newSubs = new Array<number>(count).fill(0);
  const unsubs = new Array<number>(count).fill(0);
  const unsubsReal = new Array<number>(count).fill(0);
  const unsubsAuto = new Array<number>(count).fill(0);
  const active = new Array<number>(count).fill(0);

  type Row = {
    confirmed_at: string | null;
    unsubscribed_at: string | null;
    unsubscribe_reason: string | null;
  };
  const rows = await fetchAll<Row>(
    () => supabaseAdmin()
      .from("subscribers")
      .select("confirmed_at, unsubscribed_at, unsubscribe_reason") as unknown as QueryBuilder<Row>,
    "getSubscriberSeries",
  );

  // Active count at end of window = current active (matches snapshot now).
  // Walk backward subtracting net deltas to fill earlier buckets.
  const windowStartMs = buckets[0]?.getTime() ?? 0;
  const windowEndMs = (buckets[count - 1]?.getTime() ?? 0) + sizeMs;

  let activeAtEnd = 0;
  for (const r of rows) {
    const c = r.confirmed_at ? new Date(r.confirmed_at).getTime() : null;
    const u = r.unsubscribed_at ? new Date(r.unsubscribed_at).getTime() : null;
    if (c !== null && c < windowEndMs && (u === null || u >= windowEndMs)) activeAtEnd++;
    if (c !== null) {
      const idx = bucketIndex(buckets, sizeMs, new Date(c));
      if (idx >= 0) newSubs[idx]!++;
    }
    if (u !== null) {
      const idx = bucketIndex(buckets, sizeMs, new Date(u));
      if (idx >= 0) {
        unsubs[idx]!++;
        // "Real" = subscriber clicked unsubscribe (explicit user action).
        // Everything else (bounce, complaint, manual=admin) is "auto" —
        // system removed them, not them telling us they're out.
        const reason = r.unsubscribe_reason;
        if (reason === null || reason === "user") {
          unsubsReal[idx]!++;
        } else {
          unsubsAuto[idx]!++;
        }
      }
    }
  }

  // Fill `active` from right to left: active[i] is the active count at the END
  // of bucket i. active[count-1] = activeAtEnd. Going back one bucket subtracts
  // that bucket's net (new - unsubs).
  active[count - 1] = activeAtEnd;
  for (let i = count - 2; i >= 0; i--) {
    active[i] = active[i + 1]! - (newSubs[i + 1]! - unsubs[i + 1]!);
  }
  // Optional: ensure no negatives from out-of-window churn.
  for (let i = 0; i < count; i++) if (active[i]! < 0) active[i] = 0;

  // Note: `windowStartMs` is reserved if we need to clip pre-window subscribers
  // out of activeAtEnd later; currently we count from all-time correctly.
  void windowStartMs;

  return { buckets, active, newSubs, unsubs, unsubsReal, unsubsAuto };
}

// ---- Open stickiness histogram -----------------------------------------

// "Of subscribers who received every league send in the last N days, how
// many days did they actually open?" The histogram answers a question
// neither open rate (per-send) nor active-list size (per-subscriber)
// covers: how *sticky* the audience is on a per-reader basis.
//
// Denominator gates on receiving all N sends (eligible base) so the
// metric isn't dragged down by mid-window signups. Numerator is per-day
// distinct opens — multiple opens of the same email collapse to 1 day.
//
// MPP caveat: Apple Mail Privacy Protection silently prefetches the
// open pixel, so "opened" is an upper bound on real reads. The admin
// surface surfaces this as a footnote rather than adjusting the number.

export type OpenStickiness = {
  sport:        string;
  windowDays:   number;
  windowStart:  string;        // YYYY-MM-DD ET
  windowEnd:    string;        // YYYY-MM-DD ET (yesterday)
  eligible:     number;        // subscribers who received all N sends
  // histogram[k] = # of eligible subscribers who opened exactly k of N.
  histogram:    number[];
};

function ymdInET(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function getOpenStickiness(
  sport:      string,
  windowDays: number,
): Promise<OpenStickiness> {
  if (windowDays < 1) throw new Error(`windowDays must be ≥1, got ${windowDays}`);

  // Reads the most recent snapshot from daily_open_stickiness (migration
  // 0063, written nightly by /api/cron/aggregate-stats). The histogram
  // pivot is per-subscriber-per-day, which can't be served from the
  // per-(sport,scope,date) totals in daily_send_stats — but precomputing
  // it once in the cron lets the page render in one indexed read.
  //
  // Scope is "league" (matches the original team_id IS NULL filter).
  // If no snapshot exists yet (fresh deploy, never-run cron, or sport
  // with no recent league sends), return a zeroed histogram so the
  // panel renders an empty state instead of erroring.
  const { data, error } = await supabaseAdmin()
    .from("daily_open_stickiness")
    .select("date, eligible, histogram")
    .eq("sport", sport)
    .eq("scope", "league")
    .eq("window_days", windowDays)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle<{ date: string; eligible: number; histogram: number[] }>();
  if (error) throw new Error(`getOpenStickiness: ${error.message}`);

  if (!data) {
    return {
      sport, windowDays,
      windowStart: ymdInET(new Date(Date.now() - windowDays * 86_400_000)),
      windowEnd:   ymdInET(new Date(Date.now() - 86_400_000)),
      eligible: 0,
      histogram: new Array<number>(windowDays + 1).fill(0),
    };
  }

  // Reconstruct the window labels from the snapshot's end date. The cron
  // writes end = "yesterday in ET"; the page's "windowStart" label is N-1
  // days before that.
  const endMs = new Date(`${data.date}T12:00:00Z`).getTime();
  const windowStart = ymdInET(new Date(endMs - (windowDays - 1) * 86_400_000));
  const windowEnd   = data.date;

  return {
    sport, windowDays,
    windowStart, windowEnd,
    eligible: data.eligible,
    histogram: data.histogram,
  };
}

// ---- Send health series ------------------------------------------------

export type SendSeries = {
  buckets: Date[];
  ok: number[];
  failed: number[];
};

export async function getSendSeries(w: Window): Promise<SendSeries> {
  const buckets = buildBuckets(w);
  const sizeMs = bucketHours(w) * 3600 * 1000;
  const count = buckets.length;
  const ok = new Array<number>(count).fill(0);
  const failed = new Array<number>(count).fill(0);

  const sinceIso = buckets[0]?.toISOString();
  if (!sinceIso) return { buckets, ok, failed };

  // For day-bucket windows (3d+) the chart lines up with daily_send_stats
  // rows one-to-one. Sub-day buckets (24h → 1h) aren't aggregated; fall
  // back to a live sends scan, which is bounded to 24h and fast.
  if (bucketHours(w) >= 24) {
    const startDate = sinceIso.slice(0, 10);
    const { data, error } = await supabaseAdmin()
      .from("daily_send_stats")
      .select("date, sends, failed_send")
      .gte("date", startDate);
    if (error) throw new Error(`getSendSeries: ${error.message}`);
    for (const r of (data ?? []) as Array<{ date: string; sends: number; failed_send: number }>) {
      // Bucket boundaries align to UTC day starts; map date → bucket index.
      const idx = bucketIndex(buckets, sizeMs, new Date(`${r.date}T00:00:00.000Z`));
      if (idx < 0) continue;
      ok[idx]!     += r.sends - r.failed_send;
      failed[idx]! += r.failed_send;
    }
    return { buckets, ok, failed };
  }

  // 24h window: live scan (small, fast).
  const rows = await fetchAll<{ sent_at: string; error: string | null }>(
    () => supabaseAdmin()
      .from("sends")
      .select("sent_at, error")
      .gte("sent_at", sinceIso) as unknown as QueryBuilder<{ sent_at: string; error: string | null }>,
    "getSendSeries",
  );
  for (const r of rows) {
    const idx = bucketIndex(buckets, sizeMs, new Date(r.sent_at));
    if (idx < 0) continue;
    if (r.error) failed[idx]!++; else ok[idx]!++;
  }
  return { buckets, ok, failed };
}

// ---- Cron heat-map -----------------------------------------------------

export const CRON_ROUTES = ["generate", "send-email", "post-bluesky", "post-twitter"] as const;
export type CronRoute = (typeof CRON_ROUTES)[number];
export type CronCellStatus = "pass" | "fail" | "running" | "none";

export type CronHeatMap = {
  days: string[];               // ISO dates, oldest → newest
  cells: Record<CronRoute, CronCellStatus[]>;
  runIds: Record<CronRoute, (string | null)[]>;
};

// Convert a window into a day count for the cron heat-map. The cron_runs.date
// column is per-day, so we always show whole days; sub-day windows show 1.
export function windowDays(w: Window): number {
  return Math.max(1, Math.ceil(windowHours(w) / 24));
}

export async function getCronHeatMap(days: number = 14): Promise<CronHeatMap> {
  // Build the day list (ET-aligned, ending at today)
  const dayList: string[] = [];
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const todayMs = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayMs - i * 24 * 3600 * 1000);
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    dayList.push(`${get("year")}-${get("month")}-${get("day")}`);
  }

  // Pull all cron_runs in the window, then bucket by (route, date).
  const sinceIso = new Date(todayMs - days * 24 * 3600 * 1000).toISOString();
  const { data } = await supabaseAdmin()
    .from("cron_runs")
    .select("id, route, date, status, started_at")
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: true });

  const cells = {} as Record<CronRoute, CronCellStatus[]>;
  const runIds = {} as Record<CronRoute, (string | null)[]>;
  for (const route of CRON_ROUTES) {
    cells[route] = new Array<CronCellStatus>(days).fill("none");
    runIds[route] = new Array<string | null>(days).fill(null);
  }

  for (const r of (data ?? []) as {
    id: string; route: string; date: string | null; status: string; started_at: string;
  }[]) {
    if (!CRON_ROUTES.includes(r.route as CronRoute)) continue;
    // Prefer the run's logical `date` (the digest date it processed); fall back to started_at day.
    const dayKey = r.date ?? r.started_at.slice(0, 10);
    const idx = dayList.indexOf(dayKey);
    if (idx < 0) continue;
    const route = r.route as CronRoute;
    // Latest run wins (sorted ascending, so just overwrite).
    cells[route][idx] = r.status === "ok" ? "pass" : r.status === "failed" ? "fail" : "running";
    runIds[route][idx] = r.id;
  }

  return { days: dayList, cells, runIds };
}

// ---- Deliverability ---------------------------------------------------
//
// Send-level KPIs about what Resend actually did with the messages we
// handed off. We already store a row per send (sends) and webhook events
// per resend_id (email_events). This rolls them together and classifies
// each send into one terminal state:
//
//   delivered   — at least one email.delivered event landed
//   bounced     — email.bounced and no delivered (hard/soft bounce both count)
//   delayed     — email.delivery_delayed seen, no delivered/bounced yet
//   pending     — Resend accepted the send but no terminal event yet
//   failed      — sends.error is set (Resend rejected before sending)
//
// Complained is tracked separately because it can overlap with delivered
// (subscriber receives the email *then* marks it as spam). Counts can sum
// to greater than the send total only on the complaints row.

export type DeliverabilityStats = {
  sent: number;
  delivered: number;
  bounced: number;
  delayed: number;
  complained: number;
  pending: number;
  failed: number;
  deliveredRate: number;
  bouncedRate: number;
  delayedRate: number;
  complainedRate: number;
  failedRate: number;
};

export async function getDeliverabilityStats(w: Window): Promise<DeliverabilityStats> {
  // Reads precomputed daily_send_stats rows for the window and sums. The
  // 60s+ per-request sends + email_events scan moved to the
  // /api/cron/aggregate-stats nightly job; this function is now a small
  // indexed lookup. See migration 0062 + lib/admin-aggregates.ts.
  //
  // Window granularity is one day (the smallest aggregate). "24h" maps to
  // yesterday's row; longer windows sum N rows. Today's partial day isn't
  // aggregated yet and is intentionally excluded — the live counts would
  // distort hourly rates anyway.
  const days = Math.max(1, Math.ceil(windowHours(w) / 24));
  const start = aggregateDateNDaysAgo(days);
  const end   = aggregateDateNDaysAgo(1);
  const { data, error } = await supabaseAdmin()
    .from("daily_send_stats")
    .select("sends, failed_send, delivered, bounced, delayed, pending, complained")
    .gte("date", start)
    .lte("date", end);
  if (error) throw new Error(`getDeliverabilityStats: ${error.message}`);
  let sent = 0, delivered = 0, bounced = 0, delayed = 0, pending = 0, complained = 0, failed = 0;
  for (const r of (data ?? []) as Array<{
    sends: number; failed_send: number; delivered: number;
    bounced: number; delayed: number; pending: number; complained: number;
  }>) {
    sent       += r.sends;
    failed     += r.failed_send;
    delivered  += r.delivered;
    bounced    += r.bounced;
    delayed    += r.delayed;
    pending    += r.pending;
    complained += r.complained;
  }
  if (sent === 0) {
    return {
      sent: 0, delivered: 0, bounced: 0, delayed: 0, complained: 0, pending: 0, failed: 0,
      deliveredRate: 0, bouncedRate: 0, delayedRate: 0, complainedRate: 0, failedRate: 0,
    };
  }
  return {
    sent, delivered, bounced, delayed, pending, complained, failed,
    deliveredRate: delivered / sent,
    bouncedRate:   bounced   / sent,
    delayedRate:   delayed   / sent,
    complainedRate: complained / sent,
    failedRate:    failed    / sent,
  };
}

// Helper: UTC date N days ago in YYYY-MM-DD. Matches daily_send_stats.date
// (which stores sends.sent_at::date in UTC).
function aggregateDateNDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// ---- Universal-dashboard watchwall + sport-day grid --------------------
//
// The "is anything broken right now?" hero. Returns one row per visible
// sport, with one cell per route that sport is *expected* to run today
// (from lib/sport-features). Cell status:
//   pass     — most-recent cron_run for (sport, route, yesterdayET) was ok
//   fail     — most-recent run failed
//   running  — most-recent run hasn't finished yet
//   missing  — sport expects this route today but no run yet (red flag)

export type WatchwallCellStatus = "pass" | "fail" | "running" | "missing";

export type WatchwallCell = {
  route: SportCronRoute;
  status: WatchwallCellStatus;
  startedAt: string | null;
  error: string | null;
  runId: string | null;
};

export type WatchwallRow = {
  sport: string;
  sportName: string;
  date: string;
  cells: WatchwallCell[];
};

export async function getDashboardWatchwall(): Promise<WatchwallRow[]> {
  const sports = await getVisibleSports({ includeAdminOnly: true });
  const date = yesterdayInET();

  // One query, group in JS. Ascending order so later rows overwrite earlier,
  // leaving the most recent run per (sport, route) in the map at the end.
  type Row = {
    id: string; route: string; sport: string;
    status: string; error: string | null; started_at: string;
  };
  const { data, error } = await supabaseAdmin()
    .from("cron_runs")
    .select("id, route, sport, status, error, started_at")
    .eq("date", date)
    .order("started_at", { ascending: true });
  if (error) throw new Error(`getDashboardWatchwall: ${error.message}`);

  // Group by sport. Sport-less rows (e.g. `supervise`) get bucketed under
  // the sentinel "__platform" key so the synthetic Platform row below can
  // find them via the same map lookup as a real sport.
  const PLATFORM_KEY = "__platform";
  const latest: Record<string, Record<string, Row>> = {};
  for (const r of (data ?? []) as Array<Row & { sport: string | null }>) {
    const key = r.sport ?? PLATFORM_KEY;
    (latest[key] ??= {})[r.route] = r as Row;
  }

  const toCell = (route: SportCronRoute, r: Row | undefined): WatchwallCell => ({
    route,
    status: !r ? "missing"
      : r.status === "ok" ? "pass"
      : r.status === "failed" ? "fail"
      : "running",
    startedAt: r?.started_at ?? null,
    error: r?.error ?? null,
    runId: r?.id ?? null,
  });

  const sportRows: WatchwallRow[] = sports.map((sport) => {
    const features = featuresFor(sport.id);
    const cells = features.expectedRoutes.map((route) =>
      toCell(route, latest[sport.id]?.[route]),
    );
    return { sport: sport.id, sportName: sport.name, date, cells };
  });

  // Platform row — surfaces sport-less crons (currently just `supervise`).
  // Without this they'd run daily and never appear on the wall.
  const platformRow: WatchwallRow = {
    sport: PLATFORM_KEY,
    sportName: "Platform",
    date,
    cells: SPORTLESS_ROUTES.map((route) =>
      toCell(route, latest[PLATFORM_KEY]?.[route]),
    ),
  };

  return [...sportRows, platformRow];
}

// GitHub-style contribution grid — one row per visible sport, columns are
// the last N days. Each cell aggregates across that sport's expected routes
// for that day:
//   pass     — every expected route ran ok
//   partial  — some expected routes ran ok, at least one missing (no fails)
//   fail     — at least one expected route failed
//   missing  — no expected route ran at all (this should rarely be ok)

export type CronGridCellStatus = "pass" | "partial" | "fail" | "missing";

export type CronGridRow = {
  sport: string;
  sportName: string;
  cells: CronGridCellStatus[];
};

export type CronGridBySport = {
  days: string[];    // ISO dates, oldest → newest
  rows: CronGridRow[];
};

export async function getCronGridBySportDay(days: number = 14): Promise<CronGridBySport> {
  const sports = await getVisibleSports({ includeAdminOnly: true });

  // Build ET-aligned day list ending at yesterday-in-ET. Today isn't included
  // because the cron_runs.date stores the digest date (yesterday at run time);
  // showing "today" would always be missing because crons haven't run for it.
  const dayList: string[] = [];
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const todayMs = Date.now();
  for (let i = days; i >= 1; i--) {
    const d = new Date(todayMs - i * 24 * 3600 * 1000);
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    dayList.push(`${get("year")}-${get("month")}-${get("day")}`);
  }

  // One query for the whole window. We use `started_at >= sinceIso` rather
  // than filtering on `date` so a run scheduled at the boundary still gets
  // picked up, then we bucket by `date` in JS.
  const sinceIso = new Date(todayMs - (days + 1) * 24 * 3600 * 1000).toISOString();
  type Row = { route: string; sport: string; date: string | null; status: string; started_at: string };
  const { data, error } = await supabaseAdmin()
    .from("cron_runs")
    .select("route, sport, date, status, started_at")
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: true });
  if (error) throw new Error(`getCronGridBySportDay: ${error.message}`);

  // sport → date → route → status (latest wins via ascending order).
  const map: Record<string, Record<string, Record<string, string>>> = {};
  for (const r of (data ?? []) as Row[]) {
    const dayKey = r.date ?? r.started_at.slice(0, 10);
    ((map[r.sport] ??= {})[dayKey] ??= {})[r.route] = r.status;
  }

  const rows: CronGridRow[] = sports.map((sport) => {
    const features = featuresFor(sport.id);
    const expected = features.expectedRoutes;
    const cells: CronGridCellStatus[] = dayList.map((day) => {
      const dayRuns = map[sport.id]?.[day] ?? {};
      let ok = 0, failed = 0, present = 0;
      for (const route of expected) {
        const s = dayRuns[route];
        if (s == null) continue;
        present++;
        if (s === "ok") ok++;
        else if (s === "failed") failed++;
      }
      if (failed > 0) return "fail";
      if (present === 0) return "missing";
      if (present < expected.length) return "partial";
      return "pass";
    });
    return { sport: sport.id, sportName: sport.name, cells };
  });

  return { days: dayList, rows };
}

// ---- Content snapshot --------------------------------------------------

export type ContentSnapshot = {
  yesterday: {
    date: string;
    gameCount: number;
    htmlSize: number;
    emailSize: number;
    sendCount: number;
  } | null;
  emailSizeTrend: { date: string; size: number }[];
};

export async function getContentSnapshot(w: Window): Promise<ContentSnapshot> {
  const db = supabaseAdmin();
  const yesterday = yesterdayInET();

  const { data: digest } = await db
    .from("daily_digests")
    .select("date, game_count, html, email_html")
    .eq("sport", "mlb")
    .eq("date", yesterday)
    .maybeSingle<{ date: string; game_count: number; html: string; email_html: string | null }>();

  let sendCount = 0;
  if (digest) {
    const { count } = await db
      .from("sends")
      .select("id", { count: "exact", head: true })
      .eq("digest_date", yesterday)
      .is("error", null);
    sendCount = count ?? 0;
  }

  // Trend: pull email_html sizes within the window. For 24h/3d we still
  // use daily granularity here because digests are daily.
  const days = Math.ceil(windowHours(w) / 24);
  const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: trendRows } = await db
    .from("daily_digests")
    .select("date, email_html")
    .eq("sport", "mlb")
    .gte("date", sinceIso)
    .order("date", { ascending: true });

  const emailSizeTrend = ((trendRows ?? []) as { date: string; email_html: string | null }[])
    .map((r) => ({ date: r.date, size: r.email_html ? r.email_html.length : 0 }));

  return {
    yesterday: digest
      ? {
          date: digest.date,
          gameCount: digest.game_count,
          htmlSize: digest.html.length,
          emailSize: digest.email_html ? digest.email_html.length : 0,
          sendCount,
        }
      : null,
    emailSizeTrend,
  };
}

// ---- Send coverage -------------------------------------------------------
//
// For each sport that runs sends, compares the count of currently-eligible
// subscribers (active subscriber + active opt-in row) against the count of
// rows actually written to `sends` for that (sport, date). A meaningful
// gap means the cron either hasn't fully fired OR is silently dropping
// recipients somewhere — both worth surfacing on the universal dashboard
// next to the watchwall.
//
// Some natural daily gap is expected from subscribers who confirm AFTER
// the cron runs; we flag rows where the gap exceeds a small threshold.

export type SendCoverageBucket = {
  eligible: number;
  sent: number;
  /** sent / eligible as a 0–1 ratio. 1.0 when fully covered, 0 when no sends. */
  coverage: number;
  /** True when there's a meaningful unexplained gap — UI surfaces this in red. */
  warn: boolean;
};

export type SendCoverageRow = {
  sport: string;
  sportName: string;
  date: string;
  league: SendCoverageBucket | null;  // null = sport doesn't run a league send
  team: SendCoverageBucket | null;    // null = sport doesn't have team digests
};

// Tunable. Anything ≥5% gap (e.g. 100 sent of 110 eligible) is the kind of
// thing that begs a second look. Smaller gaps are typically just post-cron
// confirmations.
const COVERAGE_WARN_THRESHOLD = 0.05;

function makeBucket(eligible: number, sent: number): SendCoverageBucket {
  const coverage = eligible === 0 ? 1 : sent / eligible;
  const gap = eligible - sent;
  // Flag when coverage is meaningfully below 1.0 AND the gap is more than
  // a handful of subscribers — avoids false alarms on tiny eligible sets
  // (e.g. 1 eligible / 0 sent isn't actually interesting).
  const warn = eligible > 5 && gap >= 5 && coverage < 1 - COVERAGE_WARN_THRESHOLD;
  return { eligible, sent, coverage, warn };
}

// Most recent successful cron_runs.started_at for a given (route, sport, date).
// We use this as the cutoff for "who was eligible at cron time" — opt-ins
// created after the cron fired weren't subscribed yet and shouldn't be in
// the denominator. Returns null when no completed run exists yet (e.g. for
// a sport whose cron hasn't been scheduled).
async function getCronStartedAt(
  route: string,
  sport: string,
  date: string,
): Promise<string | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("cron_runs")
    .select("started_at")
    .eq("route", route)
    .eq("sport", sport)
    .eq("date", date)
    .eq("status", "ok")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getCronStartedAt ${route}/${sport}/${date}: ${error.message}`);
  return data?.started_at ?? null;
}

export async function getSendCoverage(): Promise<SendCoverageRow[]> {
  const date = yesterdayInET();
  const sports = await getVisibleSports({ includeAdminOnly: true });
  const db = supabaseAdmin();

  // Fallback for when no cron has fired yet — denominator = currently
  // active subscribers. Once a cron exists, we use a cutoff-aware set
  // instead so churn since the cron doesn't skew the ratio.
  const currentlyActiveIds = await getActiveSubscriberIdSet();

  const rows: SendCoverageRow[] = [];
  for (const sport of sports) {
    const features = featuresFor(sport.id);

    let league: SendCoverageBucket | null = null;
    if (features.expectedRoutes.includes("send-email")) {
      // We use the cron's started_at to decide who was active *as a
      // subscriber* at the time. The email_subscriptions row's own
      // created_at is unreliable — applyInitialSubscriptions deletes and
      // recreates rows on resubscribe, so an existing opt-in can appear
      // "newly created" even though it was effectively in place at cron
      // time. The subscriber-level cutoff is solid; the opt-in side just
      // checks current active=true.
      const cutoff = await getCronStartedAt("send-email", sport.id, date);
      const activeIds = cutoff
        ? await getActiveSubscriberIdSetAt(cutoff)
        : currentlyActiveIds;
      const [optIns, sent] = await Promise.all([
        fetchAll<{ subscriber_id: string }>(
          () => db.from("email_subscriptions")
            .select("subscriber_id")
            .eq("sport", sport.id)
            .eq("scope", "league")
            .eq("active", true) as unknown as QueryBuilder<{ subscriber_id: string }>,
          `getSendCoverage league opt-ins (${sport.id})`,
        ),
        db.from("sends")
          .select("subscriber_id", { count: "exact", head: true })
          .eq("digest_sport", sport.id)
          .eq("digest_date", date)
          .is("team_id", null)
          .is("error", null),
      ]);
      if (sent.error) throw new Error(`getSendCoverage league sends: ${sent.error.message}`);
      let eligible = 0;
      for (const r of optIns) {
        if (activeIds.has(r.subscriber_id)) eligible++;
      }
      league = makeBucket(eligible, sent.count ?? 0);
    }

    let team: SendCoverageBucket | null = null;
    if (features.expectedRoutes.includes("send-team-email")) {
      const cutoff = await getCronStartedAt("send-team-email", sport.id, date);
      const activeIds = cutoff
        ? await getActiveSubscriberIdSetAt(cutoff)
        : currentlyActiveIds;
      const [optIns, sent] = await Promise.all([
        fetchAll<{ subscriber_id: string }>(
          () => db.from("email_subscriptions")
            .select("subscriber_id")
            .eq("sport", sport.id)
            .eq("scope", "team")
            .eq("active", true) as unknown as QueryBuilder<{ subscriber_id: string }>,
          `getSendCoverage team opt-ins (${sport.id})`,
        ),
        db.from("sends")
          .select("subscriber_id", { count: "exact", head: true })
          .eq("digest_sport", sport.id)
          .eq("digest_date", date)
          .not("team_id", "is", null)
          .is("error", null),
      ]);
      if (sent.error) throw new Error(`getSendCoverage team sends: ${sent.error.message}`);
      let eligible = 0;
      for (const r of optIns) {
        if (activeIds.has(r.subscriber_id)) eligible++;
      }
      team = makeBucket(eligible, sent.count ?? 0);
    }

    if (league || team) {
      rows.push({ sport: sport.id, sportName: sport.name, date, league, team });
    }
  }
  return rows;
}

// ---- Storage stats -----------------------------------------------------

export type BucketStats = { name: string; bytes: number; files: number };
export type StorageStats = { buckets: BucketStats[]; totalBytes: number; totalFiles: number };

// Buckets we own and want to monitor. Add to this list when we provision new
// ones. Listed buckets that don't exist yet are silently skipped so we don't
// pollute the dashboard with errors during a partial setup.
const MONITORED_BUCKETS = ["share-images"] as const;

export async function getStorageStats(): Promise<StorageStats> {
  const supa = supabaseAdmin();
  const buckets: BucketStats[] = [];
  let totalBytes = 0;
  let totalFiles = 0;
  for (const name of MONITORED_BUCKETS) {
    let bytes = 0;
    let files = 0;
    // Storage list maxes out at 1000 per request; paginate for buckets that
    // accumulate past that (share-images grows ~18 files/day = 1000 in ~55d).
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supa.storage.from(name).list("", { limit: pageSize, offset });
      if (error) {
        // Missing bucket isn't fatal — skip it so the dashboard still renders.
        console.warn(`getStorageStats: bucket "${name}" list error: ${error.message}`);
        break;
      }
      const page = data ?? [];
      if (page.length === 0) break;
      for (const f of page) {
        if (f.name === ".emptyFolderPlaceholder") continue;
        const size = (f.metadata?.size as number | undefined) ?? 0;
        bytes += size;
        files++;
      }
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    buckets.push({ name, bytes, files });
    totalBytes += bytes;
    totalFiles += files;
  }
  return { buckets, totalBytes, totalFiles };
}

// ---- RSS readership ----------------------------------------------------

export type RssReadershipDay = {
  date: string;           // YYYY-MM-DD in ET
  polls: number;          // total poll count for the day
  aggregatorSubs: number; // sum of MAX(subscribers) per aggregator that day
  individuals: number;    // distinct individual-reader user-agent variants
  estimatedReaders: number; // aggregatorSubs + individuals
};

// Daily breakdown of RSS polls, grouped in ET. Estimate of "readers" leans on
// the user-agent pattern: aggregators (Feedly, Inoreader, etc.) advertise the
// subscriber count they're polling on behalf of, so we take MAX(subscribers)
// per (day, aggregator) to dedupe multiple polls. Everything else (no
// reported count) is a one-human-each individual reader, counted by distinct
// user-agent variants.
export async function getRssReadership(
  sport: string,
  days: number,
): Promise<RssReadershipDay[]> {
  const sinceMs = Date.now() - days * 24 * 3600 * 1000;
  const since = new Date(sinceMs).toISOString();
  const rows = await fetchAll<{
    polled_at: string;
    user_agent: string | null;
    aggregator: string | null;
    subscribers: number | null;
  }>(
    () => supabaseAdmin()
      .from("rss_polls")
      .select("polled_at, user_agent, aggregator, subscribers")
      .eq("sport", sport)
      .gte("polled_at", since)
      .order("polled_at", { ascending: true }) as unknown as QueryBuilder<{
        polled_at: string;
        user_agent: string | null;
        aggregator: string | null;
        subscribers: number | null;
      }>,
    "getRssReadership",
  );

  // Bucket by ET date.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  });
  type DayAccum = {
    polls: number;
    maxSubsByAggregator: Map<string, number>;
    individualUAs: Set<string>;
  };
  const byDay = new Map<string, DayAccum>();
  for (const r of rows) {
    const date = fmt.format(new Date(r.polled_at));
    const accum = byDay.get(date) ?? {
      polls: 0,
      maxSubsByAggregator: new Map<string, number>(),
      individualUAs: new Set<string>(),
    };
    accum.polls++;
    if (r.subscribers != null && r.aggregator) {
      const prev = accum.maxSubsByAggregator.get(r.aggregator) ?? 0;
      if (r.subscribers > prev) accum.maxSubsByAggregator.set(r.aggregator, r.subscribers);
    } else if (r.user_agent) {
      accum.individualUAs.add(r.user_agent);
    }
    byDay.set(date, accum);
  }

  const out: RssReadershipDay[] = [];
  for (const [date, accum] of byDay) {
    let aggregatorSubs = 0;
    for (const n of accum.maxSubsByAggregator.values()) aggregatorSubs += n;
    const individuals = accum.individualUAs.size;
    out.push({
      date,
      polls: accum.polls,
      aggregatorSubs,
      individuals,
      estimatedReaders: aggregatorSubs + individuals,
    });
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

// ---- Advertiser stats (for /admin/ads) ---------------------------------
//
// Two helpers feeding the prospective-advertiser pitch panel: yesterday's
// numbers and a 30-day rolling view with a daily opens/clicks series. The
// `tracked` flag mirrors getKpis().openRate.tracked — false when no open
// event has ever landed, so the UI can render "—" instead of a misleading
// "0.0%" before Resend's open-tracking pixel is verified.
//
// Yesterday is sliced by (sport, scope) where scope is "league" (sends.
// team_id is null) or "team" (team_id is set). The page collapses team
// rows into a single "Team digests" line for now — drilldown per team is
// a future need; aggregating early would hide the fact that we still
// have the raw row.

export type AdStatsBucket = {
  sport: string;
  scope: "league" | "team";
  sends: number;
  delivered: number;
  opened: number;
  clicked: number;
};

export type YesterdayAdStats = {
  date: string;
  sends: number;
  delivered: number;
  opened: number;
  clicked: number;
  openRate: number;
  clickRate: number;
  breakdown: AdStatsBucket[];
  tracked: boolean;
};

export type AdStatsDailyPoint = {
  date: string;
  delivered: number;
  opened: number;
  clicked: number;
};

export type RollingAdStats = {
  days: number;
  activeSubscribers: number;
  sends: number;
  delivered: number;
  opened: number;
  clicked: number;
  openRate: number;
  clickRate: number;
  deliveryRate: number;
  daily: AdStatsDailyPoint[];
  tracked: boolean;
};

// Map a set of resend_ids to per-id sets of event types. Returns events from
// the bounded date range only — caller passes a wide enough range that late
// opens still land.
//
// Implementation: we DO NOT pass the resend_id set through `.in()`. With
// thousands of ids the URL exceeds PostgREST's length limit and the request
// silently 414s. Instead we date-bound the query (cheap, index-friendly via
// email_events_type_event_at_desc) and intersect against the caller's id set
// in JS. The event_type filter keeps the row count down to opens + clicks +
// deliveries — the only types either caller looks at.
async function eventsByResendId(
  resendIds: string[],
  sinceIso: string,
): Promise<Record<string, Set<string>>> {
  if (resendIds.length === 0) return {};
  const db = supabaseAdmin();
  type Ev = { resend_id: string; event_type: string };
  const events = await fetchAll<Ev>(
    () => db.from("email_events")
      .select("resend_id, event_type")
      .gte("event_at", sinceIso)
      .in("event_type", ["email.delivered", "email.opened", "email.clicked", "boxscore.opened"]) as unknown as QueryBuilder<Ev>,
    "eventsByResendId",
  );
  const idSet = new Set(resendIds);
  const byId: Record<string, Set<string>> = {};
  for (const e of events) {
    if (!idSet.has(e.resend_id)) continue;
    (byId[e.resend_id] ??= new Set()).add(e.event_type);
  }
  return byId;
}

export async function getYesterdayAdStats(): Promise<YesterdayAdStats> {
  // Aggregate-backed via daily_send_stats. The "date" label is preserved
  // in ET semantics (matches the digest_date the email shipped under) but
  // the aggregate row is keyed by UTC sent_at::date. For the steady-state
  // 9am ET send the two align; in the rare edge case of a late-evening
  // ET send pushed past midnight UTC the count may straddle.
  const db = supabaseAdmin();
  const date = yesterdayInET();
  const utcDate = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

  const [statsQ, openEverQ] = await Promise.all([
    db.from("daily_send_stats")
      .select("sport, scope, sends, delivered, opens_unique, clicks_unique")
      .eq("date", utcDate),
    db.from("email_events").select("id", { count: "exact", head: true })
      .in("event_type", ["email.opened", "boxscore.opened"]),
  ]);

  let totalSends = 0, totalDelivered = 0, totalOpened = 0, totalClicked = 0;
  const breakdown: AdStatsBucket[] = [];
  for (const r of (statsQ.data ?? []) as Array<{
    sport: string; scope: "league" | "team";
    sends: number; delivered: number; opens_unique: number; clicks_unique: number;
  }>) {
    totalSends     += r.sends;
    totalDelivered += r.delivered;
    totalOpened    += r.opens_unique;
    totalClicked   += r.clicks_unique;
    breakdown.push({
      sport: r.sport, scope: r.scope,
      sends: r.sends, delivered: r.delivered,
      opened: r.opens_unique, clicked: r.clicks_unique,
    });
  }
  breakdown.sort((a, b) => a.sport.localeCompare(b.sport) || a.scope.localeCompare(b.scope));

  return {
    date,
    sends: totalSends,
    delivered: totalDelivered,
    opened: totalOpened,
    clicked: totalClicked,
    openRate: totalDelivered === 0 ? 0 : totalOpened / totalDelivered,
    clickRate: totalDelivered === 0 ? 0 : totalClicked / totalDelivered,
    breakdown,
    tracked: (openEverQ.count ?? 0) > 0,
  };
}

export async function getRollingAdStats(days: number): Promise<RollingAdStats> {
  // Aggregate-backed via daily_send_stats (migration 0062). Was 95s in
  // benchmark (per-request 30-day sends + email_events scan); now indexed.
  // Axis is built in UTC (matching daily_send_stats.date); the chart's
  // x-axis dates may shift by up to one row vs. the old ET-based labels
  // on the calendar boundary — acceptable for an admin-only dashboard.
  const db = supabaseAdmin();
  const now = Date.now();
  const axis: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    axis.push(new Date(now - i * 86400_000).toISOString().slice(0, 10));
  }
  const dailyMap = new Map<string, AdStatsDailyPoint>(
    axis.map((date) => [date, { date, delivered: 0, opened: 0, clicked: 0 }]),
  );

  const startDate = axis[0]!;
  const endDate   = axis[axis.length - 1]!;
  const [statsQ, activeQ, openEverQ] = await Promise.all([
    db.from("daily_send_stats")
      .select("date, sends, failed_send, delivered, opens_unique, clicks_unique")
      .gte("date", startDate).lte("date", endDate),
    db.from("subscribers").select("id", { count: "exact", head: true }).eq("status", "active"),
    db.from("email_events").select("id", { count: "exact", head: true })
      .in("event_type", ["email.opened", "boxscore.opened"]),
  ]);

  let totalSends = 0, totalDelivered = 0, totalOpened = 0, totalClicked = 0;
  for (const r of (statsQ.data ?? []) as Array<{
    date: string; sends: number; failed_send: number;
    delivered: number; opens_unique: number; clicks_unique: number;
  }>) {
    totalSends     += r.sends;
    totalDelivered += r.delivered;
    totalOpened    += r.opens_unique;
    totalClicked   += r.clicks_unique;
    const point = dailyMap.get(r.date);
    if (point) {
      point.delivered += r.delivered;
      point.opened    += r.opens_unique;
      point.clicked   += r.clicks_unique;
    }
  }

  return {
    days,
    activeSubscribers: activeQ.count ?? 0,
    sends: totalSends,
    delivered: totalDelivered,
    opened: totalOpened,
    clicked: totalClicked,
    openRate: totalDelivered === 0 ? 0 : totalOpened / totalDelivered,
    clickRate: totalDelivered === 0 ? 0 : totalClicked / totalDelivered,
    deliveryRate: totalSends === 0 ? 0 : totalDelivered / totalSends,
    daily: axis.map((d) => dailyMap.get(d)!),
    tracked: (openEverQ.count ?? 0) > 0,
  };
}

// Lightweight stats snapshot for the public /advertise page. The
// getRollingAdStats() above is correct but slow — it materializes every send
// in the window and joins them in JS against email_events.
//
// This version splits the work:
//   - Impressions / sends / delivery rate use cheap count queries over the
//     full 30-day window.
//   - Open + click rates use the same dedup-by-resend_id join the admin page
//     uses, but only over the engagement window (sends since May 30, when
//     open tracking turned on). That keeps the materialized event set small
//     enough to finish in a few seconds. Without the dedup, MPP / multi-open
//     pixel fires inflate the rate by ~20%.

const OPEN_TRACKING_START_ISO = "2026-05-30T00:00:00Z";

export type PublicAdStats = {
  /** Sport this snapshot covers (e.g., "mlb"). */
  sport: string;
  /** Subscribers opted into the league digest for this sport. */
  activeSubscribers: number;
  windowDays: number;
  sends: number;
  delivered: number;
  openRate: number;
  clickRate: number;
  deliveryRate: number;
  /** First date opens were tracked. Used so the UI can label the rate honestly. */
  engagementSince: string;
  tracked: boolean;
  /** Total production pageviews over windowDays, from page_views (Vercel
   *  Web Analytics Drain). Excludes preview/development deploys and
   *  custom events; pageviews only. Zero when the Drain isn't configured
   *  yet or no events have arrived in the window. */
  webPageviews: number;
};

/**
 * Public-facing ad stats scoped to ONE product: a single sport's league digest.
 * Filters every count (sends, delivered, engagement) by (digest_sport, team_id
 * IS NULL) so the page selling a sponsor placement in the MLB league digest
 * shows the audience that placement actually reaches — not the pooled total
 * across league + team + other-sport sends.
 *
 * Active-subscriber count is the intersection of email_subscriptions
 * (sport, scope='league', active=true) AND subscribers.status='active' —
 * same rule getActiveSubscribersForSport uses for the send cron. Earlier
 * versions of this function counted email_subscriptions rows directly,
 * which inflated the public number by every subscriber who unsubscribed
 * globally without their per-sport rows being flipped. Sharing the helper
 * keeps /admin and /advertise reporting the same audience size.
 */
export async function getPublicAdStatsSnapshot(
  sport: string,
  days: number,
): Promise<PublicAdStats> {
  const db = supabaseAdmin();
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const engagementSinceIso = sinceIso > OPEN_TRACKING_START_ISO
    ? sinceIso
    : OPEN_TRACKING_START_ISO;

  const [
    activeSubscribers,
    { count: sendsCount },
    { count: deliveredCount },
    { count: bouncedCount },
    engagement,
    { count: openEverCount },
    { count: webPageviewsCount },
  ] = await Promise.all([
    getActiveSubscribersForSport(sport).then((rows) => rows.length),
    db.from("sends").select("id", { count: "exact", head: true })
      .gte("sent_at", sinceIso).eq("digest_sport", sport).is("team_id", null),
    db.from("sends").select("id", { count: "exact", head: true })
      .gte("sent_at", sinceIso).eq("digest_sport", sport).is("team_id", null).is("error", null),
    db.from("email_events").select("id", { count: "exact", head: true })
      .gte("event_at", sinceIso).eq("event_type", "email.bounced"),
    getEngagementRates(engagementSinceIso, sport),
    db.from("email_events").select("id", { count: "exact", head: true }).in("event_type", ["email.opened", "boxscore.opened"]),
    // Web pageviews are not sport-scoped — the production site renders
    // multiple sports' pages from one Vercel project. Counting all
    // production pageviews is the correct "site-wide reach" number for
    // the advertiser-facing stat.
    db.from("page_views").select("id", { count: "exact", head: true })
      .gte("occurred_at", sinceIso)
      .eq("event_type", "pageview")
      .eq("vercel_environment", "production"),
  ]);

  const sends = sendsCount ?? 0;
  // Bounce events table doesn't carry digest_sport, so this approximate
  // delivered count uses all bounces in the window. Cross-sport bleed is
  // small at our scale (NBA/WNBA traffic is admin-only). Good enough for a
  // marketing stat; the exact figure comes from joining resend_ids.
  const delivered = Math.max(0, (deliveredCount ?? 0) - (bouncedCount ?? 0));

  return {
    sport,
    activeSubscribers,
    windowDays: days,
    sends,
    delivered,
    openRate: engagement.delivered === 0 ? 0 : engagement.opened / engagement.delivered,
    clickRate: engagement.delivered === 0 ? 0 : engagement.clicked / engagement.delivered,
    deliveryRate: sends === 0 ? 0 : delivered / sends,
    engagementSince: OPEN_TRACKING_START_ISO.slice(0, 10),
    tracked: (openEverCount ?? 0) > 0,
    webPageviews: webPageviewsCount ?? 0,
  };
}

// Dedup-by-resend_id engagement totals for the league digest of one sport,
// summed over the engagement window. Reads the precomputed daily_metrics
// rows instead of scanning every send + email_event in the window — the
// raw-event scan was breaching Postgres's statement_timeout as the window
// grew and broke the daily ad-stats-snapshot cron.
//
// Each row in daily_metrics already holds distinct-resend_id counts (the
// computeDailyMetric scan handles the intersection). One row per edition
// date; sum across rows for the window total. Cost is O(days), capped at
// the engagement window length — fast for years to come.
//
// Small accuracy caveat: the old code did `opened AND delivered`, which
// excluded the ~0% case where an open event lacks a corresponding delivered
// event (a missed webhook). The new path just sums opened-per-day. In
// practice the divergence is invisible; Resend's webhook order is
// delivered → opened → clicked and missed deliveries on otherwise-opened
// messages are vanishingly rare at our volume.
async function getEngagementRates(
  sinceIso: string,
  sport: string,
): Promise<{ delivered: number; opened: number; clicked: number }> {
  const sinceDate = sinceIso.slice(0, 10); // ISO timestamp → YYYY-MM-DD
  const { data, error } = await supabaseAdmin()
    .from("daily_metrics")
    .select("delivered, opened, clicked")
    .eq("sport", sport)
    .gte("date", sinceDate);
  if (error) throw new Error(`getEngagementRates daily_metrics: ${error.message}`);

  let delivered = 0, opened = 0, clicked = 0;
  for (const r of (data ?? []) as Array<{
    delivered: number | null;
    opened: number | null;
    clicked: number | null;
  }>) {
    delivered += r.delivered ?? 0;
    opened    += r.opened    ?? 0;
    clicked   += r.clicked   ?? 0;
  }
  return { delivered, opened, clicked };
}

// Daily cron writes this; /advertise reads it instead of recomputing the slow
// dedup-by-resend_id stats on every cache revalidation. Falls back to live
// compute when missing or older than STALE_AFTER_MS.
export type PublicAdStatsWithGeneratedAt = PublicAdStats & {
  generatedAt: string; // ISO timestamp of the underlying compute
};

export async function writeAdStatsSnapshot(stats: PublicAdStats): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("ad_stats_snapshot")
    .upsert({
      id: 1,
      generated_at: new Date().toISOString(),
      sport: stats.sport,
      window_days: stats.windowDays,
      active_subscribers: stats.activeSubscribers,
      sends: stats.sends,
      delivered: stats.delivered,
      open_rate: stats.openRate,
      click_rate: stats.clickRate,
      delivery_rate: stats.deliveryRate,
      engagement_since: stats.engagementSince,
      tracked: stats.tracked,
      web_pageviews: stats.webPageviews,
    });
  if (error) throw new Error(`writeAdStatsSnapshot: ${error.message}`);
}

export async function readAdStatsSnapshot(): Promise<PublicAdStatsWithGeneratedAt | null> {
  const { data, error } = await supabaseAdmin()
    .from("ad_stats_snapshot")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    sport: data.sport,
    activeSubscribers: data.active_subscribers,
    windowDays: data.window_days,
    sends: data.sends,
    delivered: data.delivered,
    openRate: Number(data.open_rate),
    clickRate: Number(data.click_rate),
    deliveryRate: Number(data.delivery_rate),
    engagementSince: data.engagement_since,
    tracked: data.tracked,
    webPageviews: data.web_pageviews ?? 0,
    generatedAt: data.generated_at,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Dashboard hero queries — the four blocks on /admin.
//
// Each function is intentionally LEAN so the dashboard can stream blocks
// independently via Suspense. Count queries use head:true so no rows
// materialise; everything inside a function runs in Promise.all parallel.
// ────────────────────────────────────────────────────────────────────────

export type TodaysSendSummary = {
  sport: string;
  sportName: string;
  date: string; // ET digest_date the send was for
  leagueSent: number; // count of league sends written
  teamSent: number;   // count of team sends written
  failed: number;     // sends with error set (league + team)
  lastSentAt: string | null; // most recent sent_at across this sport's rows
  hasSendRoute: boolean;     // does this sport have send-email at all?
  hasTeamSendRoute: boolean; // and team-email?
  // Live "how is today's email doing?" — unique opens out of non-errored
  // sends with a resend_id assigned. Split by scope so the dashboard can
  // mirror the leagueSent/teamSent layout. Reflects the partial day so
  // far; opens trickle for ~3 days but most arrive within hours.
  leagueOpens: number;
  leagueOpenDenominator: number;
  teamOpens: number;
  teamOpenDenominator: number;
};

// Per-sport summary of yesterday's-edition sends. The hero "did it work?" line.
// Fast: a handful of count queries per sport, all parallel.
//
// Opens are live (no aggregate involved) so the dashboard answers "how is
// today's email doing right now?" The one-time scan pulls every open event
// with event_at >= start-of-today-UTC; per-sport open count is the
// intersection of that set with the sport's resend_ids. Bounded payload
// (one day of opens, paginated).
export async function getTodaysSendSummaries(): Promise<TodaysSendSummary[]> {
  const date = yesterdayInET();
  const sports = await getVisibleSports({ includeAdminOnly: true });
  const db = supabaseAdmin();

  // One scan of today's opens — every event_at >= UTC midnight with an
  // opened event_type. Late opens from yesterday's send may also land
  // today; the per-sport intersection below ignores them (their resend_ids
  // aren't in today's send set).
  const todayUtcMidnight = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
  const openedRows = await fetchAll<{ resend_id: string | null }>(
    () => db.from("email_events")
      .select("resend_id")
      .in("event_type", ["email.opened", "boxscore.opened"])
      .gte("event_at", todayUtcMidnight) as unknown as QueryBuilder<{ resend_id: string | null }>,
    "getTodaysSendSummaries opens",
  );
  const openedIds = new Set<string>();
  for (const r of openedRows) if (r.resend_id) openedIds.add(r.resend_id);

  const summaries = await Promise.all(
    sports.map(async (sport): Promise<TodaysSendSummary> => {
      const features = featuresFor(sport.id);
      const hasSendRoute = features.expectedRoutes.includes("send-email");
      const hasTeamSendRoute = features.expectedRoutes.includes("send-team-email");

      // Four parallel count queries, one last-sent timestamp, plus a
      // paginated pull of this sport's resend_ids today to compute live
      // open counts against the shared openedIds set.
      const [leagueSentRes, teamSentRes, failedRes, lastSentRes, sportSends] = await Promise.all([
        hasSendRoute
          ? db.from("sends")
              .select("id", { count: "exact", head: true })
              .eq("digest_sport", sport.id)
              .eq("digest_date", date)
              .is("team_id", null)
              .is("error", null)
          : Promise.resolve({ count: 0, error: null }),
        hasTeamSendRoute
          ? db.from("sends")
              .select("id", { count: "exact", head: true })
              .eq("digest_sport", sport.id)
              .eq("digest_date", date)
              .not("team_id", "is", null)
              .is("error", null)
          : Promise.resolve({ count: 0, error: null }),
        db.from("sends")
          .select("id", { count: "exact", head: true })
          .eq("digest_sport", sport.id)
          .eq("digest_date", date)
          .not("error", "is", null),
        db.from("sends")
          .select("sent_at")
          .eq("digest_sport", sport.id)
          .eq("digest_date", date)
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        fetchAll<{ resend_id: string | null; team_id: string | null }>(
          () => db.from("sends")
            .select("resend_id, team_id")
            .eq("digest_sport", sport.id)
            .eq("digest_date", date)
            .is("error", null) as unknown as QueryBuilder<{ resend_id: string | null; team_id: string | null }>,
          `getTodaysSendSummaries(${sport.id}) sends`,
        ),
      ]);

      let leagueOpens = 0, leagueOpenDenominator = 0;
      let teamOpens = 0,   teamOpenDenominator   = 0;
      for (const s of sportSends) {
        if (!s.resend_id) continue;
        const opened = openedIds.has(s.resend_id);
        if (s.team_id == null) {
          leagueOpenDenominator++;
          if (opened) leagueOpens++;
        } else {
          teamOpenDenominator++;
          if (opened) teamOpens++;
        }
      }

      return {
        sport: sport.id,
        sportName: sport.name,
        date,
        leagueSent: leagueSentRes.count ?? 0,
        teamSent: teamSentRes.count ?? 0,
        failed: failedRes.count ?? 0,
        lastSentAt: (lastSentRes.data as { sent_at: string | null } | null)?.sent_at ?? null,
        hasSendRoute,
        hasTeamSendRoute,
        leagueOpens, leagueOpenDenominator,
        teamOpens,   teamOpenDenominator,
      };
    }),
  );

  return summaries;
}

export type Last24hPulse = {
  newSubs: number;
  newSubsPrior: number;        // for delta
  unsubs: number;
  unsubsPrior: number;         // for delta
  opens: number;
  opensPrior: number;
  bounces: number;
  pendingTotal: number;        // total pending right now
};

// Subscribers in, subscribers out, opens, bounces — last 24h with a delta
// against the prior 24h so the dashboard can show "+12 vs yesterday" style.
// All 8 count queries fire in parallel.
export async function getLast24hPulse(): Promise<Last24hPulse> {
  const db = supabaseAdmin();
  const nowMs = Date.now();
  const last24hIso = new Date(nowMs - 24 * 3600_000).toISOString();
  const prior24hIso = new Date(nowMs - 48 * 3600_000).toISOString();

  const [
    newSubsRes,
    newSubsPriorRes,
    unsubsRes,
    unsubsPriorRes,
    opensRes,
    opensPriorRes,
    bouncesRes,
    pendingRes,
  ] = await Promise.all([
    db.from("subscribers")
      .select("id", { count: "exact", head: true })
      .gte("created_at", last24hIso),
    db.from("subscribers")
      .select("id", { count: "exact", head: true })
      .gte("created_at", prior24hIso)
      .lt("created_at", last24hIso),
    db.from("subscribers")
      .select("id", { count: "exact", head: true })
      .gte("unsubscribed_at", last24hIso),
    db.from("subscribers")
      .select("id", { count: "exact", head: true })
      .gte("unsubscribed_at", prior24hIso)
      .lt("unsubscribed_at", last24hIso),
    db.from("email_events")
      .select("id", { count: "exact", head: true })
      .in("event_type", ["email.opened", "boxscore.opened"])
      .gte("event_at", last24hIso),
    db.from("email_events")
      .select("id", { count: "exact", head: true })
      .in("event_type", ["email.opened", "boxscore.opened"])
      .gte("event_at", prior24hIso)
      .lt("event_at", last24hIso),
    db.from("email_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "email.bounced")
      .gte("event_at", last24hIso),
    db.from("subscribers")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  return {
    newSubs: newSubsRes.count ?? 0,
    newSubsPrior: newSubsPriorRes.count ?? 0,
    unsubs: unsubsRes.count ?? 0,
    unsubsPrior: unsubsPriorRes.count ?? 0,
    opens: opensRes.count ?? 0,
    opensPrior: opensPriorRes.count ?? 0,
    bounces: bouncesRes.count ?? 0,
    pendingTotal: pendingRes.count ?? 0,
  };
}

export type ActionQueueItem = {
  key: string;
  count: number;
  label: string;
  href: string;
};

// Things waiting for admin attention. Returns ALL items, even at count=0,
// so the dashboard can render them with neutral styling rather than hide
// them entirely — the empty state is itself useful ("no campaigns waiting").
const STALE_PENDING_DAYS = 7;

export async function getAdminActionQueue(): Promise<ActionQueueItem[]> {
  const db = supabaseAdmin();
  const stalePendingCutoff = new Date(
    Date.now() - STALE_PENDING_DAYS * 86_400_000,
  ).toISOString();
  const yesterday = yesterdayInET();

  const [pendingCampaignsRes, unpaidApprovedRes, stalePendingSubsRes, failedCronsRes] =
    await Promise.all([
      db.from("ad_campaigns")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      db.from("ad_campaigns")
        .select("id", { count: "exact", head: true })
        .eq("status", "approved")
        .is("paid_at", null),
      db.from("subscribers")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lt("created_at", stalePendingCutoff),
      db.from("cron_runs")
        .select("id", { count: "exact", head: true })
        .eq("date", yesterday)
        .eq("status", "failed"),
    ]);

  return [
    {
      key: "pending-campaigns",
      count: pendingCampaignsRes.count ?? 0,
      label: "Ad campaigns awaiting approval",
      href: "/admin/ads",
    },
    {
      key: "unpaid-approved",
      count: unpaidApprovedRes.count ?? 0,
      label: "Approved campaigns awaiting payment",
      href: "/admin/ads",
    },
    {
      key: "stale-pending-subs",
      count: stalePendingSubsRes.count ?? 0,
      label: `Pending subscribers older than ${STALE_PENDING_DAYS} days`,
      href: "/admin/operations/email-lookup",
    },
    {
      key: "failed-crons",
      count: failedCronsRes.count ?? 0,
      label: "Failed cron runs yesterday",
      href: "/admin/operations/crons",
    },
  ];
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---- Subscriber acquisition sources -------------------------------------
//
// Backed by the migration-0057 columns on subscribers: utm_source/medium/
// campaign/content/term + referrer + landing_path. Captured at /subscribe
// POST via the root-layout sessionStorage script (see app/layout.tsx) and
// only written for genuinely-new rows so first-touch attribution sticks
// across resubscribes.
//
// Windowing is on `created_at` — we want acquisition signal (who showed up)
// not activation signal (who confirmed). A subscriber who signed up via
// Reddit but never clicked the confirm link is still useful attribution
// data; the diligence question is "where are signups coming from?", not
// "where are activations coming from?"
//
// Pre-migration rows have nulls for all attribution columns and `created_at`
// before 2026-06-22. We bucket those into a separate "pre-migration" count
// so they don't pollute the "direct/unknown" bucket of the post-migration
// window.

export type SourceCount = { key: string; count: number };

export type SubscriberSources = {
  windowStartIso: string;
  // Acquisition attempts (subscribers.created_at) in the window. Includes
  // active, pending, and unsubscribed — every signup attempt is acquisition
  // signal, even if it never confirmed.
  total: number;
  // Of `total`, how many had any utm_* field or a referrer recorded.
  withAttribution: number;
  // Of `total`, how many had no utm AND no referrer. Post-migration this
  // means direct traffic; pre-migration it means the capture didn't exist.
  unknownOrDirect: number;
  // Top groupings, sorted desc by count, capped at MAX_KEYS_PER_FACET.
  bySource: SourceCount[];
  byMedium: SourceCount[];
  byCampaign: SourceCount[];
  byReferrerHost: SourceCount[];
  // Full referrer URL — for "go visit the page that linked us." Search
  // engines (Google/Bing) ship only the origin so those rows aren't
  // useful to click, but blog posts / news articles / Reddit threads /
  // HN comments preserve the full URL.
  byReferrerUrl: SourceCount[];
  byLandingPath: SourceCount[];
};

const MAX_KEYS_PER_FACET = 20;
// URL-level facets get more headroom — same hostname can appear under
// many distinct URLs (each Reddit thread, each blog post, etc.), and the
// whole point of the URL table is "give me a list of pages to visit."
const MAX_URLS_PER_FACET = 50;

// Best-effort URL → hostname. Returns the raw string if it doesn't parse
// (we can't trust client-supplied referrer strings to be valid URLs).
function referrerHost(raw: string): string {
  try {
    const u = new URL(raw);
    return u.hostname || raw;
  } catch {
    return raw;
  }
}

function topN(counts: Map<string, number>, n: number): SourceCount[] {
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, n);
}

// ---- Site traffic sources (all visitors, not just signups) -------------
//
// Backed by page_views.raw — Vercel Web Analytics Drain ships `referrer` on
// session-entry pageviews only (verified 2026-06-22 via probe-page-view-fields.ts:
// ~1 in 20 production pageviews had a referrer field set, matching Vercel's
// privacy-first "entry referrer per session" model).
//
// Counting model: we count entry events with a referrer as one "referred
// session." Mid-session pageviews don't double-count. Sessions with no
// referrer (typed URL, bookmark, app-link, referrer-policy: no-referrer
// from the source page) are bucketed as direct/unknown.
//
// Note on session_id: Vercel sometimes ships sessionId=0 as a sentinel for
// missing — we treat each (session_id, device_id) pair as unique. Two
// sentinel rows on the same device collapse to one session count.

export type TrafficSources = {
  windowStartIso: string;
  pageviews: number;           // total production pageviews in window
  sessions: number;            // distinct (session_id, device_id) pairs
  referredSessions: number;    // sessions whose entry event had a referrer
  directOrUnknown: number;     // sessions − referredSessions
  byReferrerHost: SourceCount[];
  // Full URL of the referring page — clickable in the admin so we can
  // actually go read what people are saying about us. Search-engine
  // referrers degenerate to origin only (see top-of-file comment).
  byReferrerUrl: SourceCount[];
  byLandingPath: SourceCount[];
};

export async function getTrafficSources(w: Window): Promise<TrafficSources> {
  const windowStartMs = Date.now() - windowHours(w) * 3600 * 1000;
  const windowStartIso = new Date(windowStartMs).toISOString();

  type Row = {
    path: string | null;
    session_id: number | null;
    device_id: number | null;
    raw: { referrer?: string } | null;
  };
  const rows = await fetchAll<Row>(
    () => supabaseAdmin()
      .from("page_views")
      .select("path, session_id, device_id, raw")
      .eq("event_type", "pageview")
      .eq("vercel_environment", "production")
      .gte("occurred_at", windowStartIso) as unknown as QueryBuilder<Row>,
    "getTrafficSources",
  );

  // De-dupe to sessions. Vercel sends ~1 referrer per session on the entry
  // event, so we group all rows by (session_id, device_id) and pick the
  // first referrer we see for that session. Sessions with no referrer on
  // any of their pageviews count as direct/unknown.
  const sessionRef = new Map<string, string | null>();
  const sessionLanding = new Map<string, string | null>();
  for (const r of rows) {
    const key = `${r.session_id ?? 0}:${r.device_id ?? 0}`;
    const ref = r.raw?.referrer ?? null;
    // First non-null referrer wins; once set, don't overwrite with a later
    // mid-session pageview that lacks one.
    if (ref && !sessionRef.get(key)) {
      sessionRef.set(key, ref);
    } else if (!sessionRef.has(key)) {
      sessionRef.set(key, null);
    }
    if (!sessionLanding.has(key) && r.path) {
      sessionLanding.set(key, r.path);
    }
  }

  const refHostCounts = new Map<string, number>();
  const refUrlCounts = new Map<string, number>();
  const landingCounts = new Map<string, number>();
  let referredSessions = 0;
  for (const [key, ref] of sessionRef) {
    if (ref) {
      referredSessions++;
      refHostCounts.set(referrerHost(ref), (refHostCounts.get(referrerHost(ref)) ?? 0) + 1);
      refUrlCounts.set(ref, (refUrlCounts.get(ref) ?? 0) + 1);
    }
    const landing = sessionLanding.get(key);
    if (landing) {
      landingCounts.set(landing, (landingCounts.get(landing) ?? 0) + 1);
    }
  }

  const sessions = sessionRef.size;
  return {
    windowStartIso,
    pageviews: rows.length,
    sessions,
    referredSessions,
    directOrUnknown: sessions - referredSessions,
    byReferrerHost: topN(refHostCounts, MAX_KEYS_PER_FACET),
    byReferrerUrl:  topN(refUrlCounts,  MAX_URLS_PER_FACET),
    byLandingPath:  topN(landingCounts, MAX_KEYS_PER_FACET),
  };
}

export async function getSubscriberSources(w: Window): Promise<SubscriberSources> {
  const windowStartMs = Date.now() - windowHours(w) * 3600 * 1000;
  const windowStartIso = new Date(windowStartMs).toISOString();

  type Row = {
    created_at: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    referrer: string | null;
    landing_path: string | null;
  };
  const rows = await fetchAll<Row>(
    () => supabaseAdmin()
      .from("subscribers")
      .select("created_at, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer, landing_path")
      .gte("created_at", windowStartIso) as unknown as QueryBuilder<Row>,
    "getSubscriberSources",
  );

  let total = 0;
  let withAttribution = 0;
  const sourceCounts = new Map<string, number>();
  const mediumCounts = new Map<string, number>();
  const campaignCounts = new Map<string, number>();
  const refHostCounts = new Map<string, number>();
  const refUrlCounts = new Map<string, number>();
  const landingCounts = new Map<string, number>();

  const bump = (m: Map<string, number>, k: string) => {
    m.set(k, (m.get(k) ?? 0) + 1);
  };

  for (const r of rows) {
    total++;
    const hasUtm = !!(r.utm_source || r.utm_medium || r.utm_campaign || r.utm_content || r.utm_term);
    const hasRef = !!r.referrer;
    if (hasUtm || hasRef) withAttribution++;

    if (r.utm_source) bump(sourceCounts, r.utm_source);
    if (r.utm_medium) bump(mediumCounts, r.utm_medium);
    if (r.utm_campaign) bump(campaignCounts, r.utm_campaign);
    if (r.referrer) {
      bump(refHostCounts, referrerHost(r.referrer));
      bump(refUrlCounts, r.referrer);
    }
    if (r.landing_path) bump(landingCounts, r.landing_path);
  }

  return {
    windowStartIso,
    total,
    withAttribution,
    unknownOrDirect: total - withAttribution,
    bySource:        topN(sourceCounts,   MAX_KEYS_PER_FACET),
    byMedium:        topN(mediumCounts,   MAX_KEYS_PER_FACET),
    byCampaign:      topN(campaignCounts, MAX_KEYS_PER_FACET),
    byReferrerHost:  topN(refHostCounts,  MAX_KEYS_PER_FACET),
    byReferrerUrl:   topN(refUrlCounts,   MAX_URLS_PER_FACET),
    byLandingPath:   topN(landingCounts,  MAX_KEYS_PER_FACET),
  };
}

// ---- Recent subscribers ------------------------------------------------

export type RecentSubscriberRow = {
  id: string;
  email: string;
  status: "pending" | "active" | "unsubscribed";
  createdAt: string;       // ISO
  confirmedAt: string | null;
  /** Display strings for each active newsletter the subscriber is on —
   *  "MLB" for league opt-ins, "MLB Guardians" for team opt-ins. */
  selections: string[];
};

// Most recent N subscribers (by created_at desc) with their currently-
// active newsletter opt-ins. Powers the audit list at the bottom of
// /admin/metrics/subscribers — useful for spot-checking signups and
// seeing which newsletters new arrivals are picking.
export async function getRecentSubscribers(limit: number = 50): Promise<RecentSubscriberRow[]> {
  const db = supabaseAdmin();
  const { data: subs, error: subErr } = await db
    .from("subscribers")
    .select("id, email, status, created_at, confirmed_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (subErr) throw new Error(`getRecentSubscribers subs: ${subErr.message}`);
  const subRows = (subs ?? []) as Array<{
    id: string;
    email: string;
    status: "pending" | "active" | "unsubscribed";
    created_at: string;
    confirmed_at: string | null;
  }>;
  if (subRows.length === 0) return [];

  const ids = subRows.map((r) => r.id);
  const { data: optins, error: optErr } = await db
    .from("email_subscriptions")
    .select("subscriber_id, sport, scope, team_id")
    .in("subscriber_id", ids)
    .eq("active", true);
  if (optErr) throw new Error(`getRecentSubscribers optins: ${optErr.message}`);

  const bySubscriber = new Map<string, string[]>();
  for (const row of (optins ?? []) as Array<{
    subscriber_id: string;
    sport: string;
    scope: "league" | "team";
    team_id: string | null;
  }>) {
    const label = row.scope === "team" && row.team_id
      ? `${row.sport.toUpperCase()} ${findTeam(row.sport as Sport, row.team_id)?.nickname ?? row.team_id}`
      : row.sport.toUpperCase();
    const list = bySubscriber.get(row.subscriber_id) ?? [];
    list.push(label);
    bySubscriber.set(row.subscriber_id, list);
  }

  return subRows.map((r) => ({
    id:          r.id,
    email:       r.email,
    status:      r.status,
    createdAt:   r.created_at,
    confirmedAt: r.confirmed_at,
    selections:  (bySubscriber.get(r.id) ?? []).sort(),
  }));
}
