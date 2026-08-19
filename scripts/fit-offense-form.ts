// Fitting script for v7.2's offense recent-form blend weight
// (V72_OFFENSE_RECENT_WEIGHT), run 2026-08-19.
//
// ◑ VERDICT: wOff=0.5, wSp=0. Blending the 21-day team RS/g into the offense
// rate at 0.5 lifts ML directional accuracy in BOTH halves of 2026 (pre-
// 2026-07-31-deadline 58.4%→58.8%, post 51.4%→54.1%), improves post-deadline
// log-loss, and costs ~nothing pre-deadline (log-loss Δ +0.0002). The August
// pick-flips it induces are 71% correct — it specifically un-picks the
// stale-roster underdogs that tanked v7.1's win rate after the deadline. SP
// recent form stays OFF: every wSp>0 row lowers accuracy and raises log-loss,
// re-confirming fit-input-blends.ts's finding that 2-5 starts of ERA is noise.
//
// WHY the prior walk-forward fit (fit-input-blends.ts) missed this: it selects
// on combined ML+NRFI log-loss, where wOff's accuracy gain is invisible
// (recent form slightly softens confident-but-correct picks). For a picks
// product graded on win rate, that's the wrong objective in the roster-churn
// regime. Note fit-input-blends's May fold DID pick wOff=0.5 — recent offense
// helps precisely when season RPG is an unreliable estimate of the current
// roster (early season AND post-deadline). A fixed 0.5 captures both.
//
// Method: holds cfg at the SHIPPED V7_CONFIG and sweeps the two blend weights,
// reporting ML directional accuracy + log-loss split pre/post 2026-08-01, plus
// how many post-deadline picks flip vs the shipped model and how many of those
// flips are correct. This is the mechanism test, not a walk-forward refit:
// the safety case is that a nonzero wOff lifts August without hurting the
// 1,600-game pre-deadline set.
//
//   npx tsx --env-file=.env.local scripts/fit-offense-form.ts

import { loadEvalGames, logLoss, type EvalGame, type SideRaw } from "./_v7-eval";
import { deriveMarkets, offenseFromRunsPerGame, pitcherFromRA9, bullpenFromRA9, type TeamInputs } from "@/lib/sports/mlb/run-model";
import { ERA_TO_RA9, V7_CONFIG } from "@/lib/sports/mlb/predictions-v7";

const CUTOFF = "2026-08-01"; // trade deadline was 2026-07-31
const GRID_WOFF = [0, 0.25, 0.5, 0.75, 1.0];
const GRID_WSP = [0, 0.25, 0.5, 0.75, 1.0];

function toInputs(r: SideRaw, wOff: number, wSp: number): TeamInputs {
  const spEra = r.spRecentEra !== null ? wSp * r.spRecentEra + (1 - wSp) * r.spSeasonEra : r.spSeasonEra;
  const rpg = r.recentRpg !== null ? wOff * r.recentRpg + (1 - wOff) * r.seasonRpg : r.seasonRpg;
  return {
    offense: offenseFromRunsPerGame(rpg),
    starter: pitcherFromRA9(spEra * ERA_TO_RA9, r.spRecentIpPerStart ?? 5.3),
    bullpen: bullpenFromRA9(r.bpEra * ERA_TO_RA9),
    parkLogFactor: r.parkLogFactor,
  };
}

function homeWinProb(g: EvalGame, wOff: number, wSp: number): number | null {
  const m = deriveMarkets(toInputs(g.awayRaw, wOff, wSp), toInputs(g.homeRaw, wOff, wSp), V7_CONFIG);
  return Number.isFinite(m.homeWin) ? m.homeWin : null;
}

type Bucket = { n: number; correct: number; loss: number };
const mk = (): Bucket => ({ n: 0, correct: 0, loss: 0 });
function add(b: Bucket, p: number, g: EvalGame) {
  b.n++;
  const pickHome = p >= 0.5;
  if ((pickHome ? "home" : "away") === g.actualWinner) b.correct++;
  b.loss += logLoss(p, g.actualWinner === "home");
}
const acc = (b: Bucket) => (b.n ? b.correct / b.n : 0);
const ll = (b: Bucket) => (b.n ? b.loss / b.n : 0);

async function main() {
  console.log(`\nLoading 2026 eval games…`);
  const games = await loadEvalGames("2026");
  const pre = games.filter((g) => g.date < CUTOFF);
  const post = games.filter((g) => g.date >= CUTOFF);
  console.log(`  ${games.length} games (${pre.length} pre-${CUTOFF}, ${post.length} post).`);

  // Recent-form coverage — if the aggregates rarely populate recentRpg /
  // spRecentEra, blending can't do anything.
  const cov = (gs: EvalGame[], f: (r: SideRaw) => boolean) =>
    (gs.flatMap((g) => [g.awayRaw, g.homeRaw]).filter(f).length / (gs.length * 2));
  console.log(`  recentRpg present: pre ${(cov(pre, (r) => r.recentRpg !== null) * 100).toFixed(0)}%  post ${(cov(post, (r) => r.recentRpg !== null) * 100).toFixed(0)}%`);
  console.log(`  spRecentEra present: pre ${(cov(pre, (r) => r.spRecentEra !== null) * 100).toFixed(0)}%  post ${(cov(post, (r) => r.spRecentEra !== null) * 100).toFixed(0)}%`);

  // Baseline (shipped v7.1): wOff=0, wSp=0.
  const baseHome = new Map<number, number>();
  for (const g of games) { const p = homeWinProb(g, 0, 0); if (p !== null) baseHome.set(g.gamePk, p); }

  console.log(`\n  cfg held at shipped V7_CONFIG (betaOff=${V7_CONFIG.betaOff}, betaPitch=${V7_CONFIG.betaPitch}, hfa=${V7_CONFIG.hfaMultiplier})`);
  console.log(`\n  wOff  wSp | PRE  n   acc%   ll   | POST n   acc%   ll   | POST flips (→correct)`);
  console.log(`  ----------+---------------------+---------------------+----------------------`);
  for (const wOff of GRID_WOFF) for (const wSp of GRID_WSP) {
    const bpre = mk(), bpost = mk();
    let flips = 0, flipsToCorrect = 0;
    for (const g of pre) { const p = homeWinProb(g, wOff, wSp); if (p !== null) add(bpre, p, g); }
    for (const g of post) {
      const p = homeWinProb(g, wOff, wSp);
      if (p === null) continue;
      add(bpost, p, g);
      const base = baseHome.get(g.gamePk);
      if (base !== undefined && (p >= 0.5) !== (base >= 0.5)) {
        flips++;
        if ((p >= 0.5 ? "home" : "away") === g.actualWinner) flipsToCorrect++;
      }
    }
    const tag = wOff === 0 && wSp === 0 ? " ← shipped" : "";
    console.log(
      `  ${wOff.toFixed(2)} ${wSp.toFixed(2)} | ` +
      `${String(bpre.n).padStart(4)} ${(acc(bpre) * 100).toFixed(1)} ${ll(bpre).toFixed(4)} | ` +
      `${String(bpost.n).padStart(4)} ${(acc(bpost) * 100).toFixed(1)} ${ll(bpost).toFixed(4)} | ` +
      `${String(flips).padStart(4)} (${flipsToCorrect} correct, ${flips ? ((flipsToCorrect / flips) * 100).toFixed(0) : "0"}%)${tag}`,
    );
  }
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
