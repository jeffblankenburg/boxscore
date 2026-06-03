// Per-platform post content generators. Kept platform-agnostic where possible
// so adding BlueSky/Facebook later reuses the same shape.

export type DailyPostContext = {
  sport: string;        // "mlb"
  date: string;         // "2026-05-14"
  prettyDate: string;   // "Wednesday, May 14, 2026"
  gameCount: number;
  digestUrl: string;    // canonical URL on boxscore.email
};

const SPORT_LABEL: Record<string, string> = { mlb: "MLB" };

function dailyPostBody(ctx: DailyPostContext): string {
  const sport = SPORT_LABEL[ctx.sport] ?? ctx.sport.toUpperCase();
  return `⚾ ${sport} box scores · ${ctx.prettyDate} · ${ctx.gameCount} games

${ctx.digestUrl}`;
}

// Twitter and BlueSky use the same body for now. If we ever need
// platform-specific tweaks (different limits, hashtag conventions, etc.),
// they diverge here.
export function tweetText(ctx: DailyPostContext): string {
  return dailyPostBody(ctx);
}

export function blueskyText(ctx: DailyPostContext): string {
  return dailyPostBody(ctx);
}

// Per-image post content used by both the BlueSky cron (auto) and the admin
// Twitter compose page (manual paste). Same wording across platforms.
import type { ManifestEntry } from "./render-images";

const hashtag = (team: string): string => "#" + team.replace(/\s+/g, "");

// Nickname → MLB tricode. Adds findability hashtags like #BOS, #NYY.
const TRICODE: Record<string, string> = {
  // AL East
  Orioles: "BAL", "Red Sox": "BOS", Yankees: "NYY", Rays: "TB", "Blue Jays": "TOR",
  // AL Central
  "White Sox": "CWS", Guardians: "CLE", Tigers: "DET", Royals: "KC", Twins: "MIN",
  // AL West
  Astros: "HOU", Angels: "LAA", Athletics: "ATH", Mariners: "SEA", Rangers: "TEX",
  // NL East
  Braves: "ATL", Marlins: "MIA", Mets: "NYM", Phillies: "PHI", Nationals: "WSH",
  // NL Central
  Cubs: "CHC", Reds: "CIN", Brewers: "MIL", Pirates: "PIT", Cardinals: "STL",
  // NL West
  Diamondbacks: "ARI", "D-backs": "ARI", Rockies: "COL", Dodgers: "LAD", Padres: "SD", Giants: "SF",
};

// Nickname → official 2026 MLB team hashtag (the "hashflag" tags that trigger
// team-branded emoji on X). Source: MLB's official 2026 announcement.
const OFFICIAL_HASHTAG: Record<string, string> = {
  Diamondbacks: "Dbacks", "D-backs": "Dbacks",
  Athletics: "Athletics",
  Braves: "BravesCountry",
  Orioles: "Birdland",
  "Red Sox": "DirtyWater",
  Cubs: "Cubs",
  "White Sox": "WhiteSox",
  Reds: "ATOBTTR",
  Guardians: "GuardsBall",
  Rockies: "Rockies",
  Tigers: "DNMW",
  Astros: "ChaseTheFight",
  Royals: "FountainsUp",
  Angels: "RepTheHalo",
  Dodgers: "Dodgers",
  Marlins: "FightinFish",
  Brewers: "ThisIsMyCrew",
  Twins: "NoPlaceLikeHERE",
  Mets: "LGM",
  Yankees: "RepBX",
  Phillies: "RingTheBell",
  Pirates: "LetsGoBucs",
  Padres: "ForTheFaithful",
  Mariners: "TridentsUp",
  Giants: "SFGiants",
  Cardinals: "STLCards",
  Rays: "RaysUp",
  Rangers: "AllForTX",
  "Blue Jays": "BlueJays50",
  Nationals: "Natitude",
};

// Caption date convention: content-anchored images (scoreboard, box scores,
// full digest) describe a specific day of games, so they use the GAMES date.
// Morning-snapshot images (standings, leaders) describe what's true the day
// the digest ships, so they use the EDITION date.
export type CaptionDates = {
  edition: string; // e.g. "Wednesday, June 3, 2026"
  games: string;   // e.g. "Tuesday, June 2, 2026"
};

export function imagePostContent(
  entry: ManifestEntry,
  dates: CaptionDates,
  digestUrl?: string,
): { text: string; alt: string } {
  // Twitter charges $0.20/post when a URL is present (vs $0.015 without), so
  // the Twitter paths pass digestUrl=undefined. Bluesky still includes it.
  const tail = digestUrl ? ` ${digestUrl}` : "";
  if (entry.type === "full") {
    const games = entry.gameCount;
    const gamesLabel = games === 1 ? "1 game" : `${games} games`;
    return {
      text: `⚾ MLB box scores · ${dates.games} · ${gamesLabel}\n\n#MLB${tail}`,
      alt: `Full MLB digest for ${dates.games}: standings, leaders, and box scores for all ${gamesLabel}.`,
    };
  }
  if (entry.type === "scoreboard") {
    const games = entry.gameCount;
    const gamesLabel = games === 1 ? "1 game" : `${games} games`;
    return {
      text: `⚾ MLB Scoreboard · ${dates.games} · ${gamesLabel}\n\n#MLB${tail}`,
      alt: `MLB scoreboard for ${dates.games}: final scores from ${gamesLabel}.`,
    };
  }
  if (entry.type === "standings") {
    const name = entry.league === "AL" ? "American League" : "National League";
    return {
      text: `${name} Standings · ${dates.edition}\n\n#MLB${tail}`,
      alt: `${name} Standings for ${dates.edition}.`,
    };
  }
  if (entry.type === "leaders") {
    const name = entry.league === "AL" ? "American League" : "National League";
    return {
      text: `${name} Leaders · ${dates.edition}\n\n#MLB${tail}`,
      alt: `${name} Leaders as of ${dates.edition}.`,
    };
  }
  const validTeams = entry.teams.filter((t) => t.length > 0);
  const nameTags = validTeams.map(hashtag);
  const tricodeTags = validTeams
    .map((t) => TRICODE[t])
    .filter((c): c is string => Boolean(c))
    .map((c) => `#${c}`);
  const officialTags = validTeams
    .map((t) => OFFICIAL_HASHTAG[t])
    .filter((c): c is string => Boolean(c))
    .map((c) => `#${c}`);
  // Dedupe — for some teams the nickname IS the official tag (#Cubs, #Dodgers).
  const tags = Array.from(new Set([...nameTags, ...tricodeTags, ...officialTags])).join(" ");
  return {
    text: `${entry.title} · ${dates.games}\n\n${tags} #MLB${tail}`.trim(),
    alt: `Box score: ${entry.title} on ${dates.games}.`,
  };
}
