import type {
  ScheduleGame, Boxscore, ScoringPlay,
  DivisionStandings, Leader, BoxTeam, BoxPlayer,
  WildCardLeagueStandings, Transaction,
} from "./mlb";
import type { DigestMode } from "./digest-mode";
import { findTeamByMlbApiId } from "./teams";
import { prevDay, nextDay, prettyDate, issueNumber, volumeNumber } from "./dates";
import { lastName } from "./names";
import { lastNameLinkWeb } from "./player-links";

// Re-exported for backwards compatibility with any caller that imports
// lastName from "./render". New code should import from "./names" directly.
export { lastName };

export type GameDetail = {
  game: ScheduleGame;
  box?: Boxscore;
  scoring?: ScoringPlay[];
};

export type LeaderGroup = { label: string; rows: Leader[]; valueLabel: string };

export type UpcomingGame = {
  gamePk: number;
  awayName: string;
  homeName: string;
  // MLB API team IDs — used to look up records in the standings table by ID
  // rather than name, since the schedule and standings endpoints sometimes
  // disagree on the exact string ("Athletics" vs "Oakland Athletics", or
  // city-only vs full name on certain teams).
  awayTeamId?: number;
  homeTeamId?: number;
  // Full name of probable pitcher; renderer applies lastName() formatting.
  awayProbable?: string;
  homeProbable?: string;
  // Season W-L for each probable pitcher, pre-formatted ("4-2").
  awayProbableRecord?: string;
  homeProbableRecord?: string;
  // Season ERA as MLB returns it (e.g. "3.42"); null if unavailable yet.
  awayProbableEra?: string | null;
  homeProbableEra?: string | null;
  startTime: string;  // already formatted in ET, e.g. "7:05 PM" or "TBD"
  status: string;     // detailedState, e.g. "Scheduled", "Postponed"
};

export type DailyData = {
  date: string;
  prettyDate: string;
  mode: DigestMode;
  games: GameDetail[];
  standings: DivisionStandings[];
  wildCard: WildCardLeagueStandings[];
  leaders: { AL: LeaderGroup[]; NL: LeaderGroup[] };
  todaysGames: UpcomingGame[];
  // Live id/name→abbreviation map built from /v1/teams at fetch time. Falls
  // back to the static TLA_OF for older cache rows that didn't capture it.
  teamAbbrev: Record<string, string>;
  // Roster moves for the digest's date (signings, trades, IL, DFA, rehab,
  // etc.). Pre-formatted by MLB as human-readable sentences.
  transactions: Transaction[];
};

const DIVISIONS = {
  AL: [
    { id: 201, name: "East Division" },
    { id: 202, name: "Central Division" },
    { id: 200, name: "West Division" },
  ],
  NL: [
    { id: 204, name: "East Division" },
    { id: 205, name: "Central Division" },
    { id: 203, name: "West Division" },
  ],
} as const;

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

// Standard MLB three-letter abbreviations. Used in dense lists (leaders) where
// "Reds" reads cleaner as "CIN". MLB's /v1/stats/leaders only returns the
// team's full name; a static map is the cheapest correct path since the team
// set is stable.
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

// Shorter team nicknames for the dense newsprint (.paper-mode) view, where
// nicknames sit in narrow 4-column boxscore tiles and longer names like
// "Diamondbacks" wrap. Keep this map sparse — only entries that visibly
// wrap need a short form. The default (non-paper) view always shows the
// full nickname.
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

const city = (name: string): string => CITY_OF[name] ?? name;
const nickname = (name: string): string => NICKNAME_OF[name] ?? name;

// Emit pre-escaped HTML for a team's game-header nickname. When a paper-mode
// abbreviation exists, both forms ship in the markup and CSS swaps which one
// is visible. When there's no abbreviation, returns the bare escaped nickname.
function nicknameHtml(teamName: string): string {
  const full = nickname(teamName);
  const short = PAPER_NICKNAME_OF[full];
  if (!short) return esc(full);
  return `<span class="nick-full">${esc(full)}</span><span class="nick-short">${esc(short)}</span>`;
}
// Live → static fallback. Pass the current map from DailyData when rendering.
const tla = (name: string, live?: Record<string, string>): string =>
  live?.[name] ?? TLA_OF[name] ?? name;

export const esc = (s: string | number | undefined): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const pad = (n: number | undefined): string => (n == null ? "—" : String(n));
export const fmtAvg = (s: string | undefined): string =>
  !s || s === "-.--" ? ".---" : s.replace(/^0/, "");
// OPS shares AVG's display rule: strip a leading "0." into ".xxx" so the
// number is wider only when it actually crosses 1.000 ("1.234"), saving a
// character in the common case.
export const fmtOps = (s: string | undefined): string =>
  !s || s === "-.--" ? ".---" : s.replace(/^0/, "");
export const fmtEra = (s: string | undefined): string =>
  !s || s === "-.--" ? "—" : s;

const fmtDiff = (scored: number | undefined, allowed: number | undefined): string => {
  if (scored == null || allowed == null) return "—";
  const d = scored - allowed;
  if (d > 0) return `+${d}`;
  if (d < 0) return `${d}`;
  return "0";
};


// team.id → "W-L" for the Today's Games matchup row. ID-keyed because the
// schedule and standings endpoints don't always agree on team.name strings.
function buildTeamRecordMap(standings: DivisionStandings[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const div of standings) {
    for (const tr of div.teamRecords) {
      out.set(tr.team.id, `${tr.wins}-${tr.losses}`);
    }
  }
  return out;
}

export function renderContent(data: DailyData): string {
  // League digests live at /mlb/{edition_date}. data.date is games_date,
  // so editionDate = games_date + 1.
  const editionDate = nextDay(data.date);
  const datelineOpts = {
    volume: volumeNumber(editionDate),
    issue: issueNumber(editionDate),
  };
  const teamRecords = buildTeamRecordMap(data.standings);

  if (data.mode === "no-games") {
    return `${renderDateline(prettyDate(nextDay(data.date)), datelineOpts)}

<p class="no-games-note">No games yesterday.</p>

${renderTodaysGames(data.todaysGames, data.teamAbbrev, teamRecords)}

${renderTransactions(data.transactions)}`;
  }

  if (data.mode === "all-star") {
    return `${renderDateline(prettyDate(nextDay(data.date)), datelineOpts)}

<div class="edition-subtitle">All-Star Game Edition</div>

<div class="section">
  ${renderAllStarLeague("American League", 103, data)}
</div>

<div class="section">
  ${renderAllStarLeague("National League", 104, data)}
</div>

${renderTodaysGames(data.todaysGames, data.teamAbbrev, teamRecords)}

${renderAllStarGame(data.games, data.teamAbbrev)}

${renderTransactions(data.transactions)}`;
  }

  return `${renderDateline(prettyDate(nextDay(data.date)), datelineOpts)}

<div class="section">
  ${renderLeague("American League", 103, data)}
</div>

<div class="section">
  ${renderLeague("National League", 104, data)}
</div>

${renderSchedule(data.games)}

${renderTodaysGames(data.todaysGames, data.teamAbbrev, teamRecords)}

<div class="boxscores-title">Yesterday's Box Scores</div>
${renderGames(data.games, data.teamAbbrev)}

${renderTransactions(data.transactions)}`;
}

export function renderTransactions(txs: Transaction[]): string {
  if (txs.length === 0) return "";
  const items = txs
    .map((t) => `<li><span class="tx-type">${esc(t.typeDesc)}</span> ${esc(t.description)}</li>`)
    .join("");
  return `<div class="transactions-section">
  <div class="boxscores-title">Transactions</div>
  <ul class="transactions-list">${items}</ul>
</div>`;
}


export function renderDateline(
  pretty: string,
  opts: { volume?: number; issue?: number } = {},
): string {
  // Day-nav arrows were removed once the date-header dropdown calendar
  // shipped — the calendar covers the same navigation with richer context.
  const counter = opts.volume && opts.issue
    ? `<div class="dateline-issue-no">Vol. ${opts.volume}, Issue ${opts.issue}</div>`
    : "";
  return `<div class="dateline"><div class="dateline-row"><span class="dateline-text">${esc(pretty)}</span></div>${counter}</div>`;
}

function renderLeague(label: string, leagueId: 103 | 104, data: DailyData, leaderLimit = 5): string {
  const key: "AL" | "NL" = leagueId === 103 ? "AL" : "NL";
  const divs = DIVISIONS[key];
  const standingsHtml = divs.map((d) => {
    const rec = data.standings.find((r) => r.division.id === d.id);
    // Team-name links in standings go to /mlb/{slug}/{editionDate};
    // data.date is games_date so shift +1 for the URL.
    return rec ? renderDivisionTable(d.name, rec, { date: nextDay(data.date) }) : "";
  }).join("");
  const wcRecord = data.wildCard.find((r) => r.league.id === leagueId);
  const wildCardHtml = wcRecord ? renderWildCardTable(wcRecord, { date: nextDay(data.date) }) : "";
  const leadersHtml = renderLeagueLeaders(data.leaders[key], data.teamAbbrev, leaderLimit);
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

function renderWildCardTable(
  wc: WildCardLeagueStandings,
  opts: { date?: string } = {},
): string {
  const sorted = [...wc.teamRecords]
    .sort((a, b) => Number(a.wildCardRank ?? 99) - Number(b.wildCardRank ?? 99));
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
    const home = t.records?.splitRecords?.find((s) => s.type === "home");
    const away = t.records?.splitRecords?.find((s) => s.type === "away");
    const l10 = t.records?.splitRecords?.find((s) => s.type === "lastTen");
    const cutoffClass = i === 3 ? " wc-cutoff" : "";
    // Same team-link treatment as the division standings above — opt in via
    // opts.date so the All-Star wildcard (which doesn't carry a date) stays
    // unlinked, matching renderAllStarDivisionTable.
    const slug = findTeamByMlbApiId(t.team.id)?.slug;
    const name = esc(nickname(t.team.name));
    const teamHref = slug && opts.date ? `/mlb/${slug}/${opts.date}` : null;
    const teamCell = teamHref
      ? `<a class="team-link" href="${teamHref}">${name}</a>`
      : name;
    return `<tr class="${cutoffClass.trim()}">
      <td class="team-col">${teamCell}</td>
      <td class="w-col">${t.wins}</td>
      <td class="l-col">${t.losses}</td>
      <td class="pct-col">${esc(t.leagueRecord.pct).replace(/^0/, "")}</td>
      <td class="gb-col">${esc(t.wildCardGamesBack ?? "—")}</td>
      <td class="diff-col">${fmtDiff(t.runsScored, t.runsAllowed)}</td>
      <td class="rec-col">${home ? home.wins + "-" + home.losses : "—"}</td>
      <td class="rec-col">${away ? away.wins + "-" + away.losses : "—"}</td>
      <td class="rec-col">${l10 ? l10.wins + "-" + l10.losses : "—"}</td>
      <td class="strk-col">${esc(t.streak?.streakCode ?? "—")}</td>
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

export function renderDivisionTable(
  label: string,
  d: DivisionStandings,
  opts: { date?: string } = {},
): string {
  const rows = [...d.teamRecords]
    .sort((a, b) => Number(a.divisionRank) - Number(b.divisionRank))
    .map((t) => {
      const home = t.records?.splitRecords?.find((s) => s.type === "home");
      const away = t.records?.splitRecords?.find((s) => s.type === "away");
      const l10 = t.records?.splitRecords?.find((s) => s.type === "lastTen");
      // Each team name links to its standalone digest page. Click-through
      // carries the current page's date when present so clicking a team
      // from /mlb/2025-08-15 lands on /mlb/{slug}/2025-08-15, not the
      // team's most-recent (which would jump you forward in time).
      const slug = findTeamByMlbApiId(t.team.id)?.slug;
      const name = esc(nickname(t.team.name));
      const teamHref = slug
        ? `/mlb/${slug}${opts.date ? `/${opts.date}` : ""}`
        : null;
      const teamCell = teamHref
        ? `<a class="team-link" href="${teamHref}">${name}</a>`
        : name;
      return `<tr>
        <td class="team-col">${teamCell}</td>
        <td class="w-col">${t.wins}</td>
        <td class="l-col">${t.losses}</td>
        <td class="pct-col">${esc(t.leagueRecord.pct).replace(/^0/, "")}</td>
        <td class="gb-col">${esc(t.gamesBack)}</td>
        <td class="diff-col">${fmtDiff(t.runsScored, t.runsAllowed)}</td>
        <td class="rec-col">${home ? home.wins + "-" + home.losses : "—"}</td>
        <td class="rec-col">${away ? away.wins + "-" + away.losses : "—"}</td>
        <td class="rec-col">${l10 ? l10.wins + "-" + l10.losses : "—"}</td>
        <td class="strk-col">${esc(t.streak?.streakCode ?? "—")}</td>
      </tr>`;
    }).join("");
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

function renderAllStarDivisionTable(label: string, d: DivisionStandings): string {
  const rec = (
    splits: Array<{ type: string; wins: number; losses: number }> | undefined,
    type: string,
  ): string => {
    const s = splits?.find((x) => x.type === type);
    return s ? `${s.wins}-${s.losses}` : "—";
  };
  const rows = [...d.teamRecords]
    .sort((a, b) => Number(a.divisionRank) - Number(b.divisionRank))
    .map((t) => {
      const sr = t.records?.splitRecords;
      return `<tr>
        <td class="team-col">${esc(nickname(t.team.name))}</td>
        <td class="w-col">${t.wins}</td>
        <td class="l-col">${t.losses}</td>
        <td class="pct-col">${esc(t.leagueRecord.pct).replace(/^0/, "")}</td>
        <td class="gb-col">${esc(t.gamesBack)}</td>
        <td class="gb-col">${esc(t.wildCardGamesBack ?? "—")}</td>
        <td class="rec-col">${rec(sr, "extraInning")}</td>
        <td class="rec-col">${rec(sr, "oneRun")}</td>
        <td class="rec-col">${rec(sr, "day")}</td>
        <td class="rec-col">${rec(sr, "night")}</td>
        <td class="rec-col">${rec(sr, "grass")}</td>
        <td class="rec-col">${rec(sr, "turf")}</td>
        <td class="rec-col">${rec(sr, "east")}</td>
        <td class="rec-col">${rec(sr, "central")}</td>
        <td class="rec-col">${rec(sr, "west")}</td>
        <td class="rec-col">${rec(sr, "interLeague")}</td>
      </tr>`;
    }).join("");
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

// Extend the cutoff through any tie with the last visible player. E.g. if the
// 5th-ranked player shares rank=5 with the 6th and 7th, all three show. Stops
// at the first player whose rank exceeds the last-included rank. Bounded by
// the underlying fetch size (currently 20 — see fetchLeadersRaw in daily.ts).
export function leadersThroughTies<T extends { rank: number }>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) return rows;
  let cutoff = limit;
  const lastRank = rows[cutoff - 1]!.rank;
  while (cutoff < rows.length && rows[cutoff]!.rank === lastRank) cutoff++;
  return rows.slice(0, cutoff);
}

function renderAllStarLeaders(groups: LeaderGroup[], liveAbbrev: Record<string, string>): string {
  const cards = groups.map((g) => {
    const rows = leadersThroughTies(g.rows, 15).map((L) => `
      <tr>
        <td class="player-col">${L.rank}. ${lastNameLinkWeb(L.person)}, ${esc(tla(L.team?.name ?? "", liveAbbrev))}</td>
        <td>${esc(L.value)}</td>
      </tr>`).join("");
    return `<div class="leaders-section">
<div class="stats-subheader">${esc(g.label)}</div>
<table class="leaders-table">
  <thead><tr><th class="player-col">Player</th><th>${esc(g.valueLabel)}</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</div>`;
  }).join("");
  return `<div class="asg-leaders-grid">${cards}</div>`;
}

function renderAllStarLeague(label: string, leagueId: 103 | 104, data: DailyData): string {
  const key: "AL" | "NL" = leagueId === 103 ? "AL" : "NL";
  const divs = DIVISIONS[key];
  const standingsHtml = divs.map((d) => {
    const rec = data.standings.find((r) => r.division.id === d.id);
    return rec ? renderAllStarDivisionTable(d.name, rec) : "";
  }).join("");
  const wcRecord = data.wildCard.find((r) => r.league.id === leagueId);
  const wildCardHtml = wcRecord ? renderWildCardTable(wcRecord) : "";
  const leadersHtml = renderAllStarLeaders(data.leaders[key], data.teamAbbrev);
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

function renderLeagueLeaders(groups: LeaderGroup[], liveAbbrev: Record<string, string>, limit = 5): string {
  const cards = groups.map((g) => {
    const rows = leadersThroughTies(g.rows, limit).map((L) => `
      <tr>
        <td class="player-col">${L.rank}. ${lastNameLinkWeb(L.person)}, ${esc(tla(L.team?.name ?? "", liveAbbrev))}</td>
        <td>${esc(L.value)}</td>
      </tr>`).join("");
    return `<div class="leaders-section">
<div class="stats-subheader">${esc(g.label)}</div>
<table class="leaders-table">
  <thead><tr><th class="player-col">Player</th><th>${esc(g.valueLabel)}</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</div>`;
  }).join("");
  return `<div class="leaders-cols">${cards}</div>`;
}

function renderSchedule(games: GameDetail[]): string {
  const lines = games.map(({ game }) => {
    const a = game.teams.away, h = game.teams.home;
    const aScore = a.score ?? 0, hScore = h.score ?? 0;
    const aClass = aScore > hScore ? "winner" : "";
    const hClass = hScore > aScore ? "winner" : "";
    const status = game.status.detailedState === "Final" ? "" : ` <span style="color:var(--text-muted)">(${esc(game.status.detailedState)})</span>`;
    return `<div class="game-score-line">
      <span class="${aClass}">${esc(nickname(a.team.name))} ${aScore}</span>, <span class="${hClass}">${esc(nickname(h.team.name))} ${hScore}</span>${status}
    </div>`;
  }).join("");
  return `<div class="games-section">
  <div class="games-section-title">Yesterday's Results</div>
  <div class="games-grid">${lines}</div>
</div>`;
}

function renderTodaysGames(
  games: UpcomingGame[],
  liveAbbrev: Record<string, string>,
  teamRecords: Map<number, string>,
): string {
  if (games.length === 0) return "";
  const probable = (full?: string, record?: string, era?: string | null) => {
    if (!full) return "TBD";
    const parts: string[] = [esc(lastName(full))];
    const detail: string[] = [];
    if (record) detail.push(esc(record));
    if (era && era !== "-.--" && era !== "—") detail.push(esc(era));
    if (detail.length > 0) parts.push(`(${detail.join(", ")})`);
    return parts.join(" ");
  };
  // Team abbreviation + W-L. parens stay non-bold even though the surrounding
  // matchup span is bold. .game-record CSS resets weight to 400.
  const teamWithRecord = (name: string, teamId: number | undefined) => {
    const tlaName = esc(tla(name, liveAbbrev));
    const record = teamId != null ? teamRecords.get(teamId) : undefined;
    if (!record) return tlaName;
    return `${tlaName} <span class="game-record">(${esc(record)})</span>`;
  };
  const lines = games.map((g) => {
    const isOff = g.status === "Postponed" || g.status === "Cancelled" || g.status === "Suspended";
    const right = isOff ? g.status : g.startTime;
    const matchup = `${teamWithRecord(g.awayName, g.awayTeamId)} @ ${teamWithRecord(g.homeName, g.homeTeamId)}`;
    const pitchers = `${probable(g.awayProbable, g.awayProbableRecord, g.awayProbableEra)} vs ${probable(g.homeProbable, g.homeProbableRecord, g.homeProbableEra)}`;
    return `<div class="game-upcoming">
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

function renderGames(games: GameDetail[], liveAbbrev: Record<string, string>): string {
  const completed = games.filter((g) => g.game.status.codedGameState === "F" && g.box);
  return `<div class="boxscores-container">
${completed.map((g) => renderGame(g as Required<GameDetail>, liveAbbrev)).join("")}
</div>`;
}

function renderAllStarGame(games: GameDetail[], liveAbbrev: Record<string, string>): string {
  const asg = games.find((g) => g.game.gameType === "A");
  if (!asg || !asg.box) return "";
  return `<div class="boxscores-title">All-Star Game</div>
<p class="all-star-note">Stats don't count toward season totals.</p>
<div class="boxscores-container">
${renderGame(asg as Required<GameDetail>, liveAbbrev)}
</div>`;
}

type InningsArray = Array<{ away?: { runs?: number }; home?: { runs?: number } }>;

// Use the widest digit across both teams' innings so columns stay aligned within
// a game, without paying for 2-char padding on the common all-single-digit case.
function inningCellWidth(innings: InningsArray): number {
  let w = 1;
  for (const inn of innings) {
    const av = inn.away?.runs ?? 0;
    const hv = inn.home?.runs ?? 0;
    w = Math.max(w, String(av).length, String(hv).length);
  }
  return w;
}

// Web caps inline display at 12 innings (vs email's 19) to fit the narrower
// box-score column. Past 12, the "Extras: Game ended in the Nth" note + the
// per-play Scoring section cover the detail.
const MAX_INNINGS_INLINE = 12;
const EXTRAS_THRESHOLD = 13;

// Each inning becomes its own CSS-grid cell so alignment no longer depends on
// the body font's figure-space or "x" glyph advance widths (Source Sans 3 on
// Mac/Chrome renders both narrower than tnum digits, drifting the scoreline
// between rows). Groups of 3 wrap in .inn-grp so column-gap creates the
// visual spacing between thirds.
function inningGroups(innings: InningsArray, side: "away" | "home"): string {
  const digits = innings.slice(0, MAX_INNINGS_INLINE).map((inn) => {
    const v = side === "away" ? inn.away?.runs : inn.home?.runs;
    return v == null ? "x" : String(v);
  });
  // Pad to >=9 cells and round up to a multiple of 3 so every group has 3.
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

function rheCells(...vals: Array<number | undefined>): string {
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

export function renderGame({ game, box, scoring }: Required<GameDetail>, liveAbbrev: Record<string, string>): string {
  const a = game.teams.away, h = game.teams.home;
  const aScore = a.score ?? 0, hScore = h.score ?? 0;
  const innings = game.linescore?.innings ?? [];
  const ls = game.linescore?.teams;

  // Pre-escaped HTML so the paper-mode nickname span markup survives intact.
  const winnerFirst = hScore >= aScore
    ? `${nicknameHtml(h.team.name)} ${hScore}, ${nicknameHtml(a.team.name)} ${aScore}`
    : `${nicknameHtml(a.team.name)} ${aScore}, ${nicknameHtml(h.team.name)} ${hScore}`;

  const w = inningCellWidth(innings);
  const extras = innings.length > 9;
  // Grid scoreline. Class flags drive cell widths: .bigInning widens each
  // inning cell to 2ch when any frame had 10+ runs; .has-extras adds one more
  // inn-grp on either side without changing column widths.
  const scoreClass = `team-score${w > 1 ? " bigInning" : ""}${extras ? " has-extras" : ""}`;
  const aCells = `${inningGroups(innings, "away")}<span class="sep">—</span>${rheCells(ls?.away.runs, ls?.away.hits, ls?.away.errors)}`;
  const hCells = `${inningGroups(innings, "home")}<span class="sep">—</span>${rheCells(ls?.home.runs, ls?.home.hits, ls?.home.errors)}`;

  const d = game.decisions;
  const decisionParts = [
    d?.winner && `<b>W:</b> ${lastNameLinkWeb(d.winner)}`,
    d?.loser && `<b>L:</b> ${lastNameLinkWeb(d.loser)}`,
    d?.save && `<b>Sv:</b> ${lastNameLinkWeb(d.save)}`,
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
    <div class="team-name">${esc(tla(a.team.name, liveAbbrev))}</div>
    <div class="${scoreClass}">${aCells}</div>
  </div>
  <div class="team-line">
    <div class="team-name">${esc(tla(h.team.name, liveAbbrev))}</div>
    <div class="${scoreClass}">${hCells}</div>
  </div>
  ${innings.length >= EXTRAS_THRESHOLD ? `<div class="notes"><b>Extras:</b> Game ended in the ${ordinal(innings.length)} — see Scoring for details.</div>` : ""}
  ${decisionParts ? `<div class="notes">${decisionParts}</div>` : ""}

  ${renderBatting(box.teams.away, city(a.team.name))}
  ${renderBatting(box.teams.home, city(h.team.name))}
  ${renderPitching(box.teams.away, city(a.team.name))}
  ${renderPitching(box.teams.home, city(h.team.name))}

  ${renderScoringNotes(scoring)}
  ${info ? `<div class="notes">${info}</div>` : ""}
</div>`;
}

function renderBatting(team: BoxTeam, cityName: string): string {
  const ordered = team.batters
    .map((id) => team.players[`ID${id}`])
    .filter((p): p is BoxPlayer => !!p);

  const rows = ordered.map((p) => {
    const b = p.stats.batting;
    if (b.atBats == null && b.baseOnBalls == null && b.strikeOuts == null && b.hits == null) return "";
    const pos = (p.allPositions?.map((x) => x.abbreviation).join("-") ?? p.position.abbreviation).toLowerCase();
    const avg = fmtAvg(p.seasonStats.batting.avg);
    const ops = fmtOps(p.seasonStats.batting.ops);
    const isStarter = !!p.battingOrder && p.battingOrder.endsWith("00");
    const playerCls = isStarter ? "player-col" : "player-col is-sub";
    return `<tr>
      <td class="${playerCls}">${lastNameLinkWeb(p.person)} ${esc(pos)}</td>
      <td class="stat-col">${pad(b.atBats)}</td>
      <td class="r-col">${pad(b.runs)}</td>
      <td class="stat-col">${pad(b.hits)}</td>
      <td class="stat-col">${pad(b.rbi)}</td>
      <td class="stat-col">${pad(b.baseOnBalls)}</td>
      <td class="stat-col">${pad(b.strikeOuts)}</td>
      <td class="ops-col">${ops}</td>
      <td class="avg-col">${avg}</td>
    </tr>`;
  }).join("");

  const ts = team.teamStats.batting;
  const totals = `<tr>
    <td class="player-col">Totals</td>
    <td class="stat-col">${pad(ts.atBats)}</td>
    <td class="r-col">${pad(ts.runs)}</td>
    <td class="stat-col">${pad(ts.hits)}</td>
    <td class="stat-col">${pad(ts.rbi)}</td>
    <td class="stat-col">${pad(ts.baseOnBalls)}</td>
    <td class="stat-col">${pad(ts.strikeOuts)}</td>
    <td class="ops-col"></td>
    <td class="avg-col"></td>
  </tr>`;

  const extras = hittingExtras(ordered);
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
        <th class="ops-col">OPS</th>
        <th class="avg-col">Avg</th>
      </tr>
    </thead>
    <tbody>${rows}${totals}</tbody>
  </table>
  ${extras ? `<div class="notes">${extras}</div>` : ""}`;
}

function hittingExtras(players: BoxPlayer[]): string {
  type Bucket = { last: string; count: number; season: number };
  const cat = { "2B": [] as Bucket[], "3B": [] as Bucket[], HR: [] as Bucket[], SB: [] as Bucket[] };
  // One entry per player-stat combo. Multi-count games render as
  // "Alvarez 2 (20)"; singles as "Alvarez (20)" (newspaper convention).
  const push = (bucket: Bucket[], name: string, gameCount: number, seasonTotal: number) => {
    if (gameCount <= 0) return;
    bucket.push({ last: name, count: gameCount, season: seasonTotal });
  };
  for (const p of players) {
    const b = p.stats.batting;
    const s = p.seasonStats.batting;
    const name = lastName(p.person.fullName);
    push(cat["2B"], name, b.doubles ?? 0, s.doubles ?? 0);
    push(cat["3B"], name, b.triples ?? 0, s.triples ?? 0);
    push(cat.HR, name, b.homeRuns ?? 0, s.homeRuns ?? 0);
    push(cat.SB, name, b.stolenBases ?? 0, s.stolenBases ?? 0);
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

function renderPitching(team: BoxTeam, cityName: string): string {
  const ordered = team.pitchers
    .map((id) => team.players[`ID${id}`])
    .filter((p): p is BoxPlayer => !!p);

  const rows = ordered.map((p) => {
    const pi = p.stats.pitching;
    const era = fmtEra(p.seasonStats.pitching.era);
    // MLB pre-formats decision notes like "(W, 2-1)", "(L, 0-3)", "(S, 7)",
    // "(H, 4)", "(BS, 2)" on each pitcher's game stats. Render alongside the
    // name when present so readers see who got the win/loss/save/hold inline.
    const note = pi.note ? ` <span class="pitcher-note">${esc(pi.note)}</span>` : "";
    return `<tr>
      <td class="player-col">${lastNameLinkWeb(p.person)}${note}</td>
      <td class="ip-col">${esc(pi.inningsPitched ?? "-")}</td>
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

function pitchingExtras(players: BoxPlayer[]): string {
  type Row = { last: string; p: number; s: number };
  const rows: Row[] = [];
  for (const p of players) {
    const pi = p.stats.pitching;
    const pitches = pi.pitchesThrown ?? pi.numberOfPitches ?? 0;
    if (pitches === 0) continue;
    rows.push({
      last: lastName(p.person.fullName),
      p: pitches,
      s: pi.strikes ?? 0,
    });
  }
  if (rows.length === 0) return "";
  const pcst = rows.map((r) => `${esc(r.last)} (${r.s}-${r.p})`).join(", ");
  return `<b>ST-PC:</b> ${pcst}.`;
}

function renderScoringNotes(plays: ScoringPlay[]): string {
  if (plays.length === 0) return "";
  const items = plays.map((p) => {
    const arrow = p.halfInning === "top" ? "▲" : "▼";
    const inn = `${arrow}${p.inning}`;
    const score = `${p.awayScore}-${p.homeScore}`;
    return `<div><span class="inn">${inn} ${score}</span> <span class="ev">${esc(p.description)}</span></div>`;
  }).join("");
  return `<div class="scoring-block">
    <div class="scoring-h">Scoring Plays</div>
    ${items}
  </div>`;
}
