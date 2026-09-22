// ESPN hidden-API client for the NHL. Mirrors lib/basketball.ts: each endpoint
// has a fetcher (network, unmodified envelope) and a parser (pure, trimmed
// shape). The raw cache stores fetcher output; renderers run it through parsers
// without re-hitting ESPN.
//
// Hockey differs from basketball in three places:
//   - box score splits into skaters (forwards + defenses groups) and goalies,
//     each carrying its own parallel keys[]/labels[]/stats[] arrays;
//   - standings are ranked by points (W-L-OTL), not win %;
//   - leaders are season totals (goals/assists/points) plus goalie rates.

import { dedupeTransactions } from "./dedupe-transactions";

const SCOREBOARD_BASE = "https://site.api.espn.com/apis/site/v2/sports/hockey";
const STANDINGS_BASE = "https://site.web.api.espn.com/apis/v2/sports/hockey";
const LEADERS_BASE = "https://site.web.api.espn.com/apis/common/v3/sports/hockey";
const ROSTER_BASE = "https://site.web.api.espn.com/apis/site/v2/sports/hockey";

export type HockeyGameStatus = "scheduled" | "in_progress" | "final" | "postponed" | "other";

export type HockeyTeam = {
  id: string;
  abbreviation: string;
  location: string;     // "Ottawa"
  name: string;         // "Senators"
  displayName: string;  // "Ottawa Senators"
};

export type HockeyLinescore = {
  period: number;  // 1..3 regulation, 4 = OT, 5 = shootout
  value: number;
};

export type HockeySeriesContext = {
  title: string;
  summary: string;      // "OTT leads series 1-0"
  completed: boolean;
  totalGames: number;   // 7 for an NHL best-of-7
  awayWins: number;
  homeWins: number;
};

export type HockeySideSummary = {
  team: HockeyTeam;
  score: number | null;
  linescores: HockeyLinescore[];
  winner: boolean;
  record?: string;      // "44-30-6" (W-L-OTL) from the scoreboard competitor
};

export type HockeyScoreboardEvent = {
  id: string;
  date: string;
  shortName: string;    // "PHI @ OTT"
  status: HockeyGameStatus;
  statusDetail: string; // "Final", "Final/OT", "Final/SO", "7:00 PM ET"
  period: number;
  seasonType: number;   // 1=preseason, 2=regular, 3=postseason
  away: HockeySideSummary;
  home: HockeySideSummary;
  venue?: string;
  roundName?: string;   // "Stanley Cup Final", etc. (postseason only)
  series?: HockeySeriesContext;
};

// A box-score player line, keyed by ESPN's stat key ("goals", "assists",
// "plusMinus", "shotsTotal", "penaltyMinutes", "timeOnIce" for skaters;
// "shotsAgainst", "saves", "goalsAgainst", "savePct", "timeOnIce" for goalies).
// Values are raw ESPN strings; the renderer formats.
export type HockeyPlayerLine = {
  athleteId: string;
  displayName: string;
  position?: string;
  stats: Record<string, string>;
};

export type HockeyBoxTeam = {
  team: HockeyTeam;
  homeAway: "home" | "away";
  skaters: HockeyPlayerLine[];
  goalies: HockeyPlayerLine[];
};

// A goal, from the summary's play-by-play. `text` is ESPN's ready-made line
// ("Nicolas Deslauriers Goal (2) Backhand, assists: Cam York, Garnet Hathaway").
export type HockeyScoringPlay = {
  period: number;
  clock: string;
  teamId: string;
  text: string;
  awayScore: number;
  homeScore: number;
};

export type HockeyBoxscore = {
  eventId: string;
  teams: [HockeyBoxTeam, HockeyBoxTeam];
  scoringPlays: HockeyScoringPlay[];
};

export type HockeyStandingsEntry = {
  team: HockeyTeam;
  // Keyed by ESPN stat name: points, wins, losses, otLosses, gamesPlayed,
  // playoffSeed, streak, pointDifferential, etc.
  stats: Record<string, { value: number; displayValue: string }>;
};

export type HockeyConferenceStandings = {
  id: string;
  name: string;          // "Eastern Conference"
  abbreviation: string;  // "East"
  entries: HockeyStandingsEntry[];
};

export type HockeyStandings = {
  conferences: HockeyConferenceStandings[];
};

export type LeaderCategoryKey = "G" | "A" | "PTS" | "+/-" | "SV%" | "GAA";

export type LeaderEntry = {
  rank: number;
  athleteId: string;
  athleteName: string;
  teamAbbr: string;
  value: number;
  displayValue: string;
};

export type LeaderCategory = {
  key: LeaderCategoryKey;
  label: string;
  abbrev: string;
  entries: LeaderEntry[];
};

export type HockeyLeaders = { categories: LeaderCategory[] };

export type HockeyTransaction = {
  date: string;
  description: string;
  teamAbbr?: string;
};

// ---- Network ---------------------------------------------------------------

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) return res.json();
    if (attempt === 2 || res.status < 500) throw new Error(`ESPN ${res.status} for ${url}`);
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error("unreachable");
}

// ---- Scoreboard -----------------------------------------------------------

export async function fetchScoreboardRaw(date: string): Promise<unknown> {
  return getJson(`${SCOREBOARD_BASE}/nhl/scoreboard?dates=${date.replace(/-/g, "")}`);
}

export async function fetchScoreboardRangeRaw(startDate: string, endDate: string): Promise<unknown> {
  return getJson(
    `${SCOREBOARD_BASE}/nhl/scoreboard?dates=${startDate.replace(/-/g, "")}-${endDate.replace(/-/g, "")}`,
  );
}

export async function fetchAthleteStatsRaw(
  season: number,
  seasonType: number,
  limit: number = 100,
): Promise<unknown> {
  return getJson(
    `${LEADERS_BASE}/nhl/statistics/byathlete?lang=en&region=us&season=${season}&seasontype=${seasonType}&limit=${limit}`,
  );
}

export async function fetchTransactionsRaw(date: string): Promise<unknown> {
  return getJson(`${SCOREBOARD_BASE}/nhl/transactions?dates=${date.replace(/-/g, "")}`);
}

export function parseScoreboard(raw: unknown): HockeyScoreboardEvent[] {
  const data = raw as { events?: Array<Record<string, unknown>> };
  return (data.events ?? []).map((ev) => {
    const comp = (ev.competitions as Array<Record<string, unknown>>)[0] ?? {};
    const status = (comp.status as Record<string, unknown>) ?? {};
    const statusType = (status.type as Record<string, unknown>) ?? {};
    const competitors = (comp.competitors as Array<Record<string, unknown>>) ?? [];
    const season = (ev.season as Record<string, unknown>) ?? {};
    const seasonType = Number(season.type ?? 0);
    const away = extractSide(competitors, "away");
    const home = extractSide(competitors, "home");
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
      venue: (comp.venue as { fullName?: string } | undefined)?.fullName,
      roundName: extractRoundName(ev, comp),
      series: seasonType === 3 ? extractSeries(comp, away.team.id, home.team.id) : undefined,
    };
  });
}

function classifyStatus(typeId: string): HockeyGameStatus {
  switch (typeId) {
    case "1": return "scheduled";
    case "2": return "in_progress";
    case "3": return "final";
    case "5": case "6": return "postponed";
    default:  return "other";
  }
}

function extractRoundName(ev: Record<string, unknown>, comp: Record<string, unknown>): string | undefined {
  const compNotes = comp.notes as Array<Record<string, unknown>> | undefined;
  const evNotes = ev.notes as Array<Record<string, unknown>> | undefined;
  const headline = compNotes?.[0]?.headline ?? evNotes?.[0]?.headline;
  if (typeof headline !== "string" || headline.length === 0) return undefined;
  const idx = headline.indexOf(" - Game ");
  return idx > 0 ? headline.slice(0, idx) : headline;
}

function extractSeries(
  comp: Record<string, unknown>,
  awayId: string,
  homeId: string,
): HockeySeriesContext | undefined {
  const s = comp.series as Record<string, unknown> | undefined;
  if (!s) return undefined;
  const sc = (s.competitors as Array<Record<string, unknown>>) ?? [];
  let awayWins = 0, homeWins = 0;
  for (const c of sc) {
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

function toTeam(team: Record<string, unknown>): HockeyTeam {
  return {
    id: String(team.id),
    abbreviation: String(team.abbreviation ?? ""),
    location: String(team.location ?? ""),
    name: String(team.name ?? ""),
    displayName: String(team.displayName ?? `${team.location ?? ""} ${team.name ?? ""}`.trim()),
  };
}

function extractSide(
  competitors: Array<Record<string, unknown>>,
  side: "home" | "away",
): HockeySideSummary {
  const c = competitors.find((x) => x.homeAway === side);
  if (!c) throw new Error(`scoreboard event missing ${side} competitor`);
  const scoreStr = c.score == null ? null : String(c.score);
  const linescores = ((c.linescores as Array<Record<string, unknown>>) ?? []).map((l) => ({
    period: Number(l.period),
    value: Number(l.value),
  }));
  const records = (c.records as Array<Record<string, unknown>>) ?? [];
  const overall = records.find((r) => r.type === "total") ?? records[0];
  return {
    team: toTeam(c.team as Record<string, unknown>),
    score: scoreStr == null || scoreStr === "" ? null : Number(scoreStr),
    linescores,
    winner: c.winner === true,
    record: overall?.summary ? String(overall.summary) : undefined,
  };
}

// ---- Summary (box score) --------------------------------------------------

export async function fetchSummaryRaw(eventId: string): Promise<unknown> {
  return getJson(`${SCOREBOARD_BASE}/nhl/summary?event=${eventId}`);
}

// ESPN's hockey box splits each team into four groups: forwards, defenses,
// skaters (a combined view that's usually empty), and goalies. We merge
// forwards + defenses into one skater list and keep goalies separate. Each
// group carries parallel `keys` (ESPN field names) + per-athlete positional
// `stats`; zip them into a keyed record.
export function parseBoxscore(raw: unknown, eventId: string): HockeyBoxscore | null {
  const data = raw as { boxscore?: Record<string, unknown> };
  const box = data.boxscore;
  if (!box) return null;
  const playersByTeam = (box.players as Array<Record<string, unknown>>) ?? [];
  const teams: HockeyBoxTeam[] = playersByTeam.map((entry) => {
    const groups = (entry.statistics as Array<Record<string, unknown>>) ?? [];
    const skaters: HockeyPlayerLine[] = [];
    const goalies: HockeyPlayerLine[] = [];
    for (const g of groups) {
      const name = String(g.name ?? "");
      const keys = (g.keys as string[]) ?? [];
      const athletes = (g.athletes as Array<Record<string, unknown>>) ?? [];
      const lines = athletes.map((a) => extractPlayerLine(a, keys));
      if (name === "forwards" || name === "defenses") skaters.push(...lines);
      else if (name === "goalies") goalies.push(...lines);
    }
    return {
      team: toTeam(entry.team as Record<string, unknown>),
      homeAway: entry.homeAway === "home" ? "home" : "away",
      skaters,
      goalies,
    };
  });
  if (teams.length !== 2) return null;

  // Goals from the play-by-play (scoringPlay=true). ESPN's `text` already reads
  // as a scoring line, so we surface it as-is (like MLB's scoring notes).
  const plays = (data as { plays?: Array<Record<string, unknown>> }).plays ?? [];
  const scoringPlays: HockeyScoringPlay[] = plays
    .filter((p) => p.scoringPlay === true)
    .map((p) => ({
      period: Number((p.period as Record<string, unknown> | undefined)?.number ?? 0),
      clock: String((p.clock as Record<string, unknown> | undefined)?.displayValue ?? ""),
      teamId: String((p.team as Record<string, unknown> | undefined)?.id ?? ""),
      text: String(p.text ?? ""),
      awayScore: Number(p.awayScore ?? 0),
      homeScore: Number(p.homeScore ?? 0),
    }));

  return { eventId, teams: [teams[0]!, teams[1]!], scoringPlays };
}

function zipPositional(keys: string[], values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k) out[k] = values[i] ?? "";
  }
  return out;
}

function extractPlayerLine(entry: Record<string, unknown>, keys: string[]): HockeyPlayerLine {
  const ath = (entry.athlete as Record<string, unknown>) ?? {};
  const pos = (ath.position as Record<string, unknown>) ?? {};
  const statsArr = (entry.stats as string[]) ?? [];
  return {
    athleteId: String(ath.id ?? ""),
    displayName: String(ath.displayName ?? ""),
    position: pos.abbreviation ? String(pos.abbreviation) : undefined,
    stats: zipPositional(keys, statsArr),
  };
}

// ---- Standings ------------------------------------------------------------

export async function fetchStandingsRaw(season: number, seasonType: number = 2): Promise<unknown> {
  return getJson(`${STANDINGS_BASE}/nhl/standings?season=${season}&seasontype=${seasonType}`);
}

export function parseStandings(raw: unknown): HockeyStandings {
  const data = raw as { children?: Array<Record<string, unknown>> };
  const conferences: HockeyConferenceStandings[] = [];
  for (const child of data.children ?? []) {
    const standings = (child.standings as Record<string, unknown>) ?? {};
    const entries = (standings.entries as Array<Record<string, unknown>>) ?? [];
    conferences.push({
      id: String(child.id ?? ""),
      name: String(child.name ?? ""),
      abbreviation: String(child.abbreviation ?? child.name ?? ""),
      entries: entries.map(extractStandingsEntry),
    });
  }
  return { conferences };
}

function extractStandingsEntry(entry: Record<string, unknown>): HockeyStandingsEntry {
  const stats: Record<string, { value: number; displayValue: string }> = {};
  for (const s of (entry.stats as Array<Record<string, unknown>>) ?? []) {
    const name = String(s.name ?? "");
    if (!name) continue;
    stats[name] = { value: Number(s.value ?? 0), displayValue: String(s.displayValue ?? "") };
  }
  return { team: toTeam(entry.team as Record<string, unknown>), stats };
}

// ---- Leaders / roster stats -----------------------------------------------

type AthleteRecord = {
  id: string;
  name: string;
  teamAbbr: string;
  position: string;
  stats: Record<string, number>;
};

function extractAthletes(raw: unknown): AthleteRecord[] {
  const data = raw as {
    categories?: Array<{ name?: string; names?: string[] }>;
    athletes?: Array<Record<string, unknown>>;
  };
  const namesByCategory = new Map<string, string[]>();
  for (const c of data.categories ?? []) {
    if (typeof c.name === "string" && Array.isArray(c.names)) namesByCategory.set(c.name, c.names);
  }
  const out: AthleteRecord[] = [];
  for (const a of data.athletes ?? []) {
    const athlete = a.athlete as Record<string, unknown> | undefined;
    if (!athlete) continue;
    const stats: Record<string, number> = {};
    for (const c of (a.categories as Array<Record<string, unknown>>) ?? []) {
      const names = namesByCategory.get(typeof c.name === "string" ? c.name : "");
      const values = c.values as unknown[] | undefined;
      if (!names || !Array.isArray(values)) continue;
      const max = Math.min(names.length, values.length);
      for (let i = 0; i < max; i++) {
        const k = names[i];
        const v = values[i];
        if (k && typeof v === "number") stats[k] = v;
      }
    }
    const pos = (athlete.position as Record<string, unknown>) ?? {};
    out.push({
      id: String(athlete.id ?? ""),
      name: String(athlete.displayName ?? `${athlete.firstName ?? ""} ${athlete.lastName ?? ""}`.trim()),
      teamAbbr: String(athlete.teamShortName ?? ""),
      position: String(pos.abbreviation ?? ""),
      stats,
    });
  }
  return out;
}

export function athleteStatsById(raw: unknown): Map<string, Record<string, number>> {
  const m = new Map<string, Record<string, number>>();
  for (const a of extractAthletes(raw)) m.set(a.id, a.stats);
  return m;
}

export type HockeyRosterEntry = {
  id: string;
  name: string;
  jersey?: string;
  position?: string;   // "C" | "LW" | "RW" | "D" | "G"
  injured: boolean;
};

export async function fetchTeamRosterRaw(teamId: string): Promise<unknown> {
  return getJson(`${ROSTER_BASE}/nhl/teams/${teamId}/roster`);
}

export function parseRoster(raw: unknown): HockeyRosterEntry[] {
  const d = raw as { athletes?: Array<Record<string, unknown>> };
  const flat: Array<Record<string, unknown>> = [];
  for (const a of d.athletes ?? []) {
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

export function teamAthletes(
  raw: unknown,
  teamAbbr: string,
): Array<{ id: string; name: string; position: string; stats: Record<string, number> }> {
  return extractAthletes(raw)
    .filter((a) => a.teamAbbr === teamAbbr)
    .map((a) => ({ id: a.id, name: a.name, position: a.position, stats: a.stats }));
}

export function parseLeaders(raw: unknown): HockeyLeaders {
  const athletes = extractAthletes(raw);
  const skaters = athletes.filter((a) => a.position !== "G");
  const goalies = athletes.filter((a) => a.position === "G");

  const fmtInt = (v: number) => String(Math.round(v));
  const fmtSigned = (v: number) => (v > 0 ? `+${Math.round(v)}` : String(Math.round(v)));
  const fmtGaa = (v: number) => v.toFixed(2);
  // ".915" newspaper style for save percentage (ESPN returns e.g. 0.915 or 91.5).
  const fmtSvpct = (v: number) => {
    const n = v > 1 ? v / 100 : v;
    const s = n.toFixed(3);
    return s.startsWith("0.") ? s.slice(1) : s;
  };

  // A goalie qualifies for rate leaders with ~1/3 of a team's games started —
  // ESPN's `games` for a goalie ≈ appearances. Prorate the NHL's ~25-game
  // rough minimum by season progress (league-max games / 82).
  const teamGames = Math.max(0, ...athletes.map((a) => a.stats.games ?? 0)) || 82;
  const goalieMin = Math.max(1, Math.round((25 * teamGames) / 82));

  const skaterCat = (
    key: LeaderCategoryKey, label: string, abbrev: string, field: string,
    fmt: (v: number) => string,
  ): LeaderCategory => {
    const sorted = skaters
      .filter((a) => typeof a.stats[field] === "number")
      .sort((a, b) => (b.stats[field] ?? 0) - (a.stats[field] ?? 0))
      .slice(0, 5);
    return {
      key, label, abbrev,
      entries: sorted.map((a, i) => ({
        rank: i + 1, athleteId: a.id, athleteName: a.name, teamAbbr: a.teamAbbr,
        value: a.stats[field] ?? 0, displayValue: fmt(a.stats[field] ?? 0),
      })),
    };
  };

  const goalieCat = (
    key: LeaderCategoryKey, label: string, abbrev: string, field: string,
    dir: "asc" | "desc", fmt: (v: number) => string,
  ): LeaderCategory => {
    const sorted = goalies
      .filter((a) => typeof a.stats[field] === "number" && (a.stats.games ?? 0) >= goalieMin)
      .sort((a, b) => dir === "desc"
        ? (b.stats[field] ?? 0) - (a.stats[field] ?? 0)
        : (a.stats[field] ?? 0) - (b.stats[field] ?? 0))
      .slice(0, 5);
    return {
      key, label, abbrev,
      entries: sorted.map((a, i) => ({
        rank: i + 1, athleteId: a.id, athleteName: a.name, teamAbbr: a.teamAbbr,
        value: a.stats[field] ?? 0, displayValue: fmt(a.stats[field] ?? 0),
      })),
    };
  };

  return {
    categories: [
      skaterCat("PTS", "Points", "PTS", "points", fmtInt),
      skaterCat("G", "Goals", "G", "goals", fmtInt),
      skaterCat("A", "Assists", "A", "assists", fmtInt),
      skaterCat("+/-", "Plus/Minus", "+/-", "plusMinus", fmtSigned),
      goalieCat("SV%", "Save %", "SV%", "savePct", "desc", fmtSvpct),
      goalieCat("GAA", "Goals-Against Avg", "GAA", "avgGoalsAgainst", "asc", fmtGaa),
    ],
  };
}

// ---- Transactions ---------------------------------------------------------

export function parseTransactions(raw: unknown): HockeyTransaction[] {
  const data = raw as { transactions?: Array<Record<string, unknown>> };
  const mapped = (data.transactions ?? []).map((t) => {
    const team = t.team as { abbreviation?: string } | undefined;
    return {
      date: String(t.date ?? ""),
      description: String(t.description ?? ""),
      teamAbbr: team?.abbreviation ? String(team.abbreviation) : undefined,
    };
  });
  return dedupeTransactions(mapped);
}
