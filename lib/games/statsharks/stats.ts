// Stat catalog + daily rotation for Stat Sharks (#64). One source of
// truth for every stat the game knows about — the picker, the UI,
// the share text, and any future admin viewer all read from this file.
//
// Schema choices (read top-to-bottom for context):
//   - `side` decides which eligibility flag the picker filters on.
//   - `column` is the actual column name on player_seasons (lowercase).
//   - `direction = "higher"` means "more is better" (HR, RBI, …).
//     `direction = "lower"` means "less is better" (ERA, WHIP).
//   - `loosestGap` is the value ratio for round-1 warmup pairs. The
//     picker walks ratios down toward `tightestGap` as the streak grows.
//   - Rate stats (AVG, OBP, OPS, ERA, WHIP) have tighter gaps because
//     a 2× ratio on rate stats is almost never possible at the
//     prominent end of the pool (you don't see two .250 hitters where
//     one had a .500 season).

export type StatKey =
  | "HR" | "RBI" | "H" | "R" | "SB" | "BB" | "2B" | "3B"
  | "AVG" | "OBP" | "OPS"
  | "K" | "W" | "SV" | "IP" | "ERA" | "WHIP";

export type StatSide      = "batter" | "pitcher";
export type StatDirection = "higher" | "lower";

export type StatDef = {
  key:           StatKey;
  side:          StatSide;
  /** Used in the "Today: …" banner and share text. */
  label:         string;
  /** Header above the cards. */
  prompt:        string;
  /** Column on player_seasons. */
  column:        string;
  direction:     StatDirection;
  /** Format helpers — number of decimals for display. */
  decimals:      number;
  /** Render as ".300" without leading zero. */
  isRateStat:    boolean;
  /** Minimum value-ratio gap at the loosest difficulty (round 0). */
  loosestGap:    number;
  /** Minimum value-ratio gap at the tightest difficulty (round 20+). */
  tightestGap:   number;
};

// Counting stats: 2× gap at round 0 → 1.15× at round 20+.
// Rate stats:    1.4× → 1.05×.
const COUNTING_LOOSE = 2.0;
const COUNTING_TIGHT = 1.15;
const RATE_LOOSE     = 1.4;
const RATE_TIGHT     = 1.05;

export const STATS: Record<StatKey, StatDef> = {
  HR:   { key: "HR",   side: "batter",  label: "Home Runs",       prompt: "MORE HOME RUNS?", column: "hr",      direction: "higher", decimals: 0, isRateStat: false, loosestGap: COUNTING_LOOSE, tightestGap: COUNTING_TIGHT },
  RBI:  { key: "RBI",  side: "batter",  label: "RBI",             prompt: "MORE RBI?",       column: "rbi",     direction: "higher", decimals: 0, isRateStat: false, loosestGap: COUNTING_LOOSE, tightestGap: COUNTING_TIGHT },
  H:    { key: "H",    side: "batter",  label: "Hits",            prompt: "MORE HITS?",      column: "h",       direction: "higher", decimals: 0, isRateStat: false, loosestGap: COUNTING_LOOSE, tightestGap: COUNTING_TIGHT },
  R:    { key: "R",    side: "batter",  label: "Runs",            prompt: "MORE RUNS?",      column: "r",       direction: "higher", decimals: 0, isRateStat: false, loosestGap: COUNTING_LOOSE, tightestGap: COUNTING_TIGHT },
  SB:   { key: "SB",   side: "batter",  label: "Stolen Bases",    prompt: "MORE SB?",        column: "sb",      direction: "higher", decimals: 0, isRateStat: false, loosestGap: COUNTING_LOOSE, tightestGap: COUNTING_TIGHT },
  BB:   { key: "BB",   side: "batter",  label: "Walks",           prompt: "MORE WALKS?",     column: "bb_bat",  direction: "higher", decimals: 0, isRateStat: false, loosestGap: COUNTING_LOOSE, tightestGap: COUNTING_TIGHT },
  "2B": { key: "2B",   side: "batter",  label: "Doubles",         prompt: "MORE DOUBLES?",   column: "doubles", direction: "higher", decimals: 0, isRateStat: false, loosestGap: COUNTING_LOOSE, tightestGap: COUNTING_TIGHT },
  "3B": { key: "3B",   side: "batter",  label: "Triples",         prompt: "MORE TRIPLES?",   column: "triples", direction: "higher", decimals: 0, isRateStat: false, loosestGap: COUNTING_LOOSE, tightestGap: COUNTING_TIGHT },
  AVG:  { key: "AVG",  side: "batter",  label: "Batting Average", prompt: "HIGHER AVG?",     column: "avg",     direction: "higher", decimals: 3, isRateStat: true,  loosestGap: RATE_LOOSE,     tightestGap: RATE_TIGHT },
  OBP:  { key: "OBP",  side: "batter",  label: "On-base %",       prompt: "HIGHER OBP?",     column: "obp",     direction: "higher", decimals: 3, isRateStat: true,  loosestGap: RATE_LOOSE,     tightestGap: RATE_TIGHT },
  OPS:  { key: "OPS",  side: "batter",  label: "OPS",             prompt: "HIGHER OPS?",     column: "ops",     direction: "higher", decimals: 3, isRateStat: true,  loosestGap: RATE_LOOSE,     tightestGap: RATE_TIGHT },

  K:    { key: "K",    side: "pitcher", label: "Strikeouts",      prompt: "MORE K?",         column: "k",       direction: "higher", decimals: 0, isRateStat: false, loosestGap: COUNTING_LOOSE, tightestGap: COUNTING_TIGHT },
  W:    { key: "W",    side: "pitcher", label: "Wins",            prompt: "MORE WINS?",      column: "w",       direction: "higher", decimals: 0, isRateStat: false, loosestGap: COUNTING_LOOSE, tightestGap: COUNTING_TIGHT },
  SV:   { key: "SV",   side: "pitcher", label: "Saves",           prompt: "MORE SAVES?",     column: "sv",      direction: "higher", decimals: 0, isRateStat: false, loosestGap: COUNTING_LOOSE, tightestGap: COUNTING_TIGHT },
  IP:   { key: "IP",   side: "pitcher", label: "Innings Pitched", prompt: "MORE IP?",        column: "ip",      direction: "higher", decimals: 1, isRateStat: false, loosestGap: COUNTING_LOOSE, tightestGap: COUNTING_TIGHT },
  ERA:  { key: "ERA",  side: "pitcher", label: "ERA",             prompt: "LOWER ERA?",      column: "era",     direction: "lower",  decimals: 2, isRateStat: true,  loosestGap: RATE_LOOSE,     tightestGap: RATE_TIGHT },
  WHIP: { key: "WHIP", side: "pitcher", label: "WHIP",            prompt: "LOWER WHIP?",     column: "whip",    direction: "lower",  decimals: 2, isRateStat: true,  loosestGap: RATE_LOOSE,     tightestGap: RATE_TIGHT },
};

// Stats currently surfaced in the game. Used for both the daily
// rotation and the Endless mode chooser. The full STATS catalog stays
// intact so we can switch any stat on later without re-importing or
// re-typing the chart; we just expand this whitelist.
//
// Filter (per Jeff, 2026-06-13):
//   Batters: HR, RBI, H, SB, AVG
//   Pitchers: W, K, SV, ERA
export const VISIBLE_STATS: ReadonlyArray<StatKey> = [
  "HR", "RBI", "H", "SB", "AVG",
  "K",  "W",   "SV", "ERA",
];

// Daily rotation. Interleaved batter / pitcher stats so a player who
// shows up two days in a row doesn't experience "batter week" or
// "pitcher week". 9 stats → cycle every 9 days.
export const ROTATION: ReadonlyArray<StatKey> = [
  "HR", "K", "RBI", "ERA", "H", "W", "SB", "SV", "AVG",
];

/**
 * Returns today's stat as a pure function of `yyyymmdd`. The same date
 * always returns the same stat — every subscriber worldwide gets the
 * same daily category, which is how the daily-leaderboard share talk
 * works. Anchored at noon UTC so DST shifts don't change the cycle.
 */
export function statForDate(yyyymmdd: string): StatDef {
  const epochDays = Math.floor(
    new Date(`${yyyymmdd}T12:00:00Z`).getTime() / 86_400_000,
  );
  const key = ROTATION[((epochDays % ROTATION.length) + ROTATION.length) % ROTATION.length]!;
  return STATS[key];
}

/**
 * Linear gap ratio interpolation. Round 0 returns `loosestGap`,
 * round `totalRounds`+ returns `tightestGap`. The picker uses this
 * to enforce a value-ratio gap between player A and player B that
 * shrinks as the user's streak grows.
 *
 * Pass `totalRounds=10` for the 10-round Daily mode (the curve peaks
 * by the last round). Endless mode keeps the default 20 so streaks
 * past 10 still have room to get harder.
 */
export function gapForRound(stat: StatDef, round: number, totalRounds = 20): number {
  const T = totalRounds;
  const t = Math.max(0, Math.min(T, round)) / T;
  return stat.loosestGap + (stat.tightestGap - stat.loosestGap) * t;
}

/**
 * Format a stat value for display. Counting stats render as the raw
 * integer; rate stats render with the appropriate decimals and a
 * leading-zero drop ("0.300" → ".300") for the classic baseball look.
 */
export function formatStatValue(stat: StatDef, value: number): string {
  if (!stat.isRateStat) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: stat.decimals,
      maximumFractionDigits: stat.decimals,
    });
  }
  const fixed = value.toFixed(stat.decimals);
  // ".300" not "0.300" for AVG/OBP/OPS. ERA/WHIP keep the leading digit
  // because they're typically > 1.
  if (stat.key === "AVG" || stat.key === "OBP" || stat.key === "OPS") {
    return fixed.startsWith("0.") ? fixed.slice(1) : fixed;
  }
  return fixed;
}
