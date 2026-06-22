// Count distinct subscribers by what they're opted into:
//   - league only
//   - team only (no league subscription for this sport)
//   - both
// Resolves the "do all team subscribers also subscribe to league?" question.

import { supabaseAdmin } from "../lib/supabase";

async function main(): Promise<void> {
  const sport = process.argv[2] ?? "mlb";
  const db = supabaseAdmin();

  type Row = { subscriber_id: string; scope: string };
  const leagueIds = new Set<string>();
  const teamIds   = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("email_subscriptions")
      .select("subscriber_id, scope")
      .eq("sport", sport)
      .eq("active", true)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Row[];
    for (const r of page) {
      if (r.scope === "league")    leagueIds.add(r.subscriber_id);
      else if (r.scope === "team") teamIds.add(r.subscriber_id);
    }
    if (page.length < 1000) break;
  }

  let both = 0;
  let teamOnly = 0;
  let leagueOnly = 0;
  for (const id of leagueIds) {
    if (teamIds.has(id)) both++;
    else leagueOnly++;
  }
  for (const id of teamIds) {
    if (!leagueIds.has(id)) teamOnly++;
  }

  console.log(`sport=${sport}`);
  console.log(`  league subscribers: ${leagueIds.size}`);
  console.log(`  team   subscribers: ${teamIds.size}`);
  console.log(`  both:               ${both}`);
  console.log(`  league only:        ${leagueOnly}`);
  console.log(`  team only:          ${teamOnly}`);
  console.log(`  distinct people:    ${leagueIds.size + teamOnly}`);
  console.log(`  overlap pct of team subs that are ALSO league: ${teamIds.size === 0 ? "—" : `${((both / teamIds.size) * 100).toFixed(1)}%`}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
