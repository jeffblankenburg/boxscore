// Backfill daily_send_stats + daily_subscriber_events + daily_placement_imps
// for every date with data, then exit. Idempotent: rerunning replaces rows.
//
// Usage:
//   node --import tsx --env-file=.env.local scripts/backfill-aggregates.mjs
//
// Optional:
//   FROM=2026-03-25  TO=2026-06-23  node --import tsx ... backfill-aggregates.mjs
//
// If FROM/TO are omitted, the script auto-discovers the date range from the
// earliest `sends.sent_at` to yesterday (UTC).

import { createClient } from "@supabase/supabase-js";
import {
  computeDailySendStats, writeDailySendStats,
  computeDailySubscriberEvents, writeDailySubscriberEvents,
  loadSubscriberSnapshot,
  computePlacementImpressions, writePlacementImpressions,
} from "../lib/admin-aggregates.ts";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Need SUPABASE_URL + SUPABASE_SECRET_KEY in .env.local");
  process.exit(2);
}
const sb = createClient(url, key);

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtUtc(d) { return d.toISOString().slice(0, 10); }

async function discoverRange() {
  const from = process.env.FROM;
  const to   = process.env.TO;
  if (from && to) return { from, to };

  const { data, error } = await sb
    .from("sends")
    .select("sent_at")
    .order("sent_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`discoverRange: ${error.message}`);
  const first = data?.[0]?.sent_at;
  if (!first) throw new Error("No rows in sends — nothing to backfill.");

  const fromAuto = first.slice(0, 10);
  const toAuto = fmtUtc(new Date(Date.now() - DAY_MS));
  return { from: from ?? fromAuto, to: to ?? toAuto };
}

function listDates(from, to) {
  const out = [];
  let cur = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cur <= end) {
    out.push(fmtUtc(cur));
    cur = new Date(cur.getTime() + DAY_MS);
  }
  return out;
}

async function main() {
  const { from, to } = await discoverRange();
  const dates = listDates(from, to);
  console.log(`Backfilling ${dates.length} days: ${from} → ${to}`);

  // Subscribers snapshot is fetched once; compute every day from cache.
  console.log("Loading subscriber snapshot...");
  const subs = await loadSubscriberSnapshot();
  console.log(`Loaded ${subs.length} subscriber rows.`);

  let okSend = 0, okSub = 0;
  for (const date of dates) {
    const t0 = Date.now();
    process.stderr.write(`  ${date} `);

    try {
      const sendRows = await computeDailySendStats(date);
      await writeDailySendStats(sendRows);
      okSend++;
      process.stderr.write(`send=${sendRows.length} `);
    } catch (e) {
      process.stderr.write(`send=ERR(${e.message}) `);
    }

    try {
      const subRow = await computeDailySubscriberEvents(date, subs);
      await writeDailySubscriberEvents([subRow]);
      okSub++;
      process.stderr.write(`sub=ok `);
    } catch (e) {
      process.stderr.write(`sub=ERR(${e.message}) `);
    }

    process.stderr.write(`(${Date.now() - t0}ms)\n`);
  }

  // Placements: one pass across all dates. Use a since-date that covers
  // every placement we have. (Cron itself only recomputes the trailing
  // 14d; backfill should hit the full history.)
  console.log("\nRecomputing all placement impressions...");
  const placementsT0 = Date.now();
  const placementRows = await computePlacementImpressions("2000-01-01");
  await writePlacementImpressions(placementRows);
  console.log(`Wrote ${placementRows.length} placement rows in ${Date.now() - placementsT0}ms.`);

  console.log(`\nDone. Sends: ${okSend}/${dates.length}, Subs: ${okSub}/${dates.length}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
