// ESPN hidden-API client for basketball (NBA + WNBA). The same endpoint
// shapes work for both leagues — only the URL slug differs ('nba' | 'wnba').
//
// Three endpoints we hit:
//   scoreboard?dates=YYYYMMDD     → list of games + per-quarter linescores
//   summary?event={id}            → per-game box score (team + player totals)
//   standings?season=YYYY&seasontype=2  → conference standings
//
// Each endpoint has a fetcher (network, returns the unmodified envelope) and
// a parser (pure, returns the trimmed shape callers want). Matches the split
// in lib/mlb.ts — the raw cache stores fetcher output; renderers run that
// output through the parsers without re-hitting ESPN.

import { dedupeTransactions } from "./dedupe-transactions";

const SCOREBOARD_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball";
const STANDINGS_BASE = "https://site.web.api.espn.com/apis/v2/sports/basketball";
// The per-athlete statistics endpoint lives on a different path (common/v3).
// Standings happen to also exist under v2 but byathlete only works here.
const LEADERS_BASE = "https://site.web.api.espn.com/apis/common/v3/sports/basketball";
// Team roster (full player list w/ jersey/position/injuries; no stats).
const ROSTER_BASE = "https://site.web.api.espn.com/apis/site/v2/sports/basketball";

export type BasketballLeagueSlug = "nba" | "wnba";

// Coarse status bucket. ESPN's status.type.id is "1"=scheduled, "2"=in
// progress, "3"=final, "5"=postponed, etc. We collapse to what the renderer
// cares about; raw value stays in the cache if we ever need more nuance.
export type BasketballGameStatus = "scheduled" | "in_progress" | "final" | "postponed" | "other";

export type BasketballTeam = {
  id: string;
  abbreviation: string;
  location: string;     // "Cleveland"
  name: string;         // "Cavaliers"
  displayName: string;  // "Cleveland Cavaliers"
};

export type BasketballLinescore = {
  period: number;  // 1..4 for quarters, 5+ for overtime
  value: number;
};

export type BasketballScoreboardEvent = {
  id: string;
  date: string;
  shortName: string;        // "CLE @ DET"
  status: BasketballGameStatus;
  statusDetail: string;     // "Final", "End of 3rd Quarter", "7:00 PM ET"
  period: number;           // current period (4 = end of regulation)
  seasonType: number;       // ESPN: 1=preseason, 2=regular, 3=postseason, 4=in-season tournament
  away: BasketballSideSummary;
  home: BasketballSideSummary;
  venue?: string;
  // Postseason-only context. ESPN attaches series info to playoff events;
  // we surface it on the renderer's "Playoff series" section in place of
  // standings. Undefined for regular-season games.
  roundName?: string;       // "West Finals", "Conference Semifinals", parsed from notes[0].headline
  series?: BasketballSeriesContext;
};

export type BasketballSeriesContext = {
  title: string;            // "Playoff Series"
  summary: string;          // "SA leads series 1-0"
  completed: boolean;
  totalGames: number;       // 7 for NBA best-of-7
  awayWins: number;
  homeWins: number;
};

export type BasketballSideSummary = {
  team: BasketballTeam;
  score: number | null;     // null before game starts
  linescores: BasketballLinescore[];
  winner: boolean;
};

export type BasketballPlayerLine = {
  athleteId: string;
  displayName: string;
  jersey?: string;
  position?: string;
  starter: boolean;
  didNotPlay: boolean;
  // Keyed by stat label (MIN/PTS/FG/3PT/FT/REB/AST/TO/STL/BLK/OREB/DREB/PF/+-).
  // Values are raw ESPN strings ("8-14" for FG, "+9" for plus/minus, "" for
  // empty cells). Renderer formats; we don't pre-parse the dash splits.
  stats: Record<string, string>;
};

export type BasketballBoxTeam = {
  team: BasketballTeam;
  homeAway: "home" | "away";
  totals: Record<string, string>;       // same keys as player.stats
  players: BasketballPlayerLine[];
};

export type BasketballBoxscore = {
  eventId: string;
  teams: [BasketballBoxTeam, BasketballBoxTeam];
};

export type BasketballStandingsEntry = {
  team: BasketballTeam;
  // ESPN stats are keyed by `name`: wins, losses, winPercent, gamesBehind,
  // streak, playoffSeed, avgPointsFor, avgPointsAgainst, differential, etc.
  // Keep both numeric and display variants — renderer picks based on stat.
  stats: Record<string, { value: number; displayValue: string }>;
};

export type BasketballConferenceStandings = {
  id: string;             // "5" (East) | "6" (West) for NBA; WNBA is one group
  name: string;           // "Eastern Conference" | "Western Conference"
  abbreviation: string;   // "East" | "West"
  entries: BasketballStandingsEntry[];
};

// League leaders — top-N players per counting-stat category. Computed
// client-side by sorting the merged athlete-stats payload.
export type LeaderCategoryKey =
  | "PTS" | "REB" | "AST" | "STL" | "BLK"
  | "FG%" | "3P%" | "FT%";

export type LeaderEntry = {
  rank: number;
  athleteId: string;       // ESPN id, for the player-page link
  athleteName: string;     // "Luka Doncic"
  teamAbbr: string;        // "LAL"
  value: number;           // 33.5 (raw stat, for sorting/debug)
  displayValue: string;    // "33.5" for averages, ".476" for percentages
};

export type LeaderCategory = {
  key: LeaderCategoryKey;
  label: string;           // "Points"
  abbrev: string;          // "PPG"
  entries: LeaderEntry[];  // top N, sorted desc
};

export type BasketballLeaders = {
  categories: LeaderCategory[];
};

// Transactions feed. Player/coach name lives inside `description`; surfaced
// to the renderer as-is.
export type BasketballTransaction = {
  date: string;            // ISO 8601
  description: string;
  teamAbbr?: string;
};

export type BasketballStandings = {
  conferences: BasketballConferenceStandings[];
};

// ---- Network ---------------------------------------------------------------

async function getJson(url: string): Promise<unknown> {
  // One retry with linear backoff. ESPN occasionally serves 5xx during their
  // own cache rebuilds; a single quick retry covers the common case without
  // turning into a thundering-herd source if they're actually down.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) return res.json();
    if (attempt === 2 || res.status < 500) {
      throw new Error(`ESPN ${res.status} for ${url}`);
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error("unreachable");
}

// ---- Scoreboard -----------------------------------------------------------

export async function fetchScoreboardRaw(
  league: BasketballLeagueSlug,
  date: string,  // YYYY-MM-DD
): Promise<unknown> {
  const espnDate = date.replace(/-/g, "");
  return getJson(`${SCOREBOARD_BASE}/${league}/scoreboard?dates=${espnDate}`);
}

// ESPN's scoreboard accepts a date range as `dates=YYYYMMDD-YYYYMMDD`. One
// call returns every event whose date falls inside the inclusive range,
// each with its full series + roundName context. The bracket renderer uses
// this to surface playoff series that haven't started yet (e.g., next-round
// series whose game 1 is several days away).
export async function fetchScoreboardRangeRaw(
  league: BasketballLeagueSlug,
  startDate: string,
  endDate: string,
): Promise<unknown> {
  const start = startDate.replace(/-/g, "");
  const end = endDate.replace(/-/g, "");
  return getJson(`${SCOREBOARD_BASE}/${league}/scoreboard?dates=${start}-${end}`);
}

// Per-athlete season stats. One call returns every athlete's general,
// offensive, and defensive buckets together. The response schema lists each
// stat by name at the top level (`categories[].names`) and stores the per-
// athlete numbers as positional `values` arrays — parseLeaders re-aligns
// them.
export async function fetchAthleteStatsRaw(
  league: BasketballLeagueSlug,
  season: number,
  seasonType: number,
  limit: number = 100,
): Promise<unknown> {
  return getJson(
    `${LEADERS_BASE}/${league}/statistics/byathlete` +
    `?lang=en&region=us&season=${season}&seasontype=${seasonType}&limit=${limit}`,
  );
}

// League-wide transaction feed. One row per transaction (signings, waivers,
// trades, coaching moves). ESPN puts the player/coach name inside the
// human-readable `description` text rather than a separate field — the
// renderer surfaces description as-is, like baseball does.
//
// The ?dates=YYYYMMDD filter is REQUIRED for correct backfill. Without it the
// endpoint returns only the latest ~25 league-wide moves (undated), so a
// digest regenerated for any past date matched nothing and hid the section.
// ESPN stamps transactions at ~07:00–08:00Z, so a single-date query returns a
// small window (that date + the next in ET); the renderer's exact ET-date
// filter then keeps only the digest day's moves.
export async function fetchTransactionsRaw(
  league: BasketballLeagueSlug,
  date: string,  // YYYY-MM-DD
): Promise<unknown> {
  const espnDate = date.replace(/-/g, "");
  return getJson(`${SCOREBOARD_BASE}/${league}/transactions?dates=${espnDate}`);
}

export function parseScoreboard(raw: unknown): BasketballScoreboardEvent[] {
  const data = raw as { events?: Array<Record<string, unknown>> };
  const events = data.events ?? [];
  return events.map((ev) => {
    const comp = (ev.competitions as Array<Record<string, unknown>>)[0] ?? {};
    const competitors = (comp.competitors as Array<Record<string, unknown>>) ?? [];
    const status = (comp.status as Record<string, unknown>) ?? {};
    const statusType = (status.type as Record<string, unknown>) ?? {};
    const venue = (comp.venue as { fullName?: string } | undefined)?.fullName;

    const season = (ev.season as Record<string, unknown>) ?? {};
    const seasonType = Number(season.type ?? 0);
    const away = extractSide(competitors, "away");
    const home = extractSide(competitors, "home");
    // Series context belongs to postseason games only. ESPN bleeds a
    // completed playoff series onto the REGULAR-season rematch between the
    // same two teams once that series exists — e.g. a March SA@NY game
    // carries {type:"playoff", summary:"NY wins series 4-1"} when viewed
    // after the following June Finals. Gate on seasonType=3 so a
    // regular-season box never sprouts a playoff series line.
    return {
      id: String(ev.id),
      date: String(ev.date),
      shortName: String(ev.shortName ?? ""),
      status: classifyStatus(String(statusType.id ?? "")),
      statusDetail: String(statusType.detail ?? statusType.description ?? ""),
      period: Number(status.period ?? 0),
      seasonType,
      away,
      home,
      venue,
      roundName: extractRoundName(ev, comp),
      series: seasonType === 3 ? extractSeries(comp, away.team.id, home.team.id) : undefined,
    };
  });
}

function classifyStatus(typeId: string): BasketballGameStatus {
  switch (typeId) {
    case "1": return "scheduled";
    case "2": return "in_progress";
    case "3": return "final";
    case "5": case "6": return "postponed";
    default:  return "other";
  }
}

// "West Finals - Game 1" → "West Finals". Falls back to the raw headline
// when there's no "- Game N" suffix. Undefined when no notes are present
// (regular-season games typically have none).
//
// ESPN puts the round headline on the COMPETITION notes, not the event
// notes — and the NBA Finals only populate it there (event.notes is []),
// so a Finals game rendered with just the series summary ("NY leads 3-1")
// and no round label. Read comp.notes first, event.notes as a fallback for
// any round ESPN tags at the event level.
function extractRoundName(
  ev: Record<string, unknown>,
  comp: Record<string, unknown>,
): string | undefined {
  const compNotes = comp.notes as Array<Record<string, unknown>> | undefined;
  const evNotes = ev.notes as Array<Record<string, unknown>> | undefined;
  const headline = compNotes?.[0]?.headline ?? evNotes?.[0]?.headline;
  if (typeof headline !== "string" || headline.length === 0) return undefined;
  const idx = headline.indexOf(" - Game ");
  return idx > 0 ? headline.slice(0, idx) : headline;
}

// ESPN's series object pairs `competitors[].wins` with the team id; align
// with the parsed away/home team ids so the renderer doesn't have to lookup.
function extractSeries(
  comp: Record<string, unknown>,
  awayId: string,
  homeId: string,
): BasketballSeriesContext | undefined {
  const s = comp.series as Record<string, unknown> | undefined;
  if (!s) return undefined;
  const sCompetitors = (s.competitors as Array<Record<string, unknown>>) ?? [];
  let awayWins = 0;
  let homeWins = 0;
  for (const c of sCompetitors) {
    const cid = String(c.id);
    const wins = Number(c.wins ?? 0);
    if (cid === awayId) awayWins = wins;
    else if (cid === homeId) homeWins = wins;
  }
  return {
    title: String(s.title ?? ""),
    summary: String(s.summary ?? ""),
    completed: s.completed === true,
    totalGames: Number(s.totalCompetitions ?? 7),
    awayWins,
    homeWins,
  };
}

function extractSide(
  competitors: Array<Record<string, unknown>>,
  side: "home" | "away",
): BasketballSideSummary {
  const c = competitors.find((x) => x.homeAway === side);
  if (!c) {
    throw new Error(`scoreboard event missing ${side} competitor`);
  }
  const team = c.team as Record<string, unknown>;
  const scoreStr = c.score == null ? null : String(c.score);
  const linescores = ((c.linescores as Array<Record<string, unknown>>) ?? []).map((l) => ({
    period: Number(l.period),
    value: Number(l.value),
  }));
  return {
    team: {
      id: String(team.id),
      abbreviation: String(team.abbreviation ?? ""),
      location: String(team.location ?? ""),
      name: String(team.name ?? ""),
      displayName: String(team.displayName ?? `${team.location ?? ""} ${team.name ?? ""}`.trim()),
    },
    score: scoreStr == null || scoreStr === "" ? null : Number(scoreStr),
    linescores,
    winner: c.winner === true,
  };
}

// ---- Summary (box score) --------------------------------------------------

export async function fetchSummaryRaw(
  league: BasketballLeagueSlug,
  eventId: string,
): Promise<unknown> {
  return getJson(`${SCOREBOARD_BASE}/${league}/summary?event=${eventId}`);
}

export function parseBoxscore(raw: unknown, eventId: string): BasketballBoxscore | null {
  const data = raw as { boxscore?: Record<string, unknown> };
  const box = data.boxscore;
  if (!box) return null;

  // box.players is an array, one entry per team. Each entry has team info plus
  // a `statistics` array — basketball has exactly one statistics group (the
  // box-score line). `names` is the positional key array; player.stats and
  // totals are positional arrays in the same order.
  const playersByTeam = (box.players as Array<Record<string, unknown>>) ?? [];
  const teams: BasketballBoxTeam[] = playersByTeam.map((entry, idx) => {
    const team = entry.team as Record<string, unknown>;
    const statsGroups = (entry.statistics as Array<Record<string, unknown>>) ?? [];
    const group = statsGroups[0] ?? {};
    const names = (group.names as string[]) ?? [];
    const totalsArr = (group.totals as string[]) ?? [];
    const athletes = (group.athletes as Array<Record<string, unknown>>) ?? [];

    return {
      team: {
        id: String(team.id),
        abbreviation: String(team.abbreviation ?? ""),
        location: String(team.location ?? ""),
        name: String(team.name ?? ""),
        displayName: String(team.displayName ?? `${team.location ?? ""} ${team.name ?? ""}`.trim()),
      },
      homeAway: (entry.homeAway === "home" ? "home" : "away"),
      totals: zipPositional(names, totalsArr),
      players: athletes.map((a) => extractPlayerLine(a, names)),
    };
  });

  // Sanity: basketball always has exactly two teams in a box score.
  if (teams.length !== 2) return null;
  return { eventId, teams: [teams[0]!, teams[1]!] };
}

function zipPositional(names: string[], values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < names.length; i++) {
    const k = names[i];
    if (k) out[k] = values[i] ?? "";
  }
  return out;
}

function extractPlayerLine(
  athleteEntry: Record<string, unknown>,
  names: string[],
): BasketballPlayerLine {
  const ath = (athleteEntry.athlete as Record<string, unknown>) ?? {};
  const pos = (ath.position as Record<string, unknown>) ?? {};
  const statsArr = (athleteEntry.stats as string[]) ?? [];
  // ESPN marks DNPs by flag, by empty stats, or by a single "DNP-Coach's
  // Decision" string. Handle all three so the renderer can suppress cleanly.
  const didNotPlay =
    athleteEntry.didNotPlay === true ||
    statsArr.length === 0 ||
    (statsArr.length === 1 && /dnp|did not play/i.test(statsArr[0] ?? ""));

  return {
    athleteId: String(ath.id ?? ""),
    displayName: String(ath.displayName ?? ""),
    jersey: ath.jersey ? String(ath.jersey) : undefined,
    position: pos.abbreviation ? String(pos.abbreviation) : undefined,
    starter: athleteEntry.starter === true,
    didNotPlay,
    stats: didNotPlay ? {} : zipPositional(names, statsArr),
  };
}

// ---- Standings ------------------------------------------------------------

export async function fetchStandingsRaw(
  league: BasketballLeagueSlug,
  season: number,
  // 2 = regular season, 3 = postseason. Default to regular for sortable W-L.
  seasonType: number = 2,
): Promise<unknown> {
  return getJson(
    `${STANDINGS_BASE}/${league}/standings?season=${season}&seasontype=${seasonType}`,
  );
}

export function parseStandings(raw: unknown): BasketballStandings {
  const data = raw as { children?: Array<Record<string, unknown>> };
  const children = data.children ?? [];
  const conferences: BasketballConferenceStandings[] = [];
  for (const child of children) {
    const standings = (child.standings as Record<string, unknown>) ?? {};
    const entries = (standings.entries as Array<Record<string, unknown>>) ?? [];
    conferences.push({
      id: String(child.id ?? ""),
      name: String(child.name ?? ""),
      abbreviation: String(child.abbreviation ?? child.name ?? ""),
      entries: entries.map((e) => extractStandingsEntry(e)),
    });
  }
  return { conferences };
}

function extractStandingsEntry(entry: Record<string, unknown>): BasketballStandingsEntry {
  const team = entry.team as Record<string, unknown>;
  const stats: Record<string, { value: number; displayValue: string }> = {};
  for (const s of (entry.stats as Array<Record<string, unknown>>) ?? []) {
    const name = String(s.name ?? "");
    if (!name) continue;
    stats[name] = {
      value: Number(s.value ?? 0),
      displayValue: String(s.displayValue ?? ""),
    };
  }
  return {
    team: {
      id: String(team.id),
      abbreviation: String(team.abbreviation ?? ""),
      location: String(team.location ?? ""),
      name: String(team.name ?? ""),
      displayName: String(team.displayName ?? ""),
    },
    stats,
  };
}

// ---- Leaders --------------------------------------------------------------
//
// ESPN's byathlete endpoint scopes stats by category bucket — one fetch
// per category, with per-game averages on each athlete record. We fetch
// offensive (PTS, AST) and defensive (REB, STL, BLK) buckets and merge by
// athlete id so each player carries every stat we need.

type AthleteRecord = {
  id: string;
  name: string;
  teamAbbr: string;
  stats: Record<string, number>;
};

// The byathlete response uses two parallel arrays per category bucket:
//   top-level: categories[].names = ["avgPoints", "avgAssists", ...]
//   per-athlete: categories[].values = [33.5, 8.3, ...]
// Index N in the per-athlete values corresponds to names[N]. Rebounds live
// in the "general" bucket, points/assists in "offensive", steals/blocks in
// "defensive" — so we have to walk all three to populate every stat we need.
function extractAthletes(raw: unknown): AthleteRecord[] {
  const data = raw as {
    categories?: Array<{ name?: string; names?: string[] }>;
    athletes?: Array<Record<string, unknown>>;
  };

  // Build schema: category name → ordered list of stat keys
  const namesByCategory = new Map<string, string[]>();
  for (const c of data.categories ?? []) {
    if (typeof c.name === "string" && Array.isArray(c.names)) {
      namesByCategory.set(c.name, c.names);
    }
  }

  const out: AthleteRecord[] = [];
  for (const a of data.athletes ?? []) {
    const athlete = a.athlete as Record<string, unknown> | undefined;
    if (!athlete) continue;
    const stats: Record<string, number> = {};
    const catArr = (a.categories as Array<Record<string, unknown>>) ?? [];
    for (const c of catArr) {
      const catName = typeof c.name === "string" ? c.name : "";
      const names = namesByCategory.get(catName);
      const values = c.values as unknown[] | undefined;
      if (!names || !Array.isArray(values)) continue;
      const max = Math.min(names.length, values.length);
      for (let i = 0; i < max; i++) {
        const k = names[i];
        const v = values[i];
        if (k && typeof v === "number") stats[k] = v;
      }
    }
    out.push({
      id: String(athlete.id ?? ""),
      name: String(
        athlete.displayName ??
          `${athlete.firstName ?? ""} ${athlete.lastName ?? ""}`.trim(),
      ),
      teamAbbr: String(athlete.teamShortName ?? ""),
      stats,
    });
  }
  return out;
}

// A roster entry from ESPN's team roster endpoint — the full active roster
// (every player, including those yet to log a game), with jersey/position and
// an injury flag. Stats live in the byathlete feed, joined by id downstream.
export type BasketballRosterEntry = {
  id: string;
  name: string;
  jersey?: string;
  position?: string;   // "G" | "F" | "C"
  injured: boolean;
};

// Full roster for one team. ESPN's roster endpoint carries names + jersey +
// position + injuries but NO stats (even with ?enable=stats), so the team
// digest joins this against the byathlete feed (athleteStatsById) by player id.
export async function fetchTeamRosterRaw(
  league: BasketballLeagueSlug,
  teamId: string,   // ESPN numeric team id or abbreviation slug
): Promise<unknown> {
  return getJson(`${ROSTER_BASE}/${league}/teams/${teamId}/roster`);
}

export function parseRoster(raw: unknown): BasketballRosterEntry[] {
  const d = raw as { athletes?: Array<Record<string, unknown>> };
  const flat: Array<Record<string, unknown>> = [];
  for (const a of d.athletes ?? []) {
    // Some ESPN roster payloads group by position ({ position, items: [...] });
    // others (NBA) return a flat player list. Handle both.
    const items = a.items as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(items)) flat.push(...items);
    else flat.push(a);
  }
  return flat.map((a) => {
    const pos = a.position as { abbreviation?: string } | undefined;
    const injuries = (a.injuries as unknown[]) ?? [];
    return {
      id: String(a.id ?? ""),
      name: String(a.fullName ?? a.displayName ?? ""),
      jersey: a.jersey ? String(a.jersey) : undefined,
      position: pos?.abbreviation ? String(pos.abbreviation) : undefined,
      injured: injuries.length > 0,
    };
  });
}

// Season averages keyed by athlete id, for joining onto a roster.
export function athleteStatsById(raw: unknown): Map<string, Record<string, number>> {
  const m = new Map<string, Record<string, number>>();
  for (const a of extractAthletes(raw)) m.set(a.id, a.stats);
  return m;
}

// Fallback roster source: the byathlete feed filtered to one team (players with
// stats only). Used when ESPN's roster endpoint is unavailable. teamAbbr is
// ESPN's teamShortName ("LAL").
export function teamAthletes(
  raw: unknown,
  teamAbbr: string,
): Array<{ id: string; name: string; stats: Record<string, number> }> {
  return extractAthletes(raw)
    .filter((a) => a.teamAbbr === teamAbbr)
    .map((a) => ({ id: a.id, name: a.name, stats: a.stats }));
}

export function parseLeaders(raw: unknown): BasketballLeaders {
  const athletes = extractAthletes(raw);

  // Percentage leaders need a minimum-makes qualifier — without one a player who
  // went 2-for-2 tops the FG% board. The NBA's official season minimums are 300
  // FGM, 82 3PM, 125 FTM over a full 82-game schedule, prorated by games played
  // so far. We estimate "team games played" as the league-max gamesPlayed and
  // scale each minimum by that / 82. Source: NBA official rate-stat qualification.
  const teamGames = Math.max(0, ...athletes.map((a) => a.stats.gamesPlayed ?? 0)) || 82;
  const prorate = (seasonMin: number) => (seasonMin * teamGames) / 82;

  const fmtAvg = (v: number) => v.toFixed(1);
  // ".476" newspaper style: ESPN returns 0–100, so /100 → 3 decimals → drop the
  // leading zero, matching the digest's ".312"-style rate formatting elsewhere.
  const fmtPct = (v: number) => {
    const s = (v / 100).toFixed(3);
    return s.startsWith("0.") ? s.slice(1) : s;
  };

  const make = (
    key: LeaderCategoryKey,
    label: string,
    abbrev: string,
    statField: string,
    opts?: { pct?: boolean; qualify?: { madeField: string; seasonMin: number } },
  ): LeaderCategory => {
    const minMakes = opts?.qualify ? prorate(opts.qualify.seasonMin) : 0;
    const sorted = athletes
      .filter((a) => typeof a.stats[statField] === "number")
      .filter((a) => {
        if (!opts?.qualify) return true;
        const made = a.stats[opts.qualify.madeField];
        return typeof made === "number" && made >= minMakes;
      })
      .sort((a, b) => (b.stats[statField] ?? 0) - (a.stats[statField] ?? 0))
      .slice(0, 5);
    const fmt = opts?.pct ? fmtPct : fmtAvg;
    return {
      key,
      label,
      abbrev,
      entries: sorted.map((a, i) => ({
        rank: i + 1,
        athleteId: a.id,
        athleteName: a.name,
        teamAbbr: a.teamAbbr,
        value: a.stats[statField] ?? 0,
        displayValue: fmt(a.stats[statField] ?? 0),
      })),
    };
  };

  // Order groups shooting next to scoring (AP newspaper convention); in the
  // 2-column web flow this puts PTS/FG%/3P%/FT% in the left column and the
  // rebound/assist/defense counting stats in the right.
  return {
    categories: [
      make("PTS", "Points", "PPG", "avgPoints"),
      make("FG%", "Field Goal %", "", "fieldGoalPct",
        { pct: true, qualify: { madeField: "fieldGoalsMade", seasonMin: 300 } }),
      make("3P%", "3-Point %", "", "threePointFieldGoalPct",
        { pct: true, qualify: { madeField: "threePointFieldGoalsMade", seasonMin: 82 } }),
      make("FT%", "Free Throw %", "", "freeThrowPct",
        { pct: true, qualify: { madeField: "freeThrowsMade", seasonMin: 125 } }),
      make("REB", "Rebounds", "RPG", "avgRebounds"),
      make("AST", "Assists", "APG", "avgAssists"),
      make("STL", "Steals", "SPG", "avgSteals"),
      make("BLK", "Blocks", "BPG", "avgBlocks"),
    ],
  };
}

// ---- Transactions ---------------------------------------------------------

export function parseTransactions(raw: unknown): BasketballTransaction[] {
  const data = raw as { transactions?: Array<Record<string, unknown>> };
  const list = data.transactions ?? [];
  const mapped = list.map((t) => {
    const team = t.team as { abbreviation?: string } | undefined;
    return {
      date: String(t.date ?? ""),
      description: String(t.description ?? ""),
      teamAbbr: team?.abbreviation ? String(team.abbreviation) : undefined,
    };
  });
  // Collapse a multi-player trade (one record per player, same text) to one row.
  return dedupeTransactions(mapped);
}
