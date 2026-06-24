// Daily aggregator that backs the slow /admin pages. Writes precomputed
// rows to daily_send_stats, daily_subscriber_events, and
// daily_placement_imps (migration 0062) so admin pages serve from a few
// indexed lookups instead of scanning sends + email_events per request.
//
// Schedule: 9:55 UTC, after the morning send + the ad-stats-snapshot cron
// (so opens from this morning's sends have had ~minutes to accumulate).
// Backfill via scripts/backfill-aggregates.mjs.
//
// What it writes per run:
//   - daily_send_stats: yesterday's row (one per (sport, scope))
//   - daily_subscriber_events: yesterday's row
//   - daily_placement_imps: last 14d of placements (recompute since opens
//     trickle for a few days after the send)

import { NextResponse } from "next/server";
import { startCronRun, finishCronRun } from "@/lib/cron-runs";
import {
  computeDailySendStats,
  writeDailySendStats,
  computeDailySubscriberEvents,
  writeDailySubscriberEvents,
  computePlacementImpressions,
  writePlacementImpressions,
  computeOpenStickiness,
  writeOpenStickiness,
} from "@/lib/admin-aggregates";
import { yesterdayInET } from "@/lib/dates";

export const runtime = "nodejs";
// Yesterday-only sends compute is ~5s; placement recompute is the long pole
// (the 14d trailing window calls loadImpressionsByPair). 5min headroom.
export const maxDuration = 300;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// UTC date for "yesterday" — matches the daily_send_stats.date semantics
// (sends.sent_at::date in UTC). Don't use ET here; the rest of the daily
// crons key on ET edition dates, but our aggregate is by UTC send-day.
function yesterdayUtc(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function daysAgoUtc(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  const date = yesterdayUtc();

  let runId: string | null = null;
  try {
    runId = await startCronRun({ route: "aggregate-stats", date, trigger });

    const t0 = Date.now();

    // 1. Sends + deliverability (all sports for the day).
    const sendStatsT0 = Date.now();
    const sendRows = await computeDailySendStats(date);
    await writeDailySendStats(sendRows);
    const sendStatsMs = Date.now() - sendStatsT0;

    // 2. Subscriber events for the same day.
    const subsT0 = Date.now();
    const subRow = await computeDailySubscriberEvents(date);
    await writeDailySubscriberEvents([subRow]);
    const subsMs = Date.now() - subsT0;

    // 3. Placement impressions for the trailing window.
    const placementsT0 = Date.now();
    const sinceDate = daysAgoUtc(14);
    const placementRows = await computePlacementImpressions(sinceDate);
    await writePlacementImpressions(placementRows);
    const placementsMs = Date.now() - placementsT0;

    // 4. Open stickiness — rolling 7-day histogram, per (sport, scope).
    //    Inclusive end date is yesterday in ET (matches the existing
    //    getOpenStickiness semantics; today's window would be partial).
    const stickyT0 = Date.now();
    const stickyEnd = yesterdayInET();
    const stickyRows = await Promise.all([
      computeOpenStickiness("mlb", "league", stickyEnd, 7),
      computeOpenStickiness("mlb", "team",   stickyEnd, 7),
    ]);
    await writeOpenStickiness(stickyRows);
    const stickyMs = Date.now() - stickyT0;

    const totalMs = Date.now() - t0;
    const result = {
      date,
      total_ms: totalMs,
      send_stats: { rows: sendRows.length, ms: sendStatsMs },
      subscribers: { row: subRow, ms: subsMs },
      placements: { rows: placementRows.length, since: sinceDate, ms: placementsMs },
      stickiness: { rows: stickyRows.length, end: stickyEnd, ms: stickyMs },
    };
    await finishCronRun(runId, { status: "ok", result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    await finishCronRun(runId, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
