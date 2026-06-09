// One-off diagnostic: time the supabase round-trip used by recordSend()
// inside the send-email loop, so we can compare current latency against
// the implied healthy (~50ms) vs failing (~150ms) range from cron_runs.
//
// We don't actually call recordSend (that would pollute real data). We
// SELECT a known-empty filter on the sends table — same connection path,
// same table, same protocol, just no write — to isolate the network +
// PostgREST + auth overhead each call pays.
//
// Run:
//   npx tsx --env-file=.env.local scripts/diag-send-rate.ts

import { supabaseAdmin } from "../lib/supabase";

const SAMPLE_SIZE = 100;          // one batch's worth, matches BATCH_SIZE in send-email
const WARMUP = 5;                 // ignore first N to skip connection setup variance

async function main(): Promise<void> {
  const db = supabaseAdmin();
  const latencies: number[] = [];

  // Sentinel filter: a date that can't exist in production data. Returns
  // 0 rows fast at the database; the per-call cost is dominated by
  // network + PostgREST + auth, not query work — same as recordSend.
  for (let i = 0; i < SAMPLE_SIZE + WARMUP; i++) {
    const t0 = performance.now();
    const { error } = await db
      .from("sends")
      .select("id", { count: "exact", head: true })
      .eq("digest_date", "1900-01-01");
    if (error) throw new Error(`sample ${i}: ${error.message}`);
    const elapsed = performance.now() - t0;
    if (i >= WARMUP) latencies.push(elapsed);
  }

  latencies.sort((a, b) => a - b);
  if (latencies.length === 0) {
    console.error("no samples collected");
    process.exit(1);
  }
  const avg = latencies.reduce((s, n) => s + n, 0) / latencies.length;
  const p50 = latencies[Math.floor(latencies.length * 0.5)]!;
  const p95 = latencies[Math.floor(latencies.length * 0.95)]!;
  const p99 = latencies[Math.floor(latencies.length * 0.99)]!;
  const min = latencies[0]!;
  const max = latencies[latencies.length - 1]!;

  console.log(`Supabase round-trip latency (${latencies.length} samples, after ${WARMUP}-call warmup)\n`);
  console.log(`  min: ${min.toFixed(1)}ms`);
  console.log(`  p50: ${p50.toFixed(1)}ms`);
  console.log(`  avg: ${avg.toFixed(1)}ms`);
  console.log(`  p95: ${p95.toFixed(1)}ms`);
  console.log(`  p99: ${p99.toFixed(1)}ms`);
  console.log(`  max: ${max.toFixed(1)}ms`);

  console.log(`\nProjected send-email cron time, given current latency:`);
  console.log(`  Per batch (100 sequential recordSend): ${(avg * 100 / 1000).toFixed(1)}s`);
  console.log(`  Per batch including ~5s Resend batch:  ${(avg * 100 / 1000 + 5).toFixed(1)}s`);
  console.log(`  57 batches (≈5,700 subscribers):       ${((avg * 100 / 1000 + 5) * 57).toFixed(0)}s`);
  console.log(`  vs 800s Vercel maxDuration cap:        ${((avg * 100 / 1000 + 5) * 57 > 800 ? "OVER" : "under")}`);

  console.log(`\nReference: healthy days ran in ~290s; failing days hit the 800s cap.`);
  console.log(`If avg is ~50ms here, the DB isn't the cause — investigate Resend.`);
  console.log(`If avg is >100ms here, the per-call DB cost dominates and parallelizing`);
  console.log(`recordSend with Promise.all is the obvious fix.`);
  console.log(`\nNote: this script runs from your local machine, not Vercel. Vercel→Supabase`);
  console.log(`latency may differ from local→Supabase. The numbers are directional.`);
}

main().catch((err) => { console.error(err); process.exit(1); });

export {};
