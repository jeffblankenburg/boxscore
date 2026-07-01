// Head-to-head hit rate comparison between two prediction_results
// model versions across the same graded games. Useful to answer "did
// the refit actually help?" after backfilling a new model version.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/compare-model-versions.ts v4-calibrated v5-empirical

import { supabaseAdmin } from "../lib/supabase";
import { ML_PLAY_THRESHOLD, NRFI_PLAY_THRESHOLD } from "../lib/sports/mlb/predictions";

type Row = {
  date: string; game_pk: number;
  away_win_pct: number; home_win_pct: number; nrfi_pct: number;
  actual_winner: "away" | "home" | null; actual_nrfi: boolean | null;
  win_correct: boolean | null; nrfi_correct: boolean | null;
};

async function loadPaginated(modelVersion: string): Promise<Row[]> {
  const sb = supabaseAdmin();
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("prediction_results")
      .select("date, game_pk, away_win_pct, home_win_pct, nrfi_pct, actual_winner, actual_nrfi, win_correct, nrfi_correct")
      .eq("sport", "mlb").eq("model_version", modelVersion)
      .range(from, from + 999);
    if (error || !data) return rows;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) return rows;
  }
}

function tally(rows: Row[]) {
  let mlPlays = 0, mlHits = 0, mlHomeHits = 0, mlHomePlays = 0, mlAwayHits = 0, mlAwayPlays = 0;
  let nrfiPlays = 0, nrfiHits = 0, yrfiPlays = 0, yrfiHits = 0;
  for (const r of rows) {
    if (r.win_correct !== null && r.actual_winner !== null) {
      const a = +r.away_win_pct, h = +r.home_win_pct;
      let picked: "away" | "home" | null = null;
      if (a >= ML_PLAY_THRESHOLD) picked = "away";
      else if (h >= ML_PLAY_THRESHOLD) picked = "home";
      if (picked) {
        mlPlays++;
        const won = picked === r.actual_winner;
        if (won) mlHits++;
        if (picked === "home") { mlHomePlays++; if (won) mlHomeHits++; }
        else { mlAwayPlays++; if (won) mlAwayHits++; }
      }
    }
    if (r.nrfi_correct !== null && r.actual_nrfi !== null) {
      const p = +r.nrfi_pct;
      if (p >= NRFI_PLAY_THRESHOLD) {
        nrfiPlays++;
        if (r.actual_nrfi) nrfiHits++;
      } else if (p <= 1 - NRFI_PLAY_THRESHOLD) {
        yrfiPlays++;
        if (!r.actual_nrfi) yrfiHits++;
      }
    }
  }
  return { mlPlays, mlHits, mlHomePlays, mlHomeHits, mlAwayPlays, mlAwayHits, nrfiPlays, nrfiHits, yrfiPlays, yrfiHits };
}

function pct(hit: number, plays: number): string {
  return plays === 0 ? "—" : `${(hit / plays * 100).toFixed(1)}%`;
}

async function main() {
  const [, , vA = "v4-calibrated", vB = "v5-empirical"] = process.argv;
  const [rowsA, rowsB] = await Promise.all([loadPaginated(vA), loadPaginated(vB)]);
  console.log(`${vA}: ${rowsA.length} rows`);
  console.log(`${vB}: ${rowsB.length} rows\n`);

  const a = tally(rowsA);
  const b = tally(rowsB);

  console.log(`${"metric".padEnd(28)} ${vA.padEnd(20)} ${vB.padEnd(20)}`);
  console.log(`${"─".repeat(28)} ${"─".repeat(20)} ${"─".repeat(20)}`);
  const fmt = (hit: number, plays: number) => `${pct(hit, plays)}  (${hit}/${plays})`;
  console.log(`${"ML plays".padEnd(28)} ${fmt(a.mlHits, a.mlPlays).padEnd(20)} ${fmt(b.mlHits, b.mlPlays)}`);
  console.log(`${"  home picks".padEnd(28)} ${fmt(a.mlHomeHits, a.mlHomePlays).padEnd(20)} ${fmt(b.mlHomeHits, b.mlHomePlays)}`);
  console.log(`${"  away picks".padEnd(28)} ${fmt(a.mlAwayHits, a.mlAwayPlays).padEnd(20)} ${fmt(b.mlAwayHits, b.mlAwayPlays)}`);
  console.log(`${"NRFI plays".padEnd(28)} ${fmt(a.nrfiHits, a.nrfiPlays).padEnd(20)} ${fmt(b.nrfiHits, b.nrfiPlays)}`);
  console.log(`${"YRFI plays".padEnd(28)} ${fmt(a.yrfiHits, a.yrfiPlays).padEnd(20)} ${fmt(b.yrfiHits, b.yrfiPlays)}`);

  const totalA = a.mlPlays + a.nrfiPlays + a.yrfiPlays;
  const hitsA = a.mlHits + a.nrfiHits + a.yrfiHits;
  const totalB = b.mlPlays + b.nrfiPlays + b.yrfiPlays;
  const hitsB = b.mlHits + b.nrfiHits + b.yrfiHits;
  console.log(`${"ALL plays".padEnd(28)} ${fmt(hitsA, totalA).padEnd(20)} ${fmt(hitsB, totalB)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
