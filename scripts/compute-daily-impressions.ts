// Actual audience-wide avg daily impressions for the /advertise page — the
// source of QUARTERLY_STATS.dailyImpressions (which replaced a stale 5-day
// trial figure). Reuses loadImpressionsByPair (the same code the advertiser
// dashboards use): impressions = unique email opens + production web pageviews
// per edition. Averages over the last N editions that actually shipped.
import { loadImpressionsByPair } from "@/lib/ad-impressions";
import { yesterdayInET, prevDay } from "@/lib/dates";

const DAYS = Number(process.argv[2] ?? "30");

async function main() {
  // Build the last DAYS edition dates ending yesterday (ET).
  const dates: string[] = [];
  let d = yesterdayInET();
  for (let i = 0; i < DAYS; i++) {
    dates.push(d);
    d = prevDay(d);
  }
  const pairs = dates.map((date) => ({ sport: "mlb", date }));

  const byPair = await loadImpressionsByPair(pairs);

  let email = 0, web = 0, editions = 0;
  for (const date of dates) {
    const imp = byPair.get(`mlb|${date}`);
    if (!imp) continue;
    const total = imp.email + imp.web;
    if (total === 0) continue; // off-day / no digest — don't dilute the avg
    editions += 1;
    email += imp.email;
    web += imp.web;
  }

  const total = email + web;
  const perEdition = editions ? Math.round(total / editions) : 0;

  console.log(`\nWindow: last ${DAYS} calendar days (${dates[dates.length - 1]} → ${dates[0]})`);
  console.log(`Editions with impressions: ${editions}`);
  console.log(`Total impressions: ${total.toLocaleString()}  (email ${email.toLocaleString()} + web ${web.toLocaleString()})`);
  console.log(`\n  AVG DAILY IMPRESSIONS (per edition): ${perEdition.toLocaleString()}`);
  console.log(`  email/day ${Math.round(email / (editions || 1)).toLocaleString()}  |  web/day ${Math.round(web / (editions || 1)).toLocaleString()}`);
  console.log(`\n  (paste perEdition into QUARTERLY_STATS.dailyImpressions)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
