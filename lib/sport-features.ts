// Per-sport admin feature matrix. Extracted so the per-league dashboard page
// AND the universal dashboard's watchwall + cron grid all reference the same
// "what does this sport actually have wired" table. Adding a sport or moving
// it through phases (e.g. NBA gaining send-email when its renderer ships)
// happens in one place.

export const ALL_CRON_ROUTES = [
  "generate",
  "send-email",
  "post-twitter",
  "post-bluesky",
] as const;
export type CronRoute = (typeof ALL_CRON_ROUTES)[number];

export type SportFeatures = {
  hasPreview: boolean;
  hasShareImages: boolean;
  hasTeamDigests: boolean;
  hasRegenAll: boolean;
  // The cron routes this sport is *expected* to run. The watchwall and cron
  // grid use this to know what "missing" means — a route that's not in this
  // list is silently absent rather than red.
  expectedRoutes: readonly CronRoute[];
};

export const SPORT_FEATURES: Record<string, SportFeatures> = {
  mlb:  { hasPreview: true,  hasShareImages: true,  hasTeamDigests: true,  hasRegenAll: true,  expectedRoutes: ALL_CRON_ROUTES },
  nba:  { hasPreview: true,  hasShareImages: false, hasTeamDigests: false, hasRegenAll: false, expectedRoutes: ["generate"] },
  wnba: { hasPreview: true,  hasShareImages: false, hasTeamDigests: false, hasRegenAll: false, expectedRoutes: ["generate"] },
};

export function featuresFor(sport: string): SportFeatures {
  return SPORT_FEATURES[sport] ?? SPORT_FEATURES.mlb!;
}
