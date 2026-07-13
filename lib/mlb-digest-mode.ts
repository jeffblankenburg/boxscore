import type { ScheduleGame } from "./mlb";
import type { DigestMode } from "./digest-mode";

// MLB-specific classifier for the DigestMode of a given date.
//
// MLB gameType codes:
//   R — regular season
//   S — spring training
//   E — exhibition (rare; treated as preseason)
//   A — All-Star Game
//   F — Wild Card series
//   D — Division Series
//   L — League Championship Series
//   W — World Series
//   P — postseason (generic; defensive fallback)
const POSTSEASON_TYPES = new Set(["F", "D", "L", "W", "P"]);
const PRESEASON_TYPES = new Set(["S", "E"]);

// Priority order matters when a date has mixed game types (rare in practice
// but possible at calendar boundaries — e.g. an exhibition the day before
// ASG). All-Star wins because the digest renders it as a single special
// section; postseason wins next because it changes the surrounding chrome
// (bracket replaces standings).
export function classifyDigestMode(
  games: ScheduleGame[],
  date: string,
  nextDayGames: ScheduleGame[] = [],
): DigestMode {
  const types = new Set(
    games.map((g) => g.gameType).filter((t): t is string => !!t),
  );

  if (types.has("A")) return "all-star";
  for (const t of types) if (POSTSEASON_TYPES.has(t)) return "postseason";
  if (types.has("R")) return "regular";
  for (const t of types) if (PRESEASON_TYPES.has(t)) return "preseason";

  // No games on the date. Distinguish offseason (Nov-Feb gap between the WS
  // and spring training) from in-season no-game days — which for MLB are
  // exclusively the All-Star break.
  const month = Number(date.slice(5, 7));
  if (month === 11 || month === 12 || month === 1 || month === 2) {
    return "offseason";
  }
  // Day before the ASG (tomorrow's slate is the ASG) → preview; any other
  // empty July day is a post-ASG break day → mid-season first-half recap.
  if (nextDayGames.some((g) => g.gameType === "A")) return "all-star-preview";
  if (month === 7) return "mid-season";
  return "no-games";
}
