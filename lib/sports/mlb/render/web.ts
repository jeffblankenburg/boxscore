// Canonical web renderer. Takes CanonicalDailyData and returns the same
// HTML body the production renderer at lib/render.ts produces — but
// reading canonical field names directly, with no statsapi-shaped
// intermediate. When we cut over production to canonical, this file
// replaces lib/render.ts entirely.
//
// Identity contract: for any date that comes out of the statsapi
// adapter, this renderer's HTML output should match lib/render.ts's
// HTML output byte-for-byte. The canonical preview tool at
// /admin/preview/canonical/[date]?source=statsapi&surface=web is the
// validation surface for that contract.

import type { CanonicalDailyData, AsgSide, AsgHitter, AsgPitcher } from "../canonical";
import type {
  MlbBoxPlayer,
  MlbBoxScore,
  MlbBoxTeam,
  MlbDivisionStandings,
  MlbDivision,
  MlbGame,
  MlbGameStatus,
  MlbInningLine,
  MlbLeaderboard,
  MlbLeaderCategory,
  MlbLeague,
  MlbPlayerRef,
  MlbProbablePitcher,
  MlbScoringPlay,
  MlbStandingRow,
  MlbTransaction,
  MlbWildCardStandings,
} from "../types";

import type { DigestMode } from "@/lib/digest-mode";
import { findTeam } from "@/lib/teams";
import { nextDay, prettyDate, issueNumber, volumeNumber } from "@/lib/dates";
import { lastName } from "@/lib/names";
import { lastNameLinkWeb, fullNameLinkWeb } from "@/lib/player-links";

// ─── Display tables (name-keyed) ─────────────────────────────────────────
// Kept local rather than imported from lib/render.ts so this file stands
// on its own when the production renderer is eventually deleted.

const DIVISION_ORDER: Record<MlbLeague, MlbDivision[]> = {
  AL: ["East", "Central", "West"],
  NL: ["East", "Central", "West"],
};

const CITY_OF: Record<string, string> = {
  "Arizona Diamondbacks": "Arizona", "Atlanta Braves": "Atlanta",
  "Baltimore Orioles": "Baltimore", "Boston Red Sox": "Boston",
  "Chicago Cubs": "Chi. Cubs", "Chicago White Sox": "Chi. White Sox",
  "Cincinnati Reds": "Cincinnati", "Cleveland Guardians": "Cleveland",
  "Colorado Rockies": "Colorado", "Detroit Tigers": "Detroit",
  "Houston Astros": "Houston", "Kansas City Royals": "Kansas City",
  "Los Angeles Angels": "Los Angeles", "Los Angeles Dodgers": "L.A. Dodgers",
  "Miami Marlins": "Miami", "Milwaukee Brewers": "Milwaukee",
  "Minnesota Twins": "Minnesota", "New York Mets": "N.Y. Mets",
  "New York Yankees": "New York", "Athletics": "Athletics",
  "Oakland Athletics": "Athletics", "Philadelphia Phillies": "Philadelphia",
  "Pittsburgh Pirates": "Pittsburgh", "San Diego Padres": "San Diego",
  "San Francisco Giants": "San Francisco", "Seattle Mariners": "Seattle",
  "St. Louis Cardinals": "St. Louis", "Tampa Bay Rays": "Tampa Bay",
  "Texas Rangers": "Texas", "Toronto Blue Jays": "Toronto",
  "Washington Nationals": "Washington",
};

const NICKNAME_OF: Record<string, string> = {
  "Arizona Diamondbacks": "Diamondbacks", "Atlanta Braves": "Braves",
  "Baltimore Orioles": "Orioles", "Boston Red Sox": "Red Sox",
  "Chicago Cubs": "Cubs", "Chicago White Sox": "White Sox",
  "Cincinnati Reds": "Reds", "Cleveland Guardians": "Guardians",
  "Colorado Rockies": "Rockies", "Detroit Tigers": "Tigers",
  "Houston Astros": "Astros", "Kansas City Royals": "Royals",
  "Los Angeles Angels": "Angels", "Los Angeles Dodgers": "Dodgers",
  "Miami Marlins": "Marlins", "Milwaukee Brewers": "Brewers",
  "Minnesota Twins": "Twins", "New York Mets": "Mets",
  "New York Yankees": "Yankees", "Athletics": "Athletics",
  "Oakland Athletics": "Athletics", "Philadelphia Phillies": "Phillies",
  "Pittsburgh Pirates": "Pirates", "San Diego Padres": "Padres",
  "San Francisco Giants": "Giants", "Seattle Mariners": "Mariners",
  "St. Louis Cardinals": "Cardinals", "Tampa Bay Rays": "Rays",
  "Texas Rangers": "Rangers", "Toronto Blue Jays": "Blue Jays",
  "Washington Nationals": "Nationals",
};

const TLA_OF: Record<string, string> = {
  "Arizona Diamondbacks": "ARI", "Atlanta Braves": "ATL",
  "Baltimore Orioles": "BAL", "Boston Red Sox": "BOS",
  "Chicago Cubs": "CHC", "Chicago White Sox": "CWS",
  "Cincinnati Reds": "CIN", "Cleveland Guardians": "CLE",
  "Colorado Rockies": "COL", "Detroit Tigers": "DET",
  "Houston Astros": "HOU", "Kansas City Royals": "KC",
  "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD",
  "Miami Marlins": "MIA", "Milwaukee Brewers": "MIL",
  "Minnesota Twins": "MIN", "New York Mets": "NYM",
  "New York Yankees": "NYY", "Athletics": "ATH",
  "Oakland Athletics": "ATH", "Philadelphia Phillies": "PHI",
  "Pittsburgh Pirates": "PIT", "San Diego Padres": "SD",
  "San Francisco Giants": "SF", "Seattle Mariners": "SEA",
  "St. Louis Cardinals": "STL", "Tampa Bay Rays": "TB",
  "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR",
  "Washington Nationals": "WSH",
};

const PAPER_NICKNAME_OF: Record<string, string> = {
  Diamondbacks: "D-Backs",
  Nationals: "Nats",
  Guardians: "Guards",
  "Blue Jays": "Jays",
  Athletics: "A's",
  Orioles: "O's",
  Cardinals: "Cards",
  Yankees: "Yanks",
  Phillies: "Phils",
};

const city     = (name: string): string => CITY_OF[name] ?? name;
const nickname = (name: string): string => NICKNAME_OF[name] ?? name;
const tla      = (name: string): string => TLA_OF[name] ?? name;

function nicknameHtml(teamName: string): string {
  const full = nickname(teamName);
  const short = PAPER_NICKNAME_OF[full];
  if (!short) return esc(full);
  return `<span class="nick-full">${esc(full)}</span><span class="nick-short">${esc(short)}</span>`;
}

const esc = (s: string | number | undefined): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const pad = (n: number | null | undefined): string => (n == null ? "—" : String(n));

// Format helpers — canonical stores numbers, statsapi stored strings. The
// production renderer's fmtAvg / fmtOps / fmtEra accepted statsapi strings
// like "0.298" / "-.--" and stripped leading "0" or returned ".---". For
// canonical inputs we format directly from numbers but produce the same
// output string for the same statsapi data.
function fmtRate3(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return ".---";
  return v.toFixed(3).replace(/^0/, "");
}
const fmtAvg = fmtRate3;
const fmtOps = fmtRate3;
function fmtEra(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}
// Standings W-L pct in canonical is a fraction 0..1; render as ".xxx".
function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return ".---";
  return v.toFixed(3).replace(/^0/, "");
}
// gamesBehind canonical is a number; display "-" for 0, integer for whole
// numbers, "x.5" for halves — mirrors statsapi's gamesBack string.
function fmtGb(v: number): string {
  if (v <= 0) return "-";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
function fmtGbOrEm(v: number | null): string {
  if (v == null) return "—";
  return fmtGb(v);
}
// Wild-card games-behind has a richer sign convention than division GB:
//   null     → "—" (not applicable, e.g. teams pre-filtered out)
//   0        → "-" (at the cutoff line)
//   positive → "X.X" (behind the cutoff by that many)
//   negative → "+X.X" (AHEAD of the cutoff by abs(X.X); MLB shows the +)
function fmtWcgb(v: number | null): string {
  if (v == null) return "—";
  if (v === 0) return "-";
  if (v < 0) {
    const abs = Math.abs(v);
    return "+" + (Number.isInteger(abs) ? String(abs) : abs.toFixed(1));
  }
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
const fmtDiff = (scored: number | undefined, allowed: number | undefined): string => {
  if (scored == null || allowed == null) return "—";
  const d = scored - allowed;
  if (d > 0) return `+${d}`;
  if (d < 0) return `${d}`;
  return "0";
};

// inningsPitched is a decimal where .1 = ⅓, .2 = ⅔. statsapi stores it as
// a string ("5.2"); canonical stores it as a number (5.2). Match the
// string form exactly.
function fmtIp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return v.toFixed(1);
}

// ─── Diff overlay helpers ───────────────────────────────────────────────
// When a highlight map is passed to the renderer, every element that
// carries a diff-key emits the key as data-diff-key AND — if the key is
// in the map — gains the cx-diff-hl class plus a title attribute holding
// a short summary of what differs. The map values are pre-formatted
// strings (built by highlightKeysFor in diff.ts).

export type HighlightMap = Map<string, string> | undefined;

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

// Emit a `data-diff-key="..."`, optional `class="..."` and optional
// `title="..."`. Use at the spot in the markup where the key element
// opens (before the closing `>` of its start tag). `extra` lets the
// caller pass an existing class string to merge with cx-diff-hl.
function diffAttrs(hl: HighlightMap, key: string, extra: string = ""): string {
  const tip = hl?.get(key);
  const cls = tip ? (extra ? `${extra} cx-diff-hl` : "cx-diff-hl") : extra;
  const titleAttr = tip ? ` title="${escAttr(tip)}"` : "";
  const classAttr = cls ? ` class="${cls}"` : "";
  return ` data-diff-key="${key}"${classAttr}${titleAttr}`;
}

// ─── Mode classifier (canonical) ─────────────────────────────────────────

const POSTSEASON_TYPES = new Set(["wild-card", "division-series", "lcs", "world-series"]);
const PRESEASON_TYPES  = new Set(["spring", "exhibition"]);

function classifyMode(games: MlbGame[], date: string, nextDayGames: MlbGame[] = []): DigestMode {
  const types = new Set(games.map((g) => g.gameType));
  if (types.has("all-star")) return "all-star";
  for (const t of types) if (POSTSEASON_TYPES.has(t)) return "postseason";
  if (types.has("regular")) return "regular";
  for (const t of types) if (PRESEASON_TYPES.has(t)) return "preseason";
  const month = Number(date.slice(5, 7));
  if (month === 11 || month === 12 || month === 1 || month === 2) return "offseason";
  // In-season with no games = the All-Star break (MLB has no other empty days).
  // Day before the ASG (tomorrow's slate is the ASG) → preview; any other empty
  // July day is a post-ASG break day → mid-season first-half recap.
  if (nextDayGames.some((g) => g.gameType === "all-star")) return "all-star-preview";
  if (month === 7) return "mid-season";
  return "no-games";
}

// ─── Team record map (for Today's Games) ────────────────────────────────

function buildTeamRecordMap(standings: MlbDivisionStandings[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const div of standings) {
    for (const tr of div.teams) {
      out.set(tr.team.id, `${tr.wins}-${tr.losses}`);
    }
  }
  return out;
}

// ─── Leader categories (canonical → display labels) ─────────────────────

const LEADER_LABEL: Record<MlbLeaderCategory, { label: string; valueLabel: string }> = {
  battingAverage:     { label: "Batting Average",      valueLabel: "AVG"  },
  homeRuns:           { label: "Home Runs",            valueLabel: "HR"   },
  runsBattedIn:       { label: "RBI",                  valueLabel: "RBI"  },
  stolenBases:        { label: "Stolen Bases",         valueLabel: "SB"   },
  wins:               { label: "Wins",                 valueLabel: "W"    },
  earnedRunAverage:   { label: "ERA",                  valueLabel: "ERA"  },
  strikeoutsPitching: { label: "Strikeouts (Pitching)", valueLabel: "SO"  },
  saves:              { label: "Saves",                valueLabel: "SV"   },
  hits:               { label: "Hits",                 valueLabel: "H"    },
  ops:                { label: "OPS",                  valueLabel: "OPS"  },
  onBasePercentage:   { label: "On-Base %",            valueLabel: "OBP"  },
  sluggingPercentage: { label: "Slugging %",           valueLabel: "SLG"  },
  whip:               { label: "WHIP",                 valueLabel: "WHIP" },
  inningsPitched:     { label: "Innings Pitched",      valueLabel: "IP"   },
};
const LEADER_ORDER: MlbLeaderCategory[] = [
  "battingAverage", "homeRuns", "runsBattedIn", "stolenBases",
  "wins", "earnedRunAverage", "strikeoutsPitching", "saves",
];

function formatLeaderValue(category: MlbLeaderCategory, v: number): string {
  switch (category) {
    case "battingAverage":
    case "ops":
    case "onBasePercentage":
    case "sluggingPercentage":
    case "whip":
      return fmtRate3(v);
    case "earnedRunAverage":
      return v.toFixed(2);
    default:
      return String(Math.round(v));
  }
}

// Extend cutoff through any tie with the last visible player. Mirrors
// production renderer (leadersThroughTies) so AL/NL leader lists land at
// the same length when ranks tie.
function leadersThroughTies<T extends { rank: number }>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) return rows;
  let cutoff = limit;
  const lastRank = rows[cutoff - 1]!.rank;
  while (cutoff < rows.length && rows[cutoff]!.rank === lastRank) cutoff++;
  return rows.slice(0, cutoff);
}

// ─── Public entry ────────────────────────────────────────────────────────

export function renderCanonicalWeb(data: CanonicalDailyData, hl?: HighlightMap): string {
  const editionDate = nextDay(data.date);
  const datelineOpts = {
    volume: volumeNumber(editionDate),
    issue:  issueNumber(editionDate),
  };
  const teamRecords = buildTeamRecordMap(data.standings);
  const mode = classifyMode(data.games, data.date, data.nextDayGames);

  if (mode === "no-games") {
    return `${renderDateline(prettyDate(nextDay(data.date)), datelineOpts)}

<p class="no-games-note">No games yesterday.</p>

${renderTodaysGames(data.nextDayGames, teamRecords, hl)}

${renderTransactions(data.transactions, hl)}`;
  }

  if (mode === "all-star") {
    return `${renderDateline(prettyDate(nextDay(data.date)), datelineOpts)}

<div class="edition-subtitle">All-Star Game Edition</div>

<div class="section">
  ${renderAllStarLeague("American League", "AL", data, hl)}
</div>

<div class="section">
  ${renderAllStarLeague("National League", "NL", data, hl)}
</div>

${renderTodaysGames(data.nextDayGames, teamRecords, hl)}

${renderAllStarGame(data, hl)}

${renderTransactions(data.transactions, hl)}`;
  }

  // Day before the ASG: masthead + AL/NL rosters (with first-half season
  // lines) + pitching matchup, then the normal first-half standings/leaders.
  if (mode === "all-star-preview") {
    return `${renderDateline(prettyDate(nextDay(data.date)), datelineOpts)}

${asgMasthead(data)}

${asgMatchupByline(data)}

${renderAsgRosters(data)}

<div class="section">
  ${renderLeague("American League", "AL", data, hl)}
</div>

<div class="section">
  ${renderLeague("National League", "NL", data, hl)}
</div>

${renderTransactions(data.transactions, hl)}`;
  }

  // Day after the ASG: first-half recap — standings + extended leaders +
  // Today's Games (second half resumes).
  if (mode === "mid-season") {
    return `${renderDateline(prettyDate(nextDay(data.date)), datelineOpts)}

<div class="asg-edition">First-Half Recap</div>

<div class="section">
  ${renderLeague("American League", "AL", data, hl, 10)}
</div>

<div class="section">
  ${renderLeague("National League", "NL", data, hl, 10)}
</div>

${renderTodaysGames(data.nextDayGames, teamRecords, hl)}

${renderTransactions(data.transactions, hl)}`;
  }

  return `${renderDateline(prettyDate(nextDay(data.date)), datelineOpts)}

<div class="section">
  ${renderLeague("American League", "AL", data, hl)}
</div>

<div class="section">
  ${renderLeague("National League", "NL", data, hl)}
</div>

${renderSchedule(data.games, hl)}

${renderTodaysGames(data.nextDayGames, teamRecords, hl)}

<div class="boxscores-title">Yesterday's Box Scores</div>
${renderGames(data, hl)}

${renderTransactions(data.transactions, hl)}`;
}

// ─── All-Star preview edition helpers ────────────────────────────────────

// Masthead: kicker + stars + headline + a sub-line built from the ASG game
// (matchup, venue, first pitch) — all real data, no placeholders.
function asgMasthead(data: CanonicalDailyData): string {
  const asg = data.nextDayGames.find((g) => g.gameType === "all-star");
  let sub = "";
  if (asg) {
    const matchup = `${esc(asg.awayTeam.name)} vs. ${esc(asg.homeTeam.name)}`;
    // Venue + first pitch travel together; on narrow screens they drop to
    // their own line (before "Truist Park") rather than splitting mid-venue.
    const loc = [asg.venueName ? esc(asg.venueName) : null, esc(timeInET(asg.startTime))]
      .filter(Boolean).join(" &middot; ");
    sub = `<div class="asg-venue">${matchup}<span class="asg-venue-sep"> &middot; </span><span class="asg-venue-loc">${loc}</span></div>`;
  }
  return `<div class="asg-mast">
  <div class="asg-kicker">Midsummer Classic &middot; Special Edition</div>
  <div class="asg-stars">&#9733; &#9733; &#9733;</div>
  <h1 class="asg-headline">The All-Star Game</h1>
  ${sub}
</div>`;
}

// Pitching matchup byline — same "(W-L, ERA)" shape as the Today's Games strip.
function asgMatchupByline(data: CanonicalDailyData): string {
  const asg = data.nextDayGames.find((g) => g.gameType === "all-star");
  if (!asg) return "";
  const fmt = (p: MlbProbablePitcher | null): string => {
    if (!p) return `<span class="asg-matchup-p">TBD</span>`;
    const detail: string[] = [];
    if (p.wins != null && p.losses != null) detail.push(`${p.wins}-${p.losses}`);
    if (p.era != null && Number.isFinite(p.era)) detail.push(p.era.toFixed(2));
    const label = detail.length ? `${esc(p.fullName)} (${detail.join(", ")})` : esc(p.fullName);
    return `<span class="asg-matchup-p">${label}</span>`;
  };
  return `<div class="asg-matchup"><span class="asg-matchup-label">Pitching Matchup</span> ${fmt(asg.awayProbablePitcher)} vs ${fmt(asg.homeProbablePitcher)}</div>`;
}

function asgHitterTable(hitters: AsgHitter[]): string {
  if (hitters.length === 0) return "";
  const rows = hitters.map((p) => `<tr>
    <td class="p-col"><span class="rtag">${esc(p.pos)}</span> ${fullNameLinkWeb({ id: p.mlbId, fullName: p.name })} <span class="rtm">${esc(p.team)}</span></td>
    <td>${pad(p.hr)}</td><td>${pad(p.rbi)}</td><td>${pad(p.ab)}</td><td>${p.avg ?? "—"}</td><td>${p.ops ?? "—"}</td>
  </tr>`).join("");
  return `<table class="asg-roster"><thead><tr><th class="p-col">Player</th><th>HR</th><th>RBI</th><th>AB</th><th>AVG</th><th>OPS</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function asgPitcherTable(pitchers: AsgPitcher[]): string {
  if (pitchers.length === 0) return "";
  const rows = pitchers.map((p) => `<tr>
    <td class="p-col"><span class="rtag">${esc(p.role)}</span> ${fullNameLinkWeb({ id: p.mlbId, fullName: p.name })} <span class="rtm">${esc(p.team)}</span></td>
    <td>${p.ip ?? "—"}</td><td>${pad(p.er)}</td><td>${pad(p.bb)}</td><td>${pad(p.k)}</td><td>${p.era ?? "—"}</td>
  </tr>`).join("");
  return `<table class="asg-roster"><thead><tr><th class="p-col">Player</th><th>IP</th><th>ER</th><th>BB</th><th>K</th><th>ERA</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function asgRosterCard(label: string, side: AsgSide | undefined): string {
  if (!side) return "";
  const starters = side.hitters.filter((h) => h.order != null);
  const bench    = side.hitters.filter((h) => h.order == null);
  const sp       = side.pitchers.filter((p) => p.starter);
  const bullpen  = side.pitchers.filter((p) => !p.starter);
  // Once the lineup is announced (starters present), split starters vs. the
  // rest; before that, fall back to the flat roster tables.
  const body = starters.length > 0
    ? `<div class="stats-subheader">Starting Lineup</div>${asgHitterTable(starters)}
       <div class="stats-subheader">Bench</div>${asgHitterTable(bench)}
       <div class="stats-subheader">Starting Pitcher</div>${asgPitcherTable(sp)}
       <div class="stats-subheader">Bullpen</div>${asgPitcherTable(bullpen)}`
    : `<div class="stats-subheader">Position Players</div>${asgHitterTable(side.hitters)}
       <div class="stats-subheader">Pitchers</div>${asgPitcherTable(side.pitchers)}`;
  return `<div>
  <div class="boxscores-title">${esc(label)}</div>
  ${body}
</div>`;
}
function renderAsgRosters(data: CanonicalDailyData): string {
  const r = data.allStarRosters;
  if (!r) return "";
  return `<div class="league-layout">${asgRosterCard("American League", r.AL)}${asgRosterCard("National League", r.NL)}</div>`;
}

// ─── Dateline + transactions ─────────────────────────────────────────────

export function renderDateline(
  pretty: string,
  opts: { volume?: number; issue?: number } = {},
): string {
  const counter = opts.volume && opts.issue
    ? `<div class="dateline-issue-no">Vol. ${opts.volume}, Issue ${opts.issue}</div>`
    : "";
  return `<div class="dateline"><div class="dateline-row"><span class="dateline-text">${esc(pretty)}</span></div>${counter}</div>`;
}

function renderTransactions(txs: MlbTransaction[], hl?: HighlightMap): string {
  if (txs.length === 0) return "";
  const items = txs
    .map((t) => {
      const attrs = t.player ? diffAttrs(hl, `txn:player:${t.player.id}`) : "";
      return `<li${attrs}><span class="tx-type">${esc(t.typeLabel)}</span> ${esc(t.description)}</li>`;
    })
    .join("");
  return `<div class="transactions-section">
  <div class="boxscores-title">Transactions</div>
  <ul class="transactions-list">${items}</ul>
</div>`;
}

// ─── League block (standings + wild card + leaders) ─────────────────────

function renderLeague(label: string, league: MlbLeague, data: CanonicalDailyData, hl?: HighlightMap, leaderLimit = 5): string {
  const standingsHtml = DIVISION_ORDER[league].map((d) => {
    const rec = data.standings.find((r) => r.league === league && r.division === d);
    return rec ? renderDivisionTable(`${d} Division`, rec, { date: nextDay(data.date) }, hl) : "";
  }).join("");
  const wcRecord = data.wildCard.find((r) => r.league === league);
  const wildCardHtml = wcRecord ? renderWildCardTable(wcRecord, { date: nextDay(data.date) }, hl) : "";
  const leadersHtml = renderLeagueLeaders(data.leaderboards.filter((b) => b.league === league), leaderLimit, hl);
  return `<div class="league-layout">
  <div class="col-standings">
    <div class="boxscores-title">${esc(label)} Standings</div>
    ${standingsHtml}
    ${wildCardHtml}
  </div>
  <div class="col-leaders">
    <div class="boxscores-title">${esc(label)} Leaders</div>
    ${leadersHtml}
  </div>
</div>`;
}

function renderDivisionTable(
  label: string,
  d: MlbDivisionStandings,
  opts: { date?: string } = {},
  hl?: HighlightMap,
): string {
  const rows = [...d.teams]
    .sort((a, b) => a.divisionRank - b.divisionRank)
    .map((t) => standingsRow(t, { date: opts.date, league: d.league, division: d.division }, hl))
    .join("");
  return `<div class="stats-subheader">${esc(label)}</div>
<div class="standings-wrap"><table class="standings-table">
  <thead>
    <tr>
      <th class="team-col">Team</th>
      <th class="w-col">W</th>
      <th class="l-col">L</th>
      <th class="pct-col">Pct</th>
      <th class="gb-col">GB</th>
      <th class="diff-col">Diff</th>
      <th class="rec-col">Home</th>
      <th class="rec-col">Away</th>
      <th class="rec-col">L10</th>
      <th class="strk-col">Strk</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table></div>`;
}

function renderWildCardTable(
  wc: MlbWildCardStandings,
  opts: { date?: string } = {},
  hl?: HighlightMap,
): string {
  const sorted = [...wc.teams]
    .sort((a, b) => (a.wildCardRank ?? 99) - (b.wildCardRank ?? 99));
  const minTeams = 6;
  let cutoff = Math.min(minTeams, sorted.length);
  const lastIncluded = sorted[cutoff - 1];
  while (cutoff < sorted.length) {
    const next = sorted[cutoff];
    if (next && lastIncluded
        && next.wins === lastIncluded.wins
        && next.losses === lastIncluded.losses) {
      cutoff++;
    } else {
      break;
    }
  }
  const top = sorted.slice(0, cutoff);
  const rows = top.map((t, i) => {
    const cutoffClass = i === 3 ? " wc-cutoff" : "";
    const slug = findTeam("mlb", t.team.id)?.slug;
    const name = esc(nickname(t.team.name));
    const teamHref = slug && opts.date ? `/mlb/${slug}/${opts.date}` : null;
    const teamCell = teamHref
      ? `<a class="team-link" href="${teamHref}">${name}</a>`
      : name;
    const attrs = diffAttrs(hl, `wc:${wc.league}/${t.team.id}`, cutoffClass.trim());
    return `<tr${attrs}>
      <td class="team-col">${teamCell}</td>
      <td class="w-col">${t.wins}</td>
      <td class="l-col">${t.losses}</td>
      <td class="pct-col">${fmtPct(t.leagueRecord.pct)}</td>
      <td class="gb-col">${fmtWcgb(t.wildCardGamesBehind)}</td>
      <td class="diff-col">${fmtDiff(t.runsScored, t.runsAllowed)}</td>
      <td class="rec-col">${t.homeRecord.wins}-${t.homeRecord.losses}</td>
      <td class="rec-col">${t.awayRecord.wins}-${t.awayRecord.losses}</td>
      <td class="rec-col">${t.lastTenRecord.wins}-${t.lastTenRecord.losses}</td>
      <td class="strk-col">${esc(t.streak)}</td>
    </tr>`;
  }).join("");
  return `<div class="stats-subheader">Wild Card</div>
<div class="standings-wrap"><table class="standings-table">
  <thead>
    <tr>
      <th class="team-col">Team</th>
      <th class="w-col">W</th>
      <th class="l-col">L</th>
      <th class="pct-col">Pct</th>
      <th class="gb-col">WCGB</th>
      <th class="diff-col">Diff</th>
      <th class="rec-col">Home</th>
      <th class="rec-col">Away</th>
      <th class="rec-col">L10</th>
      <th class="strk-col">Strk</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table></div>`;
}

function standingsRow(
  t: MlbStandingRow,
  opts: { date?: string; league?: MlbLeague; division?: MlbDivision },
  hl?: HighlightMap,
): string {
  const slug = findTeam("mlb", t.team.id)?.slug;
  const name = esc(nickname(t.team.name));
  const teamHref = slug
    ? `/mlb/${slug}${opts.date ? `/${opts.date}` : ""}`
    : null;
  const teamCell = teamHref
    ? `<a class="team-link" href="${teamHref}">${name}</a>`
    : name;
  // Standings rows only get a diff key in regular standings (league +
  // division known); the ASG variant calls renderAllStarDivisionTable
  // with its own emission.
  const attrs = opts.league && opts.division
    ? diffAttrs(hl, `standings:${opts.league}/${opts.division}/${t.team.id}`)
    : "";
  return `<tr${attrs}>
        <td class="team-col">${teamCell}</td>
        <td class="w-col">${t.wins}</td>
        <td class="l-col">${t.losses}</td>
        <td class="pct-col">${fmtPct(t.leagueRecord.pct)}</td>
        <td class="gb-col">${fmtGb(t.gamesBehind)}</td>
        <td class="diff-col">${fmtDiff(t.runsScored, t.runsAllowed)}</td>
        <td class="rec-col">${t.homeRecord.wins}-${t.homeRecord.losses}</td>
        <td class="rec-col">${t.awayRecord.wins}-${t.awayRecord.losses}</td>
        <td class="rec-col">${t.lastTenRecord.wins}-${t.lastTenRecord.losses}</td>
        <td class="strk-col">${esc(t.streak)}</td>
      </tr>`;
}

// All-Star Game variant of the standings (no links, wider split columns).
function renderAllStarDivisionTable(label: string, d: MlbDivisionStandings, hl?: HighlightMap): string {
  // Canonical doesn't carry extraInning/oneRun/day/night/grass/turf/east/
  // central/west/interLeague splits — those are an all-star-only deep dive.
  // We emit "—" for each so the table structure and column count match the
  // production renderer. When we want full ASG parity, expand MlbRecord with
  // additional split fields and populate them on both adapters.
  const rows = [...d.teams]
    .sort((a, b) => a.divisionRank - b.divisionRank)
    .map((t) => `<tr${diffAttrs(hl, `standings:${d.league}/${d.division}/${t.team.id}`)}>
        <td class="team-col">${esc(nickname(t.team.name))}</td>
        <td class="w-col">${t.wins}</td>
        <td class="l-col">${t.losses}</td>
        <td class="pct-col">${fmtPct(t.leagueRecord.pct)}</td>
        <td class="gb-col">${fmtGb(t.gamesBehind)}</td>
        <td class="gb-col">${fmtWcgb(t.wildCardGamesBehind)}</td>
        <td class="rec-col">—</td>
        <td class="rec-col">—</td>
        <td class="rec-col">—</td>
        <td class="rec-col">—</td>
        <td class="rec-col">—</td>
        <td class="rec-col">—</td>
        <td class="rec-col">—</td>
        <td class="rec-col">—</td>
        <td class="rec-col">—</td>
        <td class="rec-col">—</td>
      </tr>`).join("");
  return `<div class="stats-subheader">${esc(label)}</div>
<div class="standings-wrap"><table class="standings-table asg-standings-table">
  <thead>
    <tr>
      <th class="team-col">Team</th>
      <th class="w-col">W</th>
      <th class="l-col">L</th>
      <th class="pct-col">Pct</th>
      <th class="gb-col">GB</th>
      <th class="gb-col">WCGB</th>
      <th class="rec-col">XTRA</th>
      <th class="rec-col">1 RUN</th>
      <th class="rec-col">DAY</th>
      <th class="rec-col">NIGHT</th>
      <th class="rec-col">GRASS</th>
      <th class="rec-col">TURF</th>
      <th class="rec-col">EAST</th>
      <th class="rec-col">CENTRAL</th>
      <th class="rec-col">WEST</th>
      <th class="rec-col">AL/NL</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table></div>`;
}

function renderAllStarLeague(label: string, league: MlbLeague, data: CanonicalDailyData, hl?: HighlightMap): string {
  const standingsHtml = DIVISION_ORDER[league].map((d) => {
    const rec = data.standings.find((r) => r.league === league && r.division === d);
    return rec ? renderAllStarDivisionTable(`${d} Division`, rec, hl) : "";
  }).join("");
  const wcRecord = data.wildCard.find((r) => r.league === league);
  const wildCardHtml = wcRecord ? renderWildCardTable(wcRecord, {}, hl) : "";
  const leagueBoards = data.leaderboards.filter((b) => b.league === league);
  const leadersHtml = renderAllStarLeaders(leagueBoards, hl);
  return `<div class="league-band">
  <div class="league-name">${esc(label)}</div>
</div>
<div class="asg-league-block">
  <div class="boxscores-title">Standings</div>
  ${standingsHtml}
  ${wildCardHtml}
  <div class="boxscores-title">Leaders</div>
  ${leadersHtml}
</div>`;
}

function renderLeagueLeaders(boards: MlbLeaderboard[], limit = 5, hl?: HighlightMap): string {
  const cards = LEADER_ORDER.map((cat) => {
    const board = boards.find((b) => b.category === cat);
    if (!board) return "";
    const meta = LEADER_LABEL[cat];
    const rows = leadersThroughTies(board.entries, limit).map((L) => {
      const attrs = diffAttrs(hl, `leader:${board.league}/${board.category}/${L.rank}`);
      return `
      <tr${attrs}>
        <td class="player-col">${L.rank}. ${lastNameLinkWeb({ id: L.player.id, fullName: L.player.fullName } as MlbPlayerRef)}, ${esc(tla(L.team.name))}</td>
        <td>${esc(formatLeaderValue(cat, L.value))}</td>
      </tr>`;
    }).join("");
    return `<div class="leaders-section">
<div class="stats-subheader">${esc(meta.label)}</div>
<table class="leaders-table">
  <thead><tr><th class="player-col">Player</th><th>${esc(meta.valueLabel)}</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</div>`;
  }).join("");
  return `<div class="leaders-cols">${cards}</div>`;
}

function renderAllStarLeaders(boards: MlbLeaderboard[], hl?: HighlightMap): string {
  const cards = LEADER_ORDER.map((cat) => {
    const board = boards.find((b) => b.category === cat);
    if (!board) return "";
    const meta = LEADER_LABEL[cat];
    const rows = leadersThroughTies(board.entries, 15).map((L) => {
      const attrs = diffAttrs(hl, `leader:${board.league}/${board.category}/${L.rank}`);
      return `
      <tr${attrs}>
        <td class="player-col">${L.rank}. ${lastNameLinkWeb({ id: L.player.id, fullName: L.player.fullName } as MlbPlayerRef)}, ${esc(tla(L.team.name))}</td>
        <td>${esc(formatLeaderValue(cat, L.value))}</td>
      </tr>`;
    }).join("");
    return `<div class="leaders-section">
<div class="stats-subheader">${esc(meta.label)}</div>
<table class="leaders-table">
  <thead><tr><th class="player-col">Player</th><th>${esc(meta.valueLabel)}</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</div>`;
  }).join("");
  return `<div class="asg-leaders-grid">${cards}</div>`;
}

// ─── Yesterday's Results (compact list) ─────────────────────────────────

function renderSchedule(games: MlbGame[], hl?: HighlightMap): string {
  const lines = games.map((g) => {
    const aScore = g.awayScore ?? 0;
    const hScore = g.homeScore ?? 0;
    const aClass = aScore > hScore ? "winner" : "";
    const hClass = hScore > aScore ? "winner" : "";
    const status = g.statusDetail === "Final" ? "" : ` <span style="color:var(--text-muted)">(${esc(g.statusDetail)})</span>`;
    // Match key mirrors the diff library — composite of canonical
    // team slugs since vendor game ids don't agree cross-source.
    const attrs = diffAttrs(hl, `game:${g.awayTeam.id}/${g.homeTeam.id}`, "game-score-line");
    return `<div${attrs}>
      <span class="${aClass}">${esc(nickname(g.awayTeam.name))} ${aScore}</span>, <span class="${hClass}">${esc(nickname(g.homeTeam.name))} ${hScore}</span>${status}
    </div>`;
  }).join("");
  return `<div class="games-section">
  <div class="games-section-title">Yesterday's Results</div>
  <div class="games-grid">${lines}</div>
</div>`;
}

// ─── Today's Games ──────────────────────────────────────────────────────

function timeInET(iso: string): string {
  if (!iso) return "TBD";
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    // ET suffix so readers don't have to guess. statsapi convention is
    // wall-clock in the home stadium's timezone, but boxscore.email
    // normalizes to ET — calling it out avoids surprise for west-coast
    // subscribers.
    return `${fmt.format(new Date(iso))} ET`;
  } catch {
    return "TBD";
  }
}

function renderTodaysGames(
  games: MlbGame[],
  teamRecords: Map<string, string>,
  hl?: HighlightMap,
): string {
  if (games.length === 0) return "";
  // Probable pitcher format mirrors the production digest:
  //   "LastName (W-L, ERA)" when both are known
  //   "LastName (W-L)"       when ERA is missing
  //   "LastName (ERA)"       when W-L is missing (rare)
  //   "LastName"             when no stats yet
  //   "TBD"                  when no pitcher named
  const probable = (p: import("../types").MlbProbablePitcher | null): string => {
    if (!p) return "TBD";
    const parts: string[] = [esc(lastName(p.fullName))];
    const detail: string[] = [];
    if (p.wins != null && p.losses != null) {
      detail.push(`${p.wins}-${p.losses}`);
    }
    if (p.era != null && Number.isFinite(p.era)) {
      detail.push(p.era.toFixed(2));
    }
    if (detail.length > 0) parts.push(`(${detail.join(", ")})`);
    return parts.join(" ");
  };
  const teamWithRecord = (teamName: string, teamId: string): string => {
    const tlaName = esc(tla(teamName));
    const record = teamRecords.get(teamId);
    if (!record) return tlaName;
    return `${tlaName} <span class="game-record">(${esc(record)})</span>`;
  };
  const lines = games.map((g) => {
    const detail = g.statusDetail || "";
    const isOff = detail === "Postponed" || detail === "Cancelled" || detail === "Suspended"
                || g.status === "postponed" || g.status === "cancelled" || g.status === "suspended";
    const right = isOff ? (detail || g.status) : timeInET(g.startTime);
    const matchup = `${teamWithRecord(g.awayTeam.name, g.awayTeam.id)} @ ${teamWithRecord(g.homeTeam.name, g.homeTeam.id)}`;
    const pitchers = `${probable(g.awayProbablePitcher)} vs ${probable(g.homeProbablePitcher)}`;
    const attrs = diffAttrs(hl, `nextDay:${g.awayTeam.id}/${g.homeTeam.id}`, "game-upcoming");
    return `<div${attrs}>
      <div class="game-score-line">
        <span class="game-matchup">${matchup}</span>
        <span class="game-time">${esc(right)}</span>
      </div>
      <div class="game-pitchers probable">${pitchers}</div>
    </div>`;
  }).join("");
  return `<div class="games-section">
  <div class="games-section-title">Today's Games</div>
  <div class="games-grid games-grid-upcoming">${lines}</div>
</div>`;
}

// ─── Box scores ─────────────────────────────────────────────────────────

function renderGames(data: CanonicalDailyData, hl?: HighlightMap): string {
  const completed = data.games.filter((g) => g.status === "final" && data.boxScores.has(g.id));
  return `<div class="boxscores-container">
${completed.map((g) => renderGame(g, data.boxScores.get(g.id)!, data.scoringPlays.get(g.id) ?? [], hl)).join("")}
</div>`;
}

function renderAllStarGame(data: CanonicalDailyData, hl?: HighlightMap): string {
  const asg = data.games.find((g) => g.gameType === "all-star");
  if (!asg) return "";
  const box = data.boxScores.get(asg.id);
  if (!box) return "";
  return `<div class="boxscores-title">All-Star Game</div>
<p class="all-star-note">Stats don't count toward season totals.</p>
<div class="boxscores-container">
${renderGame(asg, box, data.scoringPlays.get(asg.id) ?? [], hl)}
</div>`;
}

function inningCellWidth(innings: MlbInningLine[]): number {
  let w = 1;
  for (const inn of innings) {
    const av = inn.awayRuns ?? 0;
    const hv = inn.homeRuns ?? 0;
    w = Math.max(w, String(av).length, String(hv).length);
  }
  return w;
}

const MAX_INNINGS_INLINE = 12;
const EXTRAS_THRESHOLD = 13;

function inningGroups(innings: MlbInningLine[], side: "away" | "home"): string {
  const digits = innings.slice(0, MAX_INNINGS_INLINE).map((inn) => {
    const v = side === "away" ? inn.awayRuns : inn.homeRuns;
    return v == null ? "x" : String(v);
  });
  const padTo = Math.max(9, Math.ceil(digits.length / 3) * 3);
  while (digits.length < padTo) digits.push("");
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 3) {
    const cells = digits.slice(i, i + 3)
      .map((d) => `<span class="inn">${esc(d)}</span>`)
      .join("");
    groups.push(`<span class="inn-grp">${cells}</span>`);
  }
  return groups.join("");
}

function rheCells(...vals: Array<number | null | undefined>): string {
  const cells = vals
    .map((v) => `<span class="rhe">${v == null ? "—" : esc(v)}</span>`)
    .join("");
  return `<span class="rhe-grp">${cells}</span>`;
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

// Same normalizer as diff.ts; duplicated to keep the renderer dependency-
// free of the diff layer. If they ever drift, the box-row highlights stop
// matching — covered by the SxS preview's visual feedback.
function normalizeName(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+jr\b/g, " jr")
    .replace(/\s+sr\b/g, " sr")
    .replace(/\s+/g, " ")
    .trim();
}

function renderGame(game: MlbGame, box: MlbBoxScore, scoring: MlbScoringPlay[], hl?: HighlightMap): string {
  // Match key from diff.ts diffBoxScores. Canonical-slug team pair, no
  // game-id dependency, so it lines up across vendor renders.
  const bkey = `box:${box.away.team.id}/${box.home.team.id}`;
  const aScore = game.awayScore ?? 0;
  const hScore = game.homeScore ?? 0;
  const innings = game.innings;

  const winnerFirst = hScore >= aScore
    ? `${nicknameHtml(game.homeTeam.name)} ${hScore}, ${nicknameHtml(game.awayTeam.name)} ${aScore}`
    : `${nicknameHtml(game.awayTeam.name)} ${aScore}, ${nicknameHtml(game.homeTeam.name)} ${hScore}`;

  const w = inningCellWidth(innings);
  const extras = innings.length > 9;
  const scoreClass = `team-score${w > 1 ? " bigInning" : ""}${extras ? " has-extras" : ""}`;
  const aCells = `${inningGroups(innings, "away")}<span class="sep">—</span>${rheCells(game.awayScore, game.awayHits, game.awayErrors)}`;
  const hCells = `${inningGroups(innings, "home")}<span class="sep">—</span>${rheCells(game.homeScore, game.homeHits, game.homeErrors)}`;

  // Decision-pitcher labels include the pitcher's season W-L (for W/L)
  // or save total (for Sv) when the canonical box carries it. Lookup is
  // by player id in either team's pitcher list — covers home/away
  // without the caller having to know which side the pitcher belongs to.
  const findPitcherSeason = (id: string) => {
    for (const team of [box.away, box.home]) {
      for (const p of team.pitchers) {
        if (p.player.id === id && p.seasonPitching) return p.seasonPitching;
      }
    }
    return null;
  };
  const fmtDecision = (label: string, pitcher: MlbPlayerRef, kind: "wl" | "sv"): string => {
    const name = lastNameLinkWeb(pitcher);
    const s = findPitcherSeason(pitcher.id);
    let suffix = "";
    if (s) {
      if (kind === "wl" && s.wins != null && s.losses != null) {
        suffix = ` (${s.wins}-${s.losses})`;
      } else if (kind === "sv" && s.saves != null) {
        suffix = ` (${s.saves})`;
      }
    }
    return `<b>${label}:</b> ${name}${suffix}`;
  };
  const d = game.decisions;
  const decisionParts = [
    d?.winner && fmtDecision("W",  d.winner, "wl"),
    d?.loser  && fmtDecision("L",  d.loser,  "wl"),
    d?.save   && fmtDecision("Sv", d.save,   "sv"),
  ].filter(Boolean).join(" · ");

  const infoOrder = ["Umpires", "Weather", "T", "Att"];
  const infoMap = new Map(box.info.map((i) => [i.label, i.value ?? ""]));
  const info = infoOrder
    .filter((label) => infoMap.has(label))
    .map((label) => `<b>${esc(label)}:</b> ${esc(infoMap.get(label) ?? "")}`)
    .join(" ");

  return `<div class="game-container">
  <div class="game-header">${winnerFirst}</div>
  <div class="team-line">
    <div class="team-name">${esc(tla(game.awayTeam.name))}</div>
    <div class="${scoreClass}">${aCells}</div>
  </div>
  <div class="team-line">
    <div class="team-name">${esc(tla(game.homeTeam.name))}</div>
    <div class="${scoreClass}">${hCells}</div>
  </div>
  ${innings.length >= EXTRAS_THRESHOLD ? `<div class="notes"><b>Extras:</b> Game ended in the ${ordinal(innings.length)} — see Scoring for details.</div>` : ""}
  ${decisionParts ? `<div class="notes">${decisionParts}</div>` : ""}

  ${renderBatting(box.away, city(game.awayTeam.name), bkey, "away", hl)}
  ${renderBatting(box.home, city(game.homeTeam.name), bkey, "home", hl)}
  ${renderPitching(box.away, city(game.awayTeam.name), bkey, "away", hl)}
  ${renderPitching(box.home, city(game.homeTeam.name), bkey, "home", hl)}

  ${renderScoringNotes(scoring)}
  ${info ? `<div class="notes">${info}</div>` : ""}
</div>`;
}

function renderBatting(team: MlbBoxTeam, cityName: string, bkey?: string, side?: "away" | "home", hl?: HighlightMap): string {
  // Production renderer iterates team.batters (player IDs) and looks each
  // up in team.players. Canonical stores batters as the player array
  // directly, in display order — same iteration.
  const ordered = team.batters;

  const rows = ordered.map((p) => {
    const b = p.batting;
    if (!b) return "";
    if (b.atBats == null && b.baseOnBalls == null && b.strikeOuts == null && b.hits == null) return "";
    const pos = (p.allPositionsAbbr && p.allPositionsAbbr.length > 0
      ? p.allPositionsAbbr.join("-")
      : p.positionAbbr).toLowerCase();
    const avg = fmtAvg(p.seasonBatting?.battingAverage ?? null);
    const ops = fmtOps(p.seasonBatting?.ops ?? null);
    const playerCls = p.isStarter ? "player-col" : "player-col is-sub";
    const rowAttrs = (bkey && side)
      ? diffAttrs(hl, `${bkey}:${side}:batters:${normalizeName(p.player.fullName)}`)
      : "";
    return `<tr${rowAttrs}>
      <td class="${playerCls}">${lastNameLinkWeb(p.player)} ${esc(pos)}</td>
      <td class="stat-col">${pad(b.atBats)}</td>
      <td class="r-col">${pad(b.runs)}</td>
      <td class="stat-col">${pad(b.hits)}</td>
      <td class="stat-col">${pad(b.rbi)}</td>
      <td class="stat-col">${pad(b.baseOnBalls)}</td>
      <td class="stat-col">${pad(b.strikeOuts)}</td>
      <td class="avg-col">${avg}</td>
      <td class="ops-col">${ops}</td>
    </tr>`;
  }).join("");

  const ts = team.totals;
  const totalsAttrs = (bkey && side) ? diffAttrs(hl, `${bkey}:${side}:totals`) : "";
  const totals = `<tr${totalsAttrs}>
    <td class="player-col">Totals</td>
    <td class="stat-col">${pad(ts.atBats)}</td>
    <td class="r-col">${pad(ts.runs)}</td>
    <td class="stat-col">${pad(ts.hits)}</td>
    <td class="stat-col">${pad(ts.rbi)}</td>
    <td class="stat-col">${pad(ts.baseOnBalls)}</td>
    <td class="stat-col">${pad(ts.strikeOuts)}</td>
    <td class="avg-col"></td>
    <td class="ops-col"></td>
  </tr>`;

  const extras = hittingExtras(ordered, team.pitchers);
  return `<table class="batting-table">
    <thead>
      <tr>
        <th class="player-col">${esc(cityName)}</th>
        <th class="stat-col">AB</th>
        <th class="r-col">R</th>
        <th class="stat-col">H</th>
        <th class="stat-col">RBI</th>
        <th class="stat-col">BB</th>
        <th class="stat-col">SO</th>
        <th class="avg-col">Avg</th>
        <th class="ops-col">OPS</th>
      </tr>
    </thead>
    <tbody>${rows}${totals}</tbody>
  </table>
  ${extras ? `<div class="notes">${extras}</div>` : ""}`;
}

function hittingExtras(batters: MlbBoxPlayer[], pitchers: MlbBoxPlayer[]): string {
  type Bucket = { last: string; count: number; season: number };
  const cat = { "2B": [] as Bucket[], "3B": [] as Bucket[], HR: [] as Bucket[], SB: [] as Bucket[], RBI: [] as Bucket[], E: [] as Bucket[] };
  // One entry per player-stat combo. Multi-count games render as
  // "Perez 4 (26)"; singles as "Perez (26)" (newspaper convention).
  const push = (bucket: Bucket[], name: string, gameCount: number, seasonTotal: number) => {
    if (gameCount <= 0) return;
    bucket.push({ last: name, count: gameCount, season: seasonTotal });
  };
  for (const p of batters) {
    const b = p.batting;
    if (!b) continue;
    const s = p.seasonBatting;
    const name = lastName(p.player.fullName);
    push(cat["2B"], name, b.doubles,     s?.doubles     ?? 0);
    push(cat["3B"], name, b.triples,     s?.triples     ?? 0);
    push(cat.HR,   name, b.homeRuns,     s?.homeRuns    ?? 0);
    push(cat.SB,   name, b.stolenBases,  s?.stolenBases ?? 0);
    push(cat.RBI,  name, b.rbi,          s?.rbi         ?? 0);
  }
  // Errors come from anyone who took the field. Union batters + pitchers
  // and dedupe by player id so two-way players (Ohtani) aren't counted
  // twice, but AL pitchers who didn't bat still surface here.
  const seen = new Set<string>();
  for (const p of [...batters, ...pitchers]) {
    if (p.errors === 0) continue;
    const key = p.player.id;
    if (seen.has(key)) continue;
    seen.add(key);
    push(cat.E, lastName(p.player.fullName), p.errors, p.seasonErrors);
  }
  const parts: string[] = [];
  for (const [label, list] of Object.entries(cat)) {
    if (list.length === 0) continue;
    const names = list.map((p) =>
      p.count > 1 ? `${esc(p.last)} ${p.count} (${p.season})` : `${esc(p.last)} (${p.season})`,
    ).join(", ");
    parts.push(`<b>${label}:</b> ${names}.`);
  }
  return parts.join(" ");
}

function renderPitching(team: MlbBoxTeam, cityName: string, bkey?: string, side?: "away" | "home", hl?: HighlightMap): string {
  const ordered = team.pitchers;
  const rows = ordered.map((p) => {
    const pi = p.pitching;
    if (!pi) return "";
    const era = fmtEra(p.seasonPitching?.era ?? null);
    const note = pi.decisionNote ? ` <span class="pitcher-note">${esc(pi.decisionNote)}</span>` : "";
    const rowAttrs = (bkey && side)
      ? diffAttrs(hl, `${bkey}:${side}:pitchers:${normalizeName(p.player.fullName)}`)
      : "";
    return `<tr${rowAttrs}>
      <td class="player-col">${lastNameLinkWeb(p.player)}${note}</td>
      <td class="ip-col">${esc(fmtIp(pi.inningsPitched))}</td>
      <td class="stat-col">${pad(pi.hits)}</td>
      <td class="stat-col">${pad(pi.runs)}</td>
      <td class="stat-col">${pad(pi.earnedRuns)}</td>
      <td class="stat-col">${pad(pi.baseOnBalls)}</td>
      <td class="stat-col">${pad(pi.strikeOuts)}</td>
      <td class="stat-col">${pad(pi.homeRuns)}</td>
      <td class="stat-col">${pad(pi.battersFaced)}</td>
      <td class="era-col">${era}</td>
    </tr>`;
  }).join("");

  const extras = pitchingExtras(ordered);
  return `<table class="pitching-table">
    <thead>
      <tr>
        <th class="player-col">${esc(cityName)}</th>
        <th class="ip-col">IP</th>
        <th class="stat-col">H</th>
        <th class="stat-col">R</th>
        <th class="stat-col">ER</th>
        <th class="stat-col">BB</th>
        <th class="stat-col">K</th>
        <th class="stat-col">HR</th>
        <th class="stat-col">BF</th>
        <th class="era-col">ERA</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  ${extras ? `<div class="notes">${extras}</div>` : ""}`;
}

function pitchingExtras(players: MlbBoxPlayer[]): string {
  type Row = { last: string; p: number; s: number };
  const rows: Row[] = [];
  for (const p of players) {
    const pi = p.pitching;
    if (!pi) continue;
    const pitches = pi.pitchesThrown ?? 0;
    if (pitches === 0) continue;
    rows.push({ last: lastName(p.player.fullName), p: pitches, s: pi.strikes ?? 0 });
  }
  if (rows.length === 0) return "";
  const pcst = rows.map((r) => `${esc(r.last)} (${r.s}-${r.p})`).join(", ");
  return `<b>ST-PC:</b> ${pcst}.`;
}

function renderScoringNotes(plays: MlbScoringPlay[]): string {
  if (plays.length === 0) return "";
  const items = plays.map((p) => {
    const arrow = p.half === "top" ? "▲" : "▼";
    const inn = `${arrow}${p.inning}`;
    const score = `${p.awayScore}-${p.homeScore}`;
    return `<div><span class="inn">${inn} ${score}</span> <span class="ev">${esc(p.description)}</span></div>`;
  }).join("");
  return `<div class="scoring-block">
    <div class="scoring-h">Scoring Plays</div>
    ${items}
  </div>`;
}
