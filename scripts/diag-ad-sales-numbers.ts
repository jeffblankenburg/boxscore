// One-off: pull the real audience numbers for the ad-sales playbook.
// Reports current active subscribers, 30-day open/click/delivery rates,
// where readers are (best available), and recent growth.
//
// Run:
//   npx tsx --env-file=.env.local scripts/diag-ad-sales-numbers.ts

import { getKpis, getRollingAdStats, getSubscriberSeries } from "../lib/dashboard";

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function main() {
  const kpis30 = await getKpis("30d");
  const rolling30 = await getRollingAdStats(30);
  const series30 = await getSubscriberSeries("30d");

  const newSubs30 = series30.newSubs.reduce((a, b) => a + b, 0);
  const unsubs30 = series30.unsubs.reduce((a, b) => a + b, 0);

  console.log("=== AD-SALES AUDIENCE NUMBERS ===");
  console.log("");
  console.log("Active subscribers (now):       ", kpis30.activeSubscribers);
  console.log("Lifetime digests shipped:       ", kpis30.totalDigestsShipped);
  console.log("");
  console.log("--- 30-day rolling (advertiser pitch view) ---");
  console.log("Sends (30d):                    ", rolling30.sends);
  console.log("Delivered (30d):                ", rolling30.delivered);
  console.log("Delivery rate:                  ", pct(rolling30.deliveryRate));
  console.log("Open rate (30d):                ", rolling30.tracked ? pct(rolling30.openRate) : "— (open tracking not recording yet)");
  console.log("Click rate (30d):               ", pct(rolling30.clickRate));
  console.log("Opened (raw, 30d):              ", rolling30.opened);
  console.log("Clicked (raw, 30d):             ", rolling30.clicked);
  console.log("");
  console.log("--- 30-day open rate (KPI view, per-send) ---");
  console.log("Open rate (30d, KPI):           ", kpis30.openRate.tracked ? pct(kpis30.openRate.rate) : "— (not tracked yet)");
  console.log("  opened sends / total sends:   ", `${kpis30.openRate.opened} / ${kpis30.openRate.sends}`);
  console.log("");
  console.log("--- 30-day growth ---");
  console.log("New subscribers (30d):          ", newSubs30);
  console.log("Unsubscribes (30d):             ", unsubs30);
  console.log("Net growth (30d):               ", newSubs30 - unsubs30);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
