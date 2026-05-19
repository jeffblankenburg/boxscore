import { supabaseAdmin } from "./supabase";
import { yesterdayInET } from "./dates";
import { getVisibleSports } from "./sports";
import { featuresFor, type CronRoute as SportCronRoute } from "./sport-features";

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
};

export async function getKpis(w: Window): Promise<DashboardKpis> {
  const db = supabaseAdmin();
  const now = new Date();
  const windowStartMs = now.getTime() - windowHours(w) * 3600 * 1000;
  const windowStartIso = new Date(windowStartMs).toISOString();
  const windowStartDate = windowStartIso.slice(0, 10); // for digest_date comparisons (date column)

  // Active subscribers (current)
  const { count: activeNow } = await db
    .from("subscribers")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  // Active at window start: confirmed before then AND (not unsubscribed yet, or unsubscribed after).
  // Computed in JS from confirmed_at/unsubscribed_at to avoid Postgres OR-with-null gymnastics.
  type SubRow = {
    status: string;
    created_at: string | null;
    confirmed_at: string | null;
    unsubscribed_at: string | null;
  };
  const subRows = await fetchAll<SubRow>(
    () => db.from("subscribers").select("status, created_at, confirmed_at, unsubscribed_at") as unknown as QueryBuilder<SubRow>,
    "getKpis subscribers",
  );
  let activeAtStart = 0;
  let newSubs = 0;
  let unsubs = 0;
  let pendingNow = 0;
  let pendingAtStart = 0;
  for (const r of subRows) {
    const cMs = r.confirmed_at ? new Date(r.confirmed_at).getTime() : null;
    const uMs = r.unsubscribed_at ? new Date(r.unsubscribed_at).getTime() : null;
    const createdMs = r.created_at ? new Date(r.created_at).getTime() : null;

    // Active at window start: confirmed before windowStart and not yet unsubscribed at windowStart.
    if (cMs !== null && cMs <= windowStartMs && (uMs === null || uMs > windowStartMs)) {
      activeAtStart++;
    }
    // Net-growth counters: confirmations / unsubscribes that landed inside the window.
    if (cMs !== null && cMs > windowStartMs) newSubs++;
    if (uMs !== null && uMs > windowStartMs) unsubs++;

    // Pending now: current status is pending.
    if (r.status === "pending") pendingNow++;
    // Pending at window start: created before windowStart, not yet confirmed and not unsubscribed by then.
    if (
      createdMs !== null && createdMs <= windowStartMs
      && (cMs === null || cMs > windowStartMs)
      && (uMs === null || uMs > windowStartMs)
    ) {
      pendingAtStart++;
    }
  }

  // Sends within window: count-only queries so we don't hit the 1000-row cap.
  // Filter on sent_at (timestamptz) so sub-day windows work.
  const { count: totalSendsCount } = await db
    .from("sends")
    .select("id", { count: "exact", head: true })
    .gte("sent_at", windowStartIso);
  const { count: failedSendsCount } = await db
    .from("sends")
    .select("id", { count: "exact", head: true })
    .gte("sent_at", windowStartIso)
    .not("error", "is", null);
  const totalSends = totalSendsCount ?? 0;
  const failedSends = failedSendsCount ?? 0;
  const okSends = totalSends - failedSends;

  // Open rate: intersect successful sends in window with opens that arrived
  // for those sends. Opens can land days after a send, so we intentionally
  // don't filter the opens by window — we filter by the send window and
  // accept any open of those sends.
  const sendsWithIds = await fetchAll<{ resend_id: string | null }>(
    () => db.from("sends")
      .select("resend_id")
      .gte("sent_at", windowStartIso)
      .is("error", null) as unknown as QueryBuilder<{ resend_id: string | null }>,
    "getKpis sends-with-ids",
  );
  const sendIds = new Set<string>();
  for (const r of sendsWithIds) if (r.resend_id) sendIds.add(r.resend_id);

  let openedInWindow = 0;
  let openTracked = false;
  if (sendIds.size > 0) {
    // Pull opens for any of the in-window resend_ids. We bound by event_at
    // back to windowStart for performance — opens of in-window sends can't
    // physically precede the send itself.
    const opens = await fetchAll<{ resend_id: string }>(
      () => db.from("email_events")
        .select("resend_id")
        .eq("event_type", "email.opened")
        .gte("event_at", windowStartIso) as unknown as QueryBuilder<{ resend_id: string }>,
      "getKpis email_events",
    );
    const openedIds = new Set<string>();
    for (const r of opens) if (r.resend_id) openedIds.add(r.resend_id);
    openTracked = openedIds.size > 0;
    for (const id of sendIds) if (openedIds.has(id)) openedInWindow++;
  } else {
    // No sends in window. Check once whether opens have *ever* been recorded
    // so we can distinguish "not tracked yet" from "tracked but no sends".
    const { count } = await db
      .from("email_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "email.opened")
      .limit(1);
    openTracked = (count ?? 0) > 0;
  }
  const openRate = sendIds.size === 0 ? 0 : openedInWindow / sendIds.size;

  void windowStartDate;

  return {
    activeSubscribers: activeNow ?? 0,
    activeSubscribersDelta: (activeNow ?? 0) - activeAtStart,
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
      sends: sendIds.size,
      tracked: openTracked,
    },
  };
}

// ---- Subscriber growth series ------------------------------------------

export type SubscriberSeries = {
  buckets: Date[];
  active: number[];   // cumulative active count at end of each bucket
  newSubs: number[];  // confirmed_at landing in each bucket
  unsubs: number[];   // unsubscribed_at landing in each bucket
};

export async function getSubscriberSeries(w: Window): Promise<SubscriberSeries> {
  const buckets = buildBuckets(w);
  const sizeMs = bucketHours(w) * 3600 * 1000;
  const count = buckets.length;
  const newSubs = new Array<number>(count).fill(0);
  const unsubs = new Array<number>(count).fill(0);
  const active = new Array<number>(count).fill(0);

  const rows = await fetchAll<{ confirmed_at: string | null; unsubscribed_at: string | null }>(
    () => supabaseAdmin()
      .from("subscribers")
      .select("confirmed_at, unsubscribed_at") as unknown as QueryBuilder<{ confirmed_at: string | null; unsubscribed_at: string | null }>,
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
      if (idx >= 0) unsubs[idx]!++;
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

  return { buckets, active, newSubs, unsubs };
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
  const db = supabaseAdmin();
  const windowStartIso = new Date(Date.now() - windowHours(w) * 3600 * 1000).toISOString();

  // Every send in the window, including failed ones. resend_id is null when
  // Resend rejected before assigning an id; we count those as "failed" via
  // the error column.
  type SendRow = { resend_id: string | null; error: string | null };
  const sends = await fetchAll<SendRow>(
    () => db.from("sends")
      .select("resend_id, error")
      .gte("sent_at", windowStartIso) as unknown as QueryBuilder<SendRow>,
    "getDeliverabilityStats sends",
  );

  const totalSent = sends.length;
  if (totalSent === 0) {
    return {
      sent: 0, delivered: 0, bounced: 0, delayed: 0, complained: 0, pending: 0, failed: 0,
      deliveredRate: 0, bouncedRate: 0, delayedRate: 0, complainedRate: 0, failedRate: 0,
    };
  }

  let failed = 0;
  const liveResendIds = new Set<string>();
  for (const s of sends) {
    if (s.error) {
      failed++;
      continue;
    }
    if (s.resend_id) liveResendIds.add(s.resend_id);
  }

  // Pull terminal events for live ids. Bound by window so we don't drag in
  // years of history; opens-only events aren't part of this classification.
  type Event = { resend_id: string; event_type: string };
  const RELEVANT_TYPES = [
    "email.delivered",
    "email.bounced",
    "email.delivery_delayed",
    "email.complained",
  ];
  let events: Event[] = [];
  if (liveResendIds.size > 0) {
    events = await fetchAll<Event>(
      () => db.from("email_events")
        .select("resend_id, event_type")
        .gte("event_at", windowStartIso)
        .in("event_type", RELEVANT_TYPES) as unknown as QueryBuilder<Event>,
      "getDeliverabilityStats events",
    );
  }

  const byId: Record<string, Set<string>> = {};
  for (const ev of events) {
    if (!liveResendIds.has(ev.resend_id)) continue;
    (byId[ev.resend_id] ??= new Set()).add(ev.event_type);
  }

  let delivered = 0, bounced = 0, delayed = 0, pending = 0, complained = 0;
  for (const id of liveResendIds) {
    const evts = byId[id] ?? new Set<string>();
    if (evts.has("email.delivered")) delivered++;
    else if (evts.has("email.bounced")) bounced++;
    else if (evts.has("email.delivery_delayed")) delayed++;
    else pending++;
    if (evts.has("email.complained")) complained++;
  }

  return {
    sent: totalSent,
    delivered, bounced, delayed, pending, complained, failed,
    deliveredRate: delivered / totalSent,
    bouncedRate: bounced / totalSent,
    delayedRate: delayed / totalSent,
    complainedRate: complained / totalSent,
    failedRate: failed / totalSent,
  };
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

  const latest: Record<string, Record<string, Row>> = {};
  for (const r of (data ?? []) as Row[]) {
    (latest[r.sport] ??= {})[r.route] = r;
  }

  return sports.map((sport) => {
    const features = featuresFor(sport.id);
    const cells: WatchwallCell[] = features.expectedRoutes.map((route) => {
      const r = latest[sport.id]?.[route];
      return {
        route,
        status: !r ? "missing"
          : r.status === "ok" ? "pass"
          : r.status === "failed" ? "fail"
          : "running",
        startedAt: r?.started_at ?? null,
        error: r?.error ?? null,
        runId: r?.id ?? null,
      };
    });
    return { sport: sport.id, sportName: sport.name, date, cells };
  });
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
