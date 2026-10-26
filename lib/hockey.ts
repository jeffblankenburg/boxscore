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
import { enumerateDatesInclusive } from "./dates";
import { espnJson } from "./espn-fetch";

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
  // TV channels (national first, then local), for the upcoming-games preview.
  tv: string[];
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
  // Shared ESPN fetch (retries transient 403/429/5xx + browser UA) — see
  // lib/espn-fetch. A scoreboard/summary 404 is a real error.
  return espnJson(url);
}

// ---- Scoreboard -----------------------------------------------------------

export async function fetchScoreboardRaw(date: string): Promise<unknown> {
  return getJson(`${SCOREBOARD_BASE}/nhl/scoreboard?dates=${date.replace(/-/g, "")}`);
}

// ESPN's dates=START-END range form now 400s for hockey (verified 2026-10-12);
// only single-date queries work. Walk the window one day at a time and merge
// the events into one scoreboard-shaped envelope, so the upcoming/playoff
// readers see the whole window exactly as before. See the basketball twin in
// lib/basketball.ts for the full rationale.
export async function fetchScoreboardRangeRaw(startDate: string, endDate: string): Promise<unknown> {
  const days = enumerateDatesInclusive(startDate, endDate);
  const envelopes = await Promise.all(
    days.map((d) => fetchScoreboardRaw(d).catch(() => null)),
  );
  const events: unknown[] = [];
  for (const e of envelopes) {
    const evs = (e as { events?: unknown })?.events;
    if (Array.isArray(evs)) events.push(...evs);
  }
  return { events };
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
      tv: tvFromComp(comp),
      roundName: extractRoundName(ev, comp),
      series: seasonType === 3 ? extractSeries(comp, away.team.id, home.team.id) : undefined,
    };
  });
}

// TV channels for a game — national first, then local, deduped. ESPN's
// competition.broadcasts entries carry a `market` and a `names` array.
function tvFromComp(comp: Record<string, unknown>): string[] {
  const entries = (comp.broadcasts as Array<Record<string, unknown>> | undefined) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  const collect = (wantNational: boolean) => {
    for (const b of entries) {
      if ((String(b.market ?? "").toLowerCase() === "national") !== wantNational) continue;
      for (const n of ((b.names as string[] | undefined) ?? [])) {
        const name = String(n).trim();
        if (name && !seen.has(name)) { seen.add(name); out.push(name); }
      }
    }
  };
  collect(true);
  collect(false);
  return out;
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

export type AthleteRecord = {
  id: string;
  name: string;
  teamAbbr: string;
  position: string;
  stats: Record<string, number>;
};

export function extractAthletes(raw: unknown): AthleteRecord[] {
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

// ── byathlete lag reconciliation (hockey twin of basketball) ────────────────
// Same ESPN byathlete lag and the same per-team detector as lib/basketball.ts
// reconcileAthletes (standings games-played vs the team's max byathlete games) —
// see that file for the full rationale and idempotency argument. Hockey differs
// in two ways: the stat split (skaters vs goalies), and goalie decisions — the
// box line carries no W/L field, so wins/losses/OT-losses come from the game
// result, credited to each team's goalie of record (most time on ice). SV% and
// GAA are recomputed from the folded saves/shots/goals-against/TOI totals.

// "59:55" → 3595 seconds; "" / malformed → 0.
function toiSeconds(s: string | undefined): number {
  const m = /^(\d+):(\d+)$/.exec((s ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
// ".905", "21", "" → number (empties / non-numeric → 0).
function numStat(s: string | undefined): number {
  const n = parseFloat((s ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function foldSkaterLine(season: Record<string, number>, line: Record<string, string>): void {
  season.games = (season.games ?? 0) + 1;
  season.goals = (season.goals ?? 0) + numStat(line.goals);
  season.assists = (season.assists ?? 0) + numStat(line.assists);
  season.points = (season.goals ?? 0) + (season.assists ?? 0); // hockey points = G + A
  season.plusMinus = (season.plusMinus ?? 0) + numStat(line.plusMinus);
  season.shotsTotal = (season.shotsTotal ?? 0) + numStat(line.shotsTotal);
  season.penaltyMinutes = (season.penaltyMinutes ?? 0) + numStat(line.penaltyMinutes);
}

function foldGoalieLine(
  season: Record<string, number>,
  line: Record<string, string>,
  decision: "W" | "L" | "OTL" | null, // null → appeared but not the goalie of record
): void {
  season.games = (season.games ?? 0) + 1;
  season.saves = (season.saves ?? 0) + numStat(line.saves);
  season.shotsAgainst = (season.shotsAgainst ?? 0) + numStat(line.shotsAgainst);
  season.goalsAgainst = (season.goalsAgainst ?? 0) + numStat(line.goalsAgainst);
  season.timeOnIce = (season.timeOnIce ?? 0) + toiSeconds(line.timeOnIce);
  if (decision === "W") {
    season.wins = (season.wins ?? 0) + 1;
    if (numStat(line.goalsAgainst) === 0) season.shutouts = (season.shutouts ?? 0) + 1;
  } else if (decision === "L") {
    season.losses = (season.losses ?? 0) + 1;
  } else if (decision === "OTL") {
    season.overtimeLosses = (season.overtimeLosses ?? 0) + 1;
  }
  const sa = season.shotsAgainst ?? 0;
  season.savePct = sa > 0 ? (season.saves ?? 0) / sa : 0; // 0–1, as ESPN returns
  const toi = season.timeOnIce ?? 0;
  season.avgGoalsAgainst = toi > 0 ? ((season.goalsAgainst ?? 0) * 3600) / toi : 0; // GAA per 60 min
}

export function reconcileHockeyAthletes(
  athletes: AthleteRecord[],
  games: Array<{ event: HockeyScoreboardEvent; box?: HockeyBoxscore }>,
  teamGamesPlayed: Map<string, number>,
): AthleteRecord[] {
  const byId = new Map(athletes.map((a) => [a.id, a]));
  const maxGames = new Map<string, number>();
  for (const a of athletes) {
    maxGames.set(a.teamAbbr, Math.max(maxGames.get(a.teamAbbr) ?? 0, a.stats.games ?? 0));
  }
  for (const { event, box } of games) {
    if (!box) continue;
    const otOrSo = /\/(OT|SO)/i.test(event.statusDetail); // "Final/OT", "Final/SO"
    const winnerId = event.away.winner
      ? event.away.team.id
      : event.home.winner
        ? event.home.team.id
        : null;
    for (const t of box.teams) {
      const abbr = t.team.abbreviation;
      const teamGp = teamGamesPlayed.get(abbr);
      // Only fold when standings lead byathlete for this team (game still missing).
      if (teamGp === undefined || (maxGames.get(abbr) ?? 0) >= teamGp) continue;
      for (const p of t.skaters) {
        const a = byId.get(p.athleteId);
        if (a) foldSkaterLine(a.stats, p.stats);
      }
      // Every goalie who appeared gets the game + save totals; the decision
      // (W/L/OTL) goes only to the goalie of record — the one with the most TOI.
      const recordGoalie = [...t.goalies].sort(
        (x, y) => toiSeconds(y.stats.timeOnIce) - toiSeconds(x.stats.timeOnIce),
      )[0];
      const teamWon = winnerId !== null && t.team.id === winnerId;
      for (const p of t.goalies) {
        const a = byId.get(p.athleteId);
        if (!a) continue;
        const decision =
          p === recordGoalie && winnerId !== null ? (teamWon ? "W" : otOrSo ? "OTL" : "L") : null;
        foldGoalieLine(a.stats, p.stats, decision);
      }
    }
  }
  return athletes;
}

// Games played per team (ESPN abbreviation → gamesPlayed) from parsed standings,
// the reference count reconcileHockeyAthletes compares byathlete against.
export function teamGamesPlayedByAbbr(standings: HockeyStandings): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of standings.conferences) {
    for (const e of c.entries) {
      const gp =
        e.stats.gamesPlayed?.value ??
        (e.stats.wins?.value ?? 0) + (e.stats.losses?.value ?? 0) + (e.stats.otLosses?.value ?? 0);
      if (e.team.abbreviation) m.set(e.team.abbreviation, gp);
    }
  }
  return m;
}

export function athleteStatsById(athletes: AthleteRecord[]): Map<string, Record<string, number>> {
  const m = new Map<string, Record<string, number>>();
  for (const a of athletes) m.set(a.id, a.stats);
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
  athletes: AthleteRecord[],
  teamAbbr: string,
): Array<{ id: string; name: string; position: string; stats: Record<string, number> }> {
  return athletes
    .filter((a) => a.teamAbbr === teamAbbr)
    .map((a) => ({ id: a.id, name: a.name, position: a.position, stats: a.stats }));
}

export function parseLeaders(athletes: AthleteRecord[]): HockeyLeaders {
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
