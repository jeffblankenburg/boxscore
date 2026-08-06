// Per-platform post content generators. Platform-agnostic where possible, and
// sport-aware: MLB, NBA, WNBA, NFL, and NCAAF each get their own emoji, league
// hashtag, and per-team findability hashtags.
//
// Team hashtags follow the MLB pattern (three per team where available):
//   1. Nickname/name tag  — #Aces, #Cowboys, #Buckeyes
//   2. Abbreviation tag   — #LV, #DAL           (pro leagues only)
//   3. Official rally tag  — #RaiseTheStakes, #FlyEaglesFly, #GoBucks
// The official tags are researched from each team's official account/site; when
// one couldn't be confirmed it's simply omitted (the first two still ship). A
// future admin surface will let us review/edit these — see GH issue.

import { TEAMS } from "./teams";
import type { ManifestEntry } from "./render-images";

export type DailyPostContext = {
  sport: string;        // "mlb"
  date: string;         // "2026-05-14"
  prettyDate: string;   // "Wednesday, May 14, 2026"
  gameCount: number;
  digestUrl: string;    // canonical URL on boxscore.email
};

// Lead emoji, display label, and league hashtag (without the leading #) per
// sport. `meta()` falls back to MLB for any unknown sport.
const SPORT_META: Record<string, { emoji: string; label: string; tag: string }> = {
  mlb:   { emoji: "⚾", label: "MLB", tag: "MLB" },
  nba:   { emoji: "🏀", label: "NBA", tag: "NBA" },
  wnba:  { emoji: "🏀", label: "WNBA", tag: "WNBA" },
  nfl:   { emoji: "🏈", label: "NFL", tag: "NFL" },
  ncaaf: { emoji: "🏈", label: "College Football", tag: "CFB" },
};
function meta(sport: string) {
  return SPORT_META[sport] ?? SPORT_META.mlb!;
}

function dailyPostBody(ctx: DailyPostContext): string {
  const m = meta(ctx.sport);
  return `${m.emoji} ${m.label} box scores · ${ctx.prettyDate} · ${ctx.gameCount} games

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

// Per-image post content used by both the BlueSky/Twitter crons (auto) and the
// admin Twitter compose page (manual paste). Same wording across platforms.

const hashtag = (team: string): string => "#" + team.replace(/\s+/g, "");
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// Derived team tag for the newer sports: strip everything X doesn't allow in a
// hashtag (spaces, &, ., ', -) so "Texas A&M" → "TexasAM", "Trail Blazers" →
// "TrailBlazers". MLB keeps its own `hashtag()` to preserve exact output.
const cleanTag = (s: string): string => s.replace(/[^a-zA-Z0-9]/g, "");

// ── MLB (nickname-keyed) ───────────────────────────────────────────────────
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

// ── Pro leagues (abbreviation-keyed official rally hashtags) ────────────────
// Researched from each team's official X account bio/game posts or team site;
// unconfirmed teams are omitted (nickname + abbreviation tags still ship).
const NFL_OFFICIAL: Record<string, string> = {
  ARI: "BirdGang", ATL: "RiseUp", BAL: "RavensFlock", BUF: "BillsMafia",
  CAR: "KeepPounding", CHI: "DaBears", CIN: "RuleTheJungle", CLE: "DawgPound",
  DAL: "DallasCowboys", DEN: "BroncosCountry", DET: "OnePride", GB: "GoPackGo",
  HOU: "WeAreTexans", IND: "ForTheShoe", JAX: "DUUUVAL", KC: "ChiefsKingdom",
  LV: "RaiderNation", LAC: "BoltUp", LAR: "RamsHouse", MIA: "FinsUp",
  MIN: "SKOL", NE: "ForeverNE", NO: "WhoDat", NYG: "TogetherBlue",
  NYJ: "TakeFlight", PHI: "FlyEaglesFly", PIT: "HereWeGo", SF: "FTTB",
  SEA: "GoHawks", TB: "GoBucs", TEN: "TitanUp", WSH: "RaiseHail",
};

const NBA_OFFICIAL: Record<string, string> = {
  ATL: "TrueToAtlanta", BOS: "DifferentHere", BKN: "NetsWorld", CHA: "AllFly",
  CLE: "LetEmKnow", DAL: "MFFL", DEN: "MileHighBasketball", DET: "DetroitBasketball",
  GSW: "DubNation", LAC: "ClipperNation", LAL: "LakeShow", MEM: "GrindCity",
  MIA: "HEATCulture", MIL: "FearTheDeer", NOP: "WontBowDown", NYK: "NewYorkForever",
  OKC: "ThunderUp", ORL: "MagicTogether", PHI: "BrotherlyLove", POR: "RipCity",
  SAC: "LightTheBeam", SAS: "PorVida", TOR: "WeTheNorth", UTA: "TakeNote",
  WAS: "ForTheDistrict",
  // Not confirmed (omitted): CHI, HOU, IND, MIN, PHX.
};

const WNBA_OFFICIAL: Record<string, string> = {
  ATL: "DoItForTheDream", CHI: "Skytown", CON: "GetClose", DAL: "WingsUp",
  GSV: "JointheAscent", LV: "ALLINLV", NY: "LIGHTITUPNYL", SEA: "TakeCover",
  // Not confirmed (omitted): IND, LA, MIN, PHX, TOR, WAS.
};

const PRO_OFFICIAL: Record<string, Record<string, string>> = {
  nfl: NFL_OFFICIAL,
  nba: NBA_OFFICIAL,
  wnba: WNBA_OFFICIAL,
};

// ── NCAAF (normalized school-name keyed) ───────────────────────────────────
// FBS teams aren't in lib/teams.ts (they come from ESPN feeds), so the box
// title token is the school "location" name (e.g. "Ohio State"). Keyed by the
// school name; looked up via norm() so spacing/punctuation differences don't
// matter. Researched from official football accounts/sites; unconfirmed teams
// are omitted and fall back to the derived #SchoolName tag.
const NCAAF_OFFICIAL_RAW: Record<string, string> = {
  // SEC
  Alabama: "RollTide", Arkansas: "WPS", Auburn: "WarEagle", Florida: "GoGators",
  Georgia: "GoDawgs", Kentucky: "ForTheTeam", LSU: "GeauxTigers",
  "Mississippi State": "HailState", Missouri: "MIZ", Oklahoma: "BoomerSooner",
  "Ole Miss": "HottyToddy", "South Carolina": "SpursUp", Tennessee: "GBO",
  Texas: "HookEm", "Texas A&M": "GigEm", Vanderbilt: "AnchorDown",
  // Big Ten
  Illinois: "Illini", Indiana: "IUFB", Maryland: "FearTheTurtle",
  Michigan: "GoBlue", "Michigan State": "GoGreen", Minnesota: "SkiUMah",
  Nebraska: "GBR", Northwestern: "GoCats", "Ohio State": "GoBucks",
  Oregon: "GoDucks", "Penn State": "WeAre", Purdue: "BoilerUp", Rutgers: "CHOP",
  UCLA: "GoBruins", USC: "FightOn", Washington: "PurpleReign", Wisconsin: "OnWisconsin",
  // Big 12
  Arizona: "BearDown", "Arizona State": "ForksUp", Baylor: "SicEm", BYU: "GoCougs",
  Cincinnati: "Bearcats", Colorado: "GoBuffs", Houston: "GoCoogs",
  "Iowa State": "cyclONEnation", Kansas: "RockChalk", "Kansas State": "EMAW",
  "Oklahoma State": "GoPokes", TCU: "GoFrogs", "Texas Tech": "WreckEm",
  UCF: "ChargeOn", Utah: "GoUtes", "West Virginia": "HailWV",
  // ACC
  "Boston College": "ForBoston", California: "GoBears", Clemson: "ALLIN",
  Duke: "GoDuke", "Florida State": "NoleFamily", "Georgia Tech": "StingEm",
  Louisville: "GoCards", Miami: "GoCanes", "NC State": "GoPack",
  "North Carolina": "GoHeels", Pittsburgh: "H2P", SMU: "PonyUpDallas",
  Stanford: "GoStanford", Virginia: "GoHoos", "Virginia Tech": "Hokies",
  "Wake Forest": "GoDeacs",
  // American
  Memphis: "GoTigersGo", UTSA: "BirdsUp", Tulane: "RollWave", Navy: "GoNavy",
  "East Carolina": "PirateNation", Charlotte: "GoldStandard",
  "Florida Atlantic": "WinningInParadise", "North Texas": "GMG", Rice: "GoOwls",
  Temple: "TempleTUFF", Tulsa: "ReignCane", UAB: "WinAsOne", Army: "GoArmy",
  // Mountain West
  "Boise State": "BleedBlue", "San Diego State": "AztecFAST",
  "Fresno State": "GoDogs", "Air Force": "FlyFightWin", Wyoming: "GoWyo",
  Nevada: "BattleBorn", UNLV: "BEaREBEL", "Utah State": "AggiesAllTheWay",
  "San Jose State": "AllSpartans", Hawaii: "BRADDAHHOOD",
  // Sun Belt
  "James Madison": "GoDukes", "Coastal Carolina": "BallAtTheBeach",
  Marshall: "WeAreMarshall", "Georgia Southern": "HailSouthern",
  Louisiana: "GeauxCajuns", Troy: "OneTROY", "South Alabama": "LSF",
  "Old Dominion": "ReignOn", "Georgia State": "LightItBlue",
  "Arkansas State": "WolvesUp", "Texas State": "EatEmUp",
  "Southern Miss": "SMTTT", "Louisiana-Monroe": "TakeFlight",
  // MAC
  Toledo: "TeamToledo", "Miami (OH)": "RiseUpRedHawks", Ohio: "OUohyeah",
  "Western Michigan": "BroncosReign", "Central Michigan": "FireUpChips",
  "Eastern Michigan": "EMUEagles", "Northern Illinois": "TheHardWay",
  "Bowling Green": "AyZiggy", Buffalo: "UBhornsUP", "Kent State": "GoFlashes",
  Akron: "GoZips", UMass: "Flagship",
  // Conference USA
  Liberty: "GoFlames", "Western Kentucky": "GoTops",
  "Jacksonville State": "StayCocky", "Sam Houston": "EatEmUpKats",
  "Louisiana Tech": "HBTD", FIU: "PawsUp", "New Mexico State": "AggieUp",
  "Kennesaw State": "GoKSUOwls",
  // Pac-12
  "Oregon State": "GoBeavs", "Washington State": "GoCougs",
  // Independents
  "Notre Dame": "GoIrish",
  // Not confirmed (omitted, fall back to derived tag): Iowa, Syracuse,
  // South Florida, Colorado State, Ball State, Middle Tennessee, Delaware,
  // Missouri State, UConn, Appalachian State.
};
const NCAAF_OFFICIAL = new Map(
  Object.entries(NCAAF_OFFICIAL_RAW).map(([school, tag]) => [norm(school), tag]),
);

// Canonical team index per pro sport: normalized abbreviation OR nickname →
// team. Lets us resolve whichever form the box title carries (basketball emits
// the abbreviation "LV"; football emits the mascot "Panthers"). Built lazily.
const teamIndexCache: Record<string, Map<string, { nickname: string; abbreviation: string }>> = {};
function teamIndex(sport: string): Map<string, { nickname: string; abbreviation: string }> {
  const cached = teamIndexCache[sport];
  if (cached) return cached;
  const idx = new Map<string, { nickname: string; abbreviation: string }>();
  for (const t of TEAMS) {
    if (t.sport !== sport) continue;
    idx.set(norm(t.abbreviation), t);
    idx.set(norm(t.nickname), t);
  }
  teamIndexCache[sport] = idx;
  return idx;
}

// MLB box titles carry nicknames ("Yankees"); look up tricode + official
// directly. Preserves the original MLB tag logic exactly.
function mlbTags(teams: string[]): string {
  const nameTags = teams.map(hashtag);
  const tricodeTags = teams
    .map((t) => TRICODE[t])
    .filter((c): c is string => Boolean(c))
    .map((c) => `#${c}`);
  const officialTags = teams
    .map((t) => OFFICIAL_HASHTAG[t])
    .filter((c): c is string => Boolean(c))
    .map((c) => `#${c}`);
  return Array.from(new Set([...nameTags, ...tricodeTags, ...officialTags])).join(" ");
}

// NBA/WNBA/NFL: resolve the token to a canonical team, then emit nickname +
// abbreviation + (if confirmed) official rally hashtag.
function proTags(sport: string, teams: string[]): string {
  const idx = teamIndex(sport);
  const official = PRO_OFFICIAL[sport] ?? {};
  const out = new Set<string>();
  for (const token of teams) {
    const team = idx.get(norm(token));
    if (!team) {
      const derived = cleanTag(token);
      if (derived) out.add(`#${derived}`);
      continue;
    }
    out.add(`#${cleanTag(team.nickname)}`);
    out.add(`#${team.abbreviation}`);
    const off = official[team.abbreviation];
    if (off) out.add(`#${off}`);
  }
  return Array.from(out).join(" ");
}

// NCAAF: token is the school name. Derive #SchoolName + (if confirmed) the
// official rally hashtag.
function ncaafTags(teams: string[]): string {
  const out = new Set<string>();
  for (const token of teams) {
    const derived = cleanTag(token);
    if (derived) out.add(`#${derived}`);
    const off = NCAAF_OFFICIAL.get(norm(token));
    if (off) out.add(`#${off}`);
  }
  return Array.from(out).join(" ");
}

function boxscoreTags(sport: string, teams: [string, string]): string {
  const valid = teams.filter((t) => t.length > 0);
  if (sport === "mlb") return mlbTags(valid);
  if (sport === "ncaaf") return ncaafTags(valid);
  return proTags(sport, valid);
}

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
  sport = "mlb",
): { text: string; alt: string } {
  // Twitter charges $0.20/post when a URL is present (vs $0.015 without), so
  // the Twitter paths pass digestUrl=undefined. Bluesky still includes it.
  const tail = digestUrl ? ` ${digestUrl}` : "";
  const m = meta(sport);
  if (entry.type === "full") {
    const games = entry.gameCount;
    const gamesLabel = games === 1 ? "1 game" : `${games} games`;
    return {
      text: `${m.emoji} ${m.label} box scores · ${dates.games} · ${gamesLabel}\n\n#${m.tag}${tail}`,
      alt: `Full ${m.label} digest for ${dates.games}: standings, leaders, and box scores for all ${gamesLabel}.`,
    };
  }
  if (entry.type === "scoreboard") {
    const games = entry.gameCount;
    const gamesLabel = games === 1 ? "1 game" : `${games} games`;
    // A board label ("Top 25", "SEC") replaces the league label as the heading
    // when a sport fans out into several boards (NCAAF); otherwise the league
    // label leads ("MLB Scoreboard").
    const heading = entry.label ?? m.label;
    return {
      text: `${m.emoji} ${heading} Scoreboard · ${dates.games} · ${gamesLabel}\n\n#${m.tag}${tail}`,
      alt: `${heading} scoreboard for ${dates.games}: final scores from ${gamesLabel}.`,
    };
  }
  if (entry.type === "standings") {
    // MLB-only section.
    const name = entry.league === "AL" ? "American League" : "National League";
    return {
      text: `${name} Standings · ${dates.edition}\n\n#${m.tag}${tail}`,
      alt: `${name} Standings for ${dates.edition}.`,
    };
  }
  if (entry.type === "leaders") {
    // MLB-only section.
    const name = entry.league === "AL" ? "American League" : "National League";
    return {
      text: `${name} Leaders · ${dates.edition}\n\n#${m.tag}${tail}`,
      alt: `${name} Leaders as of ${dates.edition}.`,
    };
  }
  const tags = boxscoreTags(sport, entry.teams);
  return {
    text: `${entry.title} · ${dates.games}\n\n${tags} #${m.tag}${tail}`.trim(),
    alt: `Box score: ${entry.title} on ${dates.games}.`,
  };
}
