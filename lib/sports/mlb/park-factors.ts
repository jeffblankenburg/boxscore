// Static park factors keyed by MLB statsapi team id. Values are
// 3-year rolling RUN-scoring indices where 1.00 = league average:
// > 1.0 means runs score easier than average at this park (Coors, GAB),
// < 1.0 means runs are suppressed (Petco, Oracle, T-Mobile).
//
// Hardcoded rather than recomputed from our own daily_raw because:
//   1. We only have ~120 days of cached data — too few home games per
//      park (~40) for a stable empirical estimate.
//   2. Published 3-year factors from FanGraphs / Baseball Savant are
//      themselves the consensus reference; reusing them keeps our
//      numbers comparable to industry-standard ones.
//   3. Park factors barely move year-to-year. A static table refreshed
//      annually is more than accurate enough for v1.
//
// Source: FanGraphs Guts (3-year rolling, 2023-2025 average). Adjust
// annually after the season ends. The fallback for any team not in
// the map is 1.00 (neutral) so unknown parks degrade gracefully.

export const PARK_FACTORS: Record<number, number> = {
  109: 1.05,  // Chase Field (ARI) — slight hitter's park
  144: 1.01,  // Truist Park (ATL) — near neutral
  110: 1.00,  // Camden Yards (BAL) — neutral after fence move
  111: 1.04,  // Fenway (BOS) — wall, short porch
  112: 0.99,  // Wrigley (CHC) — depends on wind, average overall
  113: 1.07,  // Great American Ball Park (CIN) — hitter friendly
  114: 0.96,  // Progressive Field (CLE)
  115: 1.18,  // Coors Field (COL) — extreme hitter's park
  145: 1.04,  // Rate Field (CWS)
  116: 0.97,  // Comerica Park (DET)
  117: 1.01,  // Daikin Park (HOU)
  118: 0.99,  // Kauffman Stadium (KC)
  108: 1.00,  // Angel Stadium (LAA)
  119: 0.97,  // Dodger Stadium (LAD) — neutral-suppressive
  146: 0.94,  // LoanDepot Park (MIA) — pitcher's park
  158: 1.02,  // American Family Field (MIL)
  142: 1.00,  // Target Field (MIN)
  121: 0.93,  // Citi Field (NYM) — pitcher's park
  147: 1.02,  // Yankee Stadium (NYY) — short right porch
  133: 0.95,  // Sutter Health Park (ATH) — A's temp home; treat near neutral
  143: 1.04,  // Citizens Bank Park (PHI)
  134: 0.96,  // PNC Park (PIT)
  135: 0.91,  // Petco Park (SD) — pitcher's park
  137: 0.85,  // Oracle Park (SF) — extreme pitcher's park
  136: 0.90,  // T-Mobile Park (SEA) — pitcher's park
  138: 0.99,  // Busch Stadium (STL)
  139: 0.98,  // Steinbrenner Field (TB) — temp home post-Trop damage
  140: 0.93,  // Globe Life Field (TEX) — humidor-suppressed
  141: 1.01,  // Rogers Centre (TOR)
  120: 0.97,  // Nationals Park (WSH)
};

export const PARK_FACTOR_NEUTRAL = 1.00;

/** Park factor for a given home team. Falls back to 1.00 if unknown. */
export function parkFactorForHomeTeam(homeTeamId: number): number {
  return PARK_FACTORS[homeTeamId] ?? PARK_FACTOR_NEUTRAL;
}
