// NHL implementation of the shared leaderboard provider (lib/sports/leaders-types.ts).
// Ranks EVERY player for a stat, top to bottom, in a single column (hockey has
// no league split the way MLB has AL/NL). Reuses the same ESPN byathlete feed,
// field maps, formatters, and goalie qualification the digest leaders use
// (lib/hockey.ts parseLeaders) — just without the top-5 cap.

import { fetchAthleteStatsRaw, extractAthletes, type AthleteRecord } from "./hockey";
import { seasonForDate } from "./nhl";
import { playerLink, slugifyName } from "./hockey-links";
import { todayInET } from "./dates";
import type { LeaderRow, FullLeaderboard, SportLeadersProvider } from "./sports/leaders-types";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const fmtInt = (v: number) => String(Math.round(v));
const fmtSigned = (v: number) => (v > 0 ? `+${Math.round(v)}` : String(Math.round(v)));
const fmtGaa = (v: number) => v.toFixed(2);
const fmtSvpct = (v: number) => {
  const n = v > 1 ? v / 100 : v;                 // ESPN sends 0.915 or 91.5
  const s = n.toFixed(3);
  return s.startsWith("0.") ? s.slice(1) : s;    // ".915" newspaper style
};

type HockeyLeaderConfig = {
  slug: string;
  label: string;
  valueLabel: string;
  field: string;
  role: "skater" | "goalie";
  dir: "asc" | "desc";       // asc for GAA (lower is better)
  fmt: (v: number) => string;
  digestKey: string;         // matches the digest's LeaderCategoryKey
  floor?: number;            // skaters: min value to be "recorded" (points/goals/assists ≥ 1)
};

const LEADER_PAGES: HockeyLeaderConfig[] = [
  { slug: "points",     label: "Points",                 valueLabel: "PTS",  field: "points",          role: "skater", dir: "desc", fmt: fmtInt,    digestKey: "PTS", floor: 1 },
  { slug: "goals",      label: "Goals",                  valueLabel: "G",    field: "goals",           role: "skater", dir: "desc", fmt: fmtInt,    digestKey: "G",   floor: 1 },
  { slug: "assists",    label: "Assists",                valueLabel: "A",    field: "assists",         role: "skater", dir: "desc", fmt: fmtInt,    digestKey: "A",   floor: 1 },
  { slug: "plus-minus", label: "Plus/Minus",             valueLabel: "+/-",  field: "plusMinus",       role: "skater", dir: "desc", fmt: fmtSigned, digestKey: "+/-" },
  { slug: "save-pct",   label: "Save Percentage",        valueLabel: "SV%",  field: "savePct",         role: "goalie", dir: "desc", fmt: fmtSvpct,  digestKey: "SV%" },
  { slug: "gaa",        label: "Goals-Against Average",  valueLabel: "GAA",  field: "avgGoalsAgainst", role: "goalie", dir: "asc",  fmt: fmtGaa,    digestKey: "GAA" },
];

// digest LeaderCategoryKey → page slug, for wiring the digest leader captions.
export const NHL_LEADER_CATEGORY_SLUG: Record<string, string> =
  Object.fromEntries(LEADER_PAGES.map((p) => [p.digestKey, p.slug]));

// Standard competition ranking (1, 2, 2, 4) over already-sorted rows.
function rankRows(sorted: AthleteRecord[], field: string): (AthleteRecord & { rank: number })[] {
  let lastVal: number | null = null;
  let lastRank = 0;
  return sorted.map((a, i) => {
    const v = a.stats[field] ?? 0;
    const rank = lastVal !== null && v === lastVal ? lastRank : i + 1;
    lastVal = v;
    lastRank = rank;
    return { ...a, rank };
  });
}

function toRow(a: AthleteRecord & { rank: number }, config: HockeyLeaderConfig): LeaderRow {
  return {
    rank: a.rank,
    nameHtml: playerLink({ id: a.id, slug: slugifyName(a.name) }, a.name, true),
    teamAbbr: esc(a.teamAbbr),
    value: config.fmt(a.stats[config.field] ?? 0),
  };
}

export const nhlLeadersProvider: SportLeadersProvider = {
  categories: LEADER_PAGES.map((p) => ({ slug: p.slug, label: p.label, valueLabel: p.valueLabel })),
  async load(slug: string): Promise<FullLeaderboard | null> {
    const config = LEADER_PAGES.find((p) => p.slug === slug);
    if (!config) return null;
    const season = seasonForDate(todayInET());
    const raw = await fetchAthleteStatsRaw(season, 2, 1000).catch(() => null);
    const athletes = raw ? extractAthletes(raw) : [];

    // Goalie rate stats need a games-played minimum (same rule as the digest):
    // ~25 games over a full 82, prorated by how far the season has progressed.
    const teamGames = Math.max(0, ...athletes.map((a) => a.stats.games ?? 0)) || 82;
    const goalieMin = Math.max(1, Math.round((25 * teamGames) / 82));

    const pool = athletes.filter((a) =>
      config.role === "goalie" ? a.position === "G" : a.position !== "G",
    );
    const eligible = pool.filter((a) => {
      const v = a.stats[config.field];
      if (typeof v !== "number") return false;
      if (config.role === "goalie" && (a.stats.games ?? 0) < goalieMin) return false;
      if (config.floor != null && v < config.floor) return false;
      return true;
    });
    eligible.sort((a, b) => {
      const av = a.stats[config.field] ?? 0;
      const bv = b.stats[config.field] ?? 0;
      return config.dir === "asc" ? av - bv : bv - av;
    });
    const rows = rankRows(eligible, config.field).map((a) => toRow(a, config));

    const note = config.role === "goalie"
      ? `Qualified goalies only: minimum ${goalieMin} games played.`
      : "No minimum — every player who recorded the stat, ranked top to bottom.";

    return {
      category: { slug: config.slug, label: config.label, valueLabel: config.valueLabel },
      season,
      columns: [{ label: "", rows }],   // single column; page omits the empty subheader
      qualifierNote: note,
    };
  },
};
