// Email-safe renderer for the daily digest.
//
// Approach: CSS classes defined once in EMAIL_STYLES (injected into <head> by
// the wrapping template). Cells use HTML attributes (align, cellpadding) for
// Outlook compatibility. Inline styles only where unavoidable. ~3-4× smaller
// than the all-inline version.
//
// Section order (per Jeff, 2026-05-14):
//   1. Dateline
//   2. American League — division standings + wild card
//   3. National League — division standings + wild card
//   4. Leaders — two-column (AL left, NL right)
//   5. Box scores — full, stacked
//
// Output of renderEmailContent() is body content only. The caller wraps with
// email chrome (preamble, unsubscribe footer) and is responsible for adding
// EMAIL_STYLES into the document <head>.

import type {
  ScheduleGame, ScoringPlay,
  DivisionStandings, BoxTeam, BoxPlayer,
  WildCardLeagueStandings,
} from "./mlb";
import type { DailyData, GameDetail, LeaderGroup } from "./render";

// ─── styles ───────────────────────────────────────────────────────────────

export const EMAIL_STYLES = `
  .es * { box-sizing: border-box; }
  .es { font-family: Georgia, 'Times New Roman', Times, serif; color: #161410; }
  .es a { color: inherit; }

  .es-dateline {
    border-top: 3px double #161410; border-bottom: 1px solid #161410;
    padding: 8px 0; margin: 0 0 14px; text-align: center;
    font-size: 24px; font-style: italic; font-weight: 800; letter-spacing: -0.005em;
  }
  .es-section-h {
    font-size: 20px; font-weight: 800; letter-spacing: 0.01em;
    margin: 22px 0 6px; padding-bottom: 4px;
    border-bottom: 2px solid #161410;
  }
  .es-sub-h {
    font-size: 13px; font-weight: 700;
    margin: 10px 0 2px; padding-bottom: 2px;
    border-bottom: 1px solid #161410;
  }
  .es-game-h {
    font-size: 16px; font-weight: 700;
    margin: 14px 0 4px; padding-bottom: 3px;
    border-bottom: 1px solid #161410;
  }
  .es-col-h {
    font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.08em;
    margin: 0 0 4px; padding-bottom: 2px;
    border-bottom: 1px solid #161410; color: #6a6354;
  }
  .es-team-label {
    font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.04em;
    margin: 6px 0 2px;
  }
  .es-scoring-h {
    font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.04em;
    margin: 0 0 2px;
  }

  .es-table { width: 100%; border-collapse: collapse; margin: 0 0 4px; }
  .es-table th, .es-table td { font-size: 12px; padding: 1px 3px; }
  .es-table th {
    font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.04em;
    padding-bottom: 3px; border-bottom: 1px solid #161410;
  }
  .es-totals td { font-weight: 700; border-top: 1px solid #161410; }
  .es-cutoff td { border-top: 2px dashed #161410; }
  .es-fixed { table-layout: fixed; }
  .es-mut { color: #6a6354; font-size: 11px; }

  .es-team-line { font-size: 13px; font-weight: 700; padding: 1px 0; }
  .es-score-line { font-family: 'Courier New', Courier, monospace; font-size: 13px; white-space: pre; }

  .es-note { font-size: 12px; margin: 4px 0; padding-top: 4px; border-top: 1px solid #161410; }
  .es-info { font-size: 11px; font-style: italic; color: #6a6354; margin: 6px 0 0; padding-top: 4px; border-top: 1px dotted #e8e2d4; }
  .es-info b { font-style: normal; color: #2a2620; }

  .es-scoring-block { margin: 6px 0 0; padding-top: 4px; border-top: 1px solid #161410; }
  .es-scoring p { font-size: 12px; line-height: 1.35; margin: 1px 0; }
  .es-scoring .inn { font-weight: 700; }
  .es-scoring .ev { font-style: italic; }

  .es-leaders-cols { width: 100%; border-collapse: collapse; }
  .es-leaders-cols > tbody > tr > td { vertical-align: top; padding: 0 6px; }
  .es-leaders-cols > tbody > tr > td:first-child { padding-left: 0; padding-right: 12px; }
  .es-leaders-cols > tbody > tr > td:last-child { padding-right: 0; padding-left: 12px; }

  .es-game { margin-top: 18px; padding-top: 6px; border-top: 1px solid #c4baa5; }
`;

// ─── data ────────────────────────────────────────────────────────────────

const DIVISIONS = {
  AL: [
    { id: 201, name: "East" },
    { id: 202, name: "Central" },
    { id: 200, name: "West" },
  ],
  NL: [
    { id: 204, name: "East" },
    { id: 205, name: "Central" },
    { id: 203, name: "West" },
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

const city = (n: string) => CITY_OF[n] ?? n;
const nickname = (n: string) => NICKNAME_OF[n] ?? n;

const esc = (s: string | number | undefined): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const pad = (n: number | undefined) => (n == null ? "—" : String(n));
// Pad to 2-char width for inning-line R/H/E columns so 1- and 2-digit values
// line up cleanly in the monospace score line.
const padRhe = (n: number | undefined) => (n == null ? " —" : String(n).padStart(2));
const fmtAvg = (s: string | undefined) =>
  !s || s === "-.--" ? ".---" : s.replace(/^0/, "");
const fmtEra = (s: string | undefined) =>
  !s || s === "-.--" ? "—" : s;
const fmtDiff = (scored: number | undefined, allowed: number | undefined) => {
  if (scored == null || allowed == null) return "—";
  const d = scored - allowed;
  return d > 0 ? `+${d}` : d < 0 ? String(d) : "0";
};
const lastName = (full: string) => {
  const parts = full.split(/\s+/);
  const suf = new Set(["Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV"]);
  let i = parts.length - 1;
  while (i > 0 && suf.has(parts[i] ?? "")) i--;
  return parts[i] ?? full;
};

// ─── building blocks ──────────────────────────────────────────────────────

const dateline = (pretty: string) =>
  `<div class="es-dateline">${esc(pretty)}</div>`;

const sectionH = (t: string) => `<h2 class="es-section-h">${esc(t)}</h2>`;
const subH = (t: string) => `<h3 class="es-sub-h">${esc(t)}</h3>`;
const gameH = (t: string) => `<h3 class="es-game-h">${esc(t)}</h3>`;
const colH = (t: string) => `<div class="es-col-h">${esc(t)}</div>`;

// ─── standings + wildcard ─────────────────────────────────────────────────

function standingsTableHead(): string {
  return `<thead><tr>
    <th align="left">Team</th>
    <th align="right">W</th>
    <th align="right">L</th>
    <th align="right">Pct</th>
    <th align="right">GB</th>
    <th align="right">Diff</th>
    <th align="right">Home</th>
    <th align="right">Away</th>
    <th align="right">L10</th>
    <th align="right">Strk</th>
  </tr></thead>`;
}

function standingsRow(
  r: {
    nickname: string; wins: number; losses: number; pct: string;
    gb: string; diff: string; home: string; away: string; l10: string; strk: string;
  },
  rowClass = "",
): string {
  const cls = rowClass ? ` class="${rowClass}"` : "";
  return `<tr${cls}>
    <td align="left">${esc(r.nickname)}</td>
    <td align="right">${r.wins}</td>
    <td align="right">${r.losses}</td>
    <td align="right">${esc(r.pct)}</td>
    <td align="right">${esc(r.gb)}</td>
    <td align="right">${esc(r.diff)}</td>
    <td align="right">${esc(r.home)}</td>
    <td align="right">${esc(r.away)}</td>
    <td align="right">${esc(r.l10)}</td>
    <td align="right">${esc(r.strk)}</td>
  </tr>`;
}

function renderDivisionStandings(label: string, d: DivisionStandings): string {
  const rows = [...d.teamRecords]
    .sort((a, b) => Number(a.divisionRank) - Number(b.divisionRank))
    .map((t) => {
      const home = t.records?.splitRecords?.find((s) => s.type === "home");
      const away = t.records?.splitRecords?.find((s) => s.type === "away");
      const l10 = t.records?.splitRecords?.find((s) => s.type === "lastTen");
      return standingsRow({
        nickname: nickname(t.team.name),
        wins: t.wins, losses: t.losses,
        pct: t.leagueRecord.pct.replace(/^0/, ""),
        gb: t.gamesBack,
        diff: fmtDiff(t.runsScored, t.runsAllowed),
        home: home ? `${home.wins}-${home.losses}` : "—",
        away: away ? `${away.wins}-${away.losses}` : "—",
        l10: l10 ? `${l10.wins}-${l10.losses}` : "—",
        strk: t.streak?.streakCode ?? "—",
      });
    }).join("");
  return `${subH(label + " Division")}
    <table class="es-table" cellpadding="0" cellspacing="0" border="0">
      ${standingsTableHead()}
      <tbody>${rows}</tbody>
    </table>`;
}

function renderWildCard(wc: WildCardLeagueStandings): string {
  const sorted = [...wc.teamRecords].sort(
    (a, b) => Number(a.wildCardRank ?? 99) - Number(b.wildCardRank ?? 99),
  );
  const minTeams = 6;
  let cutoff = Math.min(minTeams, sorted.length);
  const last = sorted[cutoff - 1];
  while (cutoff < sorted.length) {
    const n = sorted[cutoff];
    if (n && last && n.wins === last.wins && n.losses === last.losses) cutoff++;
    else break;
  }
  const rows = sorted.slice(0, cutoff).map((t, i) => {
    const home = t.records?.splitRecords?.find((s) => s.type === "home");
    const away = t.records?.splitRecords?.find((s) => s.type === "away");
    const l10 = t.records?.splitRecords?.find((s) => s.type === "lastTen");
    return standingsRow({
      nickname: nickname(t.team.name),
      wins: t.wins, losses: t.losses,
      pct: t.leagueRecord.pct.replace(/^0/, ""),
      gb: t.wildCardGamesBack ?? "—",
      diff: fmtDiff(t.runsScored, t.runsAllowed),
      home: home ? `${home.wins}-${home.losses}` : "—",
      away: away ? `${away.wins}-${away.losses}` : "—",
      l10: l10 ? `${l10.wins}-${l10.losses}` : "—",
      strk: t.streak?.streakCode ?? "—",
    }, i === 3 ? "es-cutoff" : "");
  }).join("");
  return `${subH("Wild Card")}
    <table class="es-table" cellpadding="0" cellspacing="0" border="0">
      ${standingsTableHead()}
      <tbody>${rows}</tbody>
    </table>`;
}

function renderLeagueStandings(label: string, key: "AL" | "NL", data: DailyData): string {
  const divs = DIVISIONS[key];
  const standingsHtml = divs.map((d) => {
    const rec = data.standings.find((r) => r.division.id === d.id);
    return rec ? renderDivisionStandings(d.name, rec) : "";
  }).join("");
  // Wild card intentionally omitted in email — keeps the email tighter; the
  // full wild card race is still on the web.
  return `${sectionH(label)}${standingsHtml}`;
}

// ─── leaders (two columns: AL, NL) ────────────────────────────────────────

function renderLeaderCategory(g: LeaderGroup): string {
  const rows = g.rows.map((L) =>
    `<tr>
      <td align="left">${L.rank}. ${esc(lastName(L.person.fullName))}, ${esc(nickname(L.team?.name ?? ""))}</td>
      <td align="right">${esc(L.value)}</td>
    </tr>`
  ).join("");
  return `${subH(g.label)}
    <table class="es-table" cellpadding="0" cellspacing="0" border="0">
      <tbody>${rows}</tbody>
    </table>`;
}

function renderLeadersColumn(leagueLabel: string, groups: LeaderGroup[]): string {
  return `${colH(leagueLabel)}${groups.map(renderLeaderCategory).join("")}`;
}

function renderLeaders(data: DailyData): string {
  return `${sectionH("Leaders")}
    <table class="es-leaders-cols" cellpadding="0" cellspacing="0" border="0">
      <tbody><tr>
        <td width="50%">${renderLeadersColumn("American League", data.leaders.AL)}</td>
        <td width="50%">${renderLeadersColumn("National League", data.leaders.NL)}</td>
      </tr></tbody>
    </table>`;
}

// ─── boxscores ────────────────────────────────────────────────────────────

function inningCellWidth(
  innings: NonNullable<ScheduleGame["linescore"]>["innings"],
): number {
  let w = 1;
  for (const inn of innings) {
    const av = inn.away?.runs ?? 0;
    const hv = inn.home?.runs ?? 0;
    w = Math.max(w, String(av).length, String(hv).length);
  }
  return w;
}

function inningGroups(
  innings: NonNullable<ScheduleGame["linescore"]>["innings"],
  side: "away" | "home",
  width: number,
): string {
  const digits = innings.map((inn) => {
    const v = side === "away" ? inn.away?.runs : inn.home?.runs;
    const s = v == null ? "x" : String(v);
    return s.padStart(width);
  });
  const reg = digits.slice(0, 9);
  while (reg.length < 9) reg.push(" ".repeat(width));
  const groups = [reg.slice(0, 3).join(""), reg.slice(3, 6).join(""), reg.slice(6, 9).join("")];
  const extras = digits.slice(9);
  return groups.join(" ") + (extras.length ? " " + extras.join(" ") : "");
}

function renderInningLine(team: string, line: string): string {
  return `<tr>
    <td align="left" class="es-team-line">${esc(team)}</td>
    <td align="right" class="es-score-line">${esc(line)}</td>
  </tr>`;
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
      <td align="left">${esc(lastName(p.person.fullName))} <span class="es-mut">${esc(pos)}</span></td>
      <td align="right">${pad(b.atBats)}</td>
      <td align="right">${pad(b.runs)}</td>
      <td align="right">${pad(b.hits)}</td>
      <td align="right">${pad(b.rbi)}</td>
      <td align="right">${pad(b.baseOnBalls)}</td>
      <td align="right">${pad(b.strikeOuts)}</td>
      <td align="right">${avg}</td>
    </tr>`;
  }).join("");
  const ts = team.teamStats.batting;
  const totals = `<tr class="es-totals">
    <td align="left">Totals</td>
    <td align="right">${pad(ts.atBats)}</td>
    <td align="right">${pad(ts.runs)}</td>
    <td align="right">${pad(ts.hits)}</td>
    <td align="right">${pad(ts.rbi)}</td>
    <td align="right">${pad(ts.baseOnBalls)}</td>
    <td align="right">${pad(ts.strikeOuts)}</td>
    <td></td>
  </tr>`;
  return `<div class="es-team-label">${esc(cityName)} Batting</div>
    <table class="es-table es-fixed" cellpadding="0" cellspacing="0" border="0">
      <colgroup>
        <col width="38%"><col width="8%"><col width="8%"><col width="8%">
        <col width="8%"><col width="8%"><col width="8%"><col width="14%">
      </colgroup>
      <thead><tr>
        <th align="left">Batter</th>
        <th align="right">AB</th>
        <th align="right">R</th>
        <th align="right">H</th>
        <th align="right">BI</th>
        <th align="right">BB</th>
        <th align="right">SO</th>
        <th align="right">Avg</th>
      </tr></thead>
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
    return `<tr>
      <td align="left">${esc(lastName(p.person.fullName))}</td>
      <td align="right">${esc(pi.inningsPitched ?? "-")}</td>
      <td align="right">${pad(pi.hits)}</td>
      <td align="right">${pad(pi.runs)}</td>
      <td align="right">${pad(pi.earnedRuns)}</td>
      <td align="right">${pad(pi.baseOnBalls)}</td>
      <td align="right">${pad(pi.strikeOuts)}</td>
      <td align="right">${era}</td>
    </tr>`;
  }).join("");
  return `<div class="es-team-label">${esc(cityName)} Pitching</div>
    <table class="es-table es-fixed" cellpadding="0" cellspacing="0" border="0">
      <colgroup>
        <col width="38%"><col width="10%"><col width="7%"><col width="7%">
        <col width="7%"><col width="7%"><col width="7%"><col width="17%">
      </colgroup>
      <thead><tr>
        <th align="left">Pitcher</th>
        <th align="right">IP</th>
        <th align="right">H</th>
        <th align="right">R</th>
        <th align="right">ER</th>
        <th align="right">BB</th>
        <th align="right">SO</th>
        <th align="right">ERA</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderScoring(plays: ScoringPlay[]): string {
  if (plays.length === 0) return "";
  const items = plays.map((p) => {
    const arrow = p.halfInning === "top" ? "▲" : "▼";
    const inn = `${arrow}${p.inning}`;
    const score = `${p.awayScore}-${p.homeScore}`;
    return `<p><span class="inn">${inn} ${score}</span> <span class="ev">${esc(p.description)}</span></p>`;
  }).join("");
  return `<div class="es-scoring-block es-scoring">
    <div class="es-scoring-h">Scoring</div>
    ${items}
  </div>`;
}

function renderGame({ game, box, scoring }: Required<GameDetail>): string {
  const a = game.teams.away, h = game.teams.home;
  const aScore = a.score ?? 0, hScore = h.score ?? 0;
  const winnerFirst = hScore >= aScore
    ? `${nickname(h.team.name)} ${hScore}, ${nickname(a.team.name)} ${aScore}`
    : `${nickname(a.team.name)} ${aScore}, ${nickname(h.team.name)} ${hScore}`;
  const innings = game.linescore?.innings ?? [];
  const ls = game.linescore?.teams;
  const w = inningCellWidth(innings);
  const aLine = `${inningGroups(innings, "away", w)}  —  ${padRhe(ls?.away.runs)}  ${padRhe(ls?.away.hits)}  ${padRhe(ls?.away.errors)}`;
  const hLine = `${inningGroups(innings, "home", w)}  —  ${padRhe(ls?.home.runs)}  ${padRhe(ls?.home.hits)}  ${padRhe(ls?.home.errors)}`;
  const d = game.decisions;
  const decisionLine = [
    d?.winner && `<b>W:</b> ${esc(lastName(d.winner.fullName))}`,
    d?.loser && `<b>L:</b> ${esc(lastName(d.loser.fullName))}`,
    d?.save && `<b>Sv:</b> ${esc(lastName(d.save.fullName))}`,
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");
  // Scoring plays + umpires/weather/T/A are intentionally omitted in email
  // to save vertical space. Both remain on the web.
  void scoring;

  return `<div class="es-game">
    ${gameH(winnerFirst)}
    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      <tbody>
        ${renderInningLine(city(a.team.name), aLine)}
        ${renderInningLine(city(h.team.name), hLine)}
      </tbody>
    </table>
    ${decisionLine ? `<p class="es-note">${decisionLine}</p>` : ""}
    ${renderBatting(box.teams.away, city(a.team.name))}
    ${renderBatting(box.teams.home, city(h.team.name))}
    ${renderPitching(box.teams.away, city(a.team.name))}
    ${renderPitching(box.teams.home, city(h.team.name))}
  </div>`;
}

function renderBoxScores(games: GameDetail[]): string {
  const completed = games.filter((g) => g.game.status.codedGameState === "F" && g.box);
  if (completed.length === 0) return "";
  return `${sectionH("Box Scores")}
    ${completed.map((g) => renderGame(g as Required<GameDetail>)).join("")}`;
}

// ─── entry ────────────────────────────────────────────────────────────────

export function renderEmailContent(data: DailyData): string {
  return `<div class="es">
${dateline(data.prettyDate)}
${renderLeagueStandings("American League", "AL", data)}
${renderLeagueStandings("National League", "NL", data)}
${renderLeaders(data)}
${renderBoxScores(data.games)}
</div>`;
}
