// Multi-sport team registry.
//
// Keyed on (sport, slug). The same slug can recur across sports — e.g.,
// "cle" maps to the Cleveland Guardians (MLB) and will later map to the
// Cleveland Browns (NFL) and Cavaliers (NBA). Lookups must always pass
// the sport.
//
// For v1 only MLB is populated; the shape is stable for future sports.

export type Sport = "mlb" | "nfl" | "nba" | "wnba" | "nhl" | "ncaaf";

export type Team = {
  sport: Sport;
  slug: string;        // lowercase short code, unique within sport
  name: string;        // "Cleveland Guardians"
  city: string;        // "Cleveland"
  nickname: string;    // "Guardians"
  abbreviation: string; // "CLE"
  mlbApiId?: number;   // present for MLB teams
};

export const TEAMS: readonly Team[] = [
  { sport: "mlb", slug: "ari", name: "Arizona Diamondbacks", city: "Arizona", nickname: "Diamondbacks", abbreviation: "ARI", mlbApiId: 109 },
  { sport: "mlb", slug: "atl", name: "Atlanta Braves", city: "Atlanta", nickname: "Braves", abbreviation: "ATL", mlbApiId: 144 },
  { sport: "mlb", slug: "bal", name: "Baltimore Orioles", city: "Baltimore", nickname: "Orioles", abbreviation: "BAL", mlbApiId: 110 },
  { sport: "mlb", slug: "bos", name: "Boston Red Sox", city: "Boston", nickname: "Red Sox", abbreviation: "BOS", mlbApiId: 111 },
  { sport: "mlb", slug: "chc", name: "Chicago Cubs", city: "Chicago", nickname: "Cubs", abbreviation: "CHC", mlbApiId: 112 },
  { sport: "mlb", slug: "cws", name: "Chicago White Sox", city: "Chicago", nickname: "White Sox", abbreviation: "CWS", mlbApiId: 145 },
  { sport: "mlb", slug: "cin", name: "Cincinnati Reds", city: "Cincinnati", nickname: "Reds", abbreviation: "CIN", mlbApiId: 113 },
  { sport: "mlb", slug: "cle", name: "Cleveland Guardians", city: "Cleveland", nickname: "Guardians", abbreviation: "CLE", mlbApiId: 114 },
  { sport: "mlb", slug: "col", name: "Colorado Rockies", city: "Colorado", nickname: "Rockies", abbreviation: "COL", mlbApiId: 115 },
  { sport: "mlb", slug: "det", name: "Detroit Tigers", city: "Detroit", nickname: "Tigers", abbreviation: "DET", mlbApiId: 116 },
  { sport: "mlb", slug: "hou", name: "Houston Astros", city: "Houston", nickname: "Astros", abbreviation: "HOU", mlbApiId: 117 },
  { sport: "mlb", slug: "kc",  name: "Kansas City Royals", city: "Kansas City", nickname: "Royals", abbreviation: "KC", mlbApiId: 118 },
  { sport: "mlb", slug: "laa", name: "Los Angeles Angels", city: "Los Angeles", nickname: "Angels", abbreviation: "LAA", mlbApiId: 108 },
  { sport: "mlb", slug: "lad", name: "Los Angeles Dodgers", city: "Los Angeles", nickname: "Dodgers", abbreviation: "LAD", mlbApiId: 119 },
  { sport: "mlb", slug: "mia", name: "Miami Marlins", city: "Miami", nickname: "Marlins", abbreviation: "MIA", mlbApiId: 146 },
  { sport: "mlb", slug: "mil", name: "Milwaukee Brewers", city: "Milwaukee", nickname: "Brewers", abbreviation: "MIL", mlbApiId: 158 },
  { sport: "mlb", slug: "min", name: "Minnesota Twins", city: "Minnesota", nickname: "Twins", abbreviation: "MIN", mlbApiId: 142 },
  { sport: "mlb", slug: "nym", name: "New York Mets", city: "New York", nickname: "Mets", abbreviation: "NYM", mlbApiId: 121 },
  { sport: "mlb", slug: "nyy", name: "New York Yankees", city: "New York", nickname: "Yankees", abbreviation: "NYY", mlbApiId: 147 },
  { sport: "mlb", slug: "ath", name: "Athletics", city: "Athletics", nickname: "Athletics", abbreviation: "ATH", mlbApiId: 133 },
  { sport: "mlb", slug: "phi", name: "Philadelphia Phillies", city: "Philadelphia", nickname: "Phillies", abbreviation: "PHI", mlbApiId: 143 },
  { sport: "mlb", slug: "pit", name: "Pittsburgh Pirates", city: "Pittsburgh", nickname: "Pirates", abbreviation: "PIT", mlbApiId: 134 },
  { sport: "mlb", slug: "sd",  name: "San Diego Padres", city: "San Diego", nickname: "Padres", abbreviation: "SD", mlbApiId: 135 },
  { sport: "mlb", slug: "sf",  name: "San Francisco Giants", city: "San Francisco", nickname: "Giants", abbreviation: "SF", mlbApiId: 137 },
  { sport: "mlb", slug: "sea", name: "Seattle Mariners", city: "Seattle", nickname: "Mariners", abbreviation: "SEA", mlbApiId: 136 },
  { sport: "mlb", slug: "stl", name: "St. Louis Cardinals", city: "St. Louis", nickname: "Cardinals", abbreviation: "STL", mlbApiId: 138 },
  { sport: "mlb", slug: "tb",  name: "Tampa Bay Rays", city: "Tampa Bay", nickname: "Rays", abbreviation: "TB", mlbApiId: 139 },
  { sport: "mlb", slug: "tex", name: "Texas Rangers", city: "Texas", nickname: "Rangers", abbreviation: "TEX", mlbApiId: 140 },
  { sport: "mlb", slug: "tor", name: "Toronto Blue Jays", city: "Toronto", nickname: "Blue Jays", abbreviation: "TOR", mlbApiId: 141 },
  { sport: "mlb", slug: "wsh", name: "Washington Nationals", city: "Washington", nickname: "Nationals", abbreviation: "WSH", mlbApiId: 120 },

  // NBA roster — placeholder entries to populate the /subscribe team-picker
  // tabs while only MLB has a per-team digest pipeline. Once the NBA team
  // renderer ships these become live. Slugs duplicate MLB on purpose (e.g.
  // "cle" → Guardians in mlb, Cavaliers in nba); lookups always key on
  // (sport, slug).
  { sport: "nba", slug: "atl", name: "Atlanta Hawks", city: "Atlanta", nickname: "Hawks", abbreviation: "ATL" },
  { sport: "nba", slug: "bos", name: "Boston Celtics", city: "Boston", nickname: "Celtics", abbreviation: "BOS" },
  { sport: "nba", slug: "bkn", name: "Brooklyn Nets", city: "Brooklyn", nickname: "Nets", abbreviation: "BKN" },
  { sport: "nba", slug: "cha", name: "Charlotte Hornets", city: "Charlotte", nickname: "Hornets", abbreviation: "CHA" },
  { sport: "nba", slug: "chi", name: "Chicago Bulls", city: "Chicago", nickname: "Bulls", abbreviation: "CHI" },
  { sport: "nba", slug: "cle", name: "Cleveland Cavaliers", city: "Cleveland", nickname: "Cavaliers", abbreviation: "CLE" },
  { sport: "nba", slug: "dal", name: "Dallas Mavericks", city: "Dallas", nickname: "Mavericks", abbreviation: "DAL" },
  { sport: "nba", slug: "den", name: "Denver Nuggets", city: "Denver", nickname: "Nuggets", abbreviation: "DEN" },
  { sport: "nba", slug: "det", name: "Detroit Pistons", city: "Detroit", nickname: "Pistons", abbreviation: "DET" },
  { sport: "nba", slug: "gsw", name: "Golden State Warriors", city: "Golden State", nickname: "Warriors", abbreviation: "GSW" },
  { sport: "nba", slug: "hou", name: "Houston Rockets", city: "Houston", nickname: "Rockets", abbreviation: "HOU" },
  { sport: "nba", slug: "ind", name: "Indiana Pacers", city: "Indiana", nickname: "Pacers", abbreviation: "IND" },
  { sport: "nba", slug: "lac", name: "Los Angeles Clippers", city: "Los Angeles", nickname: "Clippers", abbreviation: "LAC" },
  { sport: "nba", slug: "lal", name: "Los Angeles Lakers", city: "Los Angeles", nickname: "Lakers", abbreviation: "LAL" },
  { sport: "nba", slug: "mem", name: "Memphis Grizzlies", city: "Memphis", nickname: "Grizzlies", abbreviation: "MEM" },
  { sport: "nba", slug: "mia", name: "Miami Heat", city: "Miami", nickname: "Heat", abbreviation: "MIA" },
  { sport: "nba", slug: "mil", name: "Milwaukee Bucks", city: "Milwaukee", nickname: "Bucks", abbreviation: "MIL" },
  { sport: "nba", slug: "min", name: "Minnesota Timberwolves", city: "Minnesota", nickname: "Timberwolves", abbreviation: "MIN" },
  { sport: "nba", slug: "nop", name: "New Orleans Pelicans", city: "New Orleans", nickname: "Pelicans", abbreviation: "NOP" },
  { sport: "nba", slug: "nyk", name: "New York Knicks", city: "New York", nickname: "Knicks", abbreviation: "NYK" },
  { sport: "nba", slug: "okc", name: "Oklahoma City Thunder", city: "Oklahoma City", nickname: "Thunder", abbreviation: "OKC" },
  { sport: "nba", slug: "orl", name: "Orlando Magic", city: "Orlando", nickname: "Magic", abbreviation: "ORL" },
  { sport: "nba", slug: "phi", name: "Philadelphia 76ers", city: "Philadelphia", nickname: "76ers", abbreviation: "PHI" },
  { sport: "nba", slug: "phx", name: "Phoenix Suns", city: "Phoenix", nickname: "Suns", abbreviation: "PHX" },
  { sport: "nba", slug: "por", name: "Portland Trail Blazers", city: "Portland", nickname: "Trail Blazers", abbreviation: "POR" },
  { sport: "nba", slug: "sac", name: "Sacramento Kings", city: "Sacramento", nickname: "Kings", abbreviation: "SAC" },
  { sport: "nba", slug: "sas", name: "San Antonio Spurs", city: "San Antonio", nickname: "Spurs", abbreviation: "SAS" },
  { sport: "nba", slug: "tor", name: "Toronto Raptors", city: "Toronto", nickname: "Raptors", abbreviation: "TOR" },
  { sport: "nba", slug: "uta", name: "Utah Jazz", city: "Utah", nickname: "Jazz", abbreviation: "UTA" },
  { sport: "nba", slug: "was", name: "Washington Wizards", city: "Washington", nickname: "Wizards", abbreviation: "WAS" },

  // WNBA roster — same placeholder rationale as NBA above.
  { sport: "wnba", slug: "atl", name: "Atlanta Dream", city: "Atlanta", nickname: "Dream", abbreviation: "ATL" },
  { sport: "wnba", slug: "chi", name: "Chicago Sky", city: "Chicago", nickname: "Sky", abbreviation: "CHI" },
  { sport: "wnba", slug: "con", name: "Connecticut Sun", city: "Connecticut", nickname: "Sun", abbreviation: "CON" },
  { sport: "wnba", slug: "dal", name: "Dallas Wings", city: "Dallas", nickname: "Wings", abbreviation: "DAL" },
  { sport: "wnba", slug: "gsv", name: "Golden State Valkyries", city: "Golden State", nickname: "Valkyries", abbreviation: "GSV" },
  { sport: "wnba", slug: "ind", name: "Indiana Fever", city: "Indiana", nickname: "Fever", abbreviation: "IND" },
  { sport: "wnba", slug: "lv",  name: "Las Vegas Aces", city: "Las Vegas", nickname: "Aces", abbreviation: "LV" },
  { sport: "wnba", slug: "la",  name: "Los Angeles Sparks", city: "Los Angeles", nickname: "Sparks", abbreviation: "LA" },
  { sport: "wnba", slug: "min", name: "Minnesota Lynx", city: "Minnesota", nickname: "Lynx", abbreviation: "MIN" },
  { sport: "wnba", slug: "ny",  name: "New York Liberty", city: "New York", nickname: "Liberty", abbreviation: "NY" },
  { sport: "wnba", slug: "phx", name: "Phoenix Mercury", city: "Phoenix", nickname: "Mercury", abbreviation: "PHX" },
  { sport: "wnba", slug: "sea", name: "Seattle Storm", city: "Seattle", nickname: "Storm", abbreviation: "SEA" },
  { sport: "wnba", slug: "tor", name: "Toronto Tempo", city: "Toronto", nickname: "Tempo", abbreviation: "TOR" },
  { sport: "wnba", slug: "was", name: "Washington Mystics", city: "Washington", nickname: "Mystics", abbreviation: "WAS" },
];

export function findTeam(sport: Sport, slug: string): Team | undefined {
  return TEAMS.find((t) => t.sport === sport && t.slug === slug);
}

// Reverse lookup by MLB API ID. Used by the league standings web renderer
// so each team row can link to /mlb/{slug} without the caller having to
// build its own ID→slug map.
export function findTeamByMlbApiId(id: number): Team | undefined {
  return TEAMS.find((t) => t.mlbApiId === id);
}

export function teamsBySport(sport: Sport): Team[] {
  return TEAMS.filter((t) => t.sport === sport).slice().sort((a, b) => a.name.localeCompare(b.name));
}
