# Predictions v7 — Unified Run-Distribution Engine

A design proposal to replace the three-formula approach (Pythag/log5 ML, factor-model NRFI, no O/U) with one latent model of expected runs per half-inning, from which all three markets are *derived*. Written against the current code in `lib/sports/mlb/predictions.ts` (v6).

---

## 1. Why change the architecture

The v6 model works, but it has three structural problems that no amount of constant-tuning fixes:

**The shrinkage is a confession.** `WIN_SHRINKAGE = 0.20` means the raw model's deviations from 50% are ~5× too large — a 65% raw pick is really a 53% pick. That happens because correlated signals get added independently: blended Pythag already contains SP and bullpen quality (their runs are in RS/RA), then `spDelta` and `bullpenDelta` add them again, then log5 amplifies the spread. Shrinkage papers over the double-counting instead of removing it. A model whose inputs are combined on the right scale shouldn't need k=0.20 to be calibrated.

**Three markets, three disconnected formulas.** ML and NRFI can currently disagree with each other — the model can call a game a high-scoring coin flip and a strong NRFI simultaneously. And O/U would be a *third* independent formula. In reality all three are views of one quantity: how many runs each team is expected to score, inning by inning. Model that once and consistency is automatic — a game whose total distribution is fat automatically leans YRFI and Over.

**ERA is a weak signal.** Season ERA is noisy (sequencing, defense, bullpen inheritance) and slow to converge. Everything downstream inherits that noise. K%, BB%, and HR-rate (the FIP family) stabilize in a third of the sample and predict future run prevention better — and SportsDataIO already gives you the components.

---

## 2. The proposed model

### 2.1 Core object: λ, expected runs per half-inning

For each game, estimate the expected runs each offense scores in each of its 9 half-innings. Everything else is derived from these 18 numbers.

Combine ratings on the **log scale** (multiplicatively), which is the standard way to compose offense × pitching × park without double-counting:

```
log λ(team T, inning i) = log λ_lg
                        + β_off  · (log O_T   − log λ_lg)      offense rating
                        + β_pitch· (log P_opp,i − log λ_lg)    pitcher on the mound in inning i
                        + ½ · log park(home team)              park applies to both offenses
                        + firstInningBump   (i = 1 only)
```

- **O_T** — team park-adjusted runs/inning, blended recent/season exactly like today's `blendedPythag` weights, but *empirical-Bayes shrunk* (see §2.4) instead of hard min-game cliffs.
- **P_opp,i** — the run-prevention rating of whichever pitcher is expected on the mound in inning *i*: the starter's rating for innings 1..E[SP innings], the team bullpen rating after. E[SP innings] comes from the starter's average IP/start (SDIO), so a 6.1-IP workhorse and a 4.2-IP opener are handled correctly — something the current flat `spDelta` can't express.
- **Pitcher rating** — built from FIP components, not ERA:
  `xRA9 = c₀ + c₁·(HR/9) + c₂·(BB/9) − c₃·(K/9)` with the c's fit on league data (or just use FIP-scaled-to-RA9 as v7.0 and fit later). Shrink by IP toward league mean.
- **firstInningBump** — first innings score ~10–20% above the average inning because the 1-2-3 hitters are guaranteed to lead off. Fit this constant from your `historical_boxscores` linescores; it replaces the separate team-1st-inning-RPG machinery with one league-level constant plus (optionally) a shrunken per-team top-of-lineup factor.
- **β_off, β_pitch** — regression weights fit on historical games (§3). These replace `SP_ERA_TO_WINPCT`, `SP_DELTA_CAP`, `BULLPEN_DELTA_CAP`, and both shrinkage constants. If the model is overconfident, the fit pulls the βs below 1.0 — calibration lives *inside* the model instead of being applied after.

### 2.2 From λ to a run distribution: don't use raw Poisson

Half-inning runs are **not Poisson** — scoring is clustered (walks + hits chain), so the distribution is overdispersed: more zeros *and* more big innings than Poisson predicts at the same mean. Empirically ~72–73% of half-innings are scoreless while Poisson at league λ≈0.5 predicts only ~61%. Using raw `e^(−λ)` for NRFI would be badly miscalibrated from the start.

Fix: fit a **negative binomial** per-inning PMF — one dispersion parameter `r` estimated once from league linescore data (you have thousands of half-innings in `historical_boxscores`), mean set by λ:

```
P(k runs | λ) = NB(k; r, p)  where p = r/(r+λ)
P(0 | λ)      = (r/(r+λ))^r
```

Sanity check when you fit: at league-average λ, `P(0)` should land at the observed ~0.72–0.73 scoreless rate. That single check catches most implementation errors.

### 2.3 Deriving the three markets (exact, no Monte Carlo needed)

Truncate each half-inning PMF at ~12 runs and **convolve** the 9 innings per team → each team's full run-total distribution (a vector of ~40 probabilities). Convolution is deterministic, fast (18 convolutions of tiny vectors per game), and unit-testable — better fit for your codebase style than Monte Carlo.

- **NRFI** — read directly off inning 1:
  `P(NRFI) = P_away(0 | λ_away,1) · P_home(0 | λ_home,1)`
- **O/U** — from the joint total: `P(Over line) = P(T_away + T_home > line)`, with `P(push)` reported separately for whole-number lines. Grade pushes as no-action.
- **ML** — `P(home > away)` from the joint distribution, plus a tie mass. Resolve ties with a one-inning extra-innings step: `P(home wins EI) = P(H_i > A_i | one inning each, with the runner-on-2nd bump to λ) `, iterated geometrically (equivalently: `P(home | tie) = p_h / (p_h + p_a)` where p's are the one-inning win probs). Home-field advantage enters as a small multiplier on the home offense λ (fit it; expect ~1.02–1.04) instead of the flat +4pp bump — this makes HFA correctly worth *more* in low-scoring games, which the additive bump gets backwards.

One engine, three consistent outputs, and the O/U market comes free.

### 2.4 Empirical-Bayes shrinkage everywhere (kill the min-sample cliffs)

Current pattern: `if (starts < 5) use league average else use raw rate`. That's a discontinuity — a pitcher's 5th start suddenly swings his input from league-average to a raw small-sample rate. Replace every instance with the standard shrinkage estimator:

```
rating = (observed_total + K · league_rate) / (sample_size + K)
```

where K is "pseudo-innings of league-average prior" (fit per stat; K≈60 IP for pitcher run rates, K≈150 PA-innings for team offense are reasonable starting points). Small samples glide smoothly from the league mean toward the observed rate. This one change removes `TEAM_1ST_MIN_GAMES`, `SP_1ST_MIN_STARTS`, `BULLPEN_MIN_IP`, `TEAM_RECENT_MIN_GAMES`, and `SP_RECENT_MIN_STARTS`.

---

## 3. Fitting instead of hand-tuning

You already have the two things most hobbyist modelers lack: a graded-history table and a backtest harness with a `PredictionConfig` override pattern. Use them to fit rather than tune:

1. **Objective:** minimize log-loss (ML, NRFI as Bernoulli; O/U once odds are captured) on graded games. Log-loss directly optimizes calibration + sharpness, which is what your public track record lives on.
2. **Parameters to fit:** `β_off`, `β_pitch`, `firstInningBump`, HFA multiplier, NB dispersion `r`, shrinkage K's. That's ~7 numbers — fittable on a few hundred games with a coarse grid or Nelder-Mead in a `scripts/fit-v7.ts`, no ML framework needed.
3. **Walk-forward validation:** fit on April–May, evaluate on June; roll monthly. Never evaluate on games that informed the fit — your `compare-model-versions.ts` pattern already supports this shape.
4. **Benchmarks (report all three):**
   - v6 model (must beat it on Brier/log-loss to ship)
   - Coin-flip / league-base-rate baseline
   - **Market-implied probabilities** — de-vig the FanDuel/DK odds you're already capturing (`daily_odds`). This is the honest yardstick: if v7's log-loss approaches the market's, the model is genuinely strong; beating the market consistently is a much higher bar than beating v6.
5. **Track CLV** (closing line value) on plays, not just hit rate. Hit rate on ~40 plays/month is mostly noise; consistently getting a better number than the close is the earliest reliable signal a model has real edge.

A worthwhile honesty note for the /predictions page: NRFI and first-inning markets are softer (less sharp money) than ML, so that's where a transparent public model most plausibly finds real edge. ML against closing lines is close to efficient; frame the ML picks as calibrated entertainment with a tracked record rather than promising +EV.

---

## 4. Implementation sketch

New module `lib/sports/mlb/run-model.ts`, pure functions in the house style:

```ts
// Ratings — all empirical-Bayes shrunk, log-scale composition.
export type OffenseRating = { logRunsPerInning: number };   // park-adjusted
export type PitcherRating = { logRAPerInning: number; expectedInnings: number };
export type BullpenRating = { logRAPerInning: number };

export type HalfInningLambdas = number[]; // length 9, one λ per inning

export function halfInningLambdas(args: {
  offense: OffenseRating;
  starter: PitcherRating | null;   // null → bullpen game / TBD
  bullpen: BullpenRating;
  parkLogFactor: number;           // ½·log(park), precomputed
  isHome: boolean;                 // HFA multiplier on home offense
  cfg: V7Config;                   // fitted parameters
}): HalfInningLambdas { /* §2.1 */ }

// Negative-binomial PMF for one half-inning, truncated at MAX_RUNS.
export function inningPmf(lambda: number, r: number): number[] { /* §2.2 */ }

// Convolve 9 innings → team run-total distribution.
export function teamRunDistribution(lambdas: HalfInningLambdas, r: number): number[]

export type GameMarkets = {
  homeWin: number;                  // ML
  nrfi: number;                     // P(0 runs, both halves of the 1st)
  totalDist: number[];              // joint total-runs distribution
  over: (line: number) => { over: number; under: number; push: number };
};

export function deriveMarkets(away: TeamInputs, home: TeamInputs, cfg: V7Config): GameMarkets
```

`predictGames` keeps its exact signature and output type — v7 becomes an alternate producer of `GamePrediction`, selected by a config flag, so the snapshot cron, comparator, and renderer don't change. `nrfiProbability` and `winProbability` come straight from `deriveMarkets` with **no shrinkage step**; if the fit is right, they're calibrated natively. Add `ouProbability`/`ouLine` fields as optional so the renderer can adopt O/U when you're ready.

### Migration plan

1. **v7.0 (1–2 evenings):** run-distribution engine with current inputs (ERA-based pitcher ratings, existing park factors). Fit NB dispersion + βs on season-to-date. Backtest vs v6 — the architecture change alone should recover most of what shrinkage throws away.
2. **v7.1:** swap pitcher ratings to FIP components from SDIO; add expected-IP starter/bullpen split.
3. **v7.2:** fit first-inning bump from `historical_boxscores`; retire the team-1st-inning cliff machinery.
4. **v7.3:** O/U goes public once you're capturing totals lines alongside the NRFI/ML odds (extend `odds-fanduel.ts`'s market list, or — better, per the security review — a licensed odds feed that solves capture *and* your historical backfill want in one purchase).
5. **Later, in rough order of value per effort:** lineup-vs-starter handedness splits, umpire O/U tendencies, weather (temperature + wind at outdoor parks moves totals meaningfully), and optionally a market-anchored blend `p_final = w·p_model + (1−w)·p_market` for display-grade probabilities.

---

## 5. What this buys you

| | v6 today | v7 proposed |
|---|---|---|
| ML | Pythag→log5 + additive deltas, k=0.20 shrinkage | P(H>A) from run distributions, calibrated by fit |
| NRFI | 0.49 × √(factor ratio), k=0.30 shrinkage | P(0)·P(0) from inning-1 λs, NB-correct zeros |
| O/U | — | free from the same distributions |
| Calibration | post-hoc shrinkage constants | inside the fit; refit monthly, walk-forward |
| Small samples | 5 hard min-sample cliffs | smooth empirical-Bayes shrinkage |
| Pitcher signal | season ERA | K/BB/HR components, IP-shrunk, IP-aware innings split |
| Consistency | markets can contradict | one latent model, three coherent views |