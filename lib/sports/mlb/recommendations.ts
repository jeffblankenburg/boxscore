// Daily recommendation selector (house rule from Jeff, 2026-07-22):
//   - MINIMUM 1 ML + 1 NRFI every day — our "top picks", surfaced even if
//     nothing clears threshold (best-of-slate fallback).
//   - MAXIMUM 5 picks/day total, filled by conviction in any ML/NRFI mix.
//
// Pure function: takes each game's derived probabilities for a single day,
// returns the ordered rec set. Engine-agnostic (v6 or v7 can feed it).
//
// ML is HOME-ONLY by design — away-side ML picks hit ~50–55% (noise) vs
// ~62% for home; see predictions.ts winPlayFor. So the guaranteed daily ML
// is the slate's best home favorite.

export type RecCandidate = {
  gamePk: number;
  awayAbbr: string;
  homeAbbr: string;
  homeWin: number;          // P(home wins)
  nrfi: number;             // P(no run in the 1st)
  homeMlOdds?: number | null;
};

export type Recommendation = {
  gamePk: number;
  market: "ML" | "NRFI";
  side: "home" | "NRFI" | "YRFI";
  probability: number;      // win prob of the recommended side
  guaranteed: boolean;      // the min-1 top pick for its market
};

export type RecOptions = {
  mlThreshold: number;      // e.g. 0.58 (v7 scale)
  nrfiThreshold: number;    // e.g. 0.55 (v7 scale)
  maxPicks?: number;        // default 5
  /** Odds-band filter for FILLER ML plays; guaranteed top ML ignores it. */
  oddsBandOk?: (odds: number | null | undefined) => boolean;
};

const nrfiConv = (nrfi: number) => Math.max(nrfi, 1 - nrfi);
const nrfiSide = (nrfi: number): "NRFI" | "YRFI" => (nrfi >= 0.5 ? "NRFI" : "YRFI");

export function selectDailyRecommendations(games: RecCandidate[], opts: RecOptions): Recommendation[] {
  const maxPicks = opts.maxPicks ?? 5;
  if (games.length === 0) return [];

  // Guaranteed top picks: best home favorite, best first-inning lean.
  const topMl = games.reduce((b, g) => (g.homeWin > b.homeWin ? g : b));
  const topNrfi = games.reduce((b, g) => (nrfiConv(g.nrfi) > nrfiConv(b.nrfi) ? g : b));

  const picks: Recommendation[] = [
    { gamePk: topMl.gamePk, market: "ML", side: "home", probability: topMl.homeWin, guaranteed: true },
    { gamePk: topNrfi.gamePk, market: "NRFI", side: nrfiSide(topNrfi.nrfi), probability: nrfiConv(topNrfi.nrfi), guaranteed: true },
  ];
  const taken = new Set(picks.map((p) => `${p.gamePk}|${p.market}`));

  // Filler pool: everything else that clears its threshold, by conviction.
  const pool: Recommendation[] = [];
  for (const g of games) {
    if (g.homeWin >= opts.mlThreshold && (opts.oddsBandOk?.(g.homeMlOdds) ?? true) && !taken.has(`${g.gamePk}|ML`)) {
      pool.push({ gamePk: g.gamePk, market: "ML", side: "home", probability: g.homeWin, guaranteed: false });
    }
    if ((g.nrfi >= opts.nrfiThreshold || g.nrfi <= 1 - opts.nrfiThreshold) && !taken.has(`${g.gamePk}|NRFI`)) {
      pool.push({ gamePk: g.gamePk, market: "NRFI", side: nrfiSide(g.nrfi), probability: nrfiConv(g.nrfi), guaranteed: false });
    }
  }
  pool.sort((a, b) => b.probability - a.probability);

  for (const p of pool) {
    if (picks.length >= maxPicks) break;
    picks.push(p);
  }
  return picks;
}
