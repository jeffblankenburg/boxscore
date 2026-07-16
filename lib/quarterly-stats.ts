// Static quarterly stats — frozen at print, shared between the PDF
// one-pager (scripts/render-ad-onepager.ts) and the public /advertise
// page so a prospect who reads both sees the same numbers.
//
// Refresh once per quarter:
//   1. Run scripts/_compute-static-stats.ts to print the current values
//   2. For dailyImpressions, run:
//        npx tsx --env-file=.env.local scripts/compute-daily-impressions.ts 14
//   3. Paste them into QUARTERLY_STATS below
//   4. Bump the quarter title
//   5. Re-render the PDF (`npx tsx --env-file=.env.local scripts/render-ad-onepager.ts`)

export const QUARTERLY_STATS = {
  reportTitle: "2nd Quarter 2026 Report",

  // Total subscriber count = MLB league opt-ins + MLB team opt-ins,
  // intentionally not deduped. Most team subscribers also subscribe to
  // the league, so a given person can count twice; that's the honest
  // "newsletter slots" advertisers are reaching across all surfaces.
  totalSubscribers: 7930,

  // Open rate — locked to the current measured number (post-tracking-
  // pixel rollout 2026-06-23).
  openRate: 65.3,           // percent
  sendsLast30d: 224_147,    // last 30d send volume
  netGrowthLast30d: 396,    // net new subs over the same window

  // Demographic summary, computed from completed surveys (n=232) on
  // 2026-06-29. Percentages exclude prefer-not-to-say from the
  // denominator so they describe respondents who answered.
  demographicsAgeOver35: 86,        // %
  demographicsIncomeOver100k: 73,   // %
  demographicsMen: 97,              // %

  // Team digest opt-ins as of 2026-06-29.
  teamOptinTotal: 2143,
  topTeams: [
    ["nyy", 162], ["min", 157], ["bos", 138], ["chc", 113],
    ["lad", 97],  ["stl", 93],  ["atl", 92],  ["cin", 91],
  ] as Array<[string, number]>,

  // Actual audience reach an advertiser's line gets per edition: unique
  // league-digest email opens + production web pageviews on the dated page.
  // Trailing 14-day average through 2026-07-15, measured with the same
  // methodology as the advertiser dashboards (lib/ad-impressions.ts).
  // Refresh: scripts/compute-daily-impressions.ts 14. (Was a stale 5-day
  // trial figure of 3622 that undercounted the now-larger list.)
  dailyImpressions: 3929,   // (unique league opens + web pageviews) / edition

  // Trial campaign — anonymized, shown as "expected results." Clicks stay
  // trial-derived because they require an ad to actually be present; unlike
  // impressions, there's no audience-wide count to compute them from.
  trialDays: 5,
  trialDailyClicks: 95,
} as const;
