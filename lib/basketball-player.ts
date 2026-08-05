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
import { yesterdayInET } from "./dates";

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
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) return res.json();
    if (res.status === 404) return null;         // unknown id → notFound, not error
    if (attempt === 2 || res.status < 500) throw new Error(`ESPN ${res.status} for ${url}`);
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error("unreachable");
}

async function fetchAthleteRaw(league: BasketballLeague, athleteId: string, season: number): Promise<AthleteRaw> {
  const [overview, gamelog] = await Promise.all([
    getJson(`${ATHLETE_BASE}/${league}/athletes/${athleteId}`),
    getJson(`${ATHLETE_BASE}/${league}/athletes/${athleteId}/gamelog?season=${season}`),
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

function adaptGamelog(gl: GamelogJson): { columns: BasketballStatColumn[]; rows: BasketballGameLogRow[] } {
  const labels = gl.labels ?? [];
  const names = gl.names ?? [];
  const columns = labels.map((label, i) => ({ name: names[i] ?? label, label }));
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
      rows.push({
        eventId: id,
        date: str(m.gameDate) ?? "",
        oppAbbr: str(m.opponent?.abbreviation) ?? "",
        atVs: m.atVs === "@" || m.homeAway === "away" ? "@" : "vs",
        result: gr === "W" || gr === "L" ? gr : null,
        score: str(m.score),
        cells: (ev.stats ?? []).map((c) => c ?? ""),
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
  return league === "nba" ? nbaSeasonForDate(date) : wnbaSeasonForDate(date);
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
