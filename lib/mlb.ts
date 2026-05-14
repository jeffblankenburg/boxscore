const BASE = "https://statsapi.mlb.com/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`MLB API ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

export type ScheduleGame = {
  gamePk: number;
  gameDate: string;
  status: { abstractGameState: string; detailedState: string; codedGameState: string };
  teams: {
    away: { team: { id: number; name: string; abbreviation?: string }; score?: number; isWinner?: boolean };
    home: { team: { id: number; name: string; abbreviation?: string }; score?: number; isWinner?: boolean };
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

export async function getSchedule(date: string): Promise<ScheduleGame[]> {
  type Res = { dates: Array<{ games: ScheduleGame[] }> };
  const data = await get<Res>(
    `/v1/schedule?sportId=1&date=${date}&hydrate=linescore,team,decisions,probablePitcher`
  );
  return data.dates.flatMap((d) => d.games);
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

export async function getBoxscore(gamePk: number): Promise<Boxscore> {
  return get<Boxscore>(`/v1/game/${gamePk}/boxscore`);
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

export async function getScoringPlays(gamePk: number): Promise<ScoringPlay[]> {
  type PlayByPlay = {
    allPlays: Array<{
      result: { event: string; description: string; rbi: number; awayScore: number; homeScore: number };
      about: { isScoringPlay: boolean; inning: number; halfInning: "top" | "bottom" };
    }>;
  };
  const data = await get<PlayByPlay>(`/v1/game/${gamePk}/playByPlay`);
  return data.allPlays
    .filter((p) => p.about.isScoringPlay)
    .map((p) => ({
      inning: p.about.inning,
      halfInning: p.about.halfInning,
      event: p.result.event,
      description: p.result.description,
      awayScore: p.result.awayScore,
      homeScore: p.result.homeScore,
      rbi: p.result.rbi,
    }));
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

export async function getStandings(season: number, date: string): Promise<DivisionStandings[]> {
  type Res = { records: DivisionStandings[] };
  const data = await get<Res>(`/v1/standings?leagueId=103,104&season=${season}&date=${date}`);
  return data.records;
}

export type WildCardLeagueStandings = {
  league: { id: number };
  teamRecords: TeamRecord[];
};

export async function getWildCardStandings(season: number, date: string): Promise<WildCardLeagueStandings[]> {
  type Res = { records: WildCardLeagueStandings[] };
  const data = await get<Res>(
    `/v1/standings?leagueId=103,104&season=${season}&date=${date}&standingsTypes=wildCard`
  );
  return data.records;
}

export type Leader = {
  rank: number;
  value: string;
  person: { id: number; fullName: string };
  team?: { id: number; name: string };
};

export async function getLeaders(
  category: string, season: number, leagueId: 103 | 104, limit = 5,
): Promise<Leader[]> {
  type Res = { leagueLeaders: Array<{ leaderCategory: string; leaders: Leader[] }> };
  const data = await get<Res>(
    `/v1/stats/leaders?leaderCategories=${category}&season=${season}&sportId=1&leagueId=${leagueId}&limit=${limit}&statGroup=${guessStatGroup(category)}`
  );
  return data.leagueLeaders[0]?.leaders ?? [];
}

function guessStatGroup(category: string): "hitting" | "pitching" {
  const pitching = new Set([
    "wins", "earnedRunAverage", "strikeouts", "saves", "whip", "inningsPitched",
  ]);
  return pitching.has(category) ? "pitching" : "hitting";
}
