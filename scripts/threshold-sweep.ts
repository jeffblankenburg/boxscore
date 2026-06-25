// Sweep play thresholds against v4-calibrated predictions to see how
// hit rate vs play volume trades off — finds the threshold (if any)
// where the model actually hits 60%+.
// Run: npx tsx --env-file=.env.local scripts/threshold-sweep.ts

import { supabaseAdmin } from "../lib/supabase";
import { PREDICTIONS_MODEL_VERSION } from "../lib/sports/mlb/predictions-data";

type Row = {
  home_win_pct: string | number;
  away_win_pct: string | number;
  nrfi_pct: string | number;
  actual_winner: "away" | "home" | null;
  actual_nrfi: boolean | null;
};

async function main() {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("prediction_results")
    .select("home_win_pct, away_win_pct, nrfi_pct, actual_winner, actual_nrfi")
    .eq("sport", "mlb")
    .eq("model_version", PREDICTIONS_MODEL_VERSION);
  const rows = ((data ?? []) as unknown) as Row[];
  console.log(`Read ${rows.length} rows from ${PREDICTIONS_MODEL_VERSION}\n`);

  // ─── ML sweep ─────────────────────────────────────────────────────────
  // For each game, the play side is whichever team's win prob is highest.
  // Threshold filters whether the highest-prob side is high enough.
  type WinRow = { favPct: number; favSide: "away" | "home"; winner: "away" | "home" };
  const winRows: WinRow[] = [];
  for (const r of rows) {
    if (r.actual_winner === null) continue;
    const away = Number(r.away_win_pct), home = Number(r.home_win_pct);
    if (away > home) winRows.push({ favPct: away, favSide: "away", winner: r.actual_winner });
    else             winRows.push({ favPct: home, favSide: "home", winner: r.actual_winner });
  }
  console.log(`ML threshold sweep (calibrated favorite win prob):`);
  console.log(`  threshold   plays   hits    rate`);
  for (const t of [0.50, 0.51, 0.52, 0.53, 0.54, 0.545, 0.55, 0.555, 0.56, 0.57, 0.58]) {
    const eligible = winRows.filter((g) => g.favPct >= t);
    const hits = eligible.filter((g) => g.favSide === g.winner).length;
    const rate = eligible.length === 0 ? 0 : hits / eligible.length;
    console.log(`  ${t.toFixed(3)}        ${String(eligible.length).padStart(3)}      ${String(hits).padStart(2)}    ${(rate*100).toFixed(1)}%`);
  }

  // ─── NRFI sweep ───────────────────────────────────────────────────────
  // Play NRFI when prob >= t, play YRFI when prob <= 1-t. Tally both.
  type NrfiRow = { nrfi: number; actual: boolean };
  const nrfiRows: NrfiRow[] = [];
  for (const r of rows) {
    if (r.actual_nrfi === null) continue;
    nrfiRows.push({ nrfi: Number(r.nrfi_pct), actual: r.actual_nrfi });
  }
  console.log(`\nNRFI threshold sweep (calibrated NRFI prob — plays both sides):`);
  console.log(`  threshold   plays   hits    rate`);
  for (const t of [0.50, 0.51, 0.52, 0.53, 0.54, 0.545, 0.55, 0.555, 0.56, 0.57, 0.58]) {
    let plays = 0, hits = 0;
    for (const g of nrfiRows) {
      if (g.nrfi >= t) {
        plays++;
        if (g.actual) hits++;
      } else if (g.nrfi <= 1 - t) {
        plays++;
        if (!g.actual) hits++;
      }
    }
    const rate = plays === 0 ? 0 : hits / plays;
    console.log(`  ${t.toFixed(3)}        ${String(plays).padStart(3)}      ${String(hits).padStart(2)}    ${(rate*100).toFixed(1)}%`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
