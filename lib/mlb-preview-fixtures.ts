import type { DigestMode } from "./digest-mode";

// Known-good fixture dates per DigestMode for the MLB admin preview page.
// Each date must classify to its mapped mode (i.e. the schedule for that
// date must contain games of the right gameType, or for offseason/no-games
// the date must be in a gap window).
//
// Update freely — these are dev/QA fixtures, not user-facing data.
export const MLB_PREVIEW_FIXTURES: Record<DigestMode, string> = {
  // Wednesday + September is the widest weekday+month combo a dateline can
  // produce. Useful for catching dateline overflow that shorter dates miss.
  regular: "2025-09-24",
  "no-games": "2025-07-14",
  "all-star": "2025-07-15",
  postseason: "2024-10-30",
  preseason: "2026-03-04",
  offseason: "2026-01-08",
};

export const MLB_PREVIEW_MODES: DigestMode[] = [
  "regular",
  "no-games",
  "all-star",
  "postseason",
  "preseason",
  "offseason",
];
