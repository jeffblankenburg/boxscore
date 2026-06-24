// One-shot: populate daily_open_stickiness for the most recent ET window
// so the /admin/metrics/sends panel works before the nightly cron runs.
// Computes (mlb, league, 7) and (mlb, team, 7) for yesterday in ET.
//
// Usage:
//   node --import tsx --env-file=.env.local scripts/populate-stickiness.mjs

import {
  computeOpenStickiness, writeOpenStickiness,
} from "../lib/admin-aggregates.ts";

function ymdET(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(d);
}

const yesterday = ymdET(new Date(Date.now() - 24 * 60 * 60 * 1000));
console.log(`Computing open stickiness ending ${yesterday}`);

for (const scope of ["league", "team"]) {
  const t0 = Date.now();
  const row = await computeOpenStickiness("mlb", scope, yesterday, 7);
  await writeOpenStickiness([row]);
  console.log(`  mlb/${scope}: eligible=${row.eligible} histogram=${JSON.stringify(row.histogram)} (${Date.now() - t0}ms)`);
}
