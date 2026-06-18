// One-off: check today's MLB send-email cron run status. Includes runs with
// status=running (currently in progress) or runs with an error that didn't
// reach the supervisor pass yet. Today's date is computed in ET to match
// digest_date semantics.

import { supabaseAdmin } from "../lib/supabase";
import { yesterdayInET, nextDay } from "../lib/dates";

async function main(): Promise<void> {
  const db = supabaseAdmin();
  const today = nextDay(yesterdayInET());
  console.log(`Today (ET): ${today}\n`);

  // Pull every cron run with date = today, regardless of route/status.
  const { data: runs, error } = await db
    .from("cron_runs")
    .select("id, route, sport, date, status, trigger, error, result, started_at, finished_at")
    .eq("date", today)
    .order("started_at", { ascending: true });
  if (error) throw new Error(`cron_runs query: ${error.message}`);

  if (!runs || runs.length === 0) {
    console.log(`No cron runs with date=${today} found. The send-email cron has not fired today.`);
  } else {
    console.log(`${runs.length} cron run(s) with date=${today}:\n`);
    for (const r of runs) {
      const dur = r.finished_at
        ? `${Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000)}s`
        : "(unfinished)";
      console.log(
        `  ${r.route.padEnd(13)} ${(r.sport ?? "—").padEnd(5)} ${r.status.padEnd(8)} ${r.trigger.padEnd(7)} ${dur.padEnd(7)} ${r.started_at.slice(11, 19)}Z`,
      );
      if (r.error) console.log(`    error: ${r.error.slice(0, 300)}`);
      if (r.result) console.log(`    result: ${JSON.stringify(r.result).slice(0, 300)}`);
    }
  }

  // Also: how many sends.digest_date=today rows exist for MLB league?
  const { count: leagueSends, error: sErr } = await db
    .from("sends")
    .select("id", { count: "exact", head: true })
    .eq("digest_date", today)
    .eq("digest_sport", "mlb")
    .is("team_id", null);
  if (sErr) {
    console.log(`\nsends count: error ${sErr.message}`);
  } else {
    console.log(`\nsends rows for (digest_date=${today}, digest_sport=mlb, team_id IS NULL): ${leagueSends ?? 0}`);
  }

  const { count: errored, error: eErr } = await db
    .from("sends")
    .select("id", { count: "exact", head: true })
    .eq("digest_date", today)
    .eq("digest_sport", "mlb")
    .is("team_id", null)
    .not("error", "is", null);
  if (!eErr) {
    console.log(`  …of which had error: ${errored ?? 0}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
