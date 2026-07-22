// One-off diagnostic (2026-07-22): does NRFI-play quality improve with
// confidence? Buckets graded NRFI/YRFI plays by calibrated nrfi_pct and
// reports hit rate + flat-stake ROI using FanDuel NRFI/YRFI closing-ish
// odds (daily_odds_first), mirroring loadPlayRoi's join. Informs whether
// the premium product should be "all plays >=.545" or a tighter tier.
// Run: npx tsx --env-file=.env.local scripts/nrfi-roi-by-bucket.ts [days]

import { supabaseAdmin } from "@/lib/supabase";
import { NRFI_PLAY_THRESHOLD } from "@/lib/sports/mlb/predictions";
import { americanToProfitMultiplier } from "@/lib/sports/mlb/predictions-history";
import { PREDICTIONS_MODEL_VERSION } from "@/lib/sports/mlb/predictions-data";

const DAYS = Number(process.argv[2] ?? 30);
const STAKE = 10;

function isoDaysAgo(base: Date, n: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

type Res = { date: string; game_pk: number; nrfi_pct: number; status: string; actual_nrfi: boolean | null };
type Odds = { date: string; game_pk: number; nrfi_odds: number | null; yrfi_odds: number | null };

// Buckets keyed by distance/side. NRFI side only shown split; YRFI lumped.
const BANDS = [
  { key: ".545-.575", lo: 0.545, hi: 0.575 },
  { key: ".575-.60", lo: 0.575, hi: 0.60 },
  { key: ".60-.65", lo: 0.60, hi: 0.65 },
  { key: ">=.65", lo: 0.65, hi: 1.01 },
];

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

  const [res, odds] = await Promise.all([
    pageAll<Res>((f, t) => sb.from("prediction_results")
      .select("date,game_pk,nrfi_pct,status,actual_nrfi")
      .eq("sport", "mlb").eq("model_version", PREDICTIONS_MODEL_VERSION).gte("date", since).lte("date", until).range(f, t)),
    pageAll<Odds>((f, t) => sb.from("daily_odds_first")
      .select("date,game_pk,nrfi_odds,yrfi_odds")
      .eq("sport", "mlb").eq("book", "FanDuel").gte("date", since).lte("date", until).range(f, t)),
  ]);

  const oddsByKey = new Map<string, Odds>();
  for (const o of odds) oddsByKey.set(`${o.date}|${o.game_pk}`, o);

  const graded = res.filter((r) => /final/i.test(r.status) && r.actual_nrfi !== null && r.nrfi_pct != null);

  type Tally = { plays: number; hits: number; withOdds: number; staked: number; profit: number };
  const mk = (): Tally => ({ plays: 0, hits: 0, withOdds: 0, staked: 0, profit: 0 });
  const bands = new Map<string, Tally>(BANDS.map((b) => [b.key, mk()]));
  const yrfi = mk();

  const grade = (t: Tally, hit: boolean, odds: number | null) => {
    t.plays++;
    if (hit) t.hits++;
    if (odds == null) return;
    t.withOdds++;
    t.staked += STAKE;
    t.profit += hit ? STAKE * americanToProfitMultiplier(odds) : -STAKE;
  };

  for (const r of graded) {
    const p = r.nrfi_pct;
    const o = oddsByKey.get(`${r.date}|${r.game_pk}`);
    if (p >= NRFI_PLAY_THRESHOLD) {
      const band = BANDS.find((b) => p >= b.lo && p < b.hi);
      if (band) grade(bands.get(band.key)!, r.actual_nrfi === true, o?.nrfi_odds ?? null);
    } else if (p <= 1 - NRFI_PLAY_THRESHOLD) {
      grade(yrfi, r.actual_nrfi === false, o?.yrfi_odds ?? null);
    }
  }

  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "—");
  const roi = (t: Tally) => (t.staked ? ((100 * t.profit) / t.staked).toFixed(1) + "%" : "—");

  console.log(`\nNRFI ROI by confidence — mlb, ${since} → ${until} (${graded.length} graded games)`);
  console.log(`Flat $${STAKE}, FanDuel NRFI/YRFI odds. ROI = profit / staked.\n`);
  console.log(`  band        plays  hit     w/odds  ROI      profit`);
  const cum = mk();
  for (const b of BANDS) {
    const t = bands.get(b.key)!;
    cum.plays += t.plays; cum.hits += t.hits; cum.withOdds += t.withOdds; cum.staked += t.staked; cum.profit += t.profit;
    console.log(`  NRFI ${b.key.padEnd(8)} ${String(t.plays).padStart(4)}  ${pct(t.hits, t.plays).padStart(6)}  ${String(t.withOdds).padStart(5)}  ${roi(t).padStart(7)}  $${t.profit.toFixed(0)}`);
  }
  console.log(`  ${"─".repeat(52)}`);
  console.log(`  NRFI all       ${String(cum.plays).padStart(4)}  ${pct(cum.hits, cum.plays).padStart(6)}  ${String(cum.withOdds).padStart(5)}  ${roi(cum).padStart(7)}  $${cum.profit.toFixed(0)}`);
  console.log(`  YRFI all       ${String(yrfi.plays).padStart(4)}  ${pct(yrfi.hits, yrfi.plays).padStart(6)}  ${String(yrfi.withOdds).padStart(5)}  ${roi(yrfi).padStart(7)}  $${yrfi.profit.toFixed(0)}`);
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
