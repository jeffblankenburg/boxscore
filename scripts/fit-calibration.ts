// Fit a linear shrinkage k such that calibrated_p = 0.5 + k*(raw_p - 0.5)
// minimizes Brier loss against the actual outcomes recorded in
// prediction_results. Reads the most recent model version's rows.
// Run: npx tsx --env-file=.env.local scripts/fit-calibration.ts

import { supabaseAdmin } from "../lib/supabase";
import { PREDICTIONS_MODEL_VERSION } from "../lib/sports/mlb/predictions-data";

type Row = {
  home_win_pct: string | number;
  away_win_pct: string | number;
  nrfi_pct: string | number;
  actual_winner: "away" | "home" | null;
  actual_nrfi: boolean | null;
};

function fitShrinkage(rawProbs: number[], outcomes: number[]): number {
  // Closed-form least-squares for p_cal = 0.5 + k*(p - 0.5):
  //   k = sum_i (p_i - 0.5)*(y_i - 0.5) / sum_i (p_i - 0.5)^2
  let num = 0, den = 0;
  for (let i = 0; i < rawProbs.length; i++) {
    const x = rawProbs[i]! - 0.5;
    const y = outcomes[i]! - 0.5;
    num += x * y;
    den += x * x;
  }
  return den === 0 ? 1 : num / den;
}

function brier(probs: number[], outcomes: number[]): number {
  let s = 0;
  for (let i = 0; i < probs.length; i++) s += (probs[i]! - outcomes[i]!) ** 2;
  return s / probs.length;
}

function calibrationBuckets(probs: number[], outcomes: number[], edges = [0.45, 0.55, 0.60, 0.65, 0.70, 1.0]) {
  // For each bucket [edge[i-1], edge[i]), report sample size and hit rate.
  const buckets: Array<{ lo: number; hi: number; n: number; hits: number }> = [];
  let prev = 0;
  for (const e of edges) {
    buckets.push({ lo: prev, hi: e, n: 0, hits: 0 });
    prev = e;
  }
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i]!;
    for (const b of buckets) {
      if (p >= b.lo && p < b.hi) {
        b.n++;
        b.hits += outcomes[i]!;
        break;
      }
    }
  }
  return buckets;
}

async function main() {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("prediction_results")
    .select("home_win_pct, away_win_pct, nrfi_pct, actual_winner, actual_nrfi")
    .eq("sport", "mlb")
    .eq("model_version", PREDICTIONS_MODEL_VERSION);
  if (error) throw error;
  const rows = ((data ?? []) as unknown) as Row[];
  console.log(`Read ${rows.length} rows from prediction_results for ${PREDICTIONS_MODEL_VERSION}\n`);

  // ─── Win calibration ─────────────────────────────────────────────────
  // Treat raw_p = home_win_pct, outcome y = 1 if home won, 0 if away won.
  // Skip games with no decision (postponed, etc.).
  const winRaw: number[] = [];
  const winY:   number[] = [];
  for (const r of rows) {
    if (r.actual_winner === null) continue;
    winRaw.push(Number(r.home_win_pct));
    winY.push(r.actual_winner === "home" ? 1 : 0);
  }
  const kWin = fitShrinkage(winRaw, winY);
  const winCalibrated = winRaw.map((p) => 0.5 + kWin * (p - 0.5));
  const brierRawWin = brier(winRaw, winY);
  const brierCalWin = brier(winCalibrated, winY);
  console.log(`WIN calibration  (${winRaw.length} graded games):`);
  console.log(`  fitted k = ${kWin.toFixed(4)}`);
  console.log(`  Brier raw   = ${brierRawWin.toFixed(4)}`);
  console.log(`  Brier cal   = ${brierCalWin.toFixed(4)}   delta ${(brierCalWin - brierRawWin).toFixed(4)}`);
  console.log(`  Raw calibration buckets (home_win_pct → home win rate):`);
  for (const b of calibrationBuckets(winRaw, winY)) {
    if (b.n === 0) continue;
    const rate = b.hits / b.n;
    console.log(`    [${b.lo.toFixed(2)}, ${b.hi.toFixed(2)})  n=${String(b.n).padStart(3)}  hit ${(rate*100).toFixed(1)}%`);
  }

  // ─── NRFI calibration ────────────────────────────────────────────────
  const nrfiRaw: number[] = [];
  const nrfiY:   number[] = [];
  for (const r of rows) {
    if (r.actual_nrfi === null) continue;
    nrfiRaw.push(Number(r.nrfi_pct));
    nrfiY.push(r.actual_nrfi ? 1 : 0);
  }
  const kNrfi = fitShrinkage(nrfiRaw, nrfiY);
  const nrfiCalibrated = nrfiRaw.map((p) => 0.5 + kNrfi * (p - 0.5));
  const brierRawNrfi = brier(nrfiRaw, nrfiY);
  const brierCalNrfi = brier(nrfiCalibrated, nrfiY);
  console.log(`\nNRFI calibration  (${nrfiRaw.length} graded games):`);
  console.log(`  fitted k = ${kNrfi.toFixed(4)}`);
  console.log(`  Brier raw   = ${brierRawNrfi.toFixed(4)}`);
  console.log(`  Brier cal   = ${brierCalNrfi.toFixed(4)}   delta ${(brierCalNrfi - brierRawNrfi).toFixed(4)}`);
  console.log(`  Raw calibration buckets (nrfi_pct → actual NRFI rate):`);
  for (const b of calibrationBuckets(nrfiRaw, nrfiY)) {
    if (b.n === 0) continue;
    const rate = b.hits / b.n;
    console.log(`    [${b.lo.toFixed(2)}, ${b.hi.toFixed(2)})  n=${String(b.n).padStart(3)}  hit ${(rate*100).toFixed(1)}%`);
  }

  // ─── Implication for plays ───────────────────────────────────────────
  // What does the 60% threshold mean post-calibration?
  console.log(`\n─── Post-calibration play threshold implications ───`);
  const winRawForThreshold = (0.60 - 0.5) / kWin + 0.5;
  const nrfiRawForThreshold = (0.60 - 0.5) / kNrfi + 0.5;
  console.log(`  To clear a 60% calibrated WIN, raw model needs: ${(winRawForThreshold*100).toFixed(1)}%`);
  console.log(`  To clear a 60% calibrated NRFI, raw model needs: ${(nrfiRawForThreshold*100).toFixed(1)}%`);
}

main().catch((e) => { console.error(e); process.exit(1); });
