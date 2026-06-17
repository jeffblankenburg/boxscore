// One-off: what do we actually know about WHERE our audience is, and how
// big is each team market? Three signals, each with its real sample size
// surfaced so nobody over-reads a thin one.
//
//   1. Survey demographics (subscribers.country/region/age/income/gender) —
//      gold standard, but only the subset who completed the welcome form.
//   2. Team-digest opt-ins per team — the addressable "local" markets.
//   3. Vercel web-analytics country mix — broad geo signal from site traffic
//      (NOT email subscribers, but a directional read).
//
// Run:
//   npx tsx --env-file=.env.local scripts/diag-audience-geography.ts

import { supabaseAdmin } from "../lib/supabase";

const PAGE = 1000;

async function fetchAll<T>(table: string, columns: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q: any = supabaseAdmin().from(table).select(columns);
    if (filter) q = filter(q);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

function tally<T>(rows: T[], key: (r: T) => string | null | undefined): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) ?? "(none)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function printTally(title: string, t: [string, number][], limit = 50) {
  console.log(`\n${title}`);
  for (const [k, n] of t.slice(0, limit)) {
    console.log(`  ${String(k).padEnd(22)} ${n}`);
  }
  if (t.length > limit) console.log(`  … ${t.length - limit} more`);
}

async function main() {
  // ---- 1. Survey demographics --------------------------------------------
  type Sub = {
    status: string;
    country: string | null;
    region: string | null;
    age_band: string | null;
    income_band: string | null;
    gender: string | null;
    demographics_completed_at: string | null;
  };
  const subs = await fetchAll<Sub>(
    "subscribers",
    "status, country, region, age_band, income_band, gender, demographics_completed_at",
    (q) => q.eq("status", "active"),
  );
  const completed = subs.filter((s) => s.demographics_completed_at);

  console.log("=== AUDIENCE GEOGRAPHY & DEMOGRAPHICS ===");
  console.log(`\nActive subscribers:               ${subs.length}`);
  console.log(`Completed demographic survey:     ${completed.length}  (${((completed.length / subs.length) * 100).toFixed(1)}% of active)`);
  console.log(`  → tiny sample: read directionally, do not quote as fact`);

  printTally("Survey — country (completed only):", tally(completed, (s) => s.country));
  printTally("Survey — region/state (completed only):", tally(completed.filter(s => s.country === "US" || s.region), (s) => s.region));
  printTally("Survey — age band:", tally(completed, (s) => s.age_band));
  printTally("Survey — income band:", tally(completed, (s) => s.income_band));
  printTally("Survey — gender:", tally(completed, (s) => s.gender));

  // ---- 2. Team-digest opt-ins per team -----------------------------------
  type OptIn = { sport: string; team_id: string | null };
  const teamOptIns = await fetchAll<OptIn>(
    "email_subscriptions",
    "sport, team_id",
    (q) => q.eq("scope", "team").eq("active", true),
  );
  const byTeam = tally(teamOptIns, (r) => `${r.sport}:${r.team_id}`);
  console.log(`\nTotal active team-digest opt-ins: ${teamOptIns.length}`);
  printTally("Team markets by opt-in count (sport:team_id):", byTeam, 40);

  // ---- 3. Vercel web-analytics country mix (last 90d) --------------------
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  type PV = { country: string | null };
  const pv = await fetchAll<PV>(
    "page_views",
    "country",
    (q) => q.eq("event_type", "pageview").eq("vercel_environment", "production").gte("occurred_at", since),
  );
  console.log(`\nWeb pageviews (production, last 90d): ${pv.length}`);
  printTally("Web traffic — country (last 90d):", tally(pv, (r) => r.country), 20);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
