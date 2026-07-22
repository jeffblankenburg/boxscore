// Validation harness for the v7 run-distribution engine (lib/sports/mlb/
// run-model.ts). No test framework in this repo — this is the executable
// spec: invariants that must hold, plus calibration checks against the
// league anchors from docs/predictions-v7/README.md.
//   npx tsx scripts/validate-run-model.ts

import {
  DEFAULT_V7_CONFIG,
  halfInningLambdas,
  scorelessProb,
  inningPmf,
  convolve,
  teamRunDistribution,
  deriveMarkets,
  offenseFromRunsPerGame,
  pitcherFromRA9,
  bullpenFromRA9,
  type TeamInputs,
  type V7Config,
} from "@/lib/sports/mlb/run-model";

let failures = 0;
function check(name: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "✓" : "✗ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!pass) failures++;
}
const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const sum = (v: number[]) => v.reduce((s, x) => s + x, 0);

const cfg = DEFAULT_V7_CONFIG;

// A league-average side: league offense, league starter, league bullpen,
// neutral park. RA9 4.30 ≈ league; 5.5 IP typical starter.
function leagueSide(): TeamInputs {
  return {
    offense: offenseFromRunsPerGame(4.53), // ≈ league R/G
    starter: pitcherFromRA9(4.30, 5.5),
    bullpen: bullpenFromRA9(4.30),
    parkLogFactor: 0,
  };
}

console.log("\n── PMF + distribution invariants ──");
{
  const pmf = inningPmf(cfg.leagueLambda, cfg.dispersion, cfg.maxRunsPerInning);
  check("inningPmf sums to 1", approx(sum(pmf), 1, 1e-12));
  check("inningPmf all non-negative", pmf.every((x) => x >= 0));

  // NB scoreless at league λ reproduces the ~72.6% anchor.
  const p0 = scorelessProb(cfg.leagueLambda, cfg.dispersion);
  check("scoreless half-inning ≈ 72.6% anchor", Math.abs(p0 - 0.726) < 0.01, `got ${(100 * p0).toFixed(2)}%`);
  check("inningPmf[0] equals scorelessProb (pre-truncation)", Math.abs(pmf[0]! - scorelessProb(cfg.leagueLambda, cfg.dispersion)) < 5e-4);

  // Convolution of two independent innings: mean adds, mass conserved.
  const c = convolve(pmf, pmf, cfg.maxTotalRuns);
  const meanOne = pmf.reduce((s, x, k) => s + k * x, 0);
  const meanTwo = c.reduce((s, x, k) => s + k * x, 0);
  check("convolve conserves mass", approx(sum(c), 1, 1e-9));
  check("convolve adds means", Math.abs(meanTwo - 2 * meanOne) < 1e-6, `2×${meanOne.toFixed(4)} vs ${meanTwo.toFixed(4)}`);
}

console.log("\n── λ composition ──");
{
  const bat = leagueSide();
  const field = leagueSide();
  const lam = halfInningLambdas(bat, field, false, cfg);
  check("nine innings returned", lam.length === 9);
  const [i1, i2, i9] = [lam[0]!, lam[1]!, lam[8]!];
  check("inning 1 hotter than inning 2 (firstInningBump)", i1 > i2, `${i1.toFixed(4)} vs ${i2.toFixed(4)}`);
  // Innings 1..5 are all-starter; 6+ blends toward bullpen. With league
  // starter == league bullpen RA here, innings 2..9 should be flat.
  check("innings 2..9 flat when SP==BP rating", approx(i2, i9, 1e-9), `${i2.toFixed(4)} vs ${i9.toFixed(4)}`);

  // A tough OPPOSING starter (low RA9) should suppress the batting team's
  // early-inning λ — the offense faces the other team's pitcher, not its own.
  const aceField: TeamInputs = { ...field, starter: pitcherFromRA9(2.50, 6.5) };
  const lamVsAce = halfInningLambdas(bat, aceField, false, cfg);
  check("tougher opposing starter lowers inning-1 λ", lamVsAce[0]! < i1, `${lamVsAce[0]!.toFixed(4)} vs ${i1.toFixed(4)}`);
  check("opposing starter effect fades to bullpen by inning 9", approx(lamVsAce[8]!, i9, 1e-9));
}

console.log("\n── markets: ML ──");
{
  const equal = leagueSide();
  // With HFA disabled, two identical teams must be a pure coin flip.
  const noHfa: V7Config = { ...cfg, hfaMultiplier: 1.0 };
  const m0 = deriveMarkets(equal, equal, noHfa);
  check("homeWin+awayWin = 1", approx(m0.homeWin + m0.awayWin, 1, 1e-9));
  check("identical teams, no HFA → 50/50", Math.abs(m0.homeWin - 0.5) < 5e-3, `homeWin ${(100 * m0.homeWin).toFixed(2)}%`);

  // HFA on → home edge, in the empirically sane 51–55% band.
  const m1 = deriveMarkets(equal, equal, cfg);
  check("HFA gives home the edge", m1.homeWin > 0.5, `homeWin ${(100 * m1.homeWin).toFixed(2)}%`);
  check("HFA edge is modest (51–55%)", m1.homeWin > 0.51 && m1.homeWin < 0.55, `homeWin ${(100 * m1.homeWin).toFixed(2)}%`);

  // Stronger home offense monotonically raises homeWin.
  const strongHome: TeamInputs = { ...equal, offense: offenseFromRunsPerGame(5.4) };
  const m2 = deriveMarkets(equal, strongHome, cfg);
  check("better home offense raises homeWin", m2.homeWin > m1.homeWin, `${(100 * m2.homeWin).toFixed(1)}% > ${(100 * m1.homeWin).toFixed(1)}%`);
}

console.log("\n── markets: NRFI ──");
{
  const m = deriveMarkets(leagueSide(), leagueSide(), cfg);
  // Independent-halves NRFI for a league-average game. NOTE the gap to the
  // 0.485 empirical anchor: the engine assumes top/bottom of the 1st are
  // independent, but real halves are positively correlated (park/weather/
  // umpire hit both), so actual joint NRFI runs ~2–3pp BELOW the product.
  // This is a v7.x calibration item (a game-level scoring factor), not a bug.
  check("league-average NRFI in plausible band", m.nrfi > 0.47 && m.nrfi < 0.53, `NRFI ${(100 * m.nrfi).toFixed(2)}% (indep); empirical joint ≈ 48.5%`);

  // Two aces + weak offenses → NRFI clearly up; two weak SP + strong
  // offenses → NRFI clearly down. Directionally the engine must move.
  const aces: TeamInputs = { offense: offenseFromRunsPerGame(3.9), starter: pitcherFromRA9(2.6, 6.5), bullpen: bullpenFromRA9(3.4), parkLogFactor: 0 };
  const slug: TeamInputs = { offense: offenseFromRunsPerGame(5.6), starter: pitcherFromRA9(5.6, 4.5), bullpen: bullpenFromRA9(5.0), parkLogFactor: 0 };
  const mAces = deriveMarkets(aces, aces, cfg);
  const mSlug = deriveMarkets(slug, slug, cfg);
  check("aces pitchers' duel raises NRFI", mAces.nrfi > m.nrfi, `${(100 * mAces.nrfi).toFixed(1)}% > ${(100 * m.nrfi).toFixed(1)}%`);
  check("slugfest lowers NRFI", mSlug.nrfi < m.nrfi, `${(100 * mSlug.nrfi).toFixed(1)}% < ${(100 * m.nrfi).toFixed(1)}%`);
  check("NRFI ordering aces > slug", mAces.nrfi > mSlug.nrfi);
}

console.log("\n── markets: totals / O/U ──");
{
  const m = deriveMarkets(leagueSide(), leagueSide(), cfg);
  check("totalDist sums to ~1", m.totalDist.reduce((s, x) => s + x, 0) > 0.999, `mass ${sum(m.totalDist).toFixed(5)}`);
  // League-average expected total should land near the MLB ~8.5–9.5 range.
  check("expected total in MLB range", m.expectedTotal > 8 && m.expectedTotal < 10, `E[total] ${m.expectedTotal.toFixed(2)}`);
  const ou = m.over(8.5);
  check("over+under+push = 1 (half-line: no push)", approx(ou.over + ou.under + ou.push, 1, 1e-9) && ou.push === 0);
  const ou9 = m.over(9);
  check("whole-line push mass reported", ou9.push > 0, `push ${(100 * ou9.push).toFixed(2)}%`);
  check("higher line → lower Over prob", m.over(9.5).over < m.over(7.5).over);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED ✓" : `${failures} CHECK(S) FAILED ✗`}\n`);
process.exit(failures === 0 ? 0 : 1);
