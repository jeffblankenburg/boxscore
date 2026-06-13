// Two-way player exception list for Hi/Lo eligibility (#64). A row's
// batter_eligible / pitcher_eligible flags are usually decided by the
// player's primary_position from the MLB API. These players appear in
// BOTH pools regardless of their primary position because their
// non-primary side was genuinely meaningful at MLB level.
//
// Keyed by MLB player id (the value in players.mlb_id), not our
// internal id, so adding a new exception only requires looking up the
// mlb_id once. The set is small on purpose — Rick Ankiel, Brooks
// Kieschnick, etc. were not "great enough" in both halves to be
// interesting matchups, but the door is open if Jeff wants to add
// them later.

export const TWO_WAY_MLB_IDS: ReadonlySet<number> = new Set<number>([
  121578,  // Babe Ruth
  660271,  // Shohei Ohtani
]);

// Inclusion thresholds — independent of the prominence ranking the
// picker applies on top. A 100-PA backup catcher is "eligible" but
// won't appear in a top-100 stat pool because the picker filters by
// season rank.
export const MIN_PA_FOR_BATTER  = 100;
export const MIN_IP_FOR_PITCHER = 20;

export function computeEligibility(opts: {
  primary_position: string | null;
  mlb_id:           number;
  pa:               number | null;
  ip:               number | null;
}): { batter_eligible: boolean; pitcher_eligible: boolean } {
  const twoWay = TWO_WAY_MLB_IDS.has(opts.mlb_id);
  const positionAllowsBatter   = twoWay || (opts.primary_position !== "P" && opts.primary_position !== null);
  const positionAllowsPitcher  = twoWay || opts.primary_position === "P";
  return {
    batter_eligible:  positionAllowsBatter  && (opts.pa ?? 0) >= MIN_PA_FOR_BATTER,
    pitcher_eligible: positionAllowsPitcher && (opts.ip ?? 0) >= MIN_IP_FOR_PITCHER,
  };
}

// Parse MLB API's baseball-innings string ("198.2" = 198 + 2/3) into a
// decimal. Returns null for unparseable or absent strings.
export function parseInnings(ip: string | number | null | undefined): number | null {
  if (ip == null) return null;
  if (typeof ip === "number") return Number.isFinite(ip) ? ip : null;
  const m = String(ip).match(/^(\d+)(?:\.(\d))?$/);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = m[2] ? Number(m[2]) : 0;
  if (frac > 2) return null;       // .3+ would be invalid baseball innings
  return Math.round((whole + frac / 3) * 100) / 100;
}
