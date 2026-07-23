// Daily card selector — edge-aware (2026-07-22 redesign).
//
// House policy (Jeff, 2026-07-22): every day's card carries a MINIMUM of
// one pick per required market (ML + NRFI — the "top picks", surfaced even
// when nothing clears the bar) and a MAXIMUM of 5 picks total.
//
// Filler picks are ranked by estimated EV per $1 staked, NOT raw
// conviction. The naive conviction-ranked hybrid proved why: cross-market
// probabilities aren't comparable (a 0.60 NRFI at -115 and a 0.60 ML at
// -150 are different-value picks), so high-volume NRFI candidates crowded
// out v6's rarer elite ML and the hybrid card landed BELOW v6-alone
// (+5.2% vs +7.1% ROI). Both baselines are reproduced in
// scripts/fit-registry.ts.
//
// Two hard-won calibration rules (scripts/fit-registry.ts, 2026-07-22):
//   * EV is computed at the market's TYPICAL price (defaultOdds), never
//     the per-game captured line. Ranking by per-game EV selects the games
//     where the model disagrees most with the market — and when our model
//     disagrees with the ML market, the market is usually right (per-game
//     EV ranking scored 42% on ML vs 68% for conviction ranking). Per-game
//     lines are used only for the odds-band filter and grading. Revisit
//     once closing-line history is deep enough to measure real CLV.
//   * recal is a PICK-REGION shift, not a global linear fit: p' = p + a
//     where a = (realized hit rate − mean stated prob) over the market's
//     historical pick region. Global OLS says v6 ML is calibrated on
//     average (slope ≈ 1.0) while its >0.545 picks hit 68% — the
//     miscalibration lives in the tail where we actually bet, so that's
//     where it must be measured.
//
// Each market's policy: recal shift, defaultOdds, filler threshold on the
// STATED probability scale, required flag, optional odds-band filter.
//
// Pure function: plain data in, ordered card out. Engine-agnostic — the
// per-market registry decides which model's probability feeds each
// market's candidates (ML=v6, NRFI=v7 today; player props later).

import { americanToProfitMultiplier } from "./clv";

export type Market = "ML" | "NRFI";

export type CardCandidate = {
  gamePk: number;
  market: Market;
  /** The recommended side, already resolved by the caller (ML is
   *  home-only by design; NRFI vs YRFI follows the favored side). */
  side: "home" | "NRFI" | "YRFI";
  /** The engine's stated P(side wins), pre-recalibration. */
  probability: number;
  /** Captured American price for the side, if any. Internal-only; used
   *  for the odds-band filter, never for EV ranking (see header). */
  odds: number | null;
};

export type MarketPolicy = {
  /** Pick-region recalibration shift: p' = clamp(p + recalShift).
   *  Fit by scripts/fit-registry.ts. */
  recalShift: number;
  /** Market-typical American price; EV for ranking is computed here. */
  defaultOdds: number;
  /** Filler picks need stated probability ≥ threshold. */
  threshold: number;
  /** Whether the daily card guarantees one pick from this market. */
  required: boolean;
  /** Odds-band filter for filler picks; guaranteed picks ignore it. */
  oddsOk?: (odds: number | null) => boolean;
};

export type CardPick = {
  gamePk: number;
  market: Market;
  side: "home" | "NRFI" | "YRFI";
  /** Recalibrated win probability of the side. */
  probability: number;
  /** Estimated EV per $1 at the market's typical price. */
  ev: number;
  /** The min-1 top pick for its market. */
  guaranteed: boolean;
};

// Recal extrapolation guard: the card should never claim certainty.
const clampP = (p: number) => Math.min(0.99, Math.max(0.01, p));

export function selectDailyCard(
  candidates: CardCandidate[],
  policies: Record<Market, MarketPolicy>,
  maxPicks = 5,
): CardPick[] {
  type Scored = { pick: CardPick; stated: number; odds: number | null };
  const scored: Scored[] = candidates.map((c) => {
    const pol = policies[c.market];
    const p = clampP(c.probability + pol.recalShift);
    const mult = americanToProfitMultiplier(pol.defaultOdds);
    return {
      stated: c.probability, odds: c.odds,
      pick: {
        gamePk: c.gamePk, market: c.market, side: c.side,
        probability: p, ev: p * mult - (1 - p), guaranteed: false,
      },
    };
  });

  // Guaranteed top picks: best EV per required market, no filters — the
  // house rule wants a best-of-slate lean even on a thin day.
  const picks: CardPick[] = [];
  const taken = new Set<string>();
  for (const market of Object.keys(policies) as Market[]) {
    if (!policies[market].required) continue;
    const best = scored.filter((s) => s.pick.market === market)
      .reduce<Scored | null>((b, s) => (b === null || s.pick.ev > b.pick.ev ? s : b), null);
    if (best) {
      picks.push({ ...best.pick, guaranteed: true });
      taken.add(`${best.pick.gamePk}|${best.pick.market}`);
    }
  }

  // Filler: everything that clears its market's stated threshold and odds
  // band, by EV descending.
  const pool = scored
    .filter((s) => !taken.has(`${s.pick.gamePk}|${s.pick.market}`))
    .filter((s) => s.stated >= policies[s.pick.market].threshold)
    .filter((s) => policies[s.pick.market].oddsOk?.(s.odds) ?? true)
    .sort((a, b) => b.pick.ev - a.pick.ev);
  for (const s of pool) {
    if (picks.length >= maxPicks) break;
    picks.push(s.pick);
  }
  return picks;
}
