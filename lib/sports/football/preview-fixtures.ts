// Known-good dates the admin preview falls back to when no ?date= is given,
// so /admin/preview/nfl and /admin/preview/ncaaf load a full slate on first
// open. Both are 2025 regular-season game days with complete box scores,
// rankings (college), and standings.

export const FOOTBALL_PREVIEW_FIXTURES = {
  nfl: "2025-09-07",   // Week 1 Sunday, 13 games
  ncaaf: "2025-09-06", // Week 2 Saturday, ~80 FBS games
} as const;
