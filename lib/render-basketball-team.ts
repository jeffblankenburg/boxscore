// Per-team NBA/WNBA digest renderer. One body builder → web + email, same as
// the league renderer (lib/render-basketball.ts), whose bb- classes + box-score
// block this reuses. Section order mirrors the MLB team digest
// (lib/render-team-email.ts): heading + record, standings, the team's game,
// team stat sheet, upcoming games, transactions — gated by the team's mode.

import type { BasketballTeamData, BasketballTeamPlayer } from "./basketball-team";
import type {
  BasketballScoreboardEvent,
  BasketballStandingsEntry,
  BasketballTransaction,
} from "./basketball";
import { renderGameBlock, initialLast, escapeHtml, teamNameLink, playerNameLink, txDateLabel } from "./render-basketball";
import { nextDay, prettyDate, timeInET, etDateFromISO } from "./dates";

// Stat formatters. Averages → 1 decimal; GP → integer; percentages → ".476"
// newspaper style (ESPN pct is 0–100). "—" for players yet to appear.
const fmt1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "—");
const fmtInt = (v: number) => (Number.isFinite(v) ? String(Math.round(v)) : "—");
const fmtPct = (v: number) => {
  if (!Number.isFinite(v)) return "—";
  const s = (v / 100).toFixed(3);
  return s.startsWith("0.") ? s.slice(1) : s;
};
type StatCol = { label: string; get: (s: Record<string, number>) => string };

// Per-game counting stats — matches the standard MLB "Team Statistics" table.
const PERGAME_COLUMNS: ReadonlyArray<StatCol> = [
  { label: "GP", get: (s) => fmtInt(s.gamesPlayed ?? NaN) },
  { label: "MIN", get: (s) => fmt1(s.avgMinutes ?? NaN) },
  { label: "PTS", get: (s) => fmt1(s.avgPoints ?? NaN) },
  { label: "REB", get: (s) => fmt1(s.avgRebounds ?? NaN) },
  { label: "AST", get: (s) => fmt1(s.avgAssists ?? NaN) },
  { label: "STL", get: (s) => fmt1(s.avgSteals ?? NaN) },
  { label: "BLK", get: (s) => fmt1(s.avgBlocks ?? NaN) },
  { label: "TO", get: (s) => fmt1(s.avgTurnovers ?? NaN) },
  { label: "PF", get: (s) => fmt1(s.avgFouls ?? NaN) },
];

// Shooting splits — the digest's second table, mirroring MLB's "Advanced
// Stats". Makes and attempts are separate per-game columns (FGM/FGA/FG% …),
// the standard basketball-stats layout — not a hyphenated "8.3-17.1" cell,
// which reads like a score.
const SHOOTING_COLUMNS: ReadonlyArray<StatCol> = [
  { label: "FGM", get: (s) => fmt1(s.avgFieldGoalsMade ?? NaN) },
  { label: "FGA", get: (s) => fmt1(s.avgFieldGoalsAttempted ?? NaN) },
  { label: "FG%", get: (s) => fmtPct(s.fieldGoalPct ?? NaN) },
  { label: "3PM", get: (s) => fmt1(s.avgThreePointFieldGoalsMade ?? NaN) },
  { label: "3PA", get: (s) => fmt1(s.avgThreePointFieldGoalsAttempted ?? NaN) },
  { label: "3P%", get: (s) => fmtPct(s.threePointFieldGoalPct ?? NaN) },
  { label: "FTM", get: (s) => fmt1(s.avgFreeThrowsMade ?? NaN) },
  { label: "FTA", get: (s) => fmt1(s.avgFreeThrowsAttempted ?? NaN) },
  { label: "FT%", get: (s) => fmtPct(s.freeThrowPct ?? NaN) },
];

const STANDINGS_COLUMNS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "wins", label: "W" },
  { key: "losses", label: "L" },
  { key: "winPercent", label: "PCT" },
  { key: "gamesBehind", label: "GB" },
  { key: "streak", label: "STRK" },
];

export function renderBasketballTeamContent(data: BasketballTeamData): string {
  return renderBody(data, true);
}

export function renderBasketballTeamEmailContent(data: BasketballTeamData): string {
  // Email dateline = the morning the email goes out (digest date + 1).
  return renderBody({ ...data, prettyDate: prettyDate(nextDay(data.date)) }, false);
}

// ---- Body -----------------------------------------------------------------

function renderBody(data: BasketballTeamData, web: boolean): string {
  const league = data.sport;
  const sections: string[] = [
    renderDateline(data.prettyDate),
    renderHeading(data),
    renderStandings(data, web, league),
  ];
  // The box score is game-specific — only on days the team played. But the
  // roster stat sheet is SEASON averages, meaningful every day, so it always
  // renders (this is where the NBA digest departs from MLB, which gates its
  // per-game stat sheet to game days).
  if (data.mode === "game") sections.push(renderGame(data, web, league));
  sections.push(
    renderRoster(data, web, league),
    renderUpcoming(data, web, league),
    renderTransactions(data.transactions),
  );
  return sections.filter((s) => s.length > 0).join("\n");
}

function renderDateline(pretty: string): string {
  return `<div class="bb-dateline"><div class="bb-dateline-text">${escapeHtml(pretty)}</div></div>`;
}

function renderHeading(data: BasketballTeamData): string {
  const rec = data.record ? ` <span class="bb-team-record">(${data.record.wins}-${data.record.losses})</span>` : "";
  return `<div class="bb-team-heading">${escapeHtml(data.team.name)}${rec}</div>`;
}

// ---- Standings (team's conference, team row highlighted) ------------------

function renderStandings(data: BasketballTeamData, web: boolean, league: BasketballTeamData["sport"]): string {
  if (!data.conference || data.conference.entries.length === 0) return "";
  const sorted = [...data.conference.entries].sort(
    (a, b) => (b.stats.winPercent?.value ?? 0) - (a.stats.winPercent?.value ?? 0),
  );
  const rows = sorted.map((e, i) => renderStandingsRow(e, i + 1, e.team.id === data.espnId, web, league)).join("");
  return `
<section class="bb-section">
  <h2 class="bb-section-title">${escapeHtml(data.conference.name)} Standings</h2>
  <table class="bb-standings-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <thead>
      <tr>
        <th class="bb-st-rank">#</th>
        <th class="bb-st-team">Team</th>
        ${STANDINGS_COLUMNS.map((c) => `<th class="bb-st-stat">${c.label}</th>`).join("")}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</section>
`.trim();
}

function renderStandingsRow(entry: BasketballStandingsEntry, rank: number, isMe: boolean, web: boolean, league: BasketballTeamData["sport"]): string {
  const cells = STANDINGS_COLUMNS.map((c) => {
    const stat = entry.stats[c.key];
    return `<td class="bb-st-stat">${escapeHtml(stat?.displayValue ?? "")}</td>`;
  }).join("");
  const cls = isMe ? ' class="bb-st-me"' : "";
  return `<tr${cls}><td class="bb-st-rank">${rank}</td><td class="bb-st-team">${teamNameLink(entry.team.name, web, league)}</td>${cells}</tr>`;
}

// ---- The team's game (full box score) -------------------------------------

function renderGame(data: BasketballTeamData, web: boolean, league: BasketballTeamData["sport"]): string {
  if (data.games.length === 0) return "";
  const blocks = data.games.map((g) => renderGameBlock(g.event, g.box, web, league)).join("\n");
  return `
<section class="bb-section">
  <h2 class="bb-section-title">${data.games.length > 1 ? "Latest Games" : "Latest Game"}</h2>
  ${blocks}
</section>
`.trim();
}

// ---- Team statistics (roster season averages) -----------------------------

function renderRoster(data: BasketballTeamData, web: boolean, league: BasketballTeamData["sport"]): string {
  if (data.roster.length === 0) return "";
  // Full roster, both tables. Matches the MLB team digest's "Team Statistics"
  // (standard) + "Advanced Stats" (splits) two-table layout.
  return `
<section class="bb-section">
  <h2 class="bb-section-title">Team Statistics</h2>
  <h3 class="bb-team-caption">Per Game</h3>
  ${renderStatTable(data.roster, PERGAME_COLUMNS, web, league)}
  <h3 class="bb-team-caption">Shooting</h3>
  ${renderStatTable(data.roster, SHOOTING_COLUMNS, web, league)}
</section>
`.trim();
}

function renderStatTable(
  roster: readonly BasketballTeamPlayer[],
  columns: ReadonlyArray<StatCol>,
  web: boolean,
  league: BasketballTeamData["sport"],
): string {
  const rows = roster.map((p) => {
    const cells = columns.map((c) => `<td class="bb-pl-stat">${escapeHtml(c.get(p.stats))}</td>`).join("");
    return `<tr><td class="bb-pl-name">${playerNameCell(p, web, league)}</td>${cells}</tr>`;
  }).join("");
  return `<table class="bb-player-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <thead>
      <tr>
        <th class="bb-pl-name">Player</th>
        ${columns.map((c) => `<th class="bb-pl-stat">${c.label}</th>`).join("")}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function playerNameCell(p: BasketballTeamPlayer, web: boolean, league: BasketballTeamData["sport"]): string {
  const jersey = p.jersey ? `<span class="bb-pl-jersey">#${escapeHtml(p.jersey)}</span> ` : "";
  const pos = p.position ? ` <span class="bb-pl-pos">${escapeHtml(p.position.toLowerCase())}</span>` : "";
  const inj = p.injured ? ` <span class="bb-pl-inj">(INJ)</span>` : "";
  const name = playerNameLink(p.id, p.name, initialLast(p.name), web, league);
  return `${jersey}${name}${pos}${inj}`;
}

// ---- Upcoming games -------------------------------------------------------

function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function renderUpcoming(data: BasketballTeamData, web: boolean, league: BasketballTeamData["sport"]): string {
  const games = data.upcoming.slice(0, 7);
  if (games.length === 0) return "";
  const rows = games.map((e: BasketballScoreboardEvent) => {
    // Home/away by ESPN id (the boxscore abbreviation disagrees with ESPN's).
    const home = e.home.team.id === data.espnId;
    const opp = home ? e.away.team.name : e.home.team.name;
    const matchup = `${home ? "vs " : "@ "}${teamNameLink(opp, web, league)}`;
    return `<li class="bb-upcoming-row">
      <span class="bb-upcoming-matchup">${matchup}</span>
      <span class="bb-upcoming-time">${escapeHtml(dayLabel(e.date))}, ${escapeHtml(timeInET(e.date))}</span>
    </li>`;
  }).join("");
  return `
<section class="bb-section">
  <h2 class="bb-section-title">Upcoming Games</h2>
  <ul class="bb-upcoming">${rows}</ul>
</section>
`.trim();
}

// ---- Transactions ---------------------------------------------------------

function renderTransactions(transactions: BasketballTransaction[]): string {
  if (transactions.length === 0) return "";
  // Spans this team's moves since its previous game (see
  // transactionsSinceLastTeamGame), so group by ET day, newest first — an
  // off-day signing reads as its own day in the next post-game digest.
  const byDay = new Map<string, BasketballTransaction[]>();
  for (const t of transactions) {
    const day = etDateFromISO(t.date);
    if (!day) continue;
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(t);
  }
  const blocks = [...byDay.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((day) => {
      const rows = byDay.get(day)!
        .sort((a, b) => a.description.localeCompare(b.description))
        .map((t) => `<li class="bb-tx-row"><span class="bb-tx-desc">${escapeHtml(t.description)}</span></li>`)
        .join("");
      return `<div class="bb-tx-day">
    <h3 class="bb-tx-date">${escapeHtml(txDateLabel(day))}</h3>
    <ul class="bb-tx-list">${rows}</ul>
  </div>`;
    })
    .join("");
  return `
<section class="bb-section">
  <h2 class="bb-section-title">Transactions</h2>
  ${blocks}
</section>
`.trim();
}
