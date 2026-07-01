// One-shot backfill of MLB ML odds from ESPN's core API.
//
// Usage:
//   npx tsx scripts/backfill-espn-odds.ts                # season start → today
//   npx tsx scripts/backfill-espn-odds.ts 2026-06-01      # from that date → today
//   npx tsx scripts/backfill-espn-odds.ts 2026-05-01 2026-05-31
//
// Walks one date at a time so a transient ESPN failure doesn't lose
// the whole season. Prints a one-line summary per date.

import { captureEspnOddsForDate } from "../lib/sports/mlb/odds-cache";

function isoNext(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`bad iso ${iso}`);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

function todayInEt(): string {
  // No need for the in-app helper — this script runs from a TTY, and the
  // odds are date-anchored to the slate date which uses ET. Close enough.
  const now = new Date();
  const et = new Date(now.getTime() - 4 * 60 * 60 * 1000); // -4h ~ EDT
  return et.toISOString().slice(0, 10);
}

async function main() {
  const start = process.argv[2] ?? `${todayInEt().slice(0, 4)}-03-01`;
  const end   = process.argv[3] ?? todayInEt();
  console.log(`backfilling MLB ML odds from ESPN, ${start} → ${end}`);

  let totalUpserted = 0;
  let totalMatched = 0;
  let totalScheduled = 0;
  let totalUnmatched = 0;

  for (let d = start; d <= end; d = isoNext(d)) {
    try {
      const r = await captureEspnOddsForDate(d);
      totalUpserted += r.upserted;
      totalMatched += r.matched;
      totalScheduled += r.scheduled;
      totalUnmatched += r.unmatched.length;
      const flags = r.unmatched.length
        ? ` UNMATCHED: ${r.unmatched.map((u) => `${u.awayAbbr}@${u.homeAbbr}`).join(",")}`
        : "";
      console.log(
        `  ${d}: scheduled=${r.scheduled} espn=${r.espnGames} matched=${r.matched} withMl=${r.withMl} upserted=${r.upserted}${flags}`,
      );
    } catch (e) {
      console.error(`  ${d}: ERROR ${(e as Error).message}`);
    }
  }

  console.log(
    `done. scheduled=${totalScheduled} matched=${totalMatched} upserted=${totalUpserted} unmatched=${totalUnmatched}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
