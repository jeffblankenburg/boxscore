// Full-season A/B: v6 (shipped) vs v7 at DEFAULT_V7_CONFIG, in-sample over
// the whole year at the v6 play thresholds. Quick "raw engine vs v6"
// sanity check; the authoritative fitted/walk-forward/recommendation
// evaluation is scripts/fit-v7.ts. Both share scripts/_v7-eval.ts.
//
//   npx tsx --env-file=.env.local scripts/backtest-v7.ts [YEAR]

import { loadEvalGames } from "./_v7-eval";
import { DEFAULT_V7_CONFIG, deriveMarkets } from "@/lib/sports/mlb/run-model";
import { ML_PLAY_THRESHOLD, NRFI_PLAY_THRESHOLD, mlOddsInPlayableRange } from "@/lib/sports/mlb/predictions";
import { americanToProfitMultiplier } from "@/lib/sports/mlb/predictions-history";

const YEAR = process.argv[2] ?? "2026";
const STAKE = 10;
const cfg = DEFAULT_V7_CONFIG;

type Tally = { favC: number; favN: number; brier: number; plays: number; hits: number; staked: number; profit: number };
const mk = (): Tally => ({ favC: 0, favN: 0, brier: 0, plays: 0, hits: 0, staked: 0, profit: 0 });
function gradeMl(t: Tally, p: number, actual: "away" | "home", odds: number | null) {
  t.favN++; if ((p >= 0.5) === (actual === "home")) t.favC++; t.brier += (p - (actual === "home" ? 1 : 0)) ** 2;
  if (p >= ML_PLAY_THRESHOLD && mlOddsInPlayableRange(odds)) {
    t.plays++; const win = actual === "home"; if (win) t.hits++;
    if (odds != null) { t.staked += STAKE; t.profit += win ? STAKE * americanToProfitMultiplier(odds) : -STAKE; }
  }
}
function gradeNrfi(t: Tally, p: number, actual: boolean, nOdds: number | null, yOdds: number | null) {
  t.favN++; if ((p >= 0.5) === actual) t.favC++; t.brier += (p - (actual ? 1 : 0)) ** 2;
  let pick: boolean | null = null;
  if (p >= NRFI_PLAY_THRESHOLD) pick = true; else if (p <= 1 - NRFI_PLAY_THRESHOLD) pick = false;
  if (pick !== null) {
    t.plays++; const win = pick === actual; if (win) t.hits++;
    const odds = pick ? nOdds : yOdds;
    if (odds != null) { t.staked += STAKE; t.profit += win ? STAKE * americanToProfitMultiplier(odds) : -STAKE; }
  }
}
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "—");
const roi = (t: Tally) => (t.staked ? ((100 * t.profit) / t.staked).toFixed(1) + "%" : "—");
const line = (label: string, t: Tally) =>
  `  ${label.padEnd(14)} favAcc ${pct(t.favC, t.favN).padStart(6)}  Brier ${(t.brier / t.favN).toFixed(4)}  |  plays ${String(t.plays).padStart(4)}  hit ${pct(t.hits, t.plays).padStart(6)}  ROI ${roi(t).padStart(7)}`;

async function main() {
  console.log(`\nLoading ${YEAR} eval games…`);
  const games = await loadEvalGames(YEAR);
  const faith = games.reduce((s, g) => s + Math.abs(g.reV6HomeWin - g.v6HomeWin), 0) / games.length;

  const v6 = { ml: mk(), nrfi: mk() }, v7 = { ml: mk(), nrfi: mk() };
  let nan = 0;
  for (const g of games) {
    gradeMl(v6.ml, g.v6HomeWin, g.actualWinner, g.mlHomeOdds);
    gradeNrfi(v6.nrfi, g.v6Nrfi, g.actualNrfi, g.nrfiOdds, g.yrfiOdds);
    const m = deriveMarkets(g.away, g.home, cfg);
    if (!Number.isFinite(m.homeWin) || !Number.isFinite(m.nrfi)) { nan++; continue; }
    gradeMl(v7.ml, m.homeWin, g.actualWinner, g.mlHomeOdds);
    gradeNrfi(v7.nrfi, m.nrfi, g.actualNrfi, g.nrfiOdds, g.yrfiOdds);
  }

  console.log(`\n═══ ${YEAR} full-season, v7 PRE-FIT @ v6 thresholds — ${games.length} games (${nan} v7 NaN) ═══`);
  console.log(`  reconstruction faithfulness: mean |Δ home_win_pct| = ${faith.toFixed(5)} (near 0 ⇒ trustworthy)`);
  console.log(`\nMONEYLINE`);
  console.log(line("v6", v6.ml));
  console.log(line("v7 (pre-fit)", v7.ml));
  console.log(`\nNRFI`);
  console.log(line("v6", v6.nrfi));
  console.log(line("v7 (pre-fit)", v7.nrfi));
  console.log(`\n(Fitted walk-forward + recommendation-set numbers: scripts/fit-v7.ts)\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
