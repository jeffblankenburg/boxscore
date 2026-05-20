// Per-sport admin feature matrix. Extracted so the per-league dashboard page
// AND the universal dashboard's watchwall + cron grid all reference the same
// "what does this sport actually have wired" table. Adding a sport or moving
// it through phases (e.g. NBA gaining send-email when its renderer ships)
// happens in one place.

export const ALL_CRON_ROUTES = [
  "generate",
  "send-email",
  "send-team-email",
  "post-twitter",
  "post-bluesky",
  "post-facebook",
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
  // NBA/WNBA: league send wired but no team digests or social posts yet.
  // The watchwall will flag generate/send-email as missing if they don't
  // run; the team/post routes stay intentionally absent so they don't
  // show up as red rows for routes that aren't supposed to exist yet.
  nba:  { hasPreview: true,  hasShareImages: false, hasTeamDigests: false, hasRegenAll: false, expectedRoutes: ["generate", "send-email"] },
  wnba: { hasPreview: true,  hasShareImages: false, hasTeamDigests: false, hasRegenAll: false, expectedRoutes: ["generate", "send-email"] },
};

export function featuresFor(sport: string): SportFeatures {
  return SPORT_FEATURES[sport] ?? SPORT_FEATURES.mlb!;
}
