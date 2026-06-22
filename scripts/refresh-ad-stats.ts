// One-shot: refresh the ad_stats_snapshot singleton + today's daily_metrics
// row. Mirrors what /api/cron/ad-stats-snapshot does, runnable from CLI for
// after a backfill or after a failed cron.
//
// Run: npx tsx --env-file=.env.local scripts/refresh-ad-stats.ts mlb

import { yesterdayInET } from "../lib/dates";
import { getPublicAdStatsSnapshot, writeAdStatsSnapshot } from "../lib/dashboard";
import { computeDailyMetric, writeDailyMetric } from "../lib/daily-metrics";

async function main(): Promise<void> {
  const sport = process.argv[2] ?? "mlb";
  const date = yesterdayInET();
  console.log(`Refreshing ${sport} for edition ${date}…`);

  const tDaily = Date.now();
  const daily = await computeDailyMetric(sport, date, { includeActiveSubscribers: true });
  await writeDailyMetric(sport, date, daily);
  console.log(`  daily_metrics  delivered=${daily.delivered}  opened=${daily.opened}  clicked=${daily.clicked}  web=${daily.web_pageviews}  subs=${daily.active_subscribers}  (${Date.now() - tDaily}ms)`);

  const tSnap = Date.now();
  const stats = await getPublicAdStatsSnapshot(sport, 30);
  await writeAdStatsSnapshot(stats);
  console.log(`  snapshot       open_rate=${(stats.openRate * 100).toFixed(2)}%  delivered=${stats.delivered}  sends=${stats.sends}  (${Date.now() - tSnap}ms)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
