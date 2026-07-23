// v7 production producer — an alternate `predictGames` that emits the same
// GamePrediction shape from the run-distribution engine (run-model.ts), so
// the snapshot cron, comparator, and renderer consume it unchanged.
//
// v7 runs as a SHADOW alongside v6: the snapshot writes a second
// daily_predictions row per game under V7_MODEL_VERSION, the comparator
// grades it automatically (it grades every model_version present), and the
// public page keeps filtering to v6. So v7 builds a live, graded forward
// track record without changing what subscribers see — until it's promoted.

import type {
  PredictionInputs, PredictionsResult, GamePrediction, PredictionSide,
  TeamSeasonRecord, ProbableSpStats,
} from "./predictions";
import type { SeasonAggregates } from "./season-aggregates";
import type { SlateTeam } from "@/lib/mlb";
import { parkFactorForHomeTeam } from "./park-factors";
import {
  deriveMarkets, halfInningLambdas, scorelessProb, shrinkRate,
  offenseFromRunsPerGame, pitcherFromRA9, bullpenFromRA9,
  DEFAULT_V7_CONFIG, type TeamInputs, type V7Config,
} from "./run-model";

export const V7_MODEL_VERSION = "v7-run-model";

// v7.1 — v7 with a SEASON-ADAPTIVE first-inning read for NRFI. Runs as a
// second graded shadow; the card keeps reading v7 until v7.1's live
// record earns the swap.
//
// Why: v7's static firstInningBump (fit on 2024-25 linescores) went stale
// — 2026 first innings are hotter AND differently shaped (lower scoreless
// prob at the same mean; plausibly ABS-challenge-driven), leaving v7's
// NRFI ~4.6pp overstated in the mean (52.3% vs 47.7% actual, a z≈3
// calibration rejection on 1,044 OOS games). v7.1 derives the bump from
// the season-to-date league 1st-inning rate the aggregates already
// compute (EB-shrunk toward the 2024-25 prior) and reads NRFI with a
// first-inning-specific dispersion. Fitted walk-forward 2026-07-23 by
// scripts/fit-first-inning-drift.ts: src=season, K=100, r1=0.55 (fold-
// stable); OOS calibration 47.8% vs 47.7% actual, picks@0.57 61.4% hit.
// ML/totals are v7-identical by construction — only the NRFI read moves.
export const V71_MODEL_VERSION = "v7.1-adaptive-nrfi";
const V71_PRIOR_RPG1 = 0.5209;  // 2024-25 league 1st-inning runs/half (fixtures)
const V71_PRIOR_K = 100;        // EB prior weight, in team-games
const V71_R1 = 0.55;            // first-inning NB dispersion, 2026 walk-forward

// Fitted 2026-07-22, walk-forward on the 2026 season (scripts/fit-v7.ts):
// betaOff heavily shrunk (team run-rate is noisy → lean on pitching),
// betaPitch 0.7, HFA 1.05. r + firstInningBump from linescore fixtures
// (scripts/fit-v7-dispersion.ts). Bump V7_MODEL_VERSION if these change.
export const V7_CONFIG: V7Config = {
  ...DEFAULT_V7_CONFIG,
  betaOff: 0.3,
  betaPitch: 0.7,
  hfaMultiplier: 1.05,
};

const ERA_TO_RA9 = 1.08; // earned-run ERA → all-runs allowed/9 (ER ≈ 92% of R)

/** Map the same as-of-date inputs v6 uses into the run-model's TeamInputs.
 *  Exported so the offline backtest loader shares one mapping. */
export function buildV7TeamInputs(
  teamId: number,
  spId: number | null,
  homeTeamId: number,
  records: Map<number, TeamSeasonRecord>,
  spStats: Map<number, ProbableSpStats>,
  aggregates: SeasonAggregates | undefined,
): TeamInputs {
  const rec = records.get(teamId);
  const rpg = rec && rec.gamesPlayed > 0 ? rec.runsScored / rec.gamesPlayed : 4.5;

  // SP RA9: season ERA blended 50/50 with recent-form ERA (≥2 starts), → RA9.
  let spEra = 4.2;
  if (spId != null) {
    const season = spStats.get(spId)?.era ?? 4.2;
    const recent = aggregates?.spRecentForm.get(spId);
    spEra = recent && recent.starts >= 2 && Number.isFinite(recent.era)
      ? 0.5 * recent.era + 0.5 * season
      : season;
  }
  const recentSp = spId != null ? aggregates?.spRecentForm.get(spId) : undefined;
  const expIP = recentSp && recentSp.starts >= 2 && recentSp.innings > 0
    ? recentSp.innings / recentSp.starts
    : 5.3;

  const bp = aggregates?.teamBullpen.get(teamId);
  const leagueBpEra = aggregates?.league.avgBullpenEra ?? 4.2;
  const bpEra = bp && bp.innings >= 60 ? bp.era : leagueBpEra;

  // Bullpen fatigue: last-2-day reliever IP vs league mean. Zero when
  // aggregates are missing (early season) → no adjustment in the engine.
  const fatigueExcessIp = aggregates
    ? (aggregates.teamBullpenRecentIp.get(teamId) ?? 0) - aggregates.league.avgBullpenRecentIp
    : 0;

  return {
    offense: offenseFromRunsPerGame(rpg),
    starter: pitcherFromRA9(spEra * ERA_TO_RA9, expIP),
    bullpen: { ...bullpenFromRA9(bpEra * ERA_TO_RA9), fatigueExcessIp },
    parkLogFactor: 0.5 * Math.log(parkFactorForHomeTeam(homeTeamId)),
  };
}

function pythag(rec: TeamSeasonRecord | undefined): number {
  if (!rec || (rec.runsScored <= 0 && rec.runsAllowed <= 0)) return 0.5;
  const rs = Math.pow(rec.runsScored, 1.83), ra = Math.pow(rec.runsAllowed, 1.83);
  return rs + ra > 0 ? rs / (rs + ra) : 0.5;
}

function toSide(t: SlateTeam, isHome: boolean, winProbability: number, inputs: PredictionInputs): PredictionSide {
  const rec = inputs.recordsByTeamId.get(t.teamId);
  const gp = rec?.gamesPlayed ?? 0;
  const pp = t.probablePitcher;
  const st = pp ? inputs.spStatsById.get(pp.id) : undefined;
  return {
    teamId: t.teamId,
    abbr: t.abbr,
    teamName: t.teamName,
    isHome,
    record: { wins: rec?.wins ?? 0, losses: rec?.losses ?? 0 },
    runsPerGame: gp > 0 ? rec!.runsScored / gp : 4.5,
    runsAllowedPerGame: gp > 0 ? rec!.runsAllowed / gp : 4.5,
    pythagWinPct: pythag(rec),
    probableSp: pp ? { name: pp.fullName, era: st?.era ?? null, wins: st?.wins ?? null, losses: st?.losses ?? null } : null,
    winProbability,
  };
}

function runV7(inputs: PredictionInputs, nrfiOverride?: (away: TeamInputs, home: TeamInputs) => number): PredictionsResult {
  const games: GamePrediction[] = inputs.slate.map((g) => {
    const away = buildV7TeamInputs(g.away.teamId, g.away.probablePitcher?.id ?? null, g.home.teamId, inputs.recordsByTeamId, inputs.spStatsById, inputs.aggregates);
    const home = buildV7TeamInputs(g.home.teamId, g.home.probablePitcher?.id ?? null, g.home.teamId, inputs.recordsByTeamId, inputs.spStatsById, inputs.aggregates);
    const m = deriveMarkets(away, home, V7_CONFIG);
    const rawNrfi = nrfiOverride ? nrfiOverride(away, home) : m.nrfi;
    // Guard the rare missing-input NaN so one game can't break the batch.
    const homeWin = Number.isFinite(m.homeWin) ? m.homeWin : 0.5;
    const awayWin = Number.isFinite(m.awayWin) ? m.awayWin : 0.5;
    const nrfi = Number.isFinite(rawNrfi) ? rawNrfi : 0.49;
    return {
      gamePk: g.gamePk,
      startTime: g.gameDate,
      status: g.status,
      away: toSide(g.away, false, awayWin, inputs),
      home: toSide(g.home, true, homeWin, inputs),
      nrfiProbability: nrfi,
      winConfidence: Math.abs(homeWin - 0.5),
      nrfiConfidence: Math.abs(nrfi - 0.5),
      favorite: homeWin > awayWin ? "home" : awayWin > homeWin ? "away" : "even",
    };
  });
  return { date: inputs.date, generatedAt: new Date().toISOString(), games, gameCount: games.length };
}

export function predictGamesV7(inputs: PredictionInputs): PredictionsResult {
  return runV7(inputs);
}

/** v7.1 — identical to v7 except the NRFI read: season-adaptive
 *  first-inning bump + first-inning dispersion (see V71_* constants). */
export function predictGamesV71(inputs: PredictionInputs): PredictionsResult {
  const aggs = inputs.aggregates;
  const leagueGames = aggs ? [...aggs.team1stInning.values()].reduce((s, t) => s + t.games, 0) : 0;
  const rpg1 = aggs && leagueGames > 0
    ? shrinkRate(aggs.league.avgFirstInningRpg, leagueGames, V71_PRIOR_RPG1, V71_PRIOR_K)
    : V71_PRIOR_RPG1;
  const cfg: V7Config = { ...V7_CONFIG, firstInningBump: Math.log(rpg1 / V7_CONFIG.leagueLambda) };
  return runV7(inputs, (away, home) => {
    const a1 = halfInningLambdas(away, home, false, cfg)[0]!;
    const h1 = halfInningLambdas(home, away, true, cfg)[0]!;
    return scorelessProb(a1, V71_R1) * scorelessProb(h1, V71_R1);
  });
}
