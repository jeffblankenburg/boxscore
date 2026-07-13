// Per-day digest mode — what kind of day the digest is recapping.
//
// Sport-agnostic by design: every major North American league has the same
// calendar phases (regular season, midseason event, postseason, preseason,
// offseason, and incidental no-game days). The detection of *which* mode a
// given date falls into is sport-specific and lives in a sport-named module
// (e.g. lib/mlb-digest-mode.ts) since each league's data source uses its own
// game-type codes.

export type DigestMode =
  | "regular"          // normal in-season game day
  | "no-games"         // in-season but nobody's playing (defensive fallback; MLB has none outside the ASG break)
  | "all-star-preview" // day before the ASG: rosters + matchup preview + first-half standings/leaders
  | "all-star"         // the All-Star Game / midseason event itself (recap)
  | "mid-season"       // day after the ASG: first-half recap — standings + extended leaders + Today's Games
  | "postseason"       // playoff game
  | "preseason"        // spring training (MLB) / preseason (NFL/NBA/NHL)
  | "offseason";       // gap between seasons
