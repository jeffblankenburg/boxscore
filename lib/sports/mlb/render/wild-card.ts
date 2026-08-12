import type { MlbStandingRow, MlbWildCardStandings } from "../types";

// Which wild-card teams to render, shared by the web and email renderers so the
// two surfaces can't drift. The three wild-card spots are always shown, then the
// chasers (teams currently OUT of the picture): at least MIN_CHASERS of them,
// and MORE when additional teams sit within WC_MAX_GB games of the cutoff. So a
// bunched race surfaces everyone still alive, while a lopsided race still shows
// the nearest three. (Jeff, 2026-08-12: "always at least three teams out of the
// race, but when more than three are within 3 games, cut it to teams within 3.")
const WC_SPOTS = 3;      // three wild-card berths per league
const WC_MAX_GB = 3;     // "within 3 games of the cutoff"
const MIN_CHASERS = 3;   // always show at least this many teams outside the picture

export function wildCardVisibleTeams(wc: MlbWildCardStandings): MlbStandingRow[] {
  const sorted = [...wc.teams].sort(
    (a, b) => (a.wildCardRank ?? 99) - (b.wildCardRank ?? 99),
  );
  // wildCardGamesBehind is <= 0 for teams holding a spot, positive = games back.
  const chasers = sorted.slice(WC_SPOTS);
  const withinRange = chasers.filter(
    (t) => (t.wildCardGamesBehind ?? 0) <= WC_MAX_GB,
  ).length;
  let cutoff = WC_SPOTS + Math.max(MIN_CHASERS, withinRange);
  // Don't split teams tied on record at the boundary (same W-L ⇒ same games
  // back), matching the tiebreaker courtesy of the old fixed-count renderer.
  while (
    cutoff < sorted.length &&
    sorted[cutoff]!.wins === sorted[cutoff - 1]!.wins &&
    sorted[cutoff]!.losses === sorted[cutoff - 1]!.losses
  ) {
    cutoff++;
  }
  return sorted.slice(0, cutoff);
}
