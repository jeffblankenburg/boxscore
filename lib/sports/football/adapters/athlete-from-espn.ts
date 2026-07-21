// Pure adapter: ESPN athlete overview + gamelog → canonical player-page data.
// No I/O. The gamelog arrives as flat parallel arrays (names, labels, and a
// stats[] per event) plus a `categories` list that says how many leading
// columns belong to each stat group (passing:11, rushing:5, …). We slice the
// flat arrays back into per-category sections here so the renderer sees clean
// game-log tables.

import type { FootballLeagueConfig } from "../leagues";
import type {
  FootballPlayerPageData,
  FootballAthleteBio,
  FootballStatSection,
  FootballGameLogRow,
  FootballSeasonSummaryStat,
} from "../player-canonical";
import type { FootballAthleteRaw } from "../sources/espn-athlete";

// ── narrow structural shapes for the bits of the ESPN JSON we read ──────────

type OverviewJson = {
  athlete?: {
    id?: unknown;
    displayName?: unknown;
    fullName?: unknown;
    jersey?: unknown;
    position?: { abbreviation?: unknown };
    team?: { abbreviation?: unknown; displayName?: unknown };
    displayHeight?: unknown;
    displayWeight?: unknown;
    college?: { name?: unknown };
    headshot?: { href?: unknown };
    experience?: { years?: unknown };
    statsSummary?: {
      statistics?: Array<{ displayName?: unknown; displayValue?: unknown; rankDisplayValue?: unknown }>;
    };
  };
};

type GamelogJson = {
  names?: string[];
  labels?: string[];
  categories?: Array<{ name?: string; displayName?: string; count?: number }>;
  seasonTypes?: Array<{
    displayName?: string;
    categories?: Array<{ events?: Array<{ eventId?: string; stats?: string[] }>; totals?: string[] }>;
  }>;
  events?: Record<string, {
    week?: unknown;
    gameDate?: unknown;
    opponent?: { abbreviation?: unknown };
    gameResult?: unknown;
    score?: unknown;
    atVs?: unknown;
    homeAway?: unknown;
  }>;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function adaptBio(cfg: FootballLeagueConfig, raw: FootballAthleteRaw): FootballAthleteBio | null {
  const a = (raw.overview as OverviewJson | null)?.athlete;
  if (!a) return null;
  const fullName = str(a.fullName) ?? str(a.displayName);
  if (!fullName) return null;
  const teamAbbr = str(a.team?.abbreviation);
  return {
    id: raw.athleteId,
    league: cfg.league,
    fullName,
    slug: slugifyName(fullName),
    jersey: str(a.jersey),
    position: str(a.position?.abbreviation),
    teamAbbr,
    // Canonical team slug = lowercased ESPN abbreviation, matching teamRef()
    // in from-espn.ts and lib/teams.ts Team.slug for the NFL's 32 clubs.
    teamSlug: teamAbbr ? teamAbbr.toLowerCase() : null,
    teamName: str(a.team?.displayName),
    height: str(a.displayHeight),
    weight: str(a.displayWeight),
    college: str(a.college?.name),
    headshot: str(a.headshot?.href),
    experience: num(a.experience?.years),
  };
}

function adaptSummary(raw: FootballAthleteRaw): FootballSeasonSummaryStat[] {
  const stats = (raw.overview as OverviewJson | null)?.athlete?.statsSummary?.statistics ?? [];
  const out: FootballSeasonSummaryStat[] = [];
  for (const s of stats) {
    const label = str(s.displayName);
    const value = str(s.displayValue);
    if (label && value) out.push({ label, value, rank: str(s.rankDisplayValue) });
  }
  return out;
}

// A stat string that carries no information — the reason to drop an all-zero
// category (a QB's Fumbles table, a receiver with no rushing attempts).
function isZeroish(cell: string): boolean {
  const c = cell.replace(/,/g, "").trim();
  return c === "" || c === "-" || c === "0" || c === "0.0" || c === "0-0" || c === "0.00";
}

// Pick the season type to display: the regular season if present (the page's
// default view), else whichever block carries the most games.
function pickSeasonType(gl: GamelogJson): NonNullable<GamelogJson["seasonTypes"]>[number] | null {
  const types = gl.seasonTypes ?? [];
  if (types.length === 0) return null;
  const regular = types.find((t) => /regular season/i.test(t.displayName ?? ""));
  if (regular) return regular;
  return types.reduce((best, t) => {
    const n = (t.categories?.[0]?.events?.length ?? 0);
    const bn = (best.categories?.[0]?.events?.length ?? 0);
    return n > bn ? t : best;
  }, types[0]!);
}

// Compact per-category column sets for the game log — ESPN returns up to ~11
// columns per category (passing has CMP ATT YDS CMP% AVG TD INT LNG SACK RTG
// QBR), which overflows a 400px phone. We keep the essentials, in this order.
// A category not listed falls back to its first PLAYER_LOG_CAP columns.
const PLAYER_LOG_COLUMNS: Record<string, string[]> = {
  passing: ["completions", "passingAttempts", "passingYards", "passingTouchdowns", "interceptions", "QBRating"],
  rushing: ["rushingAttempts", "rushingYards", "rushingTouchdowns", "longRushing"],
  receiving: ["receptions", "receivingYards", "receivingTouchdowns", "longReception"],
  tackles: ["totalTackles", "soloTackles", "sacks", "stuffs"],
  interceptions: ["interceptions", "interceptionYards", "interceptionTouchdowns", "passesDefended"],
  fumbles: ["fumbles", "fumblesLost", "fumblesForced"],
};
const PLAYER_LOG_CAP = 5;

// Local (within-category) column indices to keep, in display order.
function keptColumnIndices(category: string, localNames: string[]): number[] {
  const keep = PLAYER_LOG_COLUMNS[category];
  if (keep) {
    const idxByName = new Map(localNames.map((n, i) => [n, i] as const));
    return keep.map((n) => idxByName.get(n)).filter((i): i is number => i !== undefined);
  }
  return localNames.slice(0, PLAYER_LOG_CAP).map((_, i) => i);
}

function adaptSections(gl: GamelogJson): FootballStatSection[] {
  const names = gl.names ?? [];
  const labels = gl.labels ?? [];
  const groups = gl.categories ?? [];
  const seasonType = pickSeasonType(gl);
  const block = seasonType?.categories?.[0];
  const events = block?.events ?? [];
  const totals = block?.totals ?? null;
  const meta = gl.events ?? {};

  const sections: FootballStatSection[] = [];
  let offset = 0;
  for (const g of groups) {
    const count = typeof g.count === "number" ? g.count : 0;
    const start = offset;
    offset += count;
    if (count === 0 || !g.name) continue;

    // Trim to the compact essential columns for this category (mobile fit).
    const localNames = names.slice(start, start + count);
    const kept = keptColumnIndices(g.name, localNames);

    const columns = kept.map((i) => ({
      name: names[start + i]!,
      label: labels[start + i] ?? names[start + i]!,
    }));

    const rows: FootballGameLogRow[] = [];
    for (const ev of events) {
      const id = str(ev.eventId);
      if (!id) continue;
      const m = meta[id] ?? {};
      const gr = str(m.gameResult);
      const stats = ev.stats ?? [];
      rows.push({
        eventId: id,
        week: num(m.week),
        date: str(m.gameDate) ?? "",
        oppAbbr: str(m.opponent?.abbreviation) ?? "",
        atVs: m.atVs === "@" || m.homeAway === "away" ? "@" : "vs",
        result: gr === "W" || gr === "L" || gr === "T" ? gr : null,
        score: str(m.score),
        cells: kept.map((i) => stats[start + i] ?? ""),
      });
    }
    // ESPN lists events oldest-first; the page shows most recent on top.
    rows.reverse();

    const sectionTotals = totals ? kept.map((i) => totals[start + i] ?? "") : null;
    if (sectionTotals && sectionTotals.every(isZeroish)) continue; // drop empty category

    sections.push({
      key: g.name,
      label: g.displayName ?? g.name,
      columns,
      rows,
      totals: sectionTotals,
    });
  }
  return sections;
}

/** ESPN athlete raw → canonical player page. Returns null when the overview
 *  is missing (unknown id) — the route turns that into notFound(). */
export function adaptAthlete(
  cfg: FootballLeagueConfig,
  raw: FootballAthleteRaw,
): FootballPlayerPageData | null {
  const bio = adaptBio(cfg, raw);
  if (!bio) return null;
  const gl = (raw.gamelog as GamelogJson | null) ?? {};
  return {
    bio,
    season: raw.season,
    summary: adaptSummary(raw),
    sections: adaptSections(gl),
  };
}
