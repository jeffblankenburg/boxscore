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
  // ADMIN-ONLY: each team's recognizable primary color, used to tint
  // tabs/rows in admin tools so scanning by color works ("the orange
  // one"). Never surfaces on the public newspaper-style site/emails;
  // those stay strictly black and white.
  primary?: string;    // hex, e.g. "#0C2340"
};

export const TEAMS: readonly Team[] = [
  { sport: "mlb", slug: "ari", name: "Arizona Diamondbacks", city: "Arizona", nickname: "Diamondbacks", abbreviation: "ARI", mlbApiId: 109, primary: "#A71930" },
  { sport: "mlb", slug: "atl", name: "Atlanta Braves", city: "Atlanta", nickname: "Braves", abbreviation: "ATL", mlbApiId: 144, primary: "#CE1141" },
  { sport: "mlb", slug: "bal", name: "Baltimore Orioles", city: "Baltimore", nickname: "Orioles", abbreviation: "BAL", mlbApiId: 110, primary: "#DF4601" },
  { sport: "mlb", slug: "bos", name: "Boston Red Sox", city: "Boston", nickname: "Red Sox", abbreviation: "BOS", mlbApiId: 111, primary: "#BD3039" },
  { sport: "mlb", slug: "chc", name: "Chicago Cubs", city: "Chicago", nickname: "Cubs", abbreviation: "CHC", mlbApiId: 112, primary: "#0E3386" },
  { sport: "mlb", slug: "cws", name: "Chicago White Sox", city: "Chicago", nickname: "White Sox", abbreviation: "CWS", mlbApiId: 145, primary: "#27251F" },
  { sport: "mlb", slug: "cin", name: "Cincinnati Reds", city: "Cincinnati", nickname: "Reds", abbreviation: "CIN", mlbApiId: 113, primary: "#C6011F" },
  { sport: "mlb", slug: "cle", name: "Cleveland Guardians", city: "Cleveland", nickname: "Guardians", abbreviation: "CLE", mlbApiId: 114, primary: "#00385D" },
  { sport: "mlb", slug: "col", name: "Colorado Rockies", city: "Colorado", nickname: "Rockies", abbreviation: "COL", mlbApiId: 115, primary: "#33006F" },
  { sport: "mlb", slug: "det", name: "Detroit Tigers", city: "Detroit", nickname: "Tigers", abbreviation: "DET", mlbApiId: 116, primary: "#0C2340" },
  { sport: "mlb", slug: "hou", name: "Houston Astros", city: "Houston", nickname: "Astros", abbreviation: "HOU", mlbApiId: 117, primary: "#002D62" },
  { sport: "mlb", slug: "kc",  name: "Kansas City Royals", city: "Kansas City", nickname: "Royals", abbreviation: "KC", mlbApiId: 118, primary: "#004687" },
  { sport: "mlb", slug: "laa", name: "Los Angeles Angels", city: "Los Angeles", nickname: "Angels", abbreviation: "LAA", mlbApiId: 108, primary: "#BA0021" },
  { sport: "mlb", slug: "lad", name: "Los Angeles Dodgers", city: "Los Angeles", nickname: "Dodgers", abbreviation: "LAD", mlbApiId: 119, primary: "#005A9C" },
  { sport: "mlb", slug: "mia", name: "Miami Marlins", city: "Miami", nickname: "Marlins", abbreviation: "MIA", mlbApiId: 146, primary: "#00A3E0" },
  { sport: "mlb", slug: "mil", name: "Milwaukee Brewers", city: "Milwaukee", nickname: "Brewers", abbreviation: "MIL", mlbApiId: 158, primary: "#0A2351" },
  { sport: "mlb", slug: "min", name: "Minnesota Twins", city: "Minnesota", nickname: "Twins", abbreviation: "MIN", mlbApiId: 142, primary: "#002B5C" },
  { sport: "mlb", slug: "nym", name: "New York Mets", city: "New York", nickname: "Mets", abbreviation: "NYM", mlbApiId: 121, primary: "#002D72" },
  { sport: "mlb", slug: "nyy", name: "New York Yankees", city: "New York", nickname: "Yankees", abbreviation: "NYY", mlbApiId: 147, primary: "#0C2340" },
  { sport: "mlb", slug: "ath", name: "Athletics", city: "Athletics", nickname: "Athletics", abbreviation: "ATH", mlbApiId: 133, primary: "#003831" },
  { sport: "mlb", slug: "phi", name: "Philadelphia Phillies", city: "Philadelphia", nickname: "Phillies", abbreviation: "PHI", mlbApiId: 143, primary: "#E81828" },
  { sport: "mlb", slug: "pit", name: "Pittsburgh Pirates", city: "Pittsburgh", nickname: "Pirates", abbreviation: "PIT", mlbApiId: 134, primary: "#FDB827" },
  { sport: "mlb", slug: "sd",  name: "San Diego Padres", city: "San Diego", nickname: "Padres", abbreviation: "SD", mlbApiId: 135, primary: "#2F241D" },
  { sport: "mlb", slug: "sf",  name: "San Francisco Giants", city: "San Francisco", nickname: "Giants", abbreviation: "SF", mlbApiId: 137, primary: "#FD5A1E" },
  { sport: "mlb", slug: "sea", name: "Seattle Mariners", city: "Seattle", nickname: "Mariners", abbreviation: "SEA", mlbApiId: 136, primary: "#0C2C56" },
  { sport: "mlb", slug: "stl", name: "St. Louis Cardinals", city: "St. Louis", nickname: "Cardinals", abbreviation: "STL", mlbApiId: 138, primary: "#C41E3A" },
  { sport: "mlb", slug: "tb",  name: "Tampa Bay Rays", city: "Tampa Bay", nickname: "Rays", abbreviation: "TB", mlbApiId: 139, primary: "#092C5C" },
  { sport: "mlb", slug: "tex", name: "Texas Rangers", city: "Texas", nickname: "Rangers", abbreviation: "TEX", mlbApiId: 140, primary: "#003278" },
  { sport: "mlb", slug: "tor", name: "Toronto Blue Jays", city: "Toronto", nickname: "Blue Jays", abbreviation: "TOR", mlbApiId: 141, primary: "#134A8E" },
  { sport: "mlb", slug: "wsh", name: "Washington Nationals", city: "Washington", nickname: "Nationals", abbreviation: "WSH", mlbApiId: 120, primary: "#AB0003" },

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

  // NFL. Slugs are the lowercased ESPN abbreviation so the football
  // adapter's derived team slug (lib/sports/football/adapters/from-espn.ts)
  // resolves here without a separate map. abbreviation matches ESPN's exactly
  // (WSH, JAX, LV, LAC/LAR) — do not "normalize" it or the join breaks.
  { sport: "nfl", slug: "ari", name: "Arizona Cardinals", city: "Arizona", nickname: "Cardinals", abbreviation: "ARI", primary: "#97233F" },
  { sport: "nfl", slug: "atl", name: "Atlanta Falcons", city: "Atlanta", nickname: "Falcons", abbreviation: "ATL", primary: "#A71930" },
  { sport: "nfl", slug: "bal", name: "Baltimore Ravens", city: "Baltimore", nickname: "Ravens", abbreviation: "BAL", primary: "#241773" },
  { sport: "nfl", slug: "buf", name: "Buffalo Bills", city: "Buffalo", nickname: "Bills", abbreviation: "BUF", primary: "#00338D" },
  { sport: "nfl", slug: "car", name: "Carolina Panthers", city: "Carolina", nickname: "Panthers", abbreviation: "CAR", primary: "#0085CA" },
  { sport: "nfl", slug: "chi", name: "Chicago Bears", city: "Chicago", nickname: "Bears", abbreviation: "CHI", primary: "#0B162A" },
  { sport: "nfl", slug: "cin", name: "Cincinnati Bengals", city: "Cincinnati", nickname: "Bengals", abbreviation: "CIN", primary: "#FB4F14" },
  { sport: "nfl", slug: "cle", name: "Cleveland Browns", city: "Cleveland", nickname: "Browns", abbreviation: "CLE", primary: "#311D00" },
  { sport: "nfl", slug: "dal", name: "Dallas Cowboys", city: "Dallas", nickname: "Cowboys", abbreviation: "DAL", primary: "#003594" },
  { sport: "nfl", slug: "den", name: "Denver Broncos", city: "Denver", nickname: "Broncos", abbreviation: "DEN", primary: "#FB4F14" },
  { sport: "nfl", slug: "det", name: "Detroit Lions", city: "Detroit", nickname: "Lions", abbreviation: "DET", primary: "#0076B6" },
  { sport: "nfl", slug: "gb",  name: "Green Bay Packers", city: "Green Bay", nickname: "Packers", abbreviation: "GB", primary: "#203731" },
  { sport: "nfl", slug: "hou", name: "Houston Texans", city: "Houston", nickname: "Texans", abbreviation: "HOU", primary: "#03202F" },
  { sport: "nfl", slug: "ind", name: "Indianapolis Colts", city: "Indianapolis", nickname: "Colts", abbreviation: "IND", primary: "#002C5F" },
  { sport: "nfl", slug: "jax", name: "Jacksonville Jaguars", city: "Jacksonville", nickname: "Jaguars", abbreviation: "JAX", primary: "#006778" },
  { sport: "nfl", slug: "kc",  name: "Kansas City Chiefs", city: "Kansas City", nickname: "Chiefs", abbreviation: "KC", primary: "#E31837" },
  { sport: "nfl", slug: "lv",  name: "Las Vegas Raiders", city: "Las Vegas", nickname: "Raiders", abbreviation: "LV", primary: "#000000" },
  { sport: "nfl", slug: "lac", name: "Los Angeles Chargers", city: "Los Angeles", nickname: "Chargers", abbreviation: "LAC", primary: "#0080C6" },
  { sport: "nfl", slug: "lar", name: "Los Angeles Rams", city: "Los Angeles", nickname: "Rams", abbreviation: "LAR", primary: "#003594" },
  { sport: "nfl", slug: "mia", name: "Miami Dolphins", city: "Miami", nickname: "Dolphins", abbreviation: "MIA", primary: "#008E97" },
  { sport: "nfl", slug: "min", name: "Minnesota Vikings", city: "Minnesota", nickname: "Vikings", abbreviation: "MIN", primary: "#4F2683" },
  { sport: "nfl", slug: "ne",  name: "New England Patriots", city: "New England", nickname: "Patriots", abbreviation: "NE", primary: "#002244" },
  { sport: "nfl", slug: "no",  name: "New Orleans Saints", city: "New Orleans", nickname: "Saints", abbreviation: "NO", primary: "#D3BC8D" },
  { sport: "nfl", slug: "nyg", name: "New York Giants", city: "New York", nickname: "Giants", abbreviation: "NYG", primary: "#0B2265" },
  { sport: "nfl", slug: "nyj", name: "New York Jets", city: "New York", nickname: "Jets", abbreviation: "NYJ", primary: "#125740" },
  { sport: "nfl", slug: "phi", name: "Philadelphia Eagles", city: "Philadelphia", nickname: "Eagles", abbreviation: "PHI", primary: "#004C54" },
  { sport: "nfl", slug: "pit", name: "Pittsburgh Steelers", city: "Pittsburgh", nickname: "Steelers", abbreviation: "PIT", primary: "#FFB612" },
  { sport: "nfl", slug: "sf",  name: "San Francisco 49ers", city: "San Francisco", nickname: "49ers", abbreviation: "SF", primary: "#AA0000" },
  { sport: "nfl", slug: "sea", name: "Seattle Seahawks", city: "Seattle", nickname: "Seahawks", abbreviation: "SEA", primary: "#002244" },
  { sport: "nfl", slug: "tb",  name: "Tampa Bay Buccaneers", city: "Tampa Bay", nickname: "Buccaneers", abbreviation: "TB", primary: "#D50A0A" },
  { sport: "nfl", slug: "ten", name: "Tennessee Titans", city: "Tennessee", nickname: "Titans", abbreviation: "TEN", primary: "#0C2340" },
  { sport: "nfl", slug: "wsh", name: "Washington Commanders", city: "Washington", nickname: "Commanders", abbreviation: "WSH", primary: "#5A1414" },
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

// Cross-vendor canonical slug for a team reference. statsapi gives us its
// MLB Stats API id; SDIO uses its own TeamID (e.g. White Sox: statsapi 145
// vs SDIO 16). Anything that needs a stable identifier across data sources
// — the canonical diff's team-matching key, the renderer's data-diff-key
// attribute, future feed adapters — resolves through this helper.
//
// Resolution order: mlbApiId first (cheap, exact for statsapi-source
// refs), then exact name match (catches SDIO refs, whose name strings
// agree with TEAMS.name on every current MLB team), then a last-ditch
// lowercased vendor abbreviation. The fallback won't cross-match but
// stays stable per-side so the diff at least groups its own rows.
export function canonicalTeamSlugForRef(ref: { id: number; name: string; abbr: string }): string {
  const byId = findTeamByMlbApiId(ref.id);
  if (byId) return byId.slug;
  const byName = TEAMS.find((t) => t.sport === "mlb" && t.name === ref.name);
  if (byName) return byName.slug;
  return ref.abbr.toLowerCase();
}

// Canonical (id, name, abbr) for a vendor team ref. The adapters call
// this when constructing MlbTeamRefs so both vendors hand us the
// REGISTRY'S canonical name and abbreviation — not statsapi's "AZ" or
// SDIO's "CHW". If we don't know the team (rare; mostly Spring Training
// exhibition opponents), pass through the vendor's name/abbr with the
// lowercased abbr as the slug fallback.
export function canonicalTeamRefForRef(ref: { id: number; name: string; abbr: string }): { id: string; name: string; abbr: string } {
  const byId = findTeamByMlbApiId(ref.id);
  if (byId) return { id: byId.slug, name: byId.name, abbr: byId.abbreviation };
  const byName = TEAMS.find((t) => t.sport === "mlb" && t.name === ref.name);
  if (byName) return { id: byName.slug, name: byName.name, abbr: byName.abbreviation };
  return { id: ref.abbr.toLowerCase(), name: ref.name, abbr: ref.abbr };
}
