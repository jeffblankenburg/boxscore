// Daily snapshot of the public ad-stats numbers shown on /advertise. Without
// this, the page recomputes the dedup-by-resend_id rolling stats on every
// hourly cache revalidation — ~14s today, slower as the engagement window
// grows. Run once a day after the morning sends have completed; /advertise
// reads the singleton row in microseconds and falls back to live compute if
// the snapshot is missing or stale.

import { NextResponse } from "next/server";
import { startCronRun, finishCronRun } from "@/lib/cron-runs";
import { yesterdayInET } from "@/lib/dates";
import {
  getPublicAdStatsSnapshot,
  writeAdStatsSnapshot,
} from "@/lib/dashboard";
import {
  computeDailyMetric,
  writeDailyMetric,
} from "@/lib/daily-metrics";

export const runtime = "nodejs";
// Steady state ~14s; budget headroom for natural growth without paying for
// idle. Bump if the underlying compute starts brushing this.
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const sport = url.searchParams.get("sport") ?? "mlb";
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  // Tag the cron_runs row with today's edition date so the supervisor (which
  // groups by date) can find this run alongside the other daily crons.
  const date = yesterdayInET();

  let runId: string | null = null;
  try {
    runId = await startCronRun({ route: "ad-stats-snapshot", sport, date, trigger });

    // Write yesterday's daily_metrics row FIRST. The public snapshot below
    // sums from daily_metrics for its open/click rates, so writing this row
    // ahead of the snapshot ensures yesterday's send is included in today's
    // rolling number. Edition date = yesterdayInET — the digest delivered
    // yesterday morning has had ~24h to accumulate opens by 5:50 AM ET.
    const dailyT0 = Date.now();
    const daily = await computeDailyMetric(sport, date, { includeActiveSubscribers: true });
    await writeDailyMetric(sport, date, daily);
    const dailyMs = Date.now() - dailyT0;

    const t0 = Date.now();
    const stats = await getPublicAdStatsSnapshot(sport, 30);
    const computeMs = Date.now() - t0;

    await writeAdStatsSnapshot(stats);

    const result = {
      sport,
      compute_ms: computeMs,
      daily_compute_ms: dailyMs,
      active_subscribers: stats.activeSubscribers,
      sends: stats.sends,
      delivered: stats.delivered,
      open_rate: stats.openRate,
      click_rate: stats.clickRate,
      delivery_rate: stats.deliveryRate,
      tracked: stats.tracked,
      daily: { date, ...daily },
    };
    await finishCronRun(runId, { status: "ok", result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    await finishCronRun(runId, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
