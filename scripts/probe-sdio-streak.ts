// One-off: inspect the raw SDIO Standings rows stored in daily_raw_sdio
// for a date, looking for streak-related fields. The canonical adapter
// reads r.Streak as a signed integer but the rendered preview suggests
// streak data isn't coming through cleanly — this script dumps every
// streak-looking field name on a sample row so we can see what SDIO
// actually returns.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-sdio-streak.ts [date]

import { supabaseAdmin } from "../lib/supabase";

async function main(): Promise<void> {
  const date = process.argv[2] ?? "2026-06-15";
  const { data, error } = await supabaseAdmin()
    .from("daily_raw_sdio")
    .select("payload")
    .eq("sport", "mlb")
    .eq("date", date)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) { console.log(`no row for ${date}`); return; }

  const payload = data.payload as { standings?: unknown };
  const standings = (payload.standings as Array<Record<string, unknown>> | null) ?? [];
  if (standings.length === 0) { console.log("standings array empty"); return; }

  console.log(`${standings.length} standings rows on ${date}.\n`);

  // Dump every key + value pair from the first row so we can see the
  // raw schema SDIO is returning. Then highlight any streak-looking
  // keys across all rows.
  const sample = standings[0] as Record<string, unknown>;
  console.log("Full schema of first row:");
  for (const [k, v] of Object.entries(sample)) {
    console.log(`  ${k.padEnd(30)} = ${JSON.stringify(v)}`);
  }

  console.log("\nStreak-looking keys (per row, all 30 teams):");
  const streakKeys = Object.keys(sample).filter((k) => /streak/i.test(k));
  if (streakKeys.length === 0) {
    console.log("  (none — no field matches /streak/i)");
  }
  for (const row of standings) {
    const r = row as Record<string, unknown>;
    const label = `${(r.Key ?? r.Name ?? r.TeamID ?? "?")}`.padEnd(20);
    const parts = streakKeys.map((k) => `${k}=${JSON.stringify(r[k])}`);
    console.log(`  ${label} ${parts.join("  ")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
