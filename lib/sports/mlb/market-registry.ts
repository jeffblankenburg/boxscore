// Per-market model registry — which engine feeds each bet market, and the
// selection policy for the daily card. This is the seam the improvement
// loop promotes into: a challenger that beats a market's champion swaps in
// HERE, without touching the other markets or the selector.
//
// Champions (Jeff, 2026-07-22): ML = v6 (its shrinkage makes it selective —
// pick-region hit 68%), NRFI = v7 (run-distribution engine; beats v6 NRFI
// in every analysis). The full head-to-head incl. the rejected naive
// hybrid and per-game-EV variants: scripts/fit-registry.ts.
//
// CARD_VERSION is the card's own contract, independent of the engines'
// model_versions: bump it when the registry mapping, a policy constant, or
// the selector logic changes, so the daily_picks track record stays
// attributable — same rule as PREDICTIONS_MODEL_VERSION.

import { type PredictionsResult } from "./predictions";
import { mlOddsInPlayableRange } from "./predictions";
import { PREDICTIONS_MODEL_VERSION } from "./predictions-data";
import { V7_MODEL_VERSION } from "./predictions-v7";
import {
  selectDailyCard,
  type CardCandidate,
  type CardPick,
  type Market,
  type MarketPolicy,
} from "./recommendations";

export const CARD_VERSION = "card-v1";

// Policy constants fitted 2026-07-22 by scripts/fit-registry.ts on the
// 2026 season through 06-30 (the latest walk-forward fold):
//   * recalShift: pick-region shift = realized hit − mean stated prob
//     (ML +0.049 over n=126 pick-region games; NRFI −0.009 over n=457).
//   * defaultOdds: median captured opening prices (DK ML home −123,
//     FanDuel NRFI/YRFI −113). EV for ranking is priced HERE — per-game
//     lines proved adverse-selection-prone (see recommendations.ts).
//   * threshold: each engine's stated-scale play threshold (v6 0.545 from
//     fit-calibration.ts; v7 NRFI 0.55 from the fit-v7.ts sweep).
export const CARD_MARKETS: Record<Market, { modelVersion: string; policy: MarketPolicy }> = {
  ML: {
    modelVersion: PREDICTIONS_MODEL_VERSION,
    policy: {
      recalShift: 0.049,
      defaultOdds: -123,
      threshold: 0.545,
      required: true,
      oddsOk: mlOddsInPlayableRange,
    },
  },
  NRFI: {
    modelVersion: V7_MODEL_VERSION,
    policy: {
      recalShift: -0.009,
      defaultOdds: -113,
      threshold: 0.55,
      required: true,
    },
  },
};

export type CardGameOdds = {
  homeMlOdds: number | null;
  nrfiOdds: number | null;
  yrfiOdds: number | null;
};

/** Build the day's card from the two engines' slates. Pure — callers load
 *  model output + whatever odds have been captured so far (missing odds
 *  only relax the ML band filter; ranking is at defaultOdds regardless). */
export function buildDailyCard(
  v6: PredictionsResult,
  v7: PredictionsResult,
  oddsByGamePk: Map<number, CardGameOdds>,
): CardPick[] {
  const v7ByPk = new Map(v7.games.map((g) => [g.gamePk, g]));
  const candidates: CardCandidate[] = [];
  for (const g of v6.games) {
    const odds = oddsByGamePk.get(g.gamePk);
    // ML is home-only by design — away-side ML picks graded ~50-55%
    // (noise) vs ~62% for home; see predictions.ts winPlayFor.
    candidates.push({
      gamePk: g.gamePk, market: "ML", side: "home",
      probability: g.home.winProbability, odds: odds?.homeMlOdds ?? null,
    });
    const v7g = v7ByPk.get(g.gamePk);
    if (v7g) {
      const fav = v7g.nrfiProbability >= 0.5;
      candidates.push({
        gamePk: g.gamePk, market: "NRFI", side: fav ? "NRFI" : "YRFI",
        probability: fav ? v7g.nrfiProbability : 1 - v7g.nrfiProbability,
        odds: (fav ? odds?.nrfiOdds : odds?.yrfiOdds) ?? null,
      });
    }
  }
  return selectDailyCard(
    candidates,
    { ML: CARD_MARKETS.ML.policy, NRFI: CARD_MARKETS.NRFI.policy },
  );
}
