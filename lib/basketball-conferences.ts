// College-basketball conference registry (NCAAM / NCAAW). Each conference is a
// subscription scope + a conference digest: the daily data filtered to that
// conference's teams. Parallels lib/sports/football/conferences.ts, but the
// list is generated (31 conferences × 2 leagues) rather than hand-maintained —
// see scripts/gen-teams-ncaab.ts.
//
// Keyed by ESPN's standings group name (`espnName`), which is also the
// `conference` stored on each team in the registry.

import ncaamConf from "./conferences-ncaam.generated.json";
import ncaawConf from "./conferences-ncaaw.generated.json";

export type BasketballConference = {
  slug: string;     // URL/subscription id ("acc", "big-ten")
  short: string;    // display ("ACC", "Big Ten")
  espnName: string; // matches standings group name + Team.conference
};

type CollegeBasketballLeague = "ncaam" | "ncaaw";

const BY_LEAGUE: Record<CollegeBasketballLeague, readonly BasketballConference[]> = {
  ncaam: ncaamConf as BasketballConference[],
  ncaaw: ncaawConf as BasketballConference[],
};

export function basketballConferences(league: CollegeBasketballLeague): readonly BasketballConference[] {
  return BY_LEAGUE[league] ?? [];
}

export function findBasketballConferenceBySlug(
  league: CollegeBasketballLeague,
  slug: string,
): BasketballConference | undefined {
  return BY_LEAGUE[league]?.find((c) => c.slug === slug);
}

// Resolve by any name form that appears in the feeds: the standings' full
// espnName ("Atlantic Coast Conference") or the short display ("ACC"). Used to
// link a conference name in the digest to its conference page.
export function findBasketballConferenceByAnyName(
  league: CollegeBasketballLeague,
  name: string | null,
): BasketballConference | undefined {
  if (!name) return undefined;
  return BY_LEAGUE[league]?.find((c) => c.espnName === name || c.short === name);
}
