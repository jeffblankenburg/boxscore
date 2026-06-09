// One-off diagnostic: list recent send-email cron runs for MLB, with the
// supervisor re-runs alongside, so we can see what failed and why.
//
// Run:
//   npx tsx --env-file=.env.local scripts/diag-send-email-failures.ts

import { supabaseAdmin } from "../lib/supabase";

async function main(): Promise<void> {
  const db = supabaseAdmin();

  // Pull every send-email run AND every supervise run from the last 14
  // days. Sorted newest first; we'll regroup by date below.
  const sinceIso = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: runs, error } = await db
    .from("cron_runs")
    .select("id, route, sport, date, status, trigger, error, result, started_at, finished_at")
    .in("route", ["send-email", "supervise"])
    .or(`sport.eq.mlb,sport.is.null`)
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: false });
  if (error) throw new Error(`cron_runs query: ${error.message}`);

  // Group by sport-relevant date (digest_date for send-email; the supervise
  // route is global, so attach it to the run's `date` field directly).
  const byDate = new Map<string, typeof runs>();
  for (const r of runs ?? []) {
    const key = r.date ?? "(no-date)";
    const arr = byDate.get(key) ?? [];
    arr.push(r);
    byDate.set(key, arr);
  }

  const dates = Array.from(byDate.keys()).sort().reverse().slice(0, 10);

  console.log(`Inspecting ${dates.length} most recent MLB send-email dates:\n`);
  for (const date of dates) {
    const dateRuns = byDate.get(date) ?? [];
    // Show in chronological order within the date.
    dateRuns.sort((a, b) => a.started_at.localeCompare(b.started_at));
    console.log(`── ${date} ──────────────────────────────────`);
    for (const r of dateRuns) {
      const dur = r.finished_at
        ? `${Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000)}s`
        : "(unfinished)";
      const tail = r.error ? `error="${r.error.slice(0, 200)}"` : "";
      console.log(
        `  ${r.route.padEnd(13)} ${r.status.padEnd(7)} ${r.trigger.padEnd(7)} ${dur.padEnd(6)} ${r.started_at.slice(11, 19)}Z  ${tail}`,
      );
      if (r.result && Object.keys(r.result).length > 0) {
        const compact = JSON.stringify(r.result);
        if (compact.length > 300) {
          console.log(`    result: ${compact.slice(0, 300)}…`);
        } else {
          console.log(`    result: ${compact}`);
        }
      }
    }
    console.log("");
  }

  // Also: a roll-up of failure error messages over the period.
  const failureErrors = new Map<string, number>();
  for (const r of runs ?? []) {
    if (r.status !== "failed" || r.route !== "send-email" || r.sport !== "mlb") continue;
    const key = r.error?.slice(0, 120) ?? "(no error message)";
    failureErrors.set(key, (failureErrors.get(key) ?? 0) + 1);
  }
  if (failureErrors.size > 0) {
    console.log(`── send-email failure error messages (count) ──────────────`);
    const sorted = Array.from(failureErrors.entries()).sort((a, b) => b[1] - a[1]);
    for (const [msg, n] of sorted) {
      console.log(`  ${String(n).padStart(3)}×  ${msg}`);
    }
  } else {
    console.log("(no send-email failures in the window)");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

export {};
