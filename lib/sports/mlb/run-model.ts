// v7 unified run-distribution engine (docs/predictions-v7/design.md).
//
// One latent object per game — expected runs per half-inning (λ) — from
// which ML, NRFI, and O/U are all *derived*, so they can never contradict
// each other the way v6's three independent formulas can. λ's compose on
// the log scale (offense × pitching × park, no double-counting), each
// half-inning's run count is negative-binomial (not Poisson — real innings
// are overdispersed: ~72.6% scoreless vs Poisson's ~61%), and the nine
// per-team PMFs are convolved into a full run-total distribution. Every
// market is read off that distribution exactly — no Monte Carlo.
//
// Pure functions only (house rule): plain data in, plain data out, no I/O.
// Ratings are inputs; building them from aggregates (with empirical-Bayes
// shrinkage) is the caller's job — see `shrinkRate` for the estimator.
//
// Fitted constants (all from committed scripts, see DEFAULT_V7_CONFIG):
//   - dispersion r, firstInningBump: scripts/fit-v7-dispersion.ts
//   - betaOff, betaPitch, hfaMultiplier: scripts/fit-v7.ts (TODO — v7.0
//     ships with neutral placeholders; the fit refines them walk-forward).

// ─── Ratings (log scale, all league-relative after shrinkage) ─────────────

/** Park-adjusted offense: log expected runs this team scores per inning. */
export type OffenseRating = { logRunsPerInning: number };
/** Pitcher run prevention: log expected runs allowed per inning, plus how
 *  deep into the game they're expected to go (drives the SP→bullpen split). */
export type PitcherRating = { logRAPerInning: number; expectedInnings: number };
/** Team bullpen run prevention: log expected runs allowed per inning.
 *  `fatigueExcessIp` is reliever IP thrown over the last 2 days minus the
 *  league average — heavily-used pens pitch worse tonight (tired arms or
 *  the mop-up tier covering). Optional so callers without recent-usage
 *  data (tests, early season) degrade to no adjustment. */
export type BullpenRating = { logRAPerInning: number; fatigueExcessIp?: number };

/** Everything the engine needs for one side of a matchup: this team's OWN
 *  offense and OWN pitching staff. deriveMarkets crosses them — a team's
 *  run-scoring is driven by its offense against the OPPONENT's pitching.
 *  `parkLogFactor` is ½·log(park run factor), the SAME for both sides (it's
 *  the home park), applied to both offenses per the design. */
export type TeamInputs = {
  offense: OffenseRating;
  starter: PitcherRating | null;   // null → bullpen game / TBD starter
  bullpen: BullpenRating;
  parkLogFactor: number;
};

export type V7Config = {
  leagueLambda: number;      // league mean runs per (regulation) half-inning
  dispersion: number;        // NB `r`; one value league-wide
  betaOff: number;           // offense composition weight (fit; 1 = raw)
  betaPitch: number;         // pitcher composition weight (fit; 1 = raw)
  firstInningBump: number;   // additive to log λ for inning 1 only
  hfaMultiplier: number;     // multiply home offense λ (fit; ~1.02–1.04)
  /** Additive to bullpen log-RA per excess reliever IP over the last 2
   *  days (fit; 0 = fatigue off). scripts/fit-bullpen-fatigue.ts. */
  fatigueLogRaPerIp: number;
  maxRunsPerInning: number;  // NB PMF truncation per half-inning
  maxTotalRuns: number;      // team run-total distribution truncation
};

// v7.0 defaults. λ_lg and the two linescore constants are fit
// (scripts/fit-v7-dispersion.ts, pooled 2024+2025). betaOff/betaPitch/hfa
// are NEUTRAL PLACEHOLDERS until scripts/fit-v7.ts runs — v7.0's thesis is
// that correct composition needs little shrinkage, so 1.0 is the honest
// starting point to fit down from, not up.
export const DEFAULT_V7_CONFIG: V7Config = {
  leagueLambda: 0.503,
  dispersion: 0.391,
  betaOff: 1.0,
  betaPitch: 1.0,
  firstInningBump: 0.0348,
  hfaMultiplier: 1.03,
  fatigueLogRaPerIp: 0,
  maxRunsPerInning: 12,
  maxTotalRuns: 30,
};

// ─── Empirical-Bayes shrinkage (design §2.4 — kills min-sample cliffs) ────

/** Glide a small-sample observed rate toward the league prior instead of a
 *  hard `if (n < min) league else raw` cliff. K is "pseudo-observations of
 *  prior" (e.g. ~60 IP for pitcher run rates, ~150 for team offense). */
export function shrinkRate(observedRate: number, sampleSize: number, leagueRate: number, K: number): number {
  return (observedRate * sampleSize + leagueRate * K) / (sampleSize + K);
}

// ─── λ: expected runs per half-inning (design §2.1) ───────────────────────

/** The nine per-inning λ's for the `batting` team scoring against the
 *  `fielding` team's pitching. The opposing pitcher term switches from their
 *  starter to their bullpen around E[SP innings]; the boundary inning is
 *  blended by the fraction the starter is expected to face, so a 5.7-IP
 *  starter correctly owns 70% of the 6th. */
export function halfInningLambdas(batting: TeamInputs, fielding: TeamInputs, isHome: boolean, cfg: V7Config): number[] {
  const logLg = Math.log(cfg.leagueLambda);
  const hfaLog = isHome ? Math.log(cfg.hfaMultiplier) : 0;
  const offTerm = cfg.betaOff * (batting.offense.logRunsPerInning - logLg);
  const spIP = fielding.starter?.expectedInnings ?? 0;

  // Fatigue moves the bullpen's log-RA before the SP/bullpen blend, so a
  // gassed pen only hurts the innings it actually covers.
  const bullpenLogRA = fielding.bullpen.logRAPerInning
    + cfg.fatigueLogRaPerIp * (fielding.bullpen.fatigueExcessIp ?? 0);

  const out: number[] = [];
  for (let i = 1; i <= 9; i++) {
    // Fraction of this inning the opposing starter is expected to pitch (0..1).
    const spFrac = fielding.starter ? Math.max(0, Math.min(1, spIP - (i - 1))) : 0;
    const pitcherLogRA = fielding.starter
      ? spFrac * fielding.starter.logRAPerInning + (1 - spFrac) * bullpenLogRA
      : bullpenLogRA;

    let logLambda = logLg
      + offTerm
      + cfg.betaPitch * (pitcherLogRA - logLg)
      + batting.parkLogFactor
      + hfaLog;
    if (i === 1) logLambda += cfg.firstInningBump;

    out.push(Math.exp(logLambda));
  }
  return out;
}

// ─── Negative-binomial half-inning PMF (design §2.2) ──────────────────────

/** Exact NB probability of a scoreless half-inning at mean λ. Used directly
 *  for NRFI so it's free of any truncation/renormalization artifact. */
export function scorelessProb(lambda: number, r: number): number {
  return Math.pow(r / (r + lambda), r);
}

/** NB PMF over {0..maxRuns} at mean λ, dispersion r, renormalized after
 *  truncation. Built by the stable ratio recurrence P(k)/P(k-1) =
 *  (k+r-1)/k · (1-p), so no gamma calls. */
export function inningPmf(lambda: number, r: number, maxRuns: number): number[] {
  const p = r / (r + lambda);
  const oneMinusP = 1 - p;
  const pmf: number[] = new Array(maxRuns + 1);
  let prev = Math.pow(p, r);
  pmf[0] = prev;
  let sum = prev;
  for (let k = 1; k <= maxRuns; k++) {
    prev = prev * ((k + r - 1) / k) * oneMinusP;
    pmf[k] = prev;
    sum += prev;
  }
  return pmf.map((x) => x / sum); // recover truncated tail mass
}

/** Convolve two run distributions, truncating the result at maxLen runs. */
export function convolve(a: number[], b: number[], maxLen: number): number[] {
  const out: number[] = new Array(Math.min(a.length + b.length - 1, maxLen + 1)).fill(0);
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    if (ai === 0) continue;
    const cap = Math.min(b.length, out.length - i);
    for (let j = 0; j < cap; j++) out[i + j] = out[i + j]! + ai * b[j]!;
  }
  return out;
}

/** Renormalize a truncated distribution back to unit mass, so the tiny tail
 *  lost at the truncation cap doesn't leak into ML/O/U sums. */
function normalize(dist: number[]): number[] {
  const s = dist.reduce((acc, x) => acc + x, 0);
  return s > 0 ? dist.map((x) => x / s) : dist;
}

/** A team's full game run-total distribution: convolve its nine per-inning
 *  PMFs. Deterministic and fast (nine tiny convolutions). Renormalized so
 *  the truncated upper tail doesn't break downstream probability sums. */
export function teamRunDistribution(lambdas: number[], cfg: V7Config): number[] {
  let dist = [1]; // point mass at 0 runs
  for (const lambda of lambdas) {
    dist = convolve(dist, inningPmf(lambda, cfg.dispersion, cfg.maxRunsPerInning), cfg.maxTotalRuns);
  }
  return normalize(dist);
}

// ─── Deriving the three markets (design §2.3) ─────────────────────────────

export type GameMarkets = {
  homeWin: number;      // ML — P(home wins), extra-inning ties resolved
  awayWin: number;
  nrfi: number;         // P(0 runs in the 1st, both halves)
  expectedTotal: number;
  totalDist: number[];  // joint (away+home) run-total distribution
  /** O/U for a given line; push mass reported separately for whole numbers. */
  over: (line: number) => { over: number; under: number; push: number };
};

function meanOf(dist: number[]): number {
  return dist.reduce((m, x, k) => m + k * x, 0);
}

export function deriveMarkets(away: TeamInputs, home: TeamInputs, cfg: V7Config): GameMarkets {
  // Each offense scores against the OTHER team's pitching.
  const awayL = halfInningLambdas(away, home, false, cfg);
  const homeL = halfInningLambdas(home, away, true, cfg);

  // NRFI straight off the two first-inning λ's (independent halves).
  const nrfi = scorelessProb(awayL[0]!, cfg.dispersion) * scorelessProb(homeL[0]!, cfg.dispersion);

  const awayDist = teamRunDistribution(awayL, cfg);
  const homeDist = teamRunDistribution(homeL, cfg);

  // ML from the independent team totals: sum the joint mass over h≷a.
  let pHome = 0, pAway = 0, pTie = 0;
  for (let h = 0; h < homeDist.length; h++) {
    const ph = homeDist[h]!;
    if (ph === 0) continue;
    for (let a = 0; a < awayDist.length; a++) {
      const pa = awayDist[a]!;
      if (pa === 0) continue;
      if (h > a) pHome += ph * pa;
      else if (a > h) pAway += ph * pa;
      else pTie += ph * pa;
    }
  }
  // Resolve regulation ties by relative scoring strength — the stronger
  // (incl. HFA, already baked into homeL) offense wins more extra innings.
  // A full one-inning ghost-runner EI resolution is a v7.x refinement.
  const homeMean = meanOf(homeDist), awayMean = meanOf(awayDist);
  const homeTieShare = homeMean + awayMean > 0 ? homeMean / (homeMean + awayMean) : 0.5;
  const homeWin = pHome + pTie * homeTieShare;
  const awayWin = pAway + pTie * (1 - homeTieShare);

  // Joint total caps at maxTotalRuns (a two-team sum, so renormalize again).
  const totalDist = normalize(convolve(awayDist, homeDist, cfg.maxTotalRuns));
  const expectedTotal = meanOf(totalDist);

  const over = (line: number) => {
    let o = 0, u = 0, push = 0;
    for (let k = 0; k < totalDist.length; k++) {
      const pk = totalDist[k]!;
      if (k > line) o += pk;
      else if (k < line) u += pk;
      else push += pk; // exact hit only possible on whole-number lines
    }
    return { over: o, under: u, push };
  };

  return { homeWin, awayWin, nrfi, expectedTotal, totalDist, over };
}

// ─── Rating constructors (convenience for callers/tests) ──────────────────

/** Offense rating from runs/game. Innings-per-game ~8.85 (home team skips
 *  the 9th when leading), but /9 is the convention the pitcher side uses too
 *  so the league-relative terms stay consistent — the absolute divisor
 *  cancels in the log-relative composition. */
export function offenseFromRunsPerGame(runsPerGame: number, parkLogFactorForOffense = 0): OffenseRating {
  return { logRunsPerInning: Math.log(runsPerGame / 9) + parkLogFactorForOffense };
}

/** Pitcher rating from RA/9 (or FIP-scaled-to-RA9 in v7.1). */
export function pitcherFromRA9(ra9: number, expectedInnings: number): PitcherRating {
  return { logRAPerInning: Math.log(ra9 / 9), expectedInnings };
}

export function bullpenFromRA9(ra9: number): BullpenRating {
  return { logRAPerInning: Math.log(ra9 / 9) };
}
