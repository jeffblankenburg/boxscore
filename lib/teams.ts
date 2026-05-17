// Multi-sport team registry.
//
// Keyed on (sport, slug). The same slug can recur across sports — e.g.,
// "cle" maps to the Cleveland Guardians (MLB) and will later map to the
// Cleveland Browns (NFL) and Cavaliers (NBA). Lookups must always pass
// the sport.
//
// For v1 only MLB is populated; the shape is stable for future sports.

export type Sport = "mlb" | "nfl" | "nba" | "nhl" | "ncaaf";

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
];

export function findTeam(sport: Sport, slug: string): Team | undefined {
  return TEAMS.find((t) => t.sport === sport && t.slug === slug);
}

export function teamsBySport(sport: Sport): Team[] {
  return TEAMS.filter((t) => t.sport === sport).slice().sort((a, b) => a.name.localeCompare(b.name));
}
