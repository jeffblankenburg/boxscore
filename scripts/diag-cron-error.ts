// One-off: most recent cron run for a given route (defaults to today's), with
// its error and result. Run: npx tsx --env-file=.env.local scripts/diag-cron-error.ts ad-stats-snapshot

import { supabaseAdmin } from "../lib/supabase";

async function main(): Promise<void> {
  const route = process.argv[2];
  if (!route) {
    console.error(`usage: diag-cron-error.ts <route> [date]`);
    process.exit(1);
  }
  const db = supabaseAdmin();
  let q = db
    .from("cron_runs")
    .select("id, route, sport, date, status, trigger, error, result, started_at, finished_at")
    .eq("route", route)
    .order("started_at", { ascending: false })
    .limit(5);
  const dateArg = process.argv[3];
  if (dateArg) q = q.eq("date", dateArg);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  for (const r of data ?? []) {
    console.log(`──`);
    console.log(`route       ${r.route}`);
    console.log(`sport       ${r.sport ?? "—"}`);
    console.log(`date        ${r.date ?? "—"}`);
    console.log(`status      ${r.status}`);
    console.log(`trigger     ${r.trigger}`);
    console.log(`started_at  ${r.started_at}`);
    console.log(`finished_at ${r.finished_at ?? "—"}`);
    if (r.error) console.log(`error       ${r.error}`);
    if (r.result) console.log(`result      ${JSON.stringify(r.result).slice(0, 500)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
