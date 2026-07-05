// CLV (Closing Line Value) math for MLB predictions.
//
// CLV is the standard sharp metric because it's *signal per bet*, not
// signal per outcome. Hit rate over 40 plays/month has a ±15pp CI —
// too noisy to tune on. CLV converges 5-10x faster because it doesn't
// wait for outcomes; it measures whether our price beat the market's
// closing consensus, which is treated as the sharpest available truth.
//
// Definitions used here:
//   * `impliedFromAmerican(odds)` — American → implied probability.
//     +150 → 0.400. -150 → 0.600.
//   * `devigTwoWay(p_a, p_b)` — remove the sportsbook's vig by
//     normalizing raw implied probs to sum to 1.0. For a two-way market
//     (home/away or NRFI/YRFI) this is straightforward proportional
//     scaling.
//   * `clvPercentagePoints(open, close)` — CLV in probability points.
//     Positive = we took a better price than the market closed at
//     (market moved TOWARD our side after we picked it).
//
// Everything is null-tolerant so callers don't have to pre-filter —
// missing odds on either side just yield null CLV.

/** Convert American odds to a raw implied probability (0-1). +150 → 0.4,
 *  -150 → 0.6. Returns null if odds is null or 0 (0 is not a valid
 *  American line and would divide by zero). */
export function impliedFromAmerican(odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  if (odds > 0)  return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

/** De-vig a two-way market. Raw implied probs sum to ~1.03-1.05 because
 *  the book takes a cut; normalize proportionally so they sum to 1.0.
 *  Returns null for either side if that side's raw implied is null. */
export function devigTwoWay(
  aRaw: number | null,
  bRaw: number | null,
): { a: number | null; b: number | null } {
  if (aRaw === null || bRaw === null) return { a: null, b: null };
  const total = aRaw + bRaw;
  if (total <= 0) return { a: null, b: null };
  return { a: aRaw / total, b: bRaw / total };
}

/** CLV in probability points. `open` is our snapshot-time implied
 *  probability, `close` is the market's closing implied probability.
 *  Positive = we picked before the market moved toward our side.
 *  Returns null if either input is null. */
export function clvPercentagePoints(
  open: number | null,
  close: number | null,
): number | null {
  if (open === null || close === null) return null;
  return (close - open) * 100;
}

/** Two-way ML CLV per game: computes de-vigged implied probs at open
 *  and close for both sides, then per-side CLV in pp. Feed in the four
 *  American-odds values from daily_odds (open) and closing_odds (close).
 *  Null-tolerant: any missing input yields null CLV for that side. */
export function mlClv(input: {
  openAwayOdds:  number | null;
  openHomeOdds:  number | null;
  closeAwayOdds: number | null;
  closeHomeOdds: number | null;
}): { away: number | null; home: number | null } {
  const oAway  = impliedFromAmerican(input.openAwayOdds);
  const oHome  = impliedFromAmerican(input.openHomeOdds);
  const cAway  = impliedFromAmerican(input.closeAwayOdds);
  const cHome  = impliedFromAmerican(input.closeHomeOdds);
  const open  = devigTwoWay(oAway, oHome);
  const close = devigTwoWay(cAway, cHome);
  return {
    away: clvPercentagePoints(open.a, close.a),
    home: clvPercentagePoints(open.b, close.b),
  };
}

/** NRFI/YRFI CLV per game — same shape as mlClv, but the two sides are
 *  NRFI (no first-inning runs) and YRFI (first-inning runs). */
export function nrfiClv(input: {
  openNrfiOdds:  number | null;
  openYrfiOdds:  number | null;
  closeNrfiOdds: number | null;
  closeYrfiOdds: number | null;
}): { nrfi: number | null; yrfi: number | null } {
  const oN  = impliedFromAmerican(input.openNrfiOdds);
  const oY  = impliedFromAmerican(input.openYrfiOdds);
  const cN  = impliedFromAmerican(input.closeNrfiOdds);
  const cY  = impliedFromAmerican(input.closeYrfiOdds);
  const open  = devigTwoWay(oN, oY);
  const close = devigTwoWay(cN, cY);
  return {
    nrfi: clvPercentagePoints(open.a, close.a),
    yrfi: clvPercentagePoints(open.b, close.b),
  };
}
