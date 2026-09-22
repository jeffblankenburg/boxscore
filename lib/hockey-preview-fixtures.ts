// Known-good fixture dates per variant for the NHL admin preview. Same pattern
// as lib/basketball-preview-fixtures.ts. "current" resolves at request time
// (yesterday in ET); the rest are pinned dates representative of the variant.

import { yesterdayInET } from "./dates";

export type HockeyPreviewMode = "current" | "regular-season" | "playoffs" | "off-day" | "offseason";

export const HOCKEY_PREVIEW_MODES: HockeyPreviewMode[] = [
  "current", "regular-season", "playoffs", "off-day", "offseason",
];

export function hockeyFixtureDate(mode: HockeyPreviewMode): string {
  switch (mode) {
    case "current":        return yesterdayInET();
    case "regular-season": return "2025-04-13"; // busy end-of-regular-season Sunday
    case "playoffs":       return "2025-05-20"; // Conference Finals window
    case "off-day":        return "2025-07-15"; // mid-summer (no games)
    case "offseason":      return "2025-08-15"; // deep offseason
  }
}
