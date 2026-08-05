// FBS conference registry for the NCAAF conference digests. Each conference is
// a subscription scope and a digest: the daily NCAAF data filtered to that
// conference's teams. Keyed by ESPN's conference name — which is the standings
// group name for single-group conferences, or the group's `conference` parent
// for division-split ones (Sun Belt East/West → "Sun Belt Conference").
//
// FBS Independents (Notre Dame, etc.) are intentionally excluded — too few
// teams to warrant a grouping; they're offered as individual team digests.

import type { CanonicalFootballDailyData } from "./canonical";
import type { FootballGame } from "./types";

export type NcaafConference = {
  slug: string;        // URL/subscription id ("sec", "big-ten")
  short: string;       // display ("SEC", "Big Ten")
  espnName: string;    // matches standings `conference ?? group`
};

export const NCAAF_CONFERENCES: readonly NcaafConference[] = [
  { slug: "acc",           short: "ACC",           espnName: "Atlantic Coast Conference" },
  { slug: "american",      short: "American",      espnName: "American Conference" },
  { slug: "big-12",        short: "Big 12",        espnName: "Big 12 Conference" },
  { slug: "big-ten",       short: "Big Ten",       espnName: "Big Ten Conference" },
  { slug: "cusa",          short: "C-USA",         espnName: "Conference USA" },
  { slug: "mac",           short: "MAC",           espnName: "Mid-American Conference" },
  { slug: "mountain-west", short: "Mountain West", espnName: "Mountain West Conference" },
  { slug: "pac-12",        short: "Pac-12",        espnName: "Pac-12 Conference" },
  { slug: "sec",           short: "SEC",           espnName: "Southeastern Conference" },
  { slug: "sun-belt",      short: "Sun Belt",      espnName: "Sun Belt Conference" },
];

export function findConferenceBySlug(slug: string): NcaafConference | undefined {
  return NCAAF_CONFERENCES.find((c) => c.slug === slug);
}

export function findConferenceByEspnName(name: string | null): NcaafConference | undefined {
  if (!name) return undefined;
  return NCAAF_CONFERENCES.find((c) => c.espnName === name);
}

// A conference's team ids, from the standings (game/leader/txn refs carry no
// conference, so the standings are the source of truth). `conference ?? group`
// folds Sun Belt East/West back into "Sun Belt Conference". id = lowercased
// abbreviation, matching game/ranking refs.
export function conferenceTeamIds(
  data: CanonicalFootballDailyData,
  espnName: string,
): Set<string> {
  const ids = new Set<string>();
  for (const g of data.standings) {
    if ((g.conference ?? g.group) === espnName) {
      for (const r of g.rows) ids.add(r.team.id);
    }
  }
  return ids;
}

// A conference-scoped view of the daily data: games / box scores / standings /
// upcoming / transactions filtered to the conference's teams. Rankings are kept
// FULL (shown as-is). Leaders are left as-is (empty for NCAAF today — see the
// tracked follow-up). The result renders through the same section renderers.
export function scopeToConference(
  data: CanonicalFootballDailyData,
  conf: NcaafConference,
): CanonicalFootballDailyData {
  const ids = conferenceTeamIds(data, conf.espnName);
  const isConf = (g: FootballGame) => ids.has(g.awayTeam.id) || ids.has(g.homeTeam.id);

  // Game/next refs carry no `location` (school) and no rank — enrich from the
  // standings (school names) and the AP poll (rank) so scores/box scores can
  // show "Troy" instead of "Troy Trojans", and standings can flag ranked teams.
  const schoolById = new Map<string, string>();
  for (const g of data.standings) for (const r of g.rows) {
    if (r.team.location) schoolById.set(r.team.id, r.team.location);
  }
  const apRankById = new Map<string, number>();
  const ap = data.rankings.find((r) => /AP Top 25/i.test(r.poll));
  for (const e of ap?.entries ?? []) apRankById.set(e.team.id, e.rank);
  const enrichRef = <T extends { id: string; location: string | null; rank?: number | null }>(t: T): T => ({
    ...t,
    location: t.location ?? schoolById.get(t.id) ?? null,
    rank: apRankById.get(t.id) ?? t.rank ?? null,
  });
  const enrichGame = (g: FootballGame): FootballGame => ({
    ...g,
    awayTeam: enrichRef(g.awayTeam),
    homeTeam: enrichRef(g.homeTeam),
  });

  const games = data.games.filter(isConf).map(enrichGame);
  const gameIds = new Set(games.map((g) => g.id));
  const boxScores = new Map([...data.boxScores].filter(([id]) => gameIds.has(id)));
  const standings = data.standings
    .filter((g) => (g.conference ?? g.group) === conf.espnName)
    .map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, team: enrichRef(r.team) })) }));
  const nextGames = data.nextGames.filter(isConf).map(enrichGame);
  const transactions = data.transactions.filter(
    (t) => t.teamAbbr != null && ids.has(t.teamAbbr.toLowerCase()),
  );
  return { ...data, games, boxScores, standings, nextGames, transactions };
}
