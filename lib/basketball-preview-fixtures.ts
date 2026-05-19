// Known-good fixture dates per variant for the basketball admin preview.
// Same pattern as lib/mlb-preview-fixtures.ts but with basketball's calendar
// (no spring training, postseason in May-June for NBA, summer regular season
// for WNBA). Update freely — these are dev/QA fixtures.
//
// "current" defaults to whatever the loader resolves at request time
// (yesterday in ET) so we always have a date that's likely to have a
// digest. Other modes are pinned to specific dates representative of the
// variant.

import { yesterdayInET } from "./dates";

export type BasketballPreviewMode =
  | "current"
  | "regular-season"
  | "playoffs"
  | "off-day"
  | "offseason";

export const BASKETBALL_PREVIEW_MODES: BasketballPreviewMode[] = [
  "current",
  "regular-season",
  "playoffs",
  "off-day",
  "offseason",
];

export function nbaFixtureDate(mode: BasketballPreviewMode): string {
  switch (mode) {
    case "current":         return yesterdayInET();
    case "regular-season":  return "2026-03-12"; // busy regular-season Thursday
    case "playoffs":        return "2026-05-18"; // Conference Finals
    case "off-day":         return "2026-05-19"; // gap day between series
    case "offseason":       return "2025-07-15"; // mid-summer, no games
  }
}

export function wnbaFixtureDate(mode: BasketballPreviewMode): string {
  switch (mode) {
    case "current":         return yesterdayInET();
    case "regular-season":  return "2026-05-18"; // season starts mid-May
    case "playoffs":        return "2025-09-20"; // last year's playoffs (current season hasn't reached postseason yet)
    case "off-day":         return "2026-05-12"; // immediate pre-season day
    case "offseason":       return "2025-12-15"; // mid-winter, no WNBA games
  }
}

export function basketballFixtureDate(
  sport: "nba" | "wnba",
  mode: BasketballPreviewMode,
): string {
  return sport === "nba" ? nbaFixtureDate(mode) : wnbaFixtureDate(mode);
}
