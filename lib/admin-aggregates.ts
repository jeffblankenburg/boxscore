import { supabaseAdmin } from "./supabase";
import { loadImpressionsByPair } from "./ad-impressions";

// Precomputed per-day aggregates that back the slow /admin pages. Tables
// (migration 0062): daily_send_stats, daily_subscriber_events,
// daily_placement_imps. Every function here is idempotent — re-running for
// the same date overwrites the row, so backfills and reruns are safe.
//
// Date semantics:
//   - daily_send_stats.date = sends.sent_at::date (UTC). Matches the
//     existing send-pipeline grain so cohort math doesn't need to flip dates.
//   - daily_subscriber_events.date = UTC calendar date. Snapshot fields
//     (active_at_end / pending_at_end) reflect end-of-day state.
//   - daily_placement_imps is keyed by placement_id (date lives on
//     ad_placements). Recomputed for the trailing window every cron run
//     so late opens within the MPP staggered tail land in the right row.

// ─── shared helpers ────────────────────────────────────────────────────────

const PAGE_SIZE = 1000;
// PostgREST's URL cap is ~8KB. resend_id chunks of 100 keep us comfortably
// under that (~40 chars × 100 ≈ 4KB), and the (resend_id, event_type) index
// handles each chunk in single-digit ms.
const RESEND_ID_CHUNK = 100;

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

// ─── daily_send_stats ──────────────────────────────────────────────────────

export type SendStatsRow = {
  date: string;
  sport: string;
  scope: "league" | "team";
  sends: number;
  failed_send: number;
  delivered: number;
  bounced: number;
  delayed: number;
  pending: number;
  complained: number;
  opens_unique: number;
  clicks_unique: number;
};

type RawSend = {
  digest_sport: string;
  team_id: string | null;
  resend_id: string | null;
  error: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayBounds(date: string): { start: string; end: string } {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end   = new Date(start.getTime() + DAY_MS);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Pull every email_events row for a set of resend_ids, batching the IN-list
// to keep PostgREST URLs under the cap. Returns map of resend_id → set of
// event_type seen.
async function eventsByResendIds(
  ids: string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (ids.length === 0) return out;
  const db = supabaseAdmin();
  for (let i = 0; i < ids.length; i += RESEND_ID_CHUNK) {
    const chunk = ids.slice(i, i + RESEND_ID_CHUNK);
    const { data, error } = await db
      .from("email_events")
      .select("resend_id, event_type")
      .in("resend_id", chunk);
    if (error) throw new Error(`eventsByResendIds: ${error.message}`);
    for (const ev of (data ?? []) as Array<{ resend_id: string | null; event_type: string }>) {
      if (!ev.resend_id) continue;
      (out.get(ev.resend_id) ?? out.set(ev.resend_id, new Set()).get(ev.resend_id)!)
        .add(ev.event_type);
    }
  }
  return out;
}

export async function computeDailySendStats(date: string): Promise<SendStatsRow[]> {
  const { start, end } = utcDayBounds(date);

  // 1. Every send whose sent_at fell on this UTC day.
  const sends = await fetchAll<RawSend>(
    () => supabaseAdmin().from("sends")
      .select("digest_sport, team_id, resend_id, error")
      .gte("sent_at", start)
      .lt("sent_at", end)
      .order("id", { ascending: true }) as unknown as QueryBuilder<RawSend>,
    `computeDailySendStats(${date}) sends`,
  );

  // 2. Bucket by (sport, scope). Track failed_send (sends.error not null)
  //    and the set of live resend_ids per bucket — events are looked up
  //    against this exact id set so deduping is automatic.
  type Bucket = {
    sends: number;
    failed_send: number;
    liveIds: Set<string>;
  };
  const buckets = new Map<string, Bucket>();
  const bucketKey = (sport: string, scope: "league" | "team") => `${sport}|${scope}`;
  const allLiveIds = new Set<string>();
  for (const s of sends) {
    const scope: "league" | "team" = s.team_id == null ? "league" : "team";
    const k = bucketKey(s.digest_sport, scope);
    let b = buckets.get(k);
    if (!b) { b = { sends: 0, failed_send: 0, liveIds: new Set() }; buckets.set(k, b); }
    b.sends++;
    if (s.error) {
      b.failed_send++;
    } else if (s.resend_id) {
      b.liveIds.add(s.resend_id);
      allLiveIds.add(s.resend_id);
    }
  }

  // 3. Look up every relevant event_type for the union of live ids. ONE
  //    pass for the whole day, then we partition by bucket in JS.
  const eventMap = await eventsByResendIds(Array.from(allLiveIds));

  // 4. Classify per bucket. Mutually exclusive priority for the terminal
  //    deliverability slot (matches getDeliverabilityStats); complained
  //    overlaps with delivered (Resend's complained event can fire after
  //    delivery). Engagement events deduped by the set.
  const rows: SendStatsRow[] = [];
  for (const [key, b] of buckets) {
    const [sport, scope] = key.split("|") as [string, "league" | "team"];
    let delivered = 0, bounced = 0, delayed = 0, pending = 0, complained = 0;
    let opens = 0, clicks = 0;
    for (const id of b.liveIds) {
      const evts = eventMap.get(id) ?? new Set<string>();
      if (evts.has("email.delivered")) delivered++;
      else if (evts.has("email.bounced")) bounced++;
      else if (evts.has("email.delivery_delayed")) delayed++;
      else pending++;
      if (evts.has("email.complained")) complained++;
      if (evts.has("email.opened") || evts.has("boxscore.opened")) opens++;
      if (evts.has("email.clicked")) clicks++;
    }
    rows.push({
      date, sport, scope,
      sends: b.sends,
      failed_send: b.failed_send,
      delivered, bounced, delayed, pending, complained,
      opens_unique: opens,
      clicks_unique: clicks,
    });
  }
  return rows;
}

export async function writeDailySendStats(rows: SendStatsRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin()
    .from("daily_send_stats")
    .upsert(
      rows.map((r) => ({ ...r, computed_at: new Date().toISOString() })),
      { onConflict: "date,sport,scope" },
    );
  if (error) throw new Error(`writeDailySendStats: ${error.message}`);
}

// ─── daily_subscriber_events ──────────────────────────────────────────────

export type SubscriberEventsRow = {
  date: string;
  new_subs: number;
  unsubs: number;
  pending_new: number;
  pending_resolved: number;
  active_at_end: number;
  pending_at_end: number;
};

type RawSub = {
  status: string;
  created_at: string | null;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
};

// Compute one row per requested date from a cached subscriber snapshot.
// Pass `subs` once when computing many dates (backfill) to avoid re-paging
// the entire subscribers table for each day.
export async function computeDailySubscriberEvents(
  date: string,
  subs?: RawSub[],
): Promise<SubscriberEventsRow> {
  const rows = subs ?? await fetchAll<RawSub>(
    () => supabaseAdmin().from("subscribers")
      .select("status, created_at, confirmed_at, unsubscribed_at") as unknown as QueryBuilder<RawSub>,
    `computeDailySubscriberEvents(${date}) subscribers`,
  );

  const dayStartMs = new Date(`${date}T00:00:00.000Z`).getTime();
  const dayEndMs   = dayStartMs + DAY_MS;

  let new_subs = 0, unsubs = 0, pending_new = 0, pending_resolved = 0;
  let active_at_end = 0, pending_at_end = 0;

  for (const r of rows) {
    const cMs = r.confirmed_at    ? new Date(r.confirmed_at).getTime()    : null;
    const uMs = r.unsubscribed_at ? new Date(r.unsubscribed_at).getTime() : null;
    const xMs = r.created_at      ? new Date(r.created_at).getTime()      : null;

    if (cMs !== null && cMs >= dayStartMs && cMs < dayEndMs) {
      new_subs++;
      // pending → confirmed transition on this day: created earlier, confirmed now.
      if (xMs !== null && xMs < dayStartMs) pending_resolved++;
    }
    if (uMs !== null && uMs >= dayStartMs && uMs < dayEndMs) unsubs++;
    if (xMs !== null && xMs >= dayStartMs && xMs < dayEndMs) pending_new++;

    // End-of-day snapshot: confirmed by end-of-day AND (not unsub yet, or unsub after end-of-day).
    if (cMs !== null && cMs < dayEndMs && (uMs === null || uMs >= dayEndMs)) active_at_end++;
    // Pending at end-of-day: created by end-of-day, NOT confirmed yet, NOT unsubscribed yet.
    if (xMs !== null && xMs < dayEndMs
        && (cMs === null || cMs >= dayEndMs)
        && (uMs === null || uMs >= dayEndMs)) {
      pending_at_end++;
    }
  }

  return { date, new_subs, unsubs, pending_new, pending_resolved, active_at_end, pending_at_end };
}

export async function writeDailySubscriberEvents(rows: SubscriberEventsRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin()
    .from("daily_subscriber_events")
    .upsert(
      rows.map((r) => ({ ...r, computed_at: new Date().toISOString() })),
      { onConflict: "date" },
    );
  if (error) throw new Error(`writeDailySubscriberEvents: ${error.message}`);
}

// Fetch the snapshot once. Returned rows feed computeDailySubscriberEvents
// for as many dates as you like without re-querying.
export async function loadSubscriberSnapshot(): Promise<RawSub[]> {
  return fetchAll<RawSub>(
    () => supabaseAdmin().from("subscribers")
      .select("status, created_at, confirmed_at, unsubscribed_at") as unknown as QueryBuilder<RawSub>,
    "loadSubscriberSnapshot",
  );
}

// ─── daily_placement_imps ─────────────────────────────────────────────────

export type PlacementImpressionsRow = {
  placement_id: string;
  email_unique_opens: number;
  web_pageviews: number;
  human_clicks: number;
  bot_clicks: number;
};

type RawPlacement = { id: string; sport: string; date: string };

// Recompute impressions for the last N days of placements. Late opens
// trickle in for ~3 days; default 14d is generous. Older placements stay
// stable (the cron skips them).
export async function computePlacementImpressions(
  sinceDate: string,
): Promise<PlacementImpressionsRow[]> {
  const db = supabaseAdmin();

  const { data: placements, error: pErr } = await db
    .from("ad_placements")
    .select("id, sport, date")
    .gte("date", sinceDate);
  if (pErr) throw new Error(`computePlacementImpressions placements: ${pErr.message}`);
  const list = (placements ?? []) as RawPlacement[];
  if (list.length === 0) return [];

  // Per-(sport, date) impressions — shared across all placements on the same
  // digest day. loadImpressionsByPair already does the heavy sends + opens +
  // pageviews scan in one pass.
  const pairs = list.map((p) => ({ sport: p.sport, date: p.date }));
  const impressions = await loadImpressionsByPair(pairs);

  // Per-placement click counts, batched. Bots and humans are split so the
  // advertiser-facing CTR can be honest about bot traffic in admin tooling.
  const humanByPlacement = new Map<string, number>();
  const botByPlacement   = new Map<string, number>();
  const ids = list.map((p) => p.id);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await db
      .from("link_clicks")
      .select("placement_id, is_bot")
      .in("placement_id", chunk);
    if (error) throw new Error(`computePlacementImpressions clicks: ${error.message}`);
    for (const r of (data ?? []) as Array<{ placement_id: string; is_bot: boolean }>) {
      const m = r.is_bot ? botByPlacement : humanByPlacement;
      m.set(r.placement_id, (m.get(r.placement_id) ?? 0) + 1);
    }
  }

  return list.map((p) => {
    const imp = impressions.get(`${p.sport}|${p.date}`);
    return {
      placement_id: p.id,
      email_unique_opens: imp?.email ?? 0,
      web_pageviews:      imp?.web   ?? 0,
      human_clicks:       humanByPlacement.get(p.id) ?? 0,
      bot_clicks:         botByPlacement.get(p.id)   ?? 0,
    };
  });
}

// Read-side: pull precomputed impressions for a set of placement ids.
// Returns a Map so callers can iterate placement-first without per-id
// round trips. Missing ids return undefined — caller decides whether to
// treat that as zero (just-created placement) or surface the gap.
export async function loadPlacementImpressionsByIds(
  ids: string[],
): Promise<Map<string, PlacementImpressionsRow>> {
  const out = new Map<string, PlacementImpressionsRow>();
  if (ids.length === 0) return out;
  const db = supabaseAdmin();
  // Chunked IN-list to stay under PostgREST's ~8KB URL cap. UUIDs are 36
  // chars; 200 per chunk ≈ 7KB safely.
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await db
      .from("daily_placement_imps")
      .select("placement_id, email_unique_opens, web_pageviews, human_clicks, bot_clicks")
      .in("placement_id", chunk);
    if (error) throw new Error(`loadPlacementImpressionsByIds: ${error.message}`);
    for (const r of (data ?? []) as PlacementImpressionsRow[]) {
      out.set(r.placement_id, r);
    }
  }
  return out;
}

export async function writePlacementImpressions(rows: PlacementImpressionsRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin()
    .from("daily_placement_imps")
    .upsert(
      rows.map((r) => ({ ...r, computed_at: new Date().toISOString() })),
      { onConflict: "placement_id" },
    );
  if (error) throw new Error(`writePlacementImpressions: ${error.message}`);
}
