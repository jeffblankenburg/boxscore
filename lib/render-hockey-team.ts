// Per-team NHL digest renderer. One body builder → web + email, reusing the
// league renderer's bb- classes + box-score block. Section order mirrors the
// MLB/NBA team digest: heading + record, standings, the team's game, team stat
// sheet (skaters + goalies), upcoming games, transactions.

import type { HockeyTeamData, HockeyTeamPlayer } from "./hockey-team";
import type { HockeyScoreboardEvent, HockeyTransaction } from "./hockey";
import {
  renderGameBlock, initialLast, escapeHtml, teamNameLink, playerNameLink, txDateLabel,
  compareHockeyStanding, renderStandingsTable, divisionShort,
} from "./render-hockey";
import { nextDay, prettyDate, timeInET, etDateFromISO } from "./dates";

const fmtInt = (v: number) => (Number.isFinite(v) ? String(Math.round(v)) : "—");
const fmtSigned = (v: number) => (Number.isFinite(v) ? (v > 0 ? `+${Math.round(v)}` : String(Math.round(v))) : "—");
const fmtGaa = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const fmtSvpct = (v: number) => {
  if (!Number.isFinite(v)) return "—";
  const n = v > 1 ? v / 100 : v;
  const s = n.toFixed(3);
  return s.startsWith("0.") ? s.slice(1) : s;
};
type StatCol = { label: string; get: (s: Record<string, number>) => string };

const SKATER_COLUMNS: ReadonlyArray<StatCol> = [
  { label: "GP",  get: (s) => fmtInt(s.games ?? NaN) },
  { label: "G",   get: (s) => fmtInt(s.goals ?? NaN) },
  { label: "A",   get: (s) => fmtInt(s.assists ?? NaN) },
  { label: "PTS", get: (s) => fmtInt(s.points ?? NaN) },
  { label: "+/-", get: (s) => fmtSigned(s.plusMinus ?? NaN) },
  { label: "S",   get: (s) => fmtInt(s.shotsTotal ?? NaN) },
  { label: "PIM", get: (s) => fmtInt(s.penaltyMinutes ?? NaN) },
];

const GOALIE_COLUMNS: ReadonlyArray<StatCol> = [
  { label: "GP",  get: (s) => fmtInt(s.games ?? NaN) },
  { label: "W",   get: (s) => fmtInt(s.wins ?? NaN) },
  { label: "L",   get: (s) => fmtInt(s.losses ?? NaN) },
  { label: "SV%", get: (s) => fmtSvpct(s.savePct ?? NaN) },
  { label: "GAA", get: (s) => fmtGaa(s.avgGoalsAgainst ?? NaN) },
  { label: "SO",  get: (s) => fmtInt(s.shutouts ?? NaN) },
];

export function renderHockeyTeamContent(data: HockeyTeamData): string {
  return renderBody(data, true);
}
export function renderHockeyTeamEmailContent(data: HockeyTeamData): string {
  return renderBody({ ...data, prettyDate: prettyDate(nextDay(data.date)) }, false);
}

function renderBody(data: HockeyTeamData, web: boolean): string {
  const sections: string[] = [
    renderDateline(data.prettyDate),
    renderHeading(data),
    renderStandings(data, web),
  ];
  if (data.mode === "game") sections.push(renderGame(data, web));
  sections.push(renderRoster(data, web), renderUpcoming(data, web), renderTransactions(data.transactions));
  return sections.filter((s) => s.length > 0).join("\n");
}

function renderDateline(pretty: string): string {
  return `<div class="bb-dateline"><div class="bb-dateline-text">${escapeHtml(pretty)}</div></div>`;
}

function renderHeading(data: HockeyTeamData): string {
  const rec = data.record
    ? ` <span class="bb-team-record">(${data.record.wins}-${data.record.losses}-${data.record.otLosses})</span>`
    : "";
  return `<div class="bb-team-heading">${escapeHtml(data.team.name)}${rec}</div>`;
}

// The team's own division standings, with the team's row highlighted — mirrors
// the MLB team digest (which shows the team's division). Falls back to the full
// conference table for older conference-only payloads.
function renderStandings(data: HockeyTeamData, web: boolean): string {
  const conf = data.conference;
  if (!conf || conf.entries.length === 0) return "";
  const me = data.espnId;
  const division = conf.divisions.find((d) => d.entries.some((e) => e.team.id === me));
  if (!division) {
    return `
<section class="bb-section">
  <h2 class="bb-section-title">${escapeHtml(conf.name)} Standings</h2>
  ${renderStandingsTable([...conf.entries].sort(compareHockeyStanding), web, { meId: me })}
</section>`.trim();
  }
  return `
<section class="bb-section">
  <h2 class="bb-section-title">${escapeHtml(divisionShort(division.name))} Standings</h2>
  ${renderStandingsTable([...division.entries].sort(compareHockeyStanding), web, { meId: me })}
</section>`.trim();
}

function renderGame(data: HockeyTeamData, web: boolean): string {
  if (data.games.length === 0) return "";
  const blocks = data.games.map((g) => renderGameBlock(g.event, g.box, web)).join("\n");
  return `
<section class="bb-section">
  <h2 class="bb-section-title">${data.games.length > 1 ? "Latest Games" : "Latest Game"}</h2>
  ${blocks}
</section>`.trim();
}

function renderRoster(data: HockeyTeamData, web: boolean): string {
  if (data.roster.length === 0) return "";
  const skaters = data.roster.filter((p) => p.position !== "G");
  const goalies = data.roster.filter((p) => p.position === "G");
  const skaterTable = skaters.length
    ? `<h3 class="bb-team-caption">Skaters</h3>${renderStatTable(skaters, SKATER_COLUMNS, web)}` : "";
  const goalieTable = goalies.length
    ? `<h3 class="bb-team-caption">Goalies</h3>${renderStatTable(goalies, GOALIE_COLUMNS, web)}` : "";
  return `
<section class="bb-section">
  <h2 class="bb-section-title">Team Statistics</h2>
  ${skaterTable}
  ${goalieTable}
</section>`.trim();
}

function renderStatTable(
  roster: readonly HockeyTeamPlayer[],
  columns: ReadonlyArray<StatCol>,
  web: boolean,
): string {
  const rows = roster.map((p) => {
    const cells = columns.map((c) => `<td class="bb-pl-stat">${escapeHtml(c.get(p.stats))}</td>`).join("");
    return `<tr><td class="bb-pl-name">${playerNameCell(p, web)}</td>${cells}</tr>`;
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

function playerNameCell(p: HockeyTeamPlayer, web: boolean): string {
  const jersey = p.jersey ? `<span class="bb-pl-jersey">#${escapeHtml(p.jersey)}</span> ` : "";
  const pos = p.position ? ` <span class="bb-pl-pos">${escapeHtml(p.position.toLowerCase())}</span>` : "";
  const inj = p.injured ? ` <span class="bb-pl-inj">(INJ)</span>` : "";
  const name = playerNameLink(p.id, p.name, initialLast(p.name), web);
  return `${jersey}${name}${pos}${inj}`;
}

function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric",
  }).format(new Date(iso));
}

function renderUpcoming(data: HockeyTeamData, web: boolean): string {
  const games = data.upcoming.slice(0, 7);
  if (games.length === 0) return "";
  const rows = games.map((e: HockeyScoreboardEvent) => {
    const home = e.home.team.id === data.espnId;
    const opp = home ? e.away.team.name : e.home.team.name;
    const matchup = `${home ? "vs " : "@ "}${teamNameLink(opp, web)}`;
    return `<li class="bb-upcoming-row">
      <span class="bb-upcoming-matchup">${matchup}</span>
      <span class="bb-upcoming-time">${escapeHtml(dayLabel(e.date))}, ${escapeHtml(timeInET(e.date))}</span>
    </li>`;
  }).join("");
  return `
<section class="bb-section">
  <h2 class="bb-section-title">Upcoming Games</h2>
  <ul class="bb-upcoming">${rows}</ul>
</section>`.trim();
}

function renderTransactions(transactions: HockeyTransaction[]): string {
  if (transactions.length === 0) return "";
  const byDay = new Map<string, HockeyTransaction[]>();
  for (const t of transactions) {
    const day = etDateFromISO(t.date);
    if (!day) continue;
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(t);
  }
  const blocks = [...byDay.keys()].sort((a, b) => b.localeCompare(a)).map((day) => {
    const rows = byDay.get(day)!
      .sort((a, b) => a.description.localeCompare(b.description))
      .map((t) => `<li class="bb-tx-row"><span class="bb-tx-desc">${escapeHtml(t.description)}</span></li>`)
      .join("");
    return `<div class="bb-tx-day">
    <h3 class="bb-tx-date">${escapeHtml(txDateLabel(day))}</h3>
    <ul class="bb-tx-list">${rows}</ul>
  </div>`;
  }).join("");
  return `
<section class="bb-section">
  <h2 class="bb-section-title">Transactions</h2>
  ${blocks}
</section>`.trim();
}
