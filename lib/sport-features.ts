// Per-sport admin feature matrix. Extracted so the per-league dashboard page
// AND the universal dashboard's watchwall + cron grid all reference the same
// "what does this sport actually have wired" table. Adding a sport or moving
// it through phases (e.g. NBA gaining send-email when its renderer ships)
// happens in one place.

// Ordered roughly chronologically by daily fire time so the watchwall reads
// left-to-right as the morning unfolds (9:00 generate → 10:00 supervise).
// post-facebook stays at the end as an unscheduled placeholder slot — when
// Facebook posting goes live it gets added to the daily schedule and starts
// passing on the wall without further wiring.
export const ALL_CRON_ROUTES = [
  "generate",
  "generate-sdio",
  "send-email",
  "post-twitter",
  "post-bluesky",
  "post-discord",
  "send-team-email",
  "ad-stats-snapshot",
  "supervise",
  "post-facebook",
] as const;
export type CronRoute = (typeof ALL_CRON_ROUTES)[number];

// Routes that don't belong to a single sport — the watchwall renders them
// in a synthetic "Platform" row because their cron_runs rows have sport=null
// and don't fit the per-sport groupings.
export const SPORTLESS_ROUTES: readonly CronRoute[] = ["supervise"];

export type SportFeatures = {
  hasPreview: boolean;
  hasShareImages: boolean;
  hasTeamDigests: boolean;
  hasRegenAll: boolean;
  // The cron routes this sport is *expected* to run. The watchwall and cron
  // grid use this to know what "missing" means — a route that's not in this
  // list is silently absent rather than red.
  expectedRoutes: readonly CronRoute[];
  // True for sports that only email on days a game was played (football:
  // NFL Thu/Sun/Mon, NCAAF mostly Saturdays). The generate cron runs daily
  // and skips persisting a digest on game-less days; send-email treats a
  // missing digest as a clean skip rather than a failure. Baseball/basketball
  // send every day in-season, so they leave this false.
  sendsOnGameDaysOnly?: boolean;
};

// MLB expects every per-sport route. supervise is excluded because it has no
// sport at insert time; it's shown on the synthetic Platform row instead.
const MLB_EXPECTED = ALL_CRON_ROUTES.filter(
  (r): r is CronRoute => !SPORTLESS_ROUTES.includes(r),
);

export const SPORT_FEATURES: Record<string, SportFeatures> = {
  mlb:  { hasPreview: true,  hasShareImages: true,  hasTeamDigests: true,  hasRegenAll: true,  expectedRoutes: MLB_EXPECTED },
  // NBA/WNBA: league send wired but no team digests or social posts yet.
  // The watchwall will flag generate/send-email as missing if they don't
  // run; the team/post routes stay intentionally absent so they don't
  // show up as red rows for routes that aren't supposed to exist yet.
  nba:  { hasPreview: true,  hasShareImages: false, hasTeamDigests: false, hasRegenAll: false, expectedRoutes: ["generate", "send-email"] },
  wnba: { hasPreview: true,  hasShareImages: false, hasTeamDigests: false, hasRegenAll: false, expectedRoutes: ["generate", "send-email"] },
  // Football: recap-only (no preview), and sends only on days with games.
  nfl:   { hasPreview: false, hasShareImages: false, hasTeamDigests: false, hasRegenAll: false, expectedRoutes: ["generate", "send-email"], sendsOnGameDaysOnly: true },
  ncaaf: { hasPreview: false, hasShareImages: false, hasTeamDigests: false, hasRegenAll: false, expectedRoutes: ["generate", "send-email"], sendsOnGameDaysOnly: true },
};

export function featuresFor(sport: string): SportFeatures {
  return SPORT_FEATURES[sport] ?? SPORT_FEATURES.mlb!;
}
