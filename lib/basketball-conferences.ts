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
import type { BasketballData } from "./basketball-daily";
import type { BasketballScoreboardEvent } from "./basketball";

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

// A conference-scoped view of the daily data: standings narrowed to the one
// conference, games/box/upcoming filtered to its teams. Rankings stay national
// (AP is league-wide). Powers the conference page + conference email — the one
// surface where the full conference standings live (the league digest omits
// them). Mirrors football's scopeToConference.
export function scopeBasketballToConference(
  data: BasketballData,
  conf: BasketballConference,
): BasketballData {
  const confStandings = data.standings.conferences.filter((c) => c.name === conf.espnName);
  const teamIds = new Set(confStandings.flatMap((c) => c.entries.map((e) => e.team.id)));
  const inConf = (e: BasketballScoreboardEvent) => teamIds.has(e.away.team.id) || teamIds.has(e.home.team.id);
  return {
    ...data,
    standings: { conferences: confStandings },
    games: data.games.filter((g) => inConf(g.event)),
    upcomingEvents: data.upcomingEvents.filter(inConf),
  };
}
