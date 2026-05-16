import type {
  ScheduleGame, Boxscore, ScoringPlay,
  DivisionStandings, Leader, BoxTeam, BoxPlayer,
  WildCardLeagueStandings, Transaction,
} from "./mlb";

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
  // Full name of probable pitcher; renderer applies lastName() formatting.
  awayProbable?: string;
  homeProbable?: string;
  // Season W-L for each probable pitcher, pre-formatted ("4-2").
  awayProbableRecord?: string;
  homeProbableRecord?: string;
  startTime: string;  // already formatted in ET, e.g. "7:05 PM" or "TBD"
  status: string;     // detailedState, e.g. "Scheduled", "Postponed"
};

export type DailyData = {
  date: string;
  prettyDate: string;
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

const city = (name: string): string => CITY_OF[name] ?? name;
const nickname = (name: string): string => NICKNAME_OF[name] ?? name;
// Live → static fallback. Pass the current map from DailyData when rendering.
const tla = (name: string, live?: Record<string, string>): string =>
  live?.[name] ?? TLA_OF[name] ?? name;

const esc = (s: string | number | undefined): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const pad = (n: number | undefined): string => (n == null ? "—" : String(n));
const fmtAvg = (s: string | undefined): string =>
  !s || s === "-.--" ? ".---" : s.replace(/^0/, "");
const fmtEra = (s: string | undefined): string =>
  !s || s === "-.--" ? "—" : s;

const fmtDiff = (scored: number | undefined, allowed: number | undefined): string => {
  if (scored == null || allowed == null) return "—";
  const d = scored - allowed;
  if (d > 0) return `+${d}`;
  if (d < 0) return `${d}`;
  return "0";
};

const lastName = (full: string): string => {
  const parts = full.split(/\s+/);
  const suffixes = new Set(["Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV"]);
  let i = parts.length - 1;
  while (i > 0 && suffixes.has(parts[i] ?? "")) i--;
  return parts[i] ?? full;
};

export function renderContent(data: DailyData): string {
  return `${renderDateline(data.prettyDate)}

<div class="section">
  ${renderLeague("American League", 103, data)}
</div>

<div class="section">
  ${renderLeague("National League", 104, data)}
</div>

${renderSchedule(data.games)}

${renderTodaysGames(data.todaysGames, data.teamAbbrev)}

<div class="boxscores-title">Yesterday's Box Scores</div>
${renderGames(data.games, data.teamAbbrev)}

${renderTransactions(data.transactions)}`;
}

function renderTransactions(txs: Transaction[]): string {
  if (txs.length === 0) return "";
  const items = txs
    .map((t) => `<li><span class="tx-type">${esc(t.typeDesc)}</span> ${esc(t.description)}</li>`)
    .join("");
  return `<div class="transactions-section">
  <div class="boxscores-title">Transactions</div>
  <ul class="transactions-list">${items}</ul>
</div>`;
}


function renderDateline(pretty: string): string {
  return `<div class="dateline">${esc(pretty)}</div>`;
}

function renderLeague(label: string, leagueId: 103 | 104, data: DailyData): string {
  const key: "AL" | "NL" = leagueId === 103 ? "AL" : "NL";
  const divs = DIVISIONS[key];
  const standingsHtml = divs.map((d) => {
    const rec = data.standings.find((r) => r.division.id === d.id);
    return rec ? renderDivisionTable(d.name, rec) : "";
  }).join("");
  const wcRecord = data.wildCard.find((r) => r.league.id === leagueId);
  const wildCardHtml = wcRecord ? renderWildCardTable(wcRecord) : "";
  const leadersHtml = renderLeagueLeaders(data.leaders[key], data.teamAbbrev);
  void leagueId;
  return `<div class="league-band">
  <div class="league-name">${esc(label)}</div>
</div>
<div class="column-container">
  <div class="col-standings">
    <div class="boxscores-title">Standings</div>
    ${standingsHtml}
    ${wildCardHtml}
  </div>
  <div class="col-leaders">
    <div class="boxscores-title">Leaders</div>
    ${leadersHtml}
  </div>
</div>`;
}

function renderWildCardTable(wc: WildCardLeagueStandings): string {
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
    return `<tr class="${cutoffClass.trim()}">
      <td class="team-col">${esc(nickname(t.team.name))}</td>
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

function renderDivisionTable(label: string, d: DivisionStandings): string {
  const rows = [...d.teamRecords]
    .sort((a, b) => Number(a.divisionRank) - Number(b.divisionRank))
    .map((t) => {
      const home = t.records?.splitRecords?.find((s) => s.type === "home");
      const away = t.records?.splitRecords?.find((s) => s.type === "away");
      const l10 = t.records?.splitRecords?.find((s) => s.type === "lastTen");
      return `<tr>
        <td class="team-col">${esc(nickname(t.team.name))}</td>
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

function renderLeagueLeaders(groups: LeaderGroup[], liveAbbrev: Record<string, string>): string {
  const cards = groups.map((g) => {
    const rows = g.rows.map((L) => `
      <tr>
        <td class="player-col">${L.rank}. ${esc(lastName(L.person.fullName))}, ${esc(tla(L.team?.name ?? "", liveAbbrev))}</td>
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

function renderTodaysGames(games: UpcomingGame[], liveAbbrev: Record<string, string>): string {
  if (games.length === 0) return "";
  const probable = (full?: string, record?: string) => {
    if (!full) return "";
    const wl = record ? ` ${esc(record)}` : "";
    return ` <span class="probable">(${esc(lastName(full))}${wl})</span>`;
  };
  const lines = games.map((g) => {
    // MLB returns Postponed/Cancelled in detailedState; replace the time with
    // the status so the line still communicates what's happening.
    const isOff = g.status === "Postponed" || g.status === "Cancelled" || g.status === "Suspended";
    const right = isOff ? g.status : g.startTime;
    return `<div class="game-score-line">
      <span>${esc(tla(g.awayName, liveAbbrev))}${probable(g.awayProbable, g.awayProbableRecord)} @ ${esc(tla(g.homeName, liveAbbrev))}${probable(g.homeProbable, g.homeProbableRecord)}</span>
      <span class="game-time">${esc(right)}</span>
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

// U+2007 figure space is the same width as a digit in fonts with tabular
// numerals — lets us pad/separate scores cleanly in the proportional body
// font instead of falling back to a different (monospace) typeface.
const FIG_SPACE = "\u2007";

// Pad R/H/E to 2-char width so single- and double-digit values line up.
const padRhe = (n: number | undefined) =>
  n == null ? FIG_SPACE + "—" : String(n).padStart(2, FIG_SPACE);

function inningGroups(innings: InningsArray, side: "away" | "home", width: number): string {
  // Pad each digit cell with FIG_SPACE so " 1" and "15" align vertically when
  // one team has a 10-run inning. Use regular spaces *between* cells — they're
  // consistent within a line and narrower than digits, which keeps the whole
  // score line compact.
  const digits = innings.map((inn) => {
    const v = side === "away" ? inn.away?.runs : inn.home?.runs;
    const s = v == null ? "x" : String(v);
    return s.padStart(width, FIG_SPACE);
  });
  const reg = digits.slice(0, 9);
  while (reg.length < 9) reg.push(FIG_SPACE.repeat(width));
  const groups = [reg.slice(0, 3).join(" "), reg.slice(3, 6).join(" "), reg.slice(6, 9).join(" ")];
  const extras = digits.slice(9);
  return groups.join(" ") + (extras.length ? " " + extras.join(" ") : "");
}

function renderGame({ game, box, scoring }: Required<GameDetail>, liveAbbrev: Record<string, string>): string {
  const a = game.teams.away, h = game.teams.home;
  const aScore = a.score ?? 0, hScore = h.score ?? 0;
  const innings = game.linescore?.innings ?? [];
  const ls = game.linescore?.teams;

  const winnerFirst = hScore >= aScore
    ? `${nickname(h.team.name)} ${hScore}, ${nickname(a.team.name)} ${aScore}`
    : `${nickname(a.team.name)} ${aScore}, ${nickname(h.team.name)} ${hScore}`;

  const w = inningCellWidth(innings);
  const aLine = `${inningGroups(innings, "away", w)}  —  ${padRhe(ls?.away.runs)}  ${padRhe(ls?.away.hits)}  ${padRhe(ls?.away.errors)}`;
  const hLine = `${inningGroups(innings, "home", w)}  —  ${padRhe(ls?.home.runs)}  ${padRhe(ls?.home.hits)}  ${padRhe(ls?.home.errors)}`;

  const d = game.decisions;
  const decisionParts = [
    d?.winner && `<b>W:</b> ${esc(lastName(d.winner.fullName))}`,
    d?.loser && `<b>L:</b> ${esc(lastName(d.loser.fullName))}`,
    d?.save && `<b>Sv:</b> ${esc(lastName(d.save.fullName))}`,
  ].filter(Boolean).join(" · ");

  const infoOrder = ["Umpires", "Weather", "T", "Att"];
  const infoMap = new Map(box.info.map((i) => [i.label, i.value ?? ""]));
  const info = infoOrder
    .filter((label) => infoMap.has(label))
    .map((label) => `<b>${esc(label)}:</b> ${esc(infoMap.get(label) ?? "")}`)
    .join(" ");

  return `<div class="game-container">
  <div class="game-header">${esc(winnerFirst)}</div>
  <div class="team-line">
    <div class="team-name">${esc(tla(a.team.name, liveAbbrev))}</div>
    <div class="team-score">${aLine}</div>
  </div>
  <div class="team-line">
    <div class="team-name">${esc(tla(h.team.name, liveAbbrev))}</div>
    <div class="team-score">${hLine}</div>
  </div>

  ${renderBatting(box.teams.away, city(a.team.name))}
  ${renderBatting(box.teams.home, city(h.team.name))}
  ${renderPitching(box.teams.away, city(a.team.name))}
  ${renderPitching(box.teams.home, city(h.team.name))}

  ${decisionParts ? `<div class="notes">${decisionParts}</div>` : ""}
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
    return `<tr>
      <td class="player-col">${esc(lastName(p.person.fullName))} ${esc(pos)}</td>
      <td class="stat-col">${pad(b.atBats)}</td>
      <td class="stat-col">${pad(b.runs)}</td>
      <td class="stat-col">${pad(b.hits)}</td>
      <td class="stat-col">${pad(b.rbi)}</td>
      <td class="stat-col">${pad(b.baseOnBalls)}</td>
      <td class="stat-col">${pad(b.strikeOuts)}</td>
      <td class="avg-col">${avg}</td>
    </tr>`;
  }).join("");

  const ts = team.teamStats.batting;
  const totals = `<tr>
    <td class="player-col">Totals</td>
    <td class="stat-col">${pad(ts.atBats)}</td>
    <td class="stat-col">${pad(ts.runs)}</td>
    <td class="stat-col">${pad(ts.hits)}</td>
    <td class="stat-col">${pad(ts.rbi)}</td>
    <td class="stat-col">${pad(ts.baseOnBalls)}</td>
    <td class="stat-col">${pad(ts.strikeOuts)}</td>
    <td class="avg-col"></td>
  </tr>`;

  return `<table class="batting-table">
    <thead>
      <tr>
        <th class="player-col">${esc(cityName)}</th>
        <th class="stat-col">AB</th>
        <th class="stat-col">R</th>
        <th class="stat-col">H</th>
        <th class="stat-col">BI</th>
        <th class="stat-col">BB</th>
        <th class="stat-col">SO</th>
        <th class="avg-col">Avg</th>
      </tr>
    </thead>
    <tbody>${rows}${totals}</tbody>
  </table>`;
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
      <td class="player-col">${esc(lastName(p.person.fullName))}${note}</td>
      <td class="ip-col">${esc(pi.inningsPitched ?? "-")}</td>
      <td class="stat-col">${pad(pi.hits)}</td>
      <td class="stat-col">${pad(pi.runs)}</td>
      <td class="stat-col">${pad(pi.earnedRuns)}</td>
      <td class="stat-col">${pad(pi.baseOnBalls)}</td>
      <td class="stat-col">${pad(pi.strikeOuts)}</td>
      <td class="era-col">${era}</td>
    </tr>`;
  }).join("");

  return `<table class="pitching-table">
    <thead>
      <tr>
        <th class="player-col">${esc(cityName)}</th>
        <th class="ip-col">IP</th>
        <th class="stat-col">H</th>
        <th class="stat-col">R</th>
        <th class="stat-col">ER</th>
        <th class="stat-col">BB</th>
        <th class="stat-col">SO</th>
        <th class="era-col">ERA</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderScoringNotes(plays: ScoringPlay[]): string {
  if (plays.length === 0) return "";
  const items = plays.map((p) => {
    const arrow = p.halfInning === "top" ? "▲" : "▼";
    const inn = `${arrow}${p.inning}`;
    const score = `${p.awayScore}-${p.homeScore}`;
    return `<div><span class="inn">${inn} ${score}</span> <span class="ev">${esc(p.description)}</span></div>`;
  }).join("");
  return `<div class="scoring-block">${items}</div>`;
}
