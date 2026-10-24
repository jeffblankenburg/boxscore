// NBA/WNBA player page: fetch ESPN's athlete overview + gamelog, adapt to a
// canonical page model. Live (no daily_raw cache) — the /[sport]/player/[id]
// route wraps this in ISR, same as football's loadFootballPlayerData and MLB's
// loadPlayerPageData.
//
// Basketball is simpler than football: every player's gamelog is one flat
// box-score stat set (MIN/FG/FG%/3PT/3P%/FT/FT%/REB/AST/BLK/STL/PF/TO/PTS), so
// the page shows a single game-log table, not football's per-category tables.

import { slugifyName, teamSlugForEspn, type BasketballLeague } from "./basketball-links";
import { seasonForDate as nbaSeasonForDate } from "./nba";
import { seasonForDate as wnbaSeasonForDate } from "./wnba";
import { seasonForDate as ncaamSeasonForDate } from "./ncaam";
import { seasonForDate as ncaawSeasonForDate } from "./ncaaw";
import { yesterdayInET } from "./dates";
import { espnJson } from "./espn-fetch";

// ESPN's athlete API path uses the full sport slug, not our short league key.
const ESPN_LEAGUE_SLUG: Record<BasketballLeague, string> = {
  nba: "nba",
  wnba: "wnba",
  ncaam: "mens-college-basketball",
  ncaaw: "womens-college-basketball",
};

// ── canonical model ─────────────────────────────────────────────────────────

export type BasketballAthleteBio = {
  id: string;
  league: BasketballLeague;
  fullName: string;
  slug: string;               // name slug WITHOUT the id suffix ("luka-doncic")
  jersey: string | null;
  position: string | null;    // "G" | "F" | "C"
  teamAbbr: string | null;
  teamSlug: string | null;    // boxscore slug for linking to the team page
  teamName: string | null;
  height: string | null;      // "6' 8\""
  weight: string | null;      // "230 lbs"
  headshot: string | null;
  experience: number | null;
};

export type BasketballGameLogRow = {
  eventId: string;
  date: string;               // ISO
  oppAbbr: string;
  atVs: "@" | "vs";
  result: "W" | "L" | null;
  score: string | null;
  cells: string[];            // parallel to columns; ESPN display strings
};

export type BasketballStatColumn = { name: string; label: string };
export type BasketballSeasonSummaryStat = { label: string; value: string; rank: string | null };

export type BasketballPlayerPageData = {
  bio: BasketballAthleteBio;
  season: number;
  summary: BasketballSeasonSummaryStat[];
  columns: BasketballStatColumn[];
  rows: BasketballGameLogRow[];   // newest game first, capped
};

// How many recent games to show — a full 82-game log overflows the page;
// matches the MLB player page's "last 15" window.
const GAMELOG_CAP = 15;

// ── fetch ────────────────────────────────────────────────────────────────────

const ATHLETE_BASE = "https://site.web.api.espn.com/apis/common/v3/sports/basketball";

type AthleteRaw = { league: BasketballLeague; athleteId: string; season: number; overview: unknown; gamelog: unknown };

async function getJson(url: string): Promise<unknown | null> {
  // Shared ESPN fetch (retries transient 403/429/5xx + browser UA) — see
  // lib/espn-fetch. 404 = unknown athlete id → null, not an error.
  return espnJson(url, { nullOn404: true });
}

async function fetchAthleteRaw(league: BasketballLeague, athleteId: string, season: number): Promise<AthleteRaw> {
  const slug = ESPN_LEAGUE_SLUG[league];
  const [overview, gamelog] = await Promise.all([
    getJson(`${ATHLETE_BASE}/${slug}/athletes/${athleteId}`),
    getJson(`${ATHLETE_BASE}/${slug}/athletes/${athleteId}/gamelog?season=${season}`),
  ]);
  return { league, athleteId, season, overview, gamelog };
}

// ── adapt ─────────────────────────────────────────────────────────────────────

type OverviewJson = {
  athlete?: {
    displayName?: unknown; fullName?: unknown; jersey?: unknown;
    position?: { abbreviation?: unknown };
    team?: { abbreviation?: unknown; displayName?: unknown; name?: unknown };
    displayHeight?: unknown; displayWeight?: unknown;
    headshot?: { href?: unknown };
    experience?: { years?: unknown };
    statsSummary?: { statistics?: Array<{ shortDisplayName?: unknown; displayName?: unknown; displayValue?: unknown; rankDisplayValue?: unknown }> };
  };
};

type GamelogJson = {
  labels?: string[];
  names?: string[];
  seasonTypes?: Array<{
    displayName?: string;
    categories?: Array<{ events?: Array<{ eventId?: string; stats?: string[] }> }>;
  }>;
  events?: Record<string, {
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

function adaptBio(league: BasketballLeague, raw: AthleteRaw): BasketballAthleteBio | null {
  const a = (raw.overview as OverviewJson | null)?.athlete;
  if (!a) return null;
  const fullName = str(a.fullName) ?? str(a.displayName);
  if (!fullName) return null;
  return {
    id: raw.athleteId,
    league,
    fullName,
    slug: slugifyName(fullName),
    jersey: str(a.jersey),
    position: str(a.position?.abbreviation),
    teamAbbr: str(a.team?.abbreviation),
    teamSlug: teamSlugForEspn(league, {
      displayName: str(a.team?.displayName),
      nickname: str(a.team?.name),
    }),
    teamName: str(a.team?.displayName),
    height: str(a.displayHeight),
    weight: str(a.displayWeight),
    headshot: str(a.headshot?.href),
    experience: num(a.experience?.years),
  };
}

function adaptSummary(raw: AthleteRaw): BasketballSeasonSummaryStat[] {
  const stats = (raw.overview as OverviewJson | null)?.athlete?.statsSummary?.statistics ?? [];
  const out: BasketballSeasonSummaryStat[] = [];
  for (const s of stats) {
    const label = str(s.shortDisplayName) ?? str(s.displayName);
    const value = str(s.displayValue);
    if (label && value) out.push({ label, value, rank: str(s.rankDisplayValue) });
  }
  return out;
}

// Regular season if present (the default view), else the block with the most
// games (a player mid-preseason, say).
function pickSeasonType(gl: GamelogJson): NonNullable<GamelogJson["seasonTypes"]>[number] | null {
  const types = gl.seasonTypes ?? [];
  if (types.length === 0) return null;
  const regular = types.find((t) => /regular season/i.test(t.displayName ?? ""));
  if (regular) return regular;
  const countEvents = (t: (typeof types)[number]) =>
    (t.categories ?? []).reduce((n, c) => n + (c.events?.length ?? 0), 0);
  return types.reduce((best, t) => (countEvents(t) > countEvents(best) ? t : best), types[0]!);
}

// Curated per-game columns (ESPN stat `names`) so the log fits mobile without
// horizontal scroll — the essential box line, not ESPN's full 14 columns
// (which drop the FG%/3P%/FT/FT%/PF detail better suited to a season view).
const GAMELOG_COLS = [
  "minutes", "points", "totalRebounds", "assists",
  "fieldGoalsMade-fieldGoalsAttempted",
  "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
  "steals", "blocks",
];

function adaptGamelog(gl: GamelogJson): { columns: BasketballStatColumn[]; rows: BasketballGameLogRow[] } {
  const labels = gl.labels ?? [];
  const names = gl.names ?? [];
  // Column indices to keep, in curated display order. Fall back to the full set
  // if ESPN's names don't match (feed change), so the log never renders blank.
  let idxs = GAMELOG_COLS.map((n) => names.indexOf(n)).filter((i) => i >= 0);
  if (idxs.length === 0) idxs = names.map((_, i) => i);
  const columns = idxs.map((i) => ({ name: names[i] ?? labels[i] ?? "", label: labels[i] ?? names[i] ?? "" }));
  const meta = gl.events ?? {};

  const seasonType = pickSeasonType(gl);
  // Basketball's "categories" are monthly splits — flatten events across all of
  // them to get the full season log (football's categories are stat groups, so
  // it reads only the first; basketball must not).
  const rows: BasketballGameLogRow[] = [];
  for (const cat of seasonType?.categories ?? []) {
    for (const ev of cat.events ?? []) {
      const id = str(ev.eventId);
      if (!id) continue;
      const m = meta[id] ?? {};
      const gr = str(m.gameResult);
      const stats = ev.stats ?? [];
      rows.push({
        eventId: id,
        date: str(m.gameDate) ?? "",
        oppAbbr: str(m.opponent?.abbreviation) ?? "",
        atVs: m.atVs === "@" || m.homeAway === "away" ? "@" : "vs",
        result: gr === "W" || gr === "L" ? gr : null,
        score: str(m.score),
        cells: idxs.map((i) => stats[i] ?? ""),
      });
    }
  }
  // ESPN lists oldest-first; show most recent on top, capped.
  rows.reverse();
  return { columns, rows: rows.slice(0, GAMELOG_CAP) };
}

function adaptAthlete(league: BasketballLeague, raw: AthleteRaw): BasketballPlayerPageData | null {
  const bio = adaptBio(league, raw);
  if (!bio) return null;
  const gl = (raw.gamelog as GamelogJson | null) ?? {};
  const { columns, rows } = adaptGamelog(gl);
  return { bio, season: raw.season, summary: adaptSummary(raw), columns, rows };
}

// ── loader ────────────────────────────────────────────────────────────────────

function seasonFor(league: BasketballLeague, date: string): number {
  switch (league) {
    case "nba":   return nbaSeasonForDate(date);
    case "wnba":  return wnbaSeasonForDate(date);
    case "ncaam": return ncaamSeasonForDate(date);
    case "ncaaw": return ncaawSeasonForDate(date);
  }
}

/**
 * Load a player page for the most relevant season. Defaults to the current
 * season; if it has no games yet (offseason / pre-opener) falls back one year
 * so the page shows real production instead of an empty shell.
 */
export async function loadBasketballPlayerData(
  league: BasketballLeague,
  athleteId: string,
  seasonHint?: number,
): Promise<BasketballPlayerPageData | null> {
  const season = seasonHint ?? seasonFor(league, yesterdayInET());
  const data = adaptAthlete(league, await fetchAthleteRaw(league, athleteId, season));
  if (!data) return null;
  if (data.rows.length === 0 && seasonHint == null) {
    const prev = adaptAthlete(league, await fetchAthleteRaw(league, athleteId, season - 1));
    if (prev && prev.rows.length > 0) return prev;
  }
  return data;
}
