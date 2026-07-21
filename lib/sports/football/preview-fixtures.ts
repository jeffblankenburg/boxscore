// Known-good preview fixtures the admin preview falls back to / jumps to.
// Values are GAMES dates (the day recapped); the preview page converts to the
// edition date via nextDay().
//
// The NFL ships an email the morning after each game day, so the preview
// offers one variant per email: Friday recaps Thursday, Sunday recaps
// Saturday, Monday recaps Sunday, Tuesday recaps Monday. All four are pinned
// to a single week (Week 16, 2025) so the standings/leaders match and only the
// day's slate changes.

export const NFL_PREVIEW_MODES = [
  "Regular Season - Friday",
  "Regular Season - Sunday",
  "Regular Season - Monday",
  "Regular Season - Tuesday",
] as const;
export type NflPreviewMode = (typeof NFL_PREVIEW_MODES)[number];

// mode → games date recapped by that morning's email.
export const NFL_PREVIEW_FIXTURES: Record<NflPreviewMode, string> = {
  "Regular Season - Friday": "2025-12-18",  // Thursday Night Football
  "Regular Season - Sunday": "2025-12-20",  // Saturday slate
  "Regular Season - Monday": "2025-12-21",  // Sunday slate (flagship)
  "Regular Season - Tuesday": "2025-12-22", // Monday Night Football
};

export const FOOTBALL_PREVIEW_FIXTURES = {
  // Default to the Monday edition (Sunday's full slate) — the flagship email.
  nfl: NFL_PREVIEW_FIXTURES["Regular Season - Monday"],
  ncaaf: "2025-09-06", // Week 2 Saturday, ~80 FBS games
} as const;
