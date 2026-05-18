// Per-day digest mode — what kind of day the digest is recapping.
//
// Sport-agnostic by design: every major North American league has the same
// calendar phases (regular season, midseason event, postseason, preseason,
// offseason, and incidental no-game days). The detection of *which* mode a
// given date falls into is sport-specific and lives in a sport-named module
// (e.g. lib/mlb-digest-mode.ts) since each league's data source uses its own
// game-type codes.

export type DigestMode =
  | "regular"      // normal in-season game day
  | "no-games"     // in-season but nobody's playing (ASG break, league-wide off-day)
  | "all-star"     // the All-Star Game / midseason event itself
  | "postseason"   // playoff game
  | "preseason"    // spring training (MLB) / preseason (NFL/NBA/NHL)
  | "offseason";   // gap between seasons
