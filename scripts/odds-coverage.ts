// One-off diagnostic (2026-07-22): quantify NRFI odds coverage. The ROI
// backtest could only price 23% of NRFI plays. Is it that FanDuel NRFI
// odds are never captured, or just absent from the "opening" (_first)
// view but present in later daily_odds captures?
// Run: npx tsx --env-file=.env.local scripts/odds-coverage.ts [days]

import { supabaseAdmin } from "@/lib/supabase";

const DAYS = Number(process.argv[2] ?? 30);
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
  const since = isoDaysAgo(today, DAYS);
  const until = isoDaysAgo(today, 1);

  const games = await pageAll<{ date: string; game_pk: number }>((f, t) =>
    sb.from("prediction_results").select("date,game_pk").eq("sport", "mlb")
      .gte("date", since).lte("date", until).range(f, t));
  const gameKeys = new Set(games.map((g) => `${g.date}|${g.game_pk}`));

  // daily_odds_first (opening view) — FanDuel NRFI + DraftKings ML
  const first = await pageAll<{ date: string; game_pk: number; book: string; nrfi_odds: number | null; home_ml_odds: number | null }>((f, t) =>
    sb.from("daily_odds_first").select("date,game_pk,book,nrfi_odds,home_ml_odds")
      .eq("sport", "mlb").in("book", ["FanDuel", "DraftKings"]).gte("date", since).lte("date", until).range(f, t));

  // daily_odds (ALL captures) — FanDuel NRFI, any capture non-null
  const allCap = await pageAll<{ date: string; game_pk: number; book: string; nrfi_odds: number | null }>((f, t) =>
    sb.from("daily_odds").select("date,game_pk,book,nrfi_odds")
      .eq("sport", "mlb").eq("book", "FanDuel").gte("date", since).lte("date", until).range(f, t));

  const fdNrfiFirst = new Set<string>();
  const dkMlFirst = new Set<string>();
  for (const o of first) {
    const k = `${o.date}|${o.game_pk}`;
    if (o.book === "FanDuel" && o.nrfi_odds != null) fdNrfiFirst.add(k);
    if (o.book === "DraftKings" && o.home_ml_odds != null) dkMlFirst.add(k);
  }
  const fdNrfiEver = new Set<string>();
  for (const o of allCap) if (o.nrfi_odds != null) fdNrfiEver.add(`${o.date}|${o.game_pk}`);

  const n = gameKeys.size;
  const pct = (s: Set<string>) => `${s.size}/${n} (${((100 * s.size) / n).toFixed(1)}%)`;
  console.log(`\nOdds coverage — mlb, ${since} → ${until}, ${n} graded games\n`);
  console.log(`  DraftKings ML   (daily_odds_first): ${pct(dkMlFirst)}`);
  console.log(`  FanDuel NRFI    (daily_odds_first): ${pct(fdNrfiFirst)}   <- what the ROI backtest reads`);
  console.log(`  FanDuel NRFI    (daily_odds, EVER): ${pct(fdNrfiEver)}   <- any capture during the day`);
  console.log("");

  // If EVER >> FIRST, NRFI markets post late and the opening view misses them.
  const lateOnly = [...fdNrfiEver].filter((k) => !fdNrfiFirst.has(k)).length;
  console.log(`  Games with NRFI odds later-but-not-in-opening: ${lateOnly}`);
  console.log("");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
