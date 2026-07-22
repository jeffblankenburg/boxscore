// Diagnose the FanDuel NRFI odds gap (~39% of games uncovered). Partitions
// each scheduled game into: (a) has odds, (b) FanDuel row exists but market
// absent (matched, no "1st Inning 0.5 Runs"), (c) NO FanDuel row at all
// (team-name/event/date match miss in captureFanDuelNrfiForDate). The fix
// differs by bucket, so we need the split before touching the scraper.
//   npx tsx --env-file=.env.local scripts/nrfi-odds-gap.ts [days]

import { supabaseAdmin } from "@/lib/supabase";

const DAYS = Number(process.argv[2] ?? 45);
function isoDaysAgo(base: Date, n: number): string {
  const d = new Date(base); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10);
}
async function pageAll<T>(build: (f: number, t: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await build(f, f + 999);
    if (error) throw error;
    const chunk = (data as T[]) ?? [];
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return out;
}

async function main() {
  const sb = supabaseAdmin();
  const today = new Date();
  const since = isoDaysAgo(today, DAYS), until = isoDaysAgo(today, 1);

  const preds = await pageAll<{ date: string; game_pk: number }>((f, t) =>
    sb.from("daily_predictions").select("date,game_pk").eq("sport", "mlb")
      .gte("date", since).lte("date", until).range(f, t));
  const scheduled = new Map<string, boolean>();
  for (const p of preds) scheduled.set(`${p.date}|${p.game_pk}`, true);

  const fd = await pageAll<{ date: string; game_pk: number; nrfi_odds: number | null }>((f, t) =>
    sb.from("daily_odds").select("date,game_pk,nrfi_odds").eq("sport", "mlb").eq("book", "FanDuel")
      .gte("date", since).lte("date", until).range(f, t));
  const hasRow = new Set<string>(), hasOdds = new Set<string>();
  for (const r of fd) {
    const k = `${r.date}|${r.game_pk}`;
    hasRow.add(k);
    if (r.nrfi_odds != null) hasOdds.add(k);
  }

  let good = 0, rowNoMarket = 0, noRow = 0;
  for (const k of scheduled.keys()) {
    if (hasOdds.has(k)) good++;
    else if (hasRow.has(k)) rowNoMarket++;
    else noRow++;
  }
  const n = scheduled.size;
  const pct = (x: number) => `${x}/${n} (${((100 * x) / n).toFixed(1)}%)`;
  console.log(`\nFanDuel NRFI odds gap — mlb, ${since} → ${until}, ${n} scheduled games\n`);
  console.log(`  (a) has NRFI odds:                 ${pct(good)}`);
  console.log(`  (b) FanDuel row but NO market:     ${pct(rowNoMarket)}   ← matched, "1st Inning 0.5 Runs" absent/renamed`);
  console.log(`  (c) NO FanDuel row at all:         ${pct(noRow)}   ← team-name/event/date match miss (never inserted)`);
  console.log("");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
