const BASE = "https://statsapi.mlb.com/api";

// Each MLB endpoint is split into a fetcher (network, returns the unmodified
// envelope) and a parser (pure, returns the trimmed shape callers want). The
// daily_raw cache stores fetcher output; callers run that output through the
// parsers without re-hitting the API.

async function getRaw(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`MLB API ${res.status} for ${path}`);
  return res.json();
}

export type ScheduleGame = {
  gamePk: number;
  gameDate: string;
  status: { abstractGameState: string; detailedState: string; codedGameState: string };
  teams: {
    away: {
      team: { id: number; name: string; abbreviation?: string };
      score?: number; isWinner?: boolean;
      probablePitcher?: { id: number; fullName: string };
    };
    home: {
      team: { id: number; name: string; abbreviation?: string };
      score?: number; isWinner?: boolean;
      probablePitcher?: { id: number; fullName: string };
    };
  };
  linescore?: {
    currentInning?: number;
    scheduledInnings?: number;
    innings: Array<{ num: number; home?: { runs?: number }; away?: { runs?: number } }>;
    teams: {
      home: { runs?: number; hits?: number; errors?: number };
      away: { runs?: number; hits?: number; errors?: number };
    };
  };
  decisions?: {
    winner?: { id: number; fullName: string };
    loser?: { id: number; fullName: string };
    save?: { id: number; fullName: string };
  };
  venue?: { name: string };
};

export async function fetchScheduleRaw(date: string): Promise<unknown> {
  return getRaw(`/v1/schedule?sportId=1&date=${date}&hydrate=linescore,team,decisions,probablePitcher`);
}
export function parseSchedule(raw: unknown): ScheduleGame[] {
  const data = raw as { dates: Array<{ games: ScheduleGame[] }> };
  return data.dates.flatMap((d) => d.games);
}
export async function getSchedule(date: string): Promise<ScheduleGame[]> {
  return parseSchedule(await fetchScheduleRaw(date));
}

export type PlayerStats = {
  batting: Partial<{
    atBats: number; runs: number; hits: number; rbi: number;
    baseOnBalls: number; strikeOuts: number; homeRuns: number;
    doubles: number; triples: number; stolenBases: number;
    leftOnBase: number; avg: string; ops: string;
  }>;
  pitching: Partial<{
    inningsPitched: string; hits: number; runs: number;
    earnedRuns: number; baseOnBalls: number; strikeOuts: number;
    homeRuns: number; pitchesThrown: number; numberOfPitches: number;
    strikes: number; era: string; note?: string;
  }>;
  fielding: Record<string, unknown>;
};

export type BoxPlayer = {
  person: { id: number; fullName: string };
  jerseyNumber?: string;
  position: { abbreviation: string };
  status?: { code: string };
  stats: PlayerStats;
  seasonStats: PlayerStats;
  battingOrder?: string;
  gameStatus?: { isCurrentBatter: boolean; isOnBench: boolean };
  allPositions?: Array<{ abbreviation: string }>;
};

export type BoxTeam = {
  team: { id: number; name: string; abbreviation?: string };
  teamStats: PlayerStats;
  players: Record<string, BoxPlayer>;
  batters: number[];
  pitchers: number[];
  battingOrder: number[];
  note?: Array<{ label: string; value: string }>;
  info?: Array<{ title: string; fieldList: Array<{ label: string; value: string }> }>;
};

export type Boxscore = {
  teams: { away: BoxTeam; home: BoxTeam };
  info: Array<{ label: string; value?: string }>;
  pitchingNotes: string[];
  officials?: Array<{ official: { fullName: string }; officialType: string }>;
};

export async function fetchBoxscoreRaw(gamePk: number): Promise<unknown> {
  return getRaw(`/v1/game/${gamePk}/boxscore`);
}
export function parseBoxscore(raw: unknown): Boxscore {
  return raw as Boxscore;
}
export async function getBoxscore(gamePk: number): Promise<Boxscore> {
  return parseBoxscore(await fetchBoxscoreRaw(gamePk));
}

export type ScoringPlay = {
  inning: number;
  halfInning: "top" | "bottom";
  event: string;
  description: string;
  awayScore: number;
  homeScore: number;
  rbi: number;
};

type PlayRunner = {
  details?: {
    event?: string;
    isScoringEvent?: boolean;
    runner?: { fullName?: string };
  };
  movement?: { end?: string | null };
};
type PlayByPlay = {
  allPlays: Array<{
    result: { event: string; description: string; rbi: number; awayScore: number; homeScore: number };
    about: { isScoringPlay: boolean; inning: number; halfInning: "top" | "bottom" };
    runners?: PlayRunner[];
  }>;
};
export async function fetchPlayByPlayRaw(gamePk: number): Promise<unknown> {
  return getRaw(`/v1/game/${gamePk}/playByPlay`);
}
export function parseScoringPlays(raw: unknown): ScoringPlay[] {
  const data = raw as PlayByPlay;
  return data.allPlays
    .filter((p) => {
      if (p.about.isScoringPlay) return true;
      // MLB's isScoringPlay is keyed to the *batter's* at-bat result, so it
      // misses runs that score mid-at-bat (wild pitches, balks, passed balls,
      // errors). Catch those by inspecting the runners array.
      return p.runners?.some(
        (r) => r.details?.isScoringEvent && r.movement?.end === "score",
      ) ?? false;
    })
    .map((p) => {
      // For mid-at-bat scoring (batter didn't drive it in), synthesize a
      // description from the runner who scored, since result.description only
      // covers the at-bat outcome ("Tena strikes out swinging").
      let event = p.result.event;
      let description = p.result.description;
      if (!p.about.isScoringPlay) {
        const scoringRunners = (p.runners ?? []).filter(
          (r) => r.details?.isScoringEvent && r.movement?.end === "score",
        );
        if (scoringRunners.length > 0) {
          const names = scoringRunners
            .map((r) => r.details?.runner?.fullName ?? "runner")
            .join(" and ");
          const ev = scoringRunners[0]?.details?.event ?? "play";
          event = ev;
          description = `${names} scores on ${ev.toLowerCase()}.`;
        }
      }
      return {
        inning: p.about.inning,
        halfInning: p.about.halfInning,
        event,
        description,
        awayScore: p.result.awayScore,
        homeScore: p.result.homeScore,
        rbi: p.result.rbi,
      };
    });
}
export async function getScoringPlays(gamePk: number): Promise<ScoringPlay[]> {
  return parseScoringPlays(await fetchPlayByPlayRaw(gamePk));
}

export type TeamRecord = {
  team: { id: number; name: string };
  wins: number;
  losses: number;
  runsScored?: number;
  runsAllowed?: number;
  gamesBack: string;
  divisionRank: string;
  wildCardRank?: string;
  wildCardGamesBack?: string;
  streak?: { streakCode: string };
  records?: {
    splitRecords?: Array<{ type: string; wins: number; losses: number; pct: string }>;
  };
  leagueRecord: { wins: number; losses: number; pct: string };
};

export type DivisionStandings = {
  league: { id: number };
  division: { id: number };
  teamRecords: TeamRecord[];
};

export async function fetchStandingsRaw(season: number, date: string): Promise<unknown> {
  return getRaw(`/v1/standings?leagueId=103,104&season=${season}&date=${date}`);
}
export function parseStandings(raw: unknown): DivisionStandings[] {
  return (raw as { records: DivisionStandings[] }).records;
}
export async function getStandings(season: number, date: string): Promise<DivisionStandings[]> {
  return parseStandings(await fetchStandingsRaw(season, date));
}

export type WildCardLeagueStandings = {
  league: { id: number };
  teamRecords: TeamRecord[];
};

export async function fetchWildCardRaw(season: number, date: string): Promise<unknown> {
  return getRaw(`/v1/standings?leagueId=103,104&season=${season}&date=${date}&standingsTypes=wildCard`);
}
export function parseWildCard(raw: unknown): WildCardLeagueStandings[] {
  return (raw as { records: WildCardLeagueStandings[] }).records;
}
export async function getWildCardStandings(season: number, date: string): Promise<WildCardLeagueStandings[]> {
  return parseWildCard(await fetchWildCardRaw(season, date));
}

export type Leader = {
  rank: number;
  value: string;
  person: { id: number; fullName: string };
  team?: { id: number; name: string };
};

export async function fetchLeadersRaw(
  category: string, season: number, leagueId: 103 | 104, limit = 5,
): Promise<unknown> {
  return getRaw(
    `/v1/stats/leaders?leaderCategories=${category}&season=${season}&sportId=1&leagueId=${leagueId}&limit=${limit}&statGroup=${guessStatGroup(category)}`
  );
}
export function parseLeaders(raw: unknown): Leader[] {
  const data = raw as { leagueLeaders: Array<{ leaderCategory: string; leaders: Leader[] }> };
  return data.leagueLeaders[0]?.leaders ?? [];
}
export async function getLeaders(
  category: string, season: number, leagueId: 103 | 104, limit = 5,
): Promise<Leader[]> {
  return parseLeaders(await fetchLeadersRaw(category, season, leagueId, limit));
}

function guessStatGroup(category: string): "hitting" | "pitching" {
  const pitching = new Set([
    "wins", "earnedRunAverage", "strikeouts", "saves", "whip", "inningsPitched",
  ]);
  return pitching.has(category) ? "pitching" : "hitting";
}

// ─── Teams ────────────────────────────────────────────────────────────────
// One call per season returns every team's id, name, and short abbreviation.
// Used to build a current id→abbreviation map at render time.
export type TeamMeta = { id: number; name: string; abbreviation?: string };

export async function fetchTeamsRaw(season: number): Promise<unknown> {
  return getRaw(`/v1/teams?sportId=1&season=${season}`);
}

export function parseTeams(raw: unknown): TeamMeta[] {
  const data = raw as { teams?: TeamMeta[] };
  return data?.teams ?? [];
}

// ─── Transactions ────────────────────────────────────────────────────────
// Daily roster moves: signings, trades, IL placements, DFA, rehab
// assignments, etc. MLB pre-writes each as a human-readable sentence.
export type Transaction = {
  typeCode: string;
  typeDesc: string;
  description: string;
};

export async function fetchTransactionsRaw(date: string): Promise<unknown> {
  return getRaw(`/v1/transactions?sportId=1&startDate=${date}&endDate=${date}`);
}

export function parseTransactions(raw: unknown): Transaction[] {
  const data = raw as { transactions?: Array<{ typeCode?: string; typeDesc?: string; description?: string }> };
  return (data?.transactions ?? [])
    .filter((t) => typeof t.description === "string" && t.description.length > 0)
    .map((t) => ({
      typeCode: t.typeCode ?? "",
      typeDesc: t.typeDesc ?? "",
      description: t.description ?? "",
    }));
}

// ─── Person season stats ──────────────────────────────────────────────────
// Used for probable-pitcher W-L on Today's Games. Single-person call returns
// season pitching stats including wins and losses.
export async function fetchPersonSeasonPitchingRaw(personId: number, season: number): Promise<unknown> {
  return getRaw(
    `/v1/people/${personId}/stats?stats=season&group=pitching&season=${season}`,
  );
}

export function parsePersonWL(raw: unknown): { wins: number; losses: number } {
  const data = raw as { stats?: Array<{ splits?: Array<{ stat?: { wins?: number; losses?: number } }> }> };
  const stat = data?.stats?.[0]?.splits?.[0]?.stat;
  return {
    wins: typeof stat?.wins === "number" ? stat.wins : 0,
    losses: typeof stat?.losses === "number" ? stat.losses : 0,
  };
}
