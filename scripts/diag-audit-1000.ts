// Audit every number I quoted that could be a Supabase-pagination artifact.
// The "1,000" suspicion: cron_runs.result.sent=1000 on day 1 could mean
// (a) the cron actually shipped to 1000 subs, or (b) the cron's internal
// queries hit the 1000-row cap and silently truncated.
//
// Method: re-count from the authoritative source (sends table, paginated)
// and compare against the cron's reported number.

import { supabaseAdmin } from "../lib/supabase";

async function countSendsForDate(date: string, scope: "league" | "team"): Promise<number> {
  const db = supabaseAdmin();
  let count = 0;
  for (let from = 0; ; from += 1000) {
    let q = db
      .from("sends")
      .select("id", { head: false })
      .eq("digest_sport", "mlb")
      .eq("digest_date", date)
      .is("error", null);
    q = scope === "league" ? q.is("team_id", null) : q.not("team_id", "is", null);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    count += page.length;
    if (page.length < 1000) break;
  }
  return count;
}

async function main(): Promise<void> {
  const db = supabaseAdmin();

  console.log("══ DAY 1 SEND SIZE — VERIFICATION ═════════════════════");
  // Authoritative: count sends.team_id IS NULL, error IS NULL, digest_date='2026-05-15'
  const day1League = await countSendsForDate("2026-05-15", "league");
  console.log(`Actual league sends on digest_date=2026-05-15: ${day1League}`);

  // Compare to what the cron reported
  const { data: day1Runs } = await db
    .from("cron_runs")
    .select("started_at, result")
    .eq("route", "send-email")
    .eq("date", "2026-05-15")
    .order("started_at", { ascending: true });
  console.log(`\nAll cron_runs for date=2026-05-15:`);
  for (const r of (day1Runs ?? []) as Array<{ started_at: string; result: Record<string, unknown> | null }>) {
    console.log(`  ${r.started_at}  result=${JSON.stringify(r.result)}`);
  }

  // ── Each subsequent day — actual sends vs cron-reported ──
  console.log("\n══ FIRST 10 EDITION DAYS — AUTHORITATIVE COUNTS ══════");
  const dates = [
    "2026-05-15", "2026-05-16", "2026-05-17", "2026-05-18", "2026-05-19",
    "2026-05-20", "2026-05-21", "2026-05-22", "2026-05-23", "2026-05-24",
  ];
  console.log(`date         league_sends   cron_reported`);
  for (const date of dates) {
    const actual = await countSendsForDate(date, "league");
    // First cron run for this date
    const { data: runs } = await db
      .from("cron_runs")
      .select("started_at, result")
      .eq("route", "send-email")
      .eq("date", date)
      .eq("status", "ok")
      .order("started_at", { ascending: true })
      .limit(1);
    type RunRow = { started_at: string; result: { sent?: number; total_active_subscribers?: number } | null };
    const first = ((runs ?? [])[0] ?? null) as RunRow | null;
    const sent = first?.result?.sent ?? "—";
    const total = first?.result?.total_active_subscribers ?? "—";
    console.log(`  ${date}   ${String(actual).padEnd(13)} sent=${sent} total_active=${total}`);
  }

  // ── Sanity: total active subscribers AT THIS MOMENT, via two methods ──
  console.log("\n══ ACTIVE SUBSCRIBER COUNT — TWO METHODS ══════════════");
  const { count: headCount } = await db.from("subscribers").select("id", { count: "exact", head: true }).eq("status", "active");
  console.log(`Method 1 (HEAD count exact): ${headCount}`);
  let scanCount = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("subscribers").select("id").eq("status", "active").range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    scanCount += page.length;
    if (page.length < 1000) break;
  }
  console.log(`Method 2 (paginated scan): ${scanCount}`);
  console.log(`Difference: ${headCount! - scanCount}`);

  // ── Audit: does total active subscriber match what cron_runs reports today? ──
  const { data: latestRun } = await db
    .from("cron_runs")
    .select("started_at, result")
    .eq("route", "send-email")
    .eq("status", "ok")
    .order("started_at", { ascending: false })
    .limit(3);
  console.log(`\nMost recent send-email runs:`);
  for (const r of (latestRun ?? []) as Array<{ started_at: string; result: Record<string, unknown> | null }>) {
    console.log(`  ${r.started_at}  result=${JSON.stringify(r.result)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
