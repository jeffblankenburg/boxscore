// Shared shapes for the full-season leaderboard pages (/[sport]/leaders/[category]).
// Each sport implements a SportLeadersProvider; the page + dispatcher
// (lib/sports/leaders.ts) are sport-agnostic and render whatever columns the
// provider returns (one column for single-table sports like NHL/WNBA, two for
// conference/league splits like MLB AL/NL or NBA East/West).

/** One ranked player row. The player name is pre-linked by the provider using
 *  that sport's own player-link helper, so this module stays sport-agnostic. */
export type LeaderRow = {
  rank: number;
  nameHtml: string;   // player name, already wrapped in the sport's player-page <a> (or plain text)
  teamAbbr: string;
  value: string;      // formatted for display (".316", "43", "1.95")
};

/** A titled column of ranked rows (e.g. "American League"). */
export type LeaderColumn = {
  label: string;
  rows: LeaderRow[];
};

/** Minimal category descriptor for the stat sub-nav. */
export type LeaderCategoryMeta = {
  slug: string;
  label: string;       // "Batting Average"
  valueLabel: string;  // "AVG" — shown in the sub-nav and as the value column header
};

/** Everything the page needs to render one leaderboard. */
export type FullLeaderboard = {
  category: LeaderCategoryMeta;
  season: number;
  columns: LeaderColumn[];        // 1 or 2
  qualifierNote: string | null;   // shown under the title (qualifier rule, or the "no minimum" note)
};

/** A sport's leaderboard implementation. */
export type SportLeadersProvider = {
  /** Categories in sub-nav order. */
  categories: LeaderCategoryMeta[];
  /** Load one category's full leaderboard, or null if the slug is unknown (→ 404).
   *  The provider owns its own season derivation (MLB uses the calendar year,
   *  NHL/NBA the season's end year) and returns it in FullLeaderboard.season. */
  load(slug: string): Promise<FullLeaderboard | null>;
};
