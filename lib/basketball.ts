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

const SCOREBOARD_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball";
const STANDINGS_BASE = "https://site.web.api.espn.com/apis/v2/sports/basketball";

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
  away: BasketballSideSummary;
  home: BasketballSideSummary;
  venue?: string;
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

export function parseScoreboard(raw: unknown): BasketballScoreboardEvent[] {
  const data = raw as { events?: Array<Record<string, unknown>> };
  const events = data.events ?? [];
  return events.map((ev) => {
    const comp = (ev.competitions as Array<Record<string, unknown>>)[0] ?? {};
    const competitors = (comp.competitors as Array<Record<string, unknown>>) ?? [];
    const status = (comp.status as Record<string, unknown>) ?? {};
    const statusType = (status.type as Record<string, unknown>) ?? {};
    const venue = (comp.venue as { fullName?: string } | undefined)?.fullName;

    return {
      id: String(ev.id),
      date: String(ev.date),
      shortName: String(ev.shortName ?? ""),
      status: classifyStatus(String(statusType.id ?? "")),
      statusDetail: String(statusType.detail ?? statusType.description ?? ""),
      period: Number(status.period ?? 0),
      away: extractSide(competitors, "away"),
      home: extractSide(competitors, "home"),
      venue,
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
