import type { DigestMode } from "./digest-mode";

// Known-good fixture dates per DigestMode for the MLB admin preview page.
// Each value is a games_date (the day the games were played); the edition it
// produces is games_date + 1. Each catalogued date must classify to its mode.
//
// `no-games` is present to keep this record total (some callers read
// MLB_PREVIEW_FIXTURES.regular directly) but is intentionally NOT in
// MLB_PREVIEW_MODES: MLB has no true in-season no-games day — the only empty
// in-season days are the All-Star break, which classify as all-star-preview /
// mid-season — so there is no real date that renders the no-games branch.
export const MLB_PREVIEW_FIXTURES: Record<DigestMode, string> = {
  // Wednesday + September is the widest weekday+month combo a dateline can
  // produce. Useful for catching dateline overflow that shorter dates miss.
  regular: "2025-09-24",
  "all-star-preview": "2025-07-14", // empty day; next day (07-15) is the ASG
  "all-star": "2025-07-15",         // the All-Star Game itself
  "mid-season": "2025-07-16",       // empty post-ASG day → first-half recap
  "no-games": "2025-07-14",         // unreachable for MLB (see note above)
  postseason: "2024-10-30",
  preseason: "2026-03-04",
  offseason: "2026-01-08",
};

// Dropdown order for the admin catalog. Omits no-games (no real MLB fixture).
export const MLB_PREVIEW_MODES: DigestMode[] = [
  "regular",
  "all-star-preview",
  "all-star",
  "mid-season",
  "postseason",
  "preseason",
  "offseason",
];
