// NHL player page: fetch ESPN's athlete overview + gamelog, adapt to a
// canonical page model. Live (no daily_raw cache) — the /[sport]/player/[id]
// route wraps this in ISR, same as basketball's loadBasketballPlayerData.
//
// The ESPN hockey gamelog has the same envelope as basketball (labels/names +
// seasonTypes.categories.events + an events map), so this is a close port of
// lib/basketball-player.ts. The stat columns come straight from ESPN's labels,
// so skaters (G/A/PTS/+/-/…) and goalies (GA/SV/SV%/…) both render correctly
// without any hockey-specific column logic here.

import { slugifyName, teamSlugForEspn } from "./hockey-links";
import { seasonForDate } from "./nhl";
import { yesterdayInET } from "./dates";

// ── canonical model ─────────────────────────────────────────────────────────

export type HockeyAthleteBio = {
  id: string;
  fullName: string;
  slug: string;               // name slug WITHOUT the id suffix ("connor-mcdavid")
  jersey: string | null;
  position: string | null;    // "C" | "LW" | "D" | "G" …
  teamAbbr: string | null;
  teamSlug: string | null;    // boxscore slug for linking to the team page
  teamName: string | null;
  height: string | null;
  weight: string | null;
  headshot: string | null;
  experience: number | null;
};

export type HockeyGameLogRow = {
  eventId: string;
  date: string;               // ISO
  oppAbbr: string;
  atVs: "@" | "vs";
  result: "W" | "L" | null;
  score: string | null;
  cells: string[];            // parallel to columns; ESPN display strings
};

export type HockeyStatColumn = { name: string; label: string };
export type HockeySeasonSummaryStat = { label: string; value: string; rank: string | null };

export type HockeyPlayerPageData = {
  bio: HockeyAthleteBio;
  season: number;
  summary: HockeySeasonSummaryStat[];
  columns: HockeyStatColumn[];
  rows: HockeyGameLogRow[];   // newest game first, capped
};

// Recent-games window — a full 82-game log overflows the page; matches the
// basketball/MLB player pages' "last 15".
const GAMELOG_CAP = 15;

// ── fetch ────────────────────────────────────────────────────────────────────

const ATHLETE_BASE = "https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl";

type AthleteRaw = { athleteId: string; season: number; overview: unknown; gamelog: unknown };

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

async function fetchAthleteRaw(athleteId: string, season: number): Promise<AthleteRaw> {
  const [overview, gamelog] = await Promise.all([
    getJson(`${ATHLETE_BASE}/athletes/${athleteId}`),
    getJson(`${ATHLETE_BASE}/athletes/${athleteId}/gamelog?season=${season}`),
  ]);
  return { athleteId, season, overview, gamelog };
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

function adaptBio(raw: AthleteRaw): HockeyAthleteBio | null {
  const a = (raw.overview as OverviewJson | null)?.athlete;
  if (!a) return null;
  const fullName = str(a.fullName) ?? str(a.displayName);
  if (!fullName) return null;
  return {
    id: raw.athleteId,
    fullName,
    slug: slugifyName(fullName),
    jersey: str(a.jersey),
    position: str(a.position?.abbreviation),
    teamAbbr: str(a.team?.abbreviation),
    teamSlug: teamSlugForEspn({
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

function adaptSummary(raw: AthleteRaw): HockeySeasonSummaryStat[] {
  const stats = (raw.overview as OverviewJson | null)?.athlete?.statsSummary?.statistics ?? [];
  const out: HockeySeasonSummaryStat[] = [];
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
// horizontal scroll — the essential box line, not ESPN's full 12-14 columns.
// Skaters and goalies get different sets; the rest (rates, situational splits)
// belong on a season page, not a per-game row.
const SKATER_COLS = ["goals", "assists", "points", "plusMinus", "shotsTotal", "penaltyMinutes", "timeOnIcePerGame"];
const GOALIE_COLS = ["goalsAgainst", "shotsAgainst", "saves", "savePct", "shutouts", "timeOnIcePerGame"];

function adaptGamelog(gl: GamelogJson, isGoalie: boolean): { columns: HockeyStatColumn[]; rows: HockeyGameLogRow[] } {
  const labels = gl.labels ?? [];
  const names = gl.names ?? [];
  const keep = isGoalie ? GOALIE_COLS : SKATER_COLS;
  // Column indices to keep, in curated display order. Fall back to the full set
  // if ESPN's names don't match (feed change), so the log never renders blank.
  let idxs = keep.map((n) => names.indexOf(n)).filter((i) => i >= 0);
  if (idxs.length === 0) idxs = names.map((_, i) => i);
  const columns = idxs.map((i) => ({ name: names[i] ?? labels[i] ?? "", label: labels[i] ?? names[i] ?? "" }));
  const meta = gl.events ?? {};

  const seasonType = pickSeasonType(gl);
  // ESPN's "categories" are monthly splits — flatten events across all of them
  // to get the full season log.
  const rows: HockeyGameLogRow[] = [];
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

function adaptAthlete(raw: AthleteRaw): HockeyPlayerPageData | null {
  const bio = adaptBio(raw);
  if (!bio) return null;
  const gl = (raw.gamelog as GamelogJson | null) ?? {};
  const { columns, rows } = adaptGamelog(gl, bio.position === "G");
  return { bio, season: raw.season, summary: adaptSummary(raw), columns, rows };
}

// ── loader ────────────────────────────────────────────────────────────────────

/**
 * Load a player page for the most relevant season. Defaults to the current
 * season; if it has no games yet (offseason / pre-opener) falls back one year
 * so the page shows real production instead of an empty shell.
 */
export async function loadHockeyPlayerData(
  athleteId: string,
  seasonHint?: number,
): Promise<HockeyPlayerPageData | null> {
  const season = seasonHint ?? seasonForDate(yesterdayInET());
  const data = adaptAthlete(await fetchAthleteRaw(athleteId, season));
  if (!data) return null;
  if (data.rows.length === 0 && seasonHint == null) {
    const prev = adaptAthlete(await fetchAthleteRaw(athleteId, season - 1));
    if (prev && prev.rows.length > 0) return prev;
  }
  return data;
}
