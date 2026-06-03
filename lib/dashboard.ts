import { supabaseAdmin } from "./supabase";
import { yesterdayInET } from "./dates";
import { getVisibleSports } from "./sports";
import { featuresFor, type CronRoute as SportCronRoute } from "./sport-features";
import { getActiveSubscriberIdSet, getActiveSubscriberIdSetAt } from "./subscribers";

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

  // All-time successful digest sends. Count-only to dodge the 1000-row cap.
  const { count: totalDigestsCount } = await db
    .from("sends")
    .select("id", { count: "exact", head: true })
    .is("error", null);

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
    totalDigestsShipped: totalDigestsCount ?? 0,
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

export type AdStatsDailyPoint = { date: string; opened: number; clicked: number };

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
      .in("event_type", ["email.delivered", "email.opened", "email.clicked"]) as unknown as QueryBuilder<Ev>,
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
  const db = supabaseAdmin();
  const date = yesterdayInET();

  type SendRow = {
    resend_id: string | null;
    error: string | null;
    digest_sport: string;
    team_id: string | null;
  };
  const sends = await fetchAll<SendRow>(
    () => db.from("sends")
      .select("resend_id, error, digest_sport, team_id")
      .eq("digest_date", date) as unknown as QueryBuilder<SendRow>,
    "getYesterdayAdStats sends",
  );

  const liveIds = sends.filter((s) => !s.error && s.resend_id).map((s) => s.resend_id!);
  // Window the events query to the last 7 days — late opens (MPP prefetch
  // staggered, recipients who let mail sit) land well within that.
  const sinceIso = new Date(Date.now() - 7 * 86400_000).toISOString();
  const byId = await eventsByResendId(liveIds, sinceIso);

  // Aggregate per (sport, scope). Map key is `${sport}::${scope}`.
  const buckets = new Map<string, AdStatsBucket>();
  let totalDelivered = 0, totalOpened = 0, totalClicked = 0;
  for (const s of sends) {
    const scope: "league" | "team" = s.team_id ? "team" : "league";
    const key = `${s.digest_sport}::${scope}`;
    const b = buckets.get(key) ?? {
      sport: s.digest_sport, scope, sends: 0, delivered: 0, opened: 0, clicked: 0,
    };
    b.sends++;
    const evts = s.resend_id ? byId[s.resend_id] : undefined;
    if (evts?.has("email.delivered")) { b.delivered++; totalDelivered++; }
    if (evts?.has("email.opened")) { b.opened++; totalOpened++; }
    if (evts?.has("email.clicked")) { b.clicked++; totalClicked++; }
    buckets.set(key, b);
  }

  // Has open tracking ever fired at all? One global probe — if zero, we
  // render "—" instead of "0%".
  const { count: openEverCount } = await db
    .from("email_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "email.opened");

  const breakdown = [...buckets.values()].sort((a, b) => {
    if (a.sport !== b.sport) return a.sport.localeCompare(b.sport);
    return a.scope.localeCompare(b.scope);
  });

  return {
    date,
    sends: sends.length,
    delivered: totalDelivered,
    opened: totalOpened,
    clicked: totalClicked,
    openRate: totalDelivered === 0 ? 0 : totalOpened / totalDelivered,
    clickRate: totalDelivered === 0 ? 0 : totalClicked / totalDelivered,
    breakdown,
    tracked: (openEverCount ?? 0) > 0,
  };
}

export async function getRollingAdStats(days: number): Promise<RollingAdStats> {
  const db = supabaseAdmin();
  const now = new Date();
  const windowStartMs = now.getTime() - days * 86400_000;
  const sinceIso = new Date(windowStartMs).toISOString();

  // Build the chronological date axis up front so days with zero activity
  // still appear in the chart (visible gaps matter).
  const axis: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400_000);
    // ET-based date label to match digest_date semantics elsewhere.
    axis.push(new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d));
  }
  const dailyMap = new Map<string, AdStatsDailyPoint>(
    axis.map((date) => [date, { date, opened: 0, clicked: 0 }]),
  );

  type SendRow = {
    resend_id: string | null;
    error: string | null;
    digest_date: string;
  };
  const sends = await fetchAll<SendRow>(
    () => db.from("sends")
      .select("resend_id, error, digest_date")
      .gte("sent_at", sinceIso) as unknown as QueryBuilder<SendRow>,
    "getRollingAdStats sends",
  );

  const dateByResendId = new Map<string, string>();
  const liveIds: string[] = [];
  let totalSends = 0;
  for (const s of sends) {
    totalSends++;
    if (s.error || !s.resend_id) continue;
    liveIds.push(s.resend_id);
    dateByResendId.set(s.resend_id, s.digest_date);
  }

  const byId = await eventsByResendId(liveIds, sinceIso);
  let totalDelivered = 0, totalOpened = 0, totalClicked = 0;
  for (const id of liveIds) {
    const evts = byId[id];
    if (!evts) continue;
    if (evts.has("email.delivered")) totalDelivered++;
    const day = dateByResendId.get(id);
    if (!day) continue;
    const point = dailyMap.get(day);
    if (!point) continue; // event outside the axis window
    if (evts.has("email.opened")) { point.opened++; totalOpened++; }
    if (evts.has("email.clicked")) { point.clicked++; totalClicked++; }
  }

  const { count: activeSubscribers } = await db
    .from("subscribers")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  const { count: openEverCount } = await db
    .from("email_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "email.opened");

  return {
    days,
    activeSubscribers: activeSubscribers ?? 0,
    sends: totalSends,
    delivered: totalDelivered,
    opened: totalOpened,
    clicked: totalClicked,
    openRate: totalDelivered === 0 ? 0 : totalOpened / totalDelivered,
    clickRate: totalDelivered === 0 ? 0 : totalClicked / totalDelivered,
    deliveryRate: totalSends === 0 ? 0 : totalDelivered / totalSends,
    daily: axis.map((d) => dailyMap.get(d)!),
    tracked: (openEverCount ?? 0) > 0,
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
};

/**
 * Public-facing ad stats scoped to ONE product: a single sport's league digest.
 * Filters every count (sends, delivered, engagement) by (digest_sport, team_id
 * IS NULL) so the page selling a sponsor placement in the MLB league digest
 * shows the audience that placement actually reaches — not the pooled total
 * across league + team + other-sport sends.
 *
 * Active-subscriber count comes from the email_subscriptions opt-in table for
 * (sport, scope='league', active=true). Slight over-count vs. the
 * subscribers.status='active' intersection, but accurate enough for the
 * "people signed up to receive this digest" stat.
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
    { count: activeSubscribers },
    { count: sendsCount },
    { count: deliveredCount },
    { count: bouncedCount },
    engagement,
    { count: openEverCount },
  ] = await Promise.all([
    db.from("email_subscriptions").select("id", { count: "exact", head: true })
      .eq("sport", sport).eq("scope", "league").eq("active", true),
    db.from("sends").select("id", { count: "exact", head: true })
      .gte("sent_at", sinceIso).eq("digest_sport", sport).is("team_id", null),
    db.from("sends").select("id", { count: "exact", head: true })
      .gte("sent_at", sinceIso).eq("digest_sport", sport).is("team_id", null).is("error", null),
    db.from("email_events").select("id", { count: "exact", head: true })
      .gte("event_at", sinceIso).eq("event_type", "email.bounced"),
    getEngagementRates(engagementSinceIso, sport),
    db.from("email_events").select("id", { count: "exact", head: true }).eq("event_type", "email.opened"),
  ]);

  const sends = sendsCount ?? 0;
  // Bounce events table doesn't carry digest_sport, so this approximate
  // delivered count uses all bounces in the window. Cross-sport bleed is
  // small at our scale (NBA/WNBA traffic is admin-only). Good enough for a
  // marketing stat; the exact figure comes from joining resend_ids.
  const delivered = Math.max(0, (deliveredCount ?? 0) - (bouncedCount ?? 0));

  return {
    sport,
    activeSubscribers: activeSubscribers ?? 0,
    windowDays: days,
    sends,
    delivered,
    openRate: engagement.delivered === 0 ? 0 : engagement.opened / engagement.delivered,
    clickRate: engagement.delivered === 0 ? 0 : engagement.clicked / engagement.delivered,
    deliveryRate: sends === 0 ? 0 : delivered / sends,
    engagementSince: OPEN_TRACKING_START_ISO.slice(0, 10),
    tracked: (openEverCount ?? 0) > 0,
  };
}

// Dedup-by-resend_id engagement rates, scoped to one sport's league digest.
// Same algorithm as getRollingAdStats (count of distinct sends that received
// each event type) so the public page's open/click rates match what
// /admin/ads reports — within their shared time window. Materializes the
// engagement-window events AND the in-window league sends so we can
// intersect resend_ids and exclude team/cross-sport activity.
async function getEngagementRates(
  sinceIso: string,
  sport: string,
): Promise<{ delivered: number; opened: number; clicked: number }> {
  const db = supabaseAdmin();

  // Pull the set of resend_ids representing in-window league sends for this
  // sport. The engagement window is short (since OPEN_TRACKING_START_ISO),
  // so this is bounded — a few thousand rows.
  type SendRow = { resend_id: string | null };
  const sendRows = await fetchAll<SendRow>(
    () => db.from("sends")
      .select("resend_id")
      .gte("sent_at", sinceIso)
      .eq("digest_sport", sport)
      .is("team_id", null)
      .is("error", null) as unknown as QueryBuilder<SendRow>,
    "getEngagementRates sends",
  );
  const inScope = new Set<string>();
  for (const r of sendRows) if (r.resend_id) inScope.add(r.resend_id);
  if (inScope.size === 0) return { delivered: 0, opened: 0, clicked: 0 };

  type Ev = { resend_id: string | null; event_type: string };
  const events = await fetchAll<Ev>(
    () => db.from("email_events")
      .select("resend_id, event_type")
      .gte("event_at", sinceIso)
      .in("event_type", ["email.delivered", "email.opened", "email.clicked"]) as unknown as QueryBuilder<Ev>,
    "getEngagementRates events",
  );

  const delivered = new Set<string>();
  const opened = new Set<string>();
  const clicked = new Set<string>();
  for (const e of events) {
    if (!e.resend_id || !inScope.has(e.resend_id)) continue;
    if (e.event_type === "email.delivered") delivered.add(e.resend_id);
    else if (e.event_type === "email.opened") opened.add(e.resend_id);
    else if (e.event_type === "email.clicked") clicked.add(e.resend_id);
  }

  let openedAndDelivered = 0;
  let clickedAndDelivered = 0;
  for (const id of delivered) {
    if (opened.has(id)) openedAndDelivered++;
    if (clicked.has(id)) clickedAndDelivered++;
  }

  return {
    delivered: delivered.size,
    opened: openedAndDelivered,
    clicked: clickedAndDelivered,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
