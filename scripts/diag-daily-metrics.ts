// Quick spot-check of the most recent daily_metrics rows, showing both
// league and team columns. Run: npx tsx --env-file=.env.local scripts/diag-daily-metrics.ts mlb

import { supabaseAdmin } from "../lib/supabase";

async function main(): Promise<void> {
  const sport = process.argv[2] ?? "mlb";
  const { data, error } = await supabaseAdmin()
    .from("daily_metrics")
    .select("date, delivered, opened, team_delivered, team_opened, team_active_subscribers")
    .eq("sport", sport)
    .order("date", { ascending: false })
    .limit(7);
  if (error) throw new Error(error.message);
  console.log(`date         league(deliv/open)   team(deliv/open)   team_subs`);
  for (const r of (data ?? []) as Array<{
    date: string; delivered: number | null; opened: number | null;
    team_delivered: number | null; team_opened: number | null;
    team_active_subscribers: number | null;
  }>) {
    const lg = `${r.delivered ?? "—"}/${r.opened ?? "—"}`.padEnd(18);
    const tm = `${r.team_delivered ?? "—"}/${r.team_opened ?? "—"}`.padEnd(18);
    console.log(`${r.date}   ${lg} ${tm} ${r.team_active_subscribers ?? "—"}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
