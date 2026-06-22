// Backfill daily_metrics for every edition date with email or web activity.
// Walks from the day open-tracking started (2026-05-30 — first day events
// can attribute to a send) forward to yesterday's edition. The active-
// subscribers field is left null for historical days because the sport-
// scoped opted-in roster isn't tracked over time; the daily cron sets it
// going forward.
//
// Run:
//   npx tsx --env-file=.env.local scripts/backfill-daily-metrics.ts mlb

import {
  computeDailyMetric,
  writeDailyMetric,
} from "../lib/daily-metrics";
import { yesterdayInET, nextDay } from "../lib/dates";

const OPEN_TRACKING_START = "2026-05-30";

async function main(): Promise<void> {
  const sport = process.argv[2];
  if (!sport) {
    console.error(`usage: backfill-daily-metrics.ts <sport>`);
    process.exit(1);
  }
  // First edition date with attributable opens: open tracking turned on
  // 2026-05-30, and a digest sent that morning has digest_date = 2026-05-29.
  // So the earliest edition where opens can land is 2026-05-30 itself.
  const start = OPEN_TRACKING_START;
  const end   = yesterdayInET();
  console.log(`Backfilling ${sport} from ${start} to ${end}…`);

  let cur = start;
  let count = 0;
  while (cur <= end) {
    const t0 = Date.now();
    const metric = await computeDailyMetric(sport, cur);
    await writeDailyMetric(sport, cur, metric);
    const ms = Date.now() - t0;
    console.log(
      `  ${cur}  delivered=${metric.delivered ?? "—"}  opened=${metric.opened ?? "—"}  clicked=${metric.clicked ?? "—"}  web=${metric.web_pageviews ?? 0}  (${ms}ms)`,
    );
    cur = nextDay(cur);
    count++;
  }
  console.log(`\nDone. Wrote ${count} rows for ${sport}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
