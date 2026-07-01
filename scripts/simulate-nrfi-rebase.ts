// Simulate what NRFI plays would look like if we rebased BASELINE_NRFI
// from 0.57 (assumed) to 0.49 (2026 empirical). No DB writes — this
// runs the same model per historical date, in memory, and compares
// hit rates against actuals from prediction_results.
//
// Usage: npx tsx --env-file=.env.local scripts/simulate-nrfi-rebase.ts

import { supabaseAdmin } from "../lib/supabase";
import { loadPredictionsForDate, PREDICTIONS_MODEL_VERSION } from "../lib/sports/mlb/predictions-data";
import {
  NRFI_PLAY_THRESHOLD,
  NRFI_STRONG_THRESHOLD,
} from "../lib/sports/mlb/predictions";

// Sweep both rebased BASELINE and looser NRFI_SHRINKAGE simultaneously.
// Rebase alone (shrinkage 0.15) can't produce plays because the shrinkage
// compresses everything back near 0.50. So we relax shrinkage — but not
// so far that YRFI-side threshold becomes trivially cleared. Grid search.
const OLD_BASELINE = 0.57;
const CANDIDATES = [
  { baseline: 0.57, shrinkage: 0.15 },  // current (baseline for comparison)
  { baseline: 0.49, shrinkage: 0.20 },
  { baseline: 0.49, shrinkage: 0.25 },
  { baseline: 0.49, shrinkage: 0.30 },
  { baseline: 0.49, shrinkage: 0.35 },
  { baseline: 0.52, shrinkage: 0.25 },
  { baseline: 0.52, shrinkage: 0.30 },
];

async function main() {
  const sb = supabaseAdmin();

  // Pull all v4 graded outcomes so we can grade the simulation.
  async function paginated<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build(from, from + 999);
      if (error || !Array.isArray(data)) return rows;
      const chunk = data as T[];
      rows.push(...chunk);
      if (chunk.length < 1000) return rows;
    }
  }
  type Row = {
    date: string; game_pk: number;
    nrfi_pct: number;
    actual_nrfi: boolean | null;
  };
  const graded = await paginated<Row>((from, to) => sb.from("prediction_results")
    .select("date, game_pk, nrfi_pct, actual_nrfi")
    .eq("sport", "mlb").eq("model_version", PREDICTIONS_MODEL_VERSION)
    .range(from, to));
  console.log(`Loaded ${graded.length} v4 graded rows.\n`);

  const pct = (h: number, p: number) => p ? `${(h/p*100).toFixed(1)}%` : "—";

  console.log(`${"baseline".padEnd(10)} ${"shrink".padEnd(8)} ${"NRFI plays".padEnd(14)} ${"YRFI plays".padEnd(14)} ${"combined".padEnd(14)}`);
  console.log("─".repeat(70));

  for (const cfg of CANDIDATES) {
    const RATIO = cfg.baseline / OLD_BASELINE;
    let nrfi = { plays: 0, hits: 0 };
    let yrfi = { plays: 0, hits: 0 };
    for (const r of graded) {
      if (r.actual_nrfi === null) continue;
      const pCalOld = Number(r.nrfi_pct);
      const pRawOld = 0.5 + (pCalOld - 0.5) / 0.15;
      const pRawNew = pRawOld * RATIO;
      const pRawNewClamped = Math.max(0.30, Math.min(0.80, pRawNew));
      const pCalNew = 0.5 + cfg.shrinkage * (pRawNewClamped - 0.5);

      if (pCalNew >= NRFI_PLAY_THRESHOLD) {
        nrfi.plays++;
        if (r.actual_nrfi) nrfi.hits++;
      } else if (pCalNew <= 1 - NRFI_PLAY_THRESHOLD) {
        yrfi.plays++;
        if (!r.actual_nrfi) yrfi.hits++;
      }
    }
    const nrfiRate = pct(nrfi.hits, nrfi.plays);
    const yrfiRate = pct(yrfi.hits, yrfi.plays);
    const combined = nrfi.plays + yrfi.plays;
    const combinedHits = nrfi.hits + yrfi.hits;
    const combinedRate = pct(combinedHits, combined);
    console.log(`${cfg.baseline.toFixed(2).padEnd(10)} ${cfg.shrinkage.toFixed(2).padEnd(8)} ${`${nrfi.hits}/${nrfi.plays} ${nrfiRate}`.padEnd(14)} ${`${yrfi.hits}/${yrfi.plays} ${yrfiRate}`.padEnd(14)} ${`${combinedHits}/${combined} ${combinedRate}`.padEnd(14)}`);
  }
  void NRFI_STRONG_THRESHOLD;
}

main().catch((e) => { console.error(e); process.exit(1); });
