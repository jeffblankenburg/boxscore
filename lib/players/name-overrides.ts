// Display-name overrides for the players cache. MLB's people endpoint
// returns the legal name (including Jr./Sr. on every legacy field —
// fullName, nameFirstLast, useName) even for players who are never
// commonly known by that suffix. Anyone in this map gets their
// players.full_name forced to the curated string at ingest time, so
// re-running backfill-player-profiles preserves the override.
//
// Keyed by MLB person id (= players.mlb_id), not our internal id.
//
// Bar for inclusion: someone whose Jr./Sr./III suffix is technically
// correct but nearly never used in broadcast / written reference.
// Don't add Ken Griffey Jr., Vlad Guerrero Jr., Ronald Acuña Jr.,
// Cal Ripken Jr. — those suffixes are part of the common usage.

export const PLAYER_NAME_OVERRIDES: Readonly<Record<number, string>> = {
  121597: "Nolan Ryan",   // MLB has him as "Nolan Ryan Jr." — never used.
};

export function applyNameOverride(mlbId: number, fullName: string): string {
  return PLAYER_NAME_OVERRIDES[mlbId] ?? fullName;
}
