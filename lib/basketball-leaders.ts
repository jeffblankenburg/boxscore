// NBA + WNBA implementation of the shared leaderboard provider
// (lib/sports/leaders-types.ts). Ranks EVERY qualifying player for a stat.
// NBA splits Eastern / Western conference into two columns; WNBA (one ESPN
// group) renders a single column. Reuses the same ESPN byathlete feed, field
// maps, formatters, and rate-stat qualification the digest leaders use
// (lib/basketball.ts parseLeaders) — without the top-5 cap.

import {
  fetchAthleteStatsRaw, extractAthletes,
  fetchStandingsRaw, parseStandings,
  type AthleteRecord, type BasketballLeagueSlug,
} from "./basketball";
import { playerLink, slugifyName, type BasketballLeague } from "./basketball-links";
import { seasonForDate as nbaSeasonForDate } from "./nba";
import { seasonForDate as wnbaSeasonForDate } from "./wnba";
import { todayInET } from "./dates";
import type { LeaderRow, LeaderColumn, FullLeaderboard, SportLeadersProvider } from "./sports/leaders-types";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const fmtAvg = (v: number) => v.toFixed(1);
// ".476" newspaper style — ESPN sends 0–100, so /100 → 3 decimals → drop the 0.
const fmtPct = (v: number) => {
  const s = (v / 100).toFixed(3);
  return s.startsWith("0.") ? s.slice(1) : s;
};

type BballLeaderConfig = {
  slug: string;
  label: string;
  valueLabel: string;
  field: string;
  pct?: boolean;
  qualify?: { madeField: string; seasonMin: number; madeLabel: string };  // rate stats: prorated made-shot minimum
  floor?: number;         // counting stats: min value to be "recorded"
  digestKey: string;      // matches the digest's LeaderCategoryKey
};

// Same categories + order as the digest (scoring, then shooting %, then the
// rebound/assist/defense counting stats).
const CATEGORIES: BballLeaderConfig[] = [
  { slug: "points",          label: "Points",        valueLabel: "PPG",  field: "avgPoints",              digestKey: "PTS", floor: 0 },
  { slug: "field-goal-pct",  label: "Field Goal %",  valueLabel: "FG%",  field: "fieldGoalPct",           digestKey: "FG%", pct: true, qualify: { madeField: "fieldGoalsMade", seasonMin: 300, madeLabel: "field goals" } },
  { slug: "three-point-pct", label: "3-Point %",     valueLabel: "3P%",  field: "threePointFieldGoalPct", digestKey: "3P%", pct: true, qualify: { madeField: "threePointFieldGoalsMade", seasonMin: 82, madeLabel: "3-pointers" } },
  { slug: "free-throw-pct",  label: "Free Throw %",  valueLabel: "FT%",  field: "freeThrowPct",           digestKey: "FT%", pct: true, qualify: { madeField: "freeThrowsMade", seasonMin: 125, madeLabel: "free throws" } },
  { slug: "rebounds",        label: "Rebounds",      valueLabel: "RPG",  field: "avgRebounds",            digestKey: "REB", floor: 0 },
  { slug: "assists",         label: "Assists",       valueLabel: "APG",  field: "avgAssists",             digestKey: "AST", floor: 0 },
  { slug: "steals",          label: "Steals",        valueLabel: "SPG",  field: "avgSteals",              digestKey: "STL", floor: 0 },
  { slug: "blocks",          label: "Blocks",        valueLabel: "BPG",  field: "avgBlocks",              digestKey: "BLK", floor: 0 },
];

// digest LeaderCategoryKey → page slug, for wiring the digest leader captions.
export const BASKETBALL_LEADER_CATEGORY_SLUG: Record<string, string> =
  Object.fromEntries(CATEGORIES.map((c) => [c.digestKey, c.slug]));

// Conferences in standings order, each with its display name + the set of team
// abbreviations in it. Used to split the leaderboard into columns (NBA/WNBA both
// have Eastern/Western; a league with a single group renders one column).
type ConfGroup = { name: string; teams: Set<string> };
function conferencesFromStandings(raw: unknown): ConfGroup[] {
  return parseStandings(raw).conferences
    .filter((c) => c.entries.length > 0)
    .map((c) => ({
      name: c.name || c.abbreviation,
      teams: new Set(c.entries.map((e) => e.team.abbreviation)),
    }));
}

function toRow(league: BasketballLeague, a: AthleteRecord & { rank: number }, fmt: (v: number) => string, field: string): LeaderRow {
  return {
    rank: a.rank,
    nameHtml: playerLink(league, { id: a.id, slug: slugifyName(a.name) }, a.name, true),
    teamAbbr: esc(a.teamAbbr),
    value: fmt(a.stats[field] ?? 0),
  };
}

// Sort desc by the stat, then standard competition ranking (1, 2, 2, 4).
function rankColumn(
  league: BasketballLeague, label: string, pool: AthleteRecord[],
  config: BballLeaderConfig, fmt: (v: number) => string,
): LeaderColumn {
  const sorted = [...pool].sort((a, b) => (b.stats[config.field] ?? 0) - (a.stats[config.field] ?? 0));
  let lastVal: number | null = null;
  let lastRank = 0;
  const rows = sorted.map((a, i) => {
    const v = a.stats[config.field] ?? 0;
    const rank = lastVal !== null && v === lastVal ? lastRank : i + 1;
    lastVal = v;
    lastRank = rank;
    return toRow(league, { ...a, rank }, fmt, config.field);
  });
  return { label, rows };
}

function makeProvider(league: BasketballLeagueSlug): SportLeadersProvider {
  const seasonFor = league === "nba" ? nbaSeasonForDate : wnbaSeasonForDate;
  return {
    categories: CATEGORIES.map((c) => ({ slug: c.slug, label: c.label, valueLabel: c.valueLabel })),
    async load(slug: string): Promise<FullLeaderboard | null> {
      const config = CATEGORIES.find((c) => c.slug === slug);
      if (!config) return null;
      const season = seasonFor(todayInET());
      const [statsRaw, standingsRaw] = await Promise.all([
        fetchAthleteStatsRaw(league, season, 2, 600).catch(() => null),
        fetchStandingsRaw(league, season, 2).catch(() => null),
      ]);
      const athletes = statsRaw ? extractAthletes(statsRaw) : [];
      const conferences = standingsRaw ? conferencesFromStandings(standingsRaw) : [];

      // Rate-stat qualifier: prorate the NBA made-shot minimum by season progress
      // (league-max gamesPlayed / 82). Same rule the digest uses.
      const teamGames = Math.max(0, ...athletes.map((a) => a.stats.gamesPlayed ?? 0)) || 82;
      const eligible = athletes.filter((a) => {
        const v = a.stats[config.field];
        if (typeof v !== "number") return false;
        if (config.qualify) {
          const made = a.stats[config.qualify.madeField];
          if (typeof made !== "number" || made < (config.qualify.seasonMin * teamGames) / 82) return false;
        }
        if (config.floor != null && v < config.floor) return false;
        return true;
      });

      const fmt = config.pct ? fmtPct : fmtAvg;
      // Split into one column per conference (NBA + WNBA both have two); fall
      // back to a single column if standings didn't expose conferences.
      const columns: LeaderColumn[] = conferences.length >= 2
        ? conferences.map((conf) =>
            rankColumn(league, conf.name, eligible.filter((a) => conf.teams.has(a.teamAbbr)), config, fmt))
        : [rankColumn(league, "", eligible, config, fmt)];

      const note = config.qualify
        ? `Qualified players only: minimum ${Math.round((config.qualify.seasonMin * teamGames) / 82)} ${config.qualify.madeLabel} made (prorated to ${teamGames} team games).`
        : "Per-game averages — every player who logged the stat, ranked top to bottom.";

      return {
        category: { slug: config.slug, label: config.label, valueLabel: config.valueLabel },
        season,
        columns,
        qualifierNote: note,
      };
    },
  };
}

export const nbaLeadersProvider = makeProvider("nba");
export const wnbaLeadersProvider = makeProvider("wnba");
