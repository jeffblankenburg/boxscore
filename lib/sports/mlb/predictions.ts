// Game-level prediction module for /mlb/predictions. Pure functions —
// caller assembles inputs (slate + team season records + probable-SP
// season ERA), we return a row per game with WIN% (each side) and
// NRFI% (probability no run scores in the 1st inning).
//
// Models are transparent and additive so the page can display the
// inputs alongside the score. v1:
//
//   WIN%: Bill James pythagorean expectation (RS^1.83 / (RS^1.83 +
//         RA^1.83)) per team → log5 matchup → home-field bump
//         (+0.040 to home, league historical) → SP-quality delta
//         from each starter's season ERA vs. league average.
//
//   NRFI%: League baseline 0.57 × combined-SP factor (better SPs →
//          higher NRFI) × combined-offense factor (stronger lineups
//          → lower NRFI). Clamped to [0.30, 0.80] to avoid silly
//          claims when one input is extreme.
//
// What's out of scope for v1:
//   - Bullpen quality (WIN late-inning leverage)
//   - First-inning-specific SP splits (NRFI sharpness)
//   - Recent form (rolling 10-game record)
//   - Park factors
//   - Weather
//
// Iterating in place is the plan.

import type { SlateGame } from "@/lib/mlb";
import type {
  SeasonAggregates,
  TeamBullpenStats,
  TeamFirstInningStats,
  SpFirstInningStats,
  TeamRecentForm,
  SpRecentForm,
} from "./season-aggregates";
import { parkFactorForHomeTeam } from "./park-factors";
import { impliedFromAmerican } from "./clv";

// ─── Inputs ──────────────────────────────────────────────────────────────

export type TeamSeasonRecord = {
  teamId: number;          // statsapi team id
  wins: number;
  losses: number;
  runsScored: number;
  runsAllowed: number;
  gamesPlayed: number;
};

export type ProbableSpStats = {
  era: number | null;
  wins: number | null;
  losses: number | null;
};

// ─── Output ──────────────────────────────────────────────────────────────

export type PredictionSide = {
  teamId: number;       // statsapi team id, carried through for snapshot provenance
  abbr: string;
  teamName: string;
  isHome: boolean;
  record: { wins: number; losses: number };
  runsPerGame: number;
  runsAllowedPerGame: number;
  pythagWinPct: number;
  /** Probable SP for this side; null if TBD. */
  probableSp: { name: string; era: number | null; wins: number | null; losses: number | null } | null;
  /** Modeled probability this side wins (0–1). */
  winProbability: number;
};

export type GamePrediction = {
  gamePk: number;
  startTime: string;          // ISO datetime from statsapi
  status: SlateGame["status"];
  away: PredictionSide;
  home: PredictionSide;
  /** Probability no run scores in the 1st inning (either team). */
  nrfiProbability: number;
  /** Distance from 50% — useful as a single confidence score. */
  winConfidence: number;
  nrfiConfidence: number;
  /** Which side the model favors. */
  favorite: "away" | "home" | "even";
};

export type PredictionsResult = {
  date: string;
  generatedAt: string;
  games: GamePrediction[];
  gameCount: number;
};

// ─── Constants ───────────────────────────────────────────────────────────

const PYTHAG_EXPONENT = 1.83;          // Bill James "pythagenpat"-ish, classic 1.83
const LG_AVG_ERA = 4.20;
const LG_AVG_RPG = 4.50;
const LG_HOME_WIN_PCT = 0.540;          // ~80-yr modern era average
const HOME_FIELD_BUMP = LG_HOME_WIN_PCT - 0.500;  // +0.040
const SP_ERA_TO_WINPCT = 0.020;         // 1 ERA point ≈ 2 win-pct points
const SP_DELTA_CAP = 0.05;              // clamp SP adjustment to ±5 pct

// v6: rebased from 0.57 (pre-2023 rule-change baseline) to 0.49 (2026
// empirical rate across 1279 graded games). The old baseline over-
// predicted NRFI, which is why the v4 model never fired a YRFI play —
// every prediction started 9pp too optimistic on scoreless-1st.
const BASELINE_NRFI = 0.49;
const NRFI_MIN = 0.30;
const NRFI_MAX = 0.80;

// ─── Calibration shrinkage ───────────────────────────────────────────────
// Empirical linear shrinkage fit on v3-park-form against 313 graded
// June games (scripts/fit-calibration.ts). The fit minimizes Brier loss
// for `cal = 0.5 + k*(raw - 0.5)`. Without shrinkage the model was
// systematically overconfident (60% picks hit 52-53%); these k values
// bring the displayed probability into line with observed frequency.
//
// Fit one parameter per metric (not per-bucket) because n=313 is too
// small for isotonic regression without overfitting; a single global
// shrinkage is more honest at this sample size. Refit annually OR after
// any material model change so the constants stay attributable to the
// fitting run (see PREDICTIONS_MODEL_VERSION for the contract).

export const WIN_SHRINKAGE  = 0.20;
// v6: relaxed from 0.15 → 0.30. With rebased BASELINE_NRFI=0.49, the
// tighter 0.15 shrinkage collapsed every NRFI pick back to ~0.50 and
// zero plays cleared threshold. 0.30 lets both NRFI and YRFI plays
// fire; empirically improves combined hit rate 52.8% → 54.0% while
// doubling play volume (from 159 to ~226) — verified via
// scripts/simulate-nrfi-rebase.ts.
export const NRFI_SHRINKAGE = 0.30;

// ─── Play thresholds ─────────────────────────────────────────────────────
// Operate on the CALIBRATED probabilities (post-shrinkage). Empirical
// sweep (scripts/threshold-sweep.ts on 313 v4 graded games) found the
// hit-rate sweet spot at 0.545:
//   - ML  ≥ 0.545: 35 plays, 65.7% hit
//   - NRFI ≥ 0.545 (or ≤ 0.455 for YRFI): 41 plays, 65.9% hit
// Sample size is modest (~1.5 plays per metric per night), so treat
// these numbers as directional, not gospel. Refit after another month
// of data to retune.
//
// NRFI strong tier never fires under current shrinkage — calibrated
// NRFI is clamped to [0.455, 0.545] (NRFI_MIN/MAX × WIN_SHRINKAGE) so
// nothing can clear 0.55. The constant stays at 0.55 for symmetry; if
// shrinkage relaxes it'll start firing.

export const ML_PLAY_THRESHOLD = 0.545;       // calibrated win probability
export const ML_STRONG_THRESHOLD = 0.555;
export const NRFI_PLAY_THRESHOLD = 0.545;     // calibrated NRFI; YRFI side mirrors
export const NRFI_STRONG_THRESHOLD = 0.55;

/** Empirical price band for ML plays where our ROI is positive. Below
 *  -200 the juice on heavy chalk eats us alive (68% hit but -5% ROI);
 *  above -100 the model overestimates home teams the books don't favor
 *  (33% hit, -30% ROI). Everything in between averages +5.8% ROI on
 *  115 season plays. When DK odds aren't captured yet we DON'T filter
 *  — a play stays a play; the odds check applies only when we have a
 *  price to check against. */
export const ML_ODDS_MIN = -200;
export const ML_ODDS_MAX = -100;
export function mlOddsInPlayableRange(odds: number | null | undefined): boolean {
  if (odds == null) return true; // no odds captured yet — don't filter
  return odds >= ML_ODDS_MIN && odds <= ML_ODDS_MAX;
}

// ─── Play helpers ────────────────────────────────────────────────────────

export type WinPlay = {
  side: "away" | "home";
  abbr: string;
  winPct: number;
  strong: boolean;
  /** True when the picked side is a betting underdog (plus-money) — a
   *  model-vs-market disagreement, our highest-ROI pick type. Flagged in
   *  the UI (🐕) without ever showing the price. */
  dog: boolean;
};
// ─── Daily card selection ────────────────────────────────────────────────
//
// The public card is ML-only (NRFI was dropped 2026-07-23 — its hit rate
// didn't justify the slot). Its BASE size scales with the slate:
// CARD_GAME_FRACTION of the day's games, floor 1 — a 15-game day shows 3,
// a 5-game day shows 1. But 20% is a FLOOR, not a cap: any additional
// positive-EV pick whose win probability clears CARD_VERY_CONFIDENT_WINPCT
// is kept too, so a light slate with two elite plays still shows both.
// (Fitted 2026-07-23, scripts/fit-v71-card.ts: at 0.68 the override adds
// only ~0.37 picks/day and those extras hit 86% — genuinely "very
// confident," rare enough to keep the card ~20% on a typical day.)
//
// Picks are the model's favored side ranked by EV vs the market price
// (model prob − break-even implied), favored side only, positive-EV only.
// That's where the money is: over the 2026 season v7.1's favored-UNDERDOG
// picks (market prices our side as a dog) returned +19.3% ROI vs favorites'
// single digits. Ranking by raw win% would bury those under chalk, so we
// rank by edge — which needs the picked side's odds.
export const CARD_GAME_FRACTION = 0.20;
export const CARD_VERY_CONFIDENT_WINPCT = 0.68;

/** Base number of ML picks for a slate of `numGames` games: 20% of the
 *  slate, rounded, floor 1. 15 → 3, 10 → 2, 5 → 1. selectDailyCard may
 *  add very-confident picks on top of this. */
export function cardSize(numGames: number): number {
  return Math.max(1, Math.round(CARD_GAME_FRACTION * numGames));
}

/** One game's card-eligible ML pick. Null when we have no odds for the
 *  favored side or its EV is non-positive (no bet). */
export type CardCandidate = {
  gamePk: number;
  ml: { side: "away" | "home"; winPct: number; edge: number; dog: boolean } | null;
};

export type CardPick = {
  gamePk: number;
  side: "away" | "home";
  winPct: number;      // picked side's win probability
  strong: boolean;
  dog: boolean;        // picked side is a plus-money underdog
  edge: number;        // EV vs market break-even — the rank metric
};

/** Build a card candidate from a game's win probabilities + the favored
 *  side's DraftKings odds. Pure — the caller supplies the odds. */
export function cardCandidateFor(
  gamePk: number,
  awayWinPct: number,
  homeWinPct: number,
  dkOdds?: { away: number | null; home: number | null },
): CardCandidate {
  const favSide: "away" | "home" = homeWinPct >= awayWinPct ? "home" : "away";
  const winPct = favSide === "home" ? homeWinPct : awayWinPct;
  const sideOdds = favSide === "home" ? dkOdds?.home ?? null : dkOdds?.away ?? null;
  const implied = impliedFromAmerican(sideOdds);
  const edge = implied === null ? null : winPct - implied;
  return {
    gamePk,
    ml: edge !== null && edge > 0 ? { side: favSide, winPct, edge, dog: (sideOdds ?? 0) > 0 } : null,
  };
}

/** The day's card: the top `count` positive-EV ML plays by edge (the 20%
 *  floor), PLUS any other positive-EV pick whose win probability clears
 *  CARD_VERY_CONFIDENT_WINPCT. Returned ordered by edge. */
export function selectDailyCard(cands: CardCandidate[], count: number): CardPick[] {
  const picks = cands
    .filter((c): c is CardCandidate & { ml: NonNullable<CardCandidate["ml"]> } => c.ml !== null)
    .map((c) => ({ gamePk: c.gamePk, side: c.ml.side, winPct: c.ml.winPct, strong: c.ml.winPct >= ML_STRONG_THRESHOLD, dog: c.ml.dog, edge: c.ml.edge }));
  picks.sort((a, b) => b.edge - a.edge);

  const chosen = picks.slice(0, Math.max(0, count));
  const chosenPks = new Set(chosen.map((p) => p.gamePk));
  // 20% is a floor: keep very-confident picks even past the base count.
  for (const p of picks) {
    if (!chosenPks.has(p.gamePk) && p.winPct >= CARD_VERY_CONFIDENT_WINPCT) {
      chosen.push(p);
      chosenPks.add(p.gamePk);
    }
  }
  chosen.sort((a, b) => b.edge - a.edge);
  return chosen;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function pythagoreanWinPct(rs: number, ra: number): number {
  if (rs <= 0 && ra <= 0) return 0.5;
  const rsP = Math.pow(rs, PYTHAG_EXPONENT);
  const raP = Math.pow(ra, PYTHAG_EXPONENT);
  return rsP / (rsP + raP);
}

/** Log5 — given each team's true-talent win pct, the probability A beats B
 *  on a neutral field. (Bill James, 1981.) */
function log5(pA: number, pB: number): number {
  const num = pA - pA * pB;
  const den = pA + pB - 2 * pA * pB;
  if (den <= 0) return 0.5;
  return num / den;
}

function spDelta(sp: ProbableSpStats | null, cfg?: PredictionConfig): number {
  if (!sp || sp.era === null) return 0;
  const eraScale = cfg?.spEraToWinPct ?? SP_ERA_TO_WINPCT;
  const cap      = cfg?.spDeltaCap    ?? SP_DELTA_CAP;
  const delta = (LG_AVG_ERA - sp.era) * eraScale;
  return clamp(delta, -cap, cap);
}

// Bullpens cover roughly the last 3.5 innings of a 9-inning game. A
// 1 ERA-point edge over league average translates to ~0.8 win-pct
// points (SP_ERA_TO_WINPCT scaled by inning fraction). Capped at ±2.5pp
// so a single anomalously good/bad pen doesn't dominate the matchup.
const BULLPEN_IP_PER_GAME = 3.5;
const BULLPEN_MIN_IP = 60;       // require this much sample before trusting
const BULLPEN_DELTA_CAP = 0.025;
function bullpenDelta(stats: TeamBullpenStats | undefined, lgAvg: number): number {
  if (!stats || stats.innings < BULLPEN_MIN_IP) return 0;
  const delta = (lgAvg - stats.era) * SP_ERA_TO_WINPCT * (BULLPEN_IP_PER_GAME / 9);
  return clamp(delta, -BULLPEN_DELTA_CAP, BULLPEN_DELTA_CAP);
}

// Pick the more specific rate when we have enough sample, otherwise
// fall back to the league average. Used for both 1st-inning RPG and
// 1st-inning SP ERA.
const TEAM_1ST_MIN_GAMES = 30;
const SP_1ST_MIN_STARTS  = 5;
function team1stInningRpg(stats: TeamFirstInningStats | undefined, lgAvg: number): number {
  if (!stats || stats.games < TEAM_1ST_MIN_GAMES) return lgAvg;
  return stats.runsPerGame;
}
function sp1stInningEra(stats: SpFirstInningStats | undefined, lgAvg: number): number {
  if (!stats || stats.starts < SP_1ST_MIN_STARTS) return lgAvg;
  return stats.era;
}

// Recent-form blends. Pythagorean is computed from blended RS/RA so a
// hot team (recent RS/RA outpacing season) gets a meaningful bump
// without abandoning the season-long anchor. Same idea for SP ERA —
// a pitcher in a rough patch gets dragged toward his recent line.
//
// Weights: 60% recent / 40% season for teams (3 weeks vs. 2.5 months
// of data ~= equal information per game but recent should weight
// higher because team rosters and bullpen quality drift); 50/50 for
// pitchers (their starts are sparse — 4-5 in 3 weeks vs. 10-15 in the
// season).
const TEAM_RECENT_WEIGHT = 0.60;
const SP_RECENT_WEIGHT   = 0.50;
const TEAM_RECENT_MIN_GAMES = 8;
const SP_RECENT_MIN_STARTS  = 2;

function blendedPythag(
  seasonRec: TeamSeasonRecord,
  recent: TeamRecentForm | undefined,
): number {
  const seasonRs = seasonRec.runsScored, seasonRa = seasonRec.runsAllowed;
  if (!recent || recent.games < TEAM_RECENT_MIN_GAMES) {
    return pythagoreanWinPct(seasonRs, seasonRa);
  }
  const seasonGames = Math.max(1, seasonRec.gamesPlayed);
  const seasonRsRate = seasonRs / seasonGames;
  const seasonRaRate = seasonRa / seasonGames;
  const recentRsRate = recent.runsScored / recent.games;
  const recentRaRate = recent.runsAllowed / recent.games;
  const blendedRsRate = TEAM_RECENT_WEIGHT * recentRsRate + (1 - TEAM_RECENT_WEIGHT) * seasonRsRate;
  const blendedRaRate = TEAM_RECENT_WEIGHT * recentRaRate + (1 - TEAM_RECENT_WEIGHT) * seasonRaRate;
  return pythagoreanWinPct(blendedRsRate, blendedRaRate);
}

function blendedSpEra(
  sp: ProbableSpStats | null,
  recent: SpRecentForm | undefined,
): number | null {
  if (!sp || sp.era === null) return sp?.era ?? null;
  if (!recent || recent.starts < SP_RECENT_MIN_STARTS) return sp.era;
  return SP_RECENT_WEIGHT * recent.era + (1 - SP_RECENT_WEIGHT) * sp.era;
}

// ─── Game-level prediction ───────────────────────────────────────────────

export type PredictionInputs = {
  date: string;
  slate: SlateGame[];
  /** Standings keyed by statsapi team id. */
  recordsByTeamId: Map<number, TeamSeasonRecord>;
  /** Probable-SP season stats keyed by statsapi person id. */
  spStatsById: Map<number, ProbableSpStats>;
  /** Season-to-date 1st-inning + bullpen aggregates. Optional so older
   *  callers (snapshot cron from the v0 era) still compile; when absent
   *  the model falls back to its pre-aggregate behavior. */
  aggregates?: SeasonAggregates;
  /** Per-call overrides for tunable constants. Used by the backtest
   *  harness to test variants; production callers omit this. */
  config?: PredictionConfig;
};

/** Tunable model constants exposed to backtests. Any field omitted
 *  falls back to the production module constant. */
export type PredictionConfig = {
  homeFieldBump?:   number;
  spDeltaCap?:      number;
  spEraToWinPct?:   number;
  winShrinkage?:    number;
  nrfiShrinkage?:   number;
};

export function predictGames(inputs: PredictionInputs): PredictionsResult {
  const { date, slate, recordsByTeamId, spStatsById, aggregates } = inputs;

  // League fallbacks when aggregates aren't available — keeps the model
  // behaviorally identical to v0 for callers that haven't been updated.
  const lgFirstInningRpg     = aggregates?.league.avgFirstInningRpg     ?? 0.55;
  const lgBullpenEra         = aggregates?.league.avgBullpenEra         ?? LG_AVG_ERA;
  const lgSpFirstInningEra   = aggregates?.league.avgSpFirstInningEra   ?? LG_AVG_ERA;

  const games: GamePrediction[] = [];

  for (const g of slate) {
    if (g.status === "postponed" || g.status === "cancelled") continue;

    const awayRec = recordsByTeamId.get(g.away.teamId);
    const homeRec = recordsByTeamId.get(g.home.teamId);
    if (!awayRec || !homeRec) continue;

    // Pythagorean win pct from a blended (recent 60% / season 40%) RS/RA
    // — lets the model react to hot/cold streaks the full season washes
    // out without abandoning the season-long anchor.
    const awayPythag = blendedPythag(awayRec, aggregates?.teamRecentForm.get(g.away.teamId));
    const homePythag = blendedPythag(homeRec, aggregates?.teamRecentForm.get(g.home.teamId));

    const awaySpRaw = g.away.probablePitcher
      ? spStatsById.get(g.away.probablePitcher.id) ?? null
      : null;
    const homeSpRaw = g.home.probablePitcher
      ? spStatsById.get(g.home.probablePitcher.id) ?? null
      : null;
    // Recent-form blend for SP ERA — same idea as the team blend.
    const awaySpRecent = g.away.probablePitcher
      ? aggregates?.spRecentForm.get(g.away.probablePitcher.id)
      : undefined;
    const homeSpRecent = g.home.probablePitcher
      ? aggregates?.spRecentForm.get(g.home.probablePitcher.id)
      : undefined;
    const awaySp: ProbableSpStats | null = awaySpRaw
      ? { ...awaySpRaw, era: blendedSpEra(awaySpRaw, awaySpRecent) }
      : null;
    const homeSp: ProbableSpStats | null = homeSpRaw
      ? { ...homeSpRaw, era: blendedSpEra(homeSpRaw, homeSpRecent) }
      : null;

    // Log5 on talent, then apply SP + bullpen deltas (better-than-avg
    // SP/pen nudge probability toward that team), then apply home-field
    // bump. The deltas nudge talent BEFORE log5 — equivalent to saying
    // "today's team is the season team plus/minus its SP and bullpen
    // quality relative to league."
    const awayBp = aggregates?.teamBullpen.get(g.away.teamId);
    const homeBp = aggregates?.teamBullpen.get(g.home.teamId);
    const cfg = inputs.config;
    const awayAdj = clamp(awayPythag + spDelta(awaySp, cfg) + bullpenDelta(awayBp, lgBullpenEra), 0.05, 0.95);
    const homeAdj = clamp(homePythag + spDelta(homeSp, cfg) + bullpenDelta(homeBp, lgBullpenEra), 0.05, 0.95);
    const awayWinNeutral = log5(awayAdj, homeAdj);
    const hfa = cfg?.homeFieldBump ?? HOME_FIELD_BUMP;
    const homeWinProb = clamp((1 - awayWinNeutral) + hfa, 0.05, 0.95);
    const awayWinProb = 1 - homeWinProb;

    // NRFI model — uses 1st-inning-specific rates when we have enough
    // sample; falls back to full-season rates (v0 behavior) otherwise.
    // Offense factor compares the two lineups' 1st-inning RPG to the
    // league 1st-inning RPG; SP factor compares each starter's
    // 1st-inning ERA to the league 1st-inning ERA.
    const awayFullRpg = awayRec.gamesPlayed > 0 ? awayRec.runsScored / awayRec.gamesPlayed : LG_AVG_RPG;
    const homeFullRpg = homeRec.gamesPlayed > 0 ? homeRec.runsScored / homeRec.gamesPlayed : LG_AVG_RPG;
    const away1stRpg = team1stInningRpg(aggregates?.team1stInning.get(g.away.teamId), lgFirstInningRpg);
    const home1stRpg = team1stInningRpg(aggregates?.team1stInning.get(g.home.teamId), lgFirstInningRpg);
    // Park factor multiplies the offense factor — Coors (1.18) makes
    // NRFI less likely, Petco (0.91) makes it more likely. The
    // geometric-mean combination below ensures park factor's effect
    // on NRFI is roughly sqrt(parkFactor), so a 20% park boost is
    // ~10% NRFI suppression. Feels right for a single-inning bet.
    const parkFactor = parkFactorForHomeTeam(g.home.teamId);
    const offenseFactor = (((away1stRpg + home1stRpg) / 2) / lgFirstInningRpg) * parkFactor;

    const awaySpId = g.away.probablePitcher?.id;
    const homeSpId = g.home.probablePitcher?.id;
    const awaySp1stEra = awaySpId !== undefined
      ? sp1stInningEra(aggregates?.spFirstInning.get(awaySpId), lgSpFirstInningEra)
      : lgSpFirstInningEra;
    const homeSp1stEra = homeSpId !== undefined
      ? sp1stInningEra(aggregates?.spFirstInning.get(homeSpId), lgSpFirstInningEra)
      : lgSpFirstInningEra;
    const spFactor = lgSpFirstInningEra / ((awaySp1stEra + homeSp1stEra) / 2);

    // Combine — geometric mean of the two factors so neither dominates.
    const combined = Math.sqrt(spFactor / offenseFactor);
    const rawNrfi = BASELINE_NRFI * combined;
    const nrfi = clamp(rawNrfi, NRFI_MIN, NRFI_MAX);

    // Per-game RPG is still useful for the side panel display ("DET
    // scoring 4.8/game" stays familiar even though the model now uses
    // 1st-inning splits internally). Keep both around for the renderer.
    const awayRpg = awayFullRpg;
    const homeRpg = homeFullRpg;

    // ─── Apply empirical calibration ─────────────────────────────────
    // Shrink toward 0.5 so the displayed probability matches observed
    // frequency. See WIN_SHRINKAGE / NRFI_SHRINKAGE for the empirical
    // fit. From here down, "homeWinProbCal" / "nrfiCal" are what the
    // model contracts for — both downstream play logic and the renderer
    // consume the calibrated values, not the raw ones.
    const winShrink  = cfg?.winShrinkage  ?? WIN_SHRINKAGE;
    const nrfiShrink = cfg?.nrfiShrinkage ?? NRFI_SHRINKAGE;
    const homeWinProbCal = clamp(0.5 + winShrink  * (homeWinProb - 0.5), 0.05, 0.95);
    const awayWinProbCal = 1 - homeWinProbCal;
    const nrfiCal        = clamp(0.5 + nrfiShrink * (nrfi        - 0.5), NRFI_MIN, NRFI_MAX);

    const favorite: "away" | "home" | "even" = awayWinProbCal > 0.52 ? "away" : homeWinProbCal > 0.52 ? "home" : "even";

    games.push({
      gamePk: g.gamePk,
      startTime: g.gameDate,
      status: g.status,
      away: {
        teamId: g.away.teamId,
        abbr: g.away.abbr,
        teamName: g.away.teamName,
        isHome: false,
        record: { wins: awayRec.wins, losses: awayRec.losses },
        runsPerGame: awayRpg,
        runsAllowedPerGame: awayRec.gamesPlayed > 0 ? awayRec.runsAllowed / awayRec.gamesPlayed : LG_AVG_RPG,
        pythagWinPct: awayPythag,
        probableSp: g.away.probablePitcher && awaySp
          ? { name: g.away.probablePitcher.fullName, era: awaySp.era, wins: awaySp.wins, losses: awaySp.losses }
          : g.away.probablePitcher
            ? { name: g.away.probablePitcher.fullName, era: null, wins: null, losses: null }
            : null,
        winProbability: awayWinProbCal,
      },
      home: {
        teamId: g.home.teamId,
        abbr: g.home.abbr,
        teamName: g.home.teamName,
        isHome: true,
        record: { wins: homeRec.wins, losses: homeRec.losses },
        runsPerGame: homeRpg,
        runsAllowedPerGame: homeRec.gamesPlayed > 0 ? homeRec.runsAllowed / homeRec.gamesPlayed : LG_AVG_RPG,
        pythagWinPct: homePythag,
        probableSp: g.home.probablePitcher && homeSp
          ? { name: g.home.probablePitcher.fullName, era: homeSp.era, wins: homeSp.wins, losses: homeSp.losses }
          : g.home.probablePitcher
            ? { name: g.home.probablePitcher.fullName, era: null, wins: null, losses: null }
            : null,
        winProbability: homeWinProbCal,
      },
      nrfiProbability: nrfiCal,
      winConfidence: Math.abs(homeWinProbCal - 0.5) * 2,    // 0 = coin flip, 1 = lock
      nrfiConfidence: Math.abs(nrfiCal - 0.5) * 2,
      favorite,
    });
  }

  // Sort by start time so the slate reads chronologically.
  games.sort((a, b) => (a.startTime < b.startTime ? -1 : 1));

  return {
    date,
    generatedAt: new Date().toISOString(),
    games,
    gameCount: games.length,
  };
}
