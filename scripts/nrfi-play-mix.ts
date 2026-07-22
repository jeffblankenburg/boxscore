// One-off diagnostic (2026-07-22): are we recommending "a ton of NRFI"?
// Applies the live play rule (NRFI_PLAY_THRESHOLD, YRFI mirror) to graded
// prediction_results and reports the NRFI-vs-YRFI play mix + hit rates over
// a trailing window, plus the calibrated nrfi_pct distribution that drives it.
// Not part of the product; safe to delete. Run:
//   npx tsx --env-file=.env.local scripts/nrfi-play-mix.ts [days]

import { supabaseAdmin } from "@/lib/supabase";
import { NRFI_PLAY_THRESHOLD } from "@/lib/sports/mlb/predictions";
import { PREDICTIONS_MODEL_VERSION } from "@/lib/sports/mlb/predictions-data";

const DAYS = Number(process.argv[2] ?? 30);

function isoDaysAgo(base: Date, n: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

type Row = {
  date: string;
  nrfi_pct: number;
  status: string;
  actual_nrfi: boolean | null;
};

async function main() {
  const sb = supabaseAdmin();
  const today = new Date();
  const since = isoDaysAgo(today, DAYS);
  const until = isoDaysAgo(today, 1); // through yesterday (last graded day)

  // Paginate — a month of MLB can exceed the 1000-row silent cap.
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("prediction_results")
      .select("date,nrfi_pct,status,actual_nrfi")
      .eq("sport", "mlb")
      .eq("model_version", PREDICTIONS_MODEL_VERSION)
      .gte("date", since)
      .lte("date", until)
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  const graded = rows.filter(
    (r) => /final/i.test(r.status) && r.actual_nrfi !== null && r.nrfi_pct != null,
  );

  const days = new Set(graded.map((r) => r.date)).size;

  let nrfiPlays = 0, nrfiHits = 0;
  let yrfiPlays = 0, yrfiHits = 0;
  let noPlay = 0;
  // Distribution buckets for calibrated nrfi_pct.
  const buckets: Record<string, number> = {
    "<.40": 0, ".40-.45": 0, ".45-.50": 0, ".50-.545": 0, ".545-.60": 0, ".60-.65": 0, ">=.65": 0,
  };

  const bump = (k: string) => { buckets[k] = (buckets[k] ?? 0) + 1; };
  for (const r of graded) {
    const p = r.nrfi_pct;
    if (p < 0.4) bump("<.40");
    else if (p < 0.45) bump(".40-.45");
    else if (p < 0.5) bump(".45-.50");
    else if (p < NRFI_PLAY_THRESHOLD) bump(".50-.545");
    else if (p < 0.6) bump(".545-.60");
    else if (p < 0.65) bump(".60-.65");
    else bump(">=.65");

    if (p >= NRFI_PLAY_THRESHOLD) {
      nrfiPlays++;
      if (r.actual_nrfi === true) nrfiHits++;
    } else if (p <= 1 - NRFI_PLAY_THRESHOLD) {
      yrfiPlays++;
      if (r.actual_nrfi === false) yrfiHits++;
    } else {
      noPlay++;
    }
  }

  const totalPlays = nrfiPlays + yrfiPlays;
  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "—");
  const baseNrfi = graded.filter((r) => r.actual_nrfi === true).length;

  console.log(`\nNRFI play mix — mlb, ${since} → ${until} (${days} graded days, ${graded.length} games)\n`);
  console.log(`  Base NRFI rate (all games):   ${pct(baseNrfi, graded.length)}  (coin-flip anchor ~0.49)`);
  console.log(`  Play threshold:                NRFI p>=${NRFI_PLAY_THRESHOLD}, YRFI p<=${(1 - NRFI_PLAY_THRESHOLD).toFixed(3)}\n`);
  console.log(`  NRFI plays:  ${String(nrfiPlays).padStart(4)}  hit ${pct(nrfiHits, nrfiPlays)}  (${(nrfiPlays / days).toFixed(1)}/day)`);
  console.log(`  YRFI plays:  ${String(yrfiPlays).padStart(4)}  hit ${pct(yrfiHits, yrfiPlays)}  (${(yrfiPlays / days).toFixed(1)}/day)`);
  console.log(`  No play:     ${String(noPlay).padStart(4)}`);
  console.log(`  ─────`);
  console.log(`  Total plays: ${String(totalPlays).padStart(4)}  (${(totalPlays / days).toFixed(1)}/day)  hit ${pct(nrfiHits + yrfiHits, totalPlays)}`);
  console.log(`  NRFI share of plays: ${pct(nrfiPlays, totalPlays)}\n`);
  console.log(`  Calibrated nrfi_pct distribution:`);
  for (const [k, v] of Object.entries(buckets)) {
    console.log(`    ${k.padEnd(8)} ${String(v).padStart(4)}  ${pct(v, graded.length)}`);
  }
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
