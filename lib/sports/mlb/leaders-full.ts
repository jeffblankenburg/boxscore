// MLB implementation of the shared leaderboard provider (see
// lib/sports/leaders-types.ts). Every league-leader stat the digest shows links
// to /mlb/leaders/[category], which ranks EVERY player for that stat, top to
// bottom, AL and NL side by side.
//
// Two data paths, by stat kind:
//   - rate stats (AVG, ERA): the /stats/leaders endpoint, which applies MLB's
//     official qualifier (3.1 PA / 1.0 IP per team game) and returns only the
//     qualified players, already ranked. We reuse that exact qualification.
//   - counting stats (HR, RBI, SB, W, SO, SV): the /stats season endpoint, which
//     returns EVERY player (the leaders endpoint caps at ~rank 100). We rank
//     them ourselves. No official minimum exists for a counting stat, so every
//     player who recorded it is listed.
//
// Current-season, live (ISR-cached by the page).

import {
  getLeaders,
  fetchSeasonStatsRaw, parseSeasonStats,
  fetchFinalStandingsRaw,
} from "@/lib/mlb";
import { findTeamByMlbApiId } from "@/lib/teams";
import { fullNameLinkWeb } from "@/lib/player-links";
import { todayInET } from "@/lib/dates";
import type { MlbLeaderCategory } from "./types";
import type { LeaderRow, FullLeaderboard, SportLeadersProvider } from "@/lib/sports/leaders-types";

type LeaderPageConfig = {
  slug: string;
  category: MlbLeaderCategory;    // canonical category, for the digest-link map
  group: "hitting" | "pitching";
  kind: "rate" | "count";
  label: string;
  valueLabel: string;
  statsapiCategory?: string;      // rate: /stats/leaders category
  statField?: string;            // count: /stats season stat field
  qualifier?: "batting" | "pitching";
};

// The eight categories the daily digest surfaces (LEADER_ORDER in the renderer).
const LEADER_PAGES: LeaderPageConfig[] = [
  { slug: "batting-average",    category: "battingAverage",     group: "hitting",  kind: "rate",  label: "Batting Average",      valueLabel: "AVG", statsapiCategory: "battingAverage",   qualifier: "batting" },
  { slug: "home-runs",          category: "homeRuns",           group: "hitting",  kind: "count", label: "Home Runs",            valueLabel: "HR",  statField: "homeRuns" },
  { slug: "rbi",                category: "runsBattedIn",       group: "hitting",  kind: "count", label: "RBI",                  valueLabel: "RBI", statField: "rbi" },
  { slug: "stolen-bases",       category: "stolenBases",        group: "hitting",  kind: "count", label: "Stolen Bases",         valueLabel: "SB",  statField: "stolenBases" },
  { slug: "wins",               category: "wins",               group: "pitching", kind: "count", label: "Wins",                 valueLabel: "W",   statField: "wins" },
  { slug: "era",                category: "earnedRunAverage",   group: "pitching", kind: "rate",  label: "Earned Run Average",   valueLabel: "ERA", statsapiCategory: "earnedRunAverage", qualifier: "pitching" },
  { slug: "strikeouts-pitching", category: "strikeoutsPitching", group: "pitching", kind: "count", label: "Strikeouts (Pitching)", valueLabel: "SO", statField: "strikeOuts" },
  { slug: "saves",              category: "saves",              group: "pitching", kind: "count", label: "Saves",                valueLabel: "SV",  statField: "saves" },
];

// canonical category → page slug, for the digest renderers to build the href.
export const LEADER_CATEGORY_SLUG: Partial<Record<MlbLeaderCategory, string>> =
  Object.fromEntries(LEADER_PAGES.map((p) => [p.category, p.slug]));

function abbrFor(teamId: number | undefined, fallbackName: string | undefined): string {
  const team = teamId != null ? findTeamByMlbApiId(teamId) : undefined;
  return team?.abbreviation ?? (fallbackName ? fallbackName.slice(0, 3).toUpperCase() : "");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function row(rank: number, id: number, name: string, teamAbbr: string, value: string): LeaderRow {
  return { rank, nameHtml: fullNameLinkWeb({ id, fullName: name }), teamAbbr: esc(teamAbbr), value };
}

// Standard competition ranking (1, 2, 2, 4) — equal values share the lowest rank.
function withRanks<T extends { sortValue: number }>(sorted: T[]): (T & { rank: number })[] {
  let lastVal: number | null = null;
  let lastRank = 0;
  return sorted.map((r, i) => {
    const rank = lastVal !== null && r.sortValue === lastVal ? lastRank : i + 1;
    lastVal = r.sortValue;
    lastRank = rank;
    return { ...r, rank };
  });
}

// Rate stat: the leaders endpoint already applies the qualifier and ranks, so
// we just reshape. limit=500 comfortably covers every qualified player (~65 max).
async function loadRateLeague(config: LeaderPageConfig, season: number, leagueId: 103 | 104): Promise<LeaderRow[]> {
  const leaders = await getLeaders(config.statsapiCategory!, season, leagueId, 500);
  return leaders.map((L) =>
    row(L.rank, L.person.id, L.person.fullName, abbrFor(L.team?.id, L.team?.name), L.value));
}

// Counting stat: every player with a nonzero total, ranked by us.
async function loadCountLeague(config: LeaderPageConfig, season: number, leagueId: 103 | 104): Promise<LeaderRow[]> {
  const splits = parseSeasonStats(await fetchSeasonStatsRaw(config.group, season, leagueId));
  const rows = splits
    .map((s) => ({ split: s, sortValue: Number(s.stat[config.statField!] ?? 0) }))
    .filter((r) => Number.isFinite(r.sortValue) && r.sortValue >= 1)
    .sort((a, b) => b.sortValue - a.sortValue);
  return withRanks(rows).map((r) =>
    row(r.rank, r.split.player.id, r.split.player.fullName,
      abbrFor(r.split.team?.id, r.split.team?.name), String(Math.round(r.sortValue))));
}

// Max games any team in the league has played (W+L). The rate-stat qualifier is
// perGame × this. All teams reach 162 by season's end; mid-season it tracks the
// furthest-along team, matching how the qualifier tightens over the year.
function teamGamesFromStandings(raw: unknown): number {
  const env = raw as { records?: Array<{ teamRecords?: Array<{ wins: number; losses: number }> }> } | null;
  let max = 0;
  for (const rec of env?.records ?? []) {
    for (const tr of rec.teamRecords ?? []) {
      const g = (tr.wins ?? 0) + (tr.losses ?? 0);
      if (g > max) max = g;
    }
  }
  return max;
}

async function qualifierNote(config: LeaderPageConfig, season: number): Promise<string> {
  if (!config.qualifier) return "No minimum — every player who recorded the stat, ranked top to bottom.";
  const teamGames = teamGamesFromStandings(await fetchFinalStandingsRaw(season).catch(() => null));
  const batting = config.qualifier === "batting";
  const perGame = batting ? 3.1 : 1.0;
  const unit = batting ? "plate appearances" : "innings pitched";
  const thresholdUnit = batting ? "PA" : "IP";
  const tail = teamGames > 0
    ? ` (${Math.round(perGame * teamGames)} ${thresholdUnit} through ${teamGames} team games)`
    : "";
  return `Qualified players only: minimum ${perGame} ${unit} per team game${tail}.`;
}

export const mlbLeadersProvider: SportLeadersProvider = {
  categories: LEADER_PAGES.map((p) => ({ slug: p.slug, label: p.label, valueLabel: p.valueLabel })),
  async load(slug: string): Promise<FullLeaderboard | null> {
    const config = LEADER_PAGES.find((p) => p.slug === slug);
    if (!config) return null;
    const season = Number(todayInET().slice(0, 4));
    const loadLeague = config.kind === "rate" ? loadRateLeague : loadCountLeague;
    const [al, nl, note] = await Promise.all([
      loadLeague(config, season, 103),
      loadLeague(config, season, 104),
      qualifierNote(config, season),
    ]);
    return {
      category: { slug: config.slug, label: config.label, valueLabel: config.valueLabel },
      season,
      columns: [
        { label: "American League", rows: al },
        { label: "National League", rows: nl },
      ],
      qualifierNote: note,
    };
  },
};
