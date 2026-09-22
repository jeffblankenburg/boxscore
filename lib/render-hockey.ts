// NHL digest renderer. One body builder produces the same HTML for web and
// email. Mirrors lib/render-basketball.ts.
//
// Styling reuse: hockey deliberately reuses basketball's generic table/section
// classes (bb-*) plus the sport-neutral games-* classes rather than duplicating
// ~340 lines of identical CSS under an hk- prefix. The classes are pure layout
// (sections, standings tables, leader tables, line score, box tables); nothing
// in them is basketball-specific. The email side maps nhl → BASKETBALL_EMAIL_
// STYLES in lib/emails/templates.ts. (Re-prefix to hk-* later if desired — a
// mechanical find/replace.)
//
// Sections (regular season): standings, leaders, yesterday's results, today's
// games, box scores, transactions. Playoffs: results, series, today, upcoming.

import type { HockeyData, HockeyGameDetail } from "./hockey-daily";
import type {
  HockeyScoreboardEvent,
  HockeyBoxscore,
  HockeyBoxTeam,
  HockeyPlayerLine,
  HockeyScoringPlay,
  HockeyConferenceStandings,
  HockeyStandings,
  HockeyStandingsEntry,
  HockeyLeaders,
  LeaderCategory,
  HockeyTransaction,
} from "./hockey";
import { lastName } from "./render-email";
import { timeInET, etDateFromISO } from "./dates";
import { renderMasthead, type NavSport } from "./masthead";
import { teamLinkByNickname, playerLink, slugifyName, escText } from "./hockey-links";

export function teamNameLink(name: string, web: boolean): string {
  return teamLinkByNickname(name, name, web);
}
export function playerNameLink(id: string, fullName: string, visible: string, web: boolean): string {
  if (!id) return escText(visible);
  return playerLink({ id, slug: slugifyName(fullName) }, visible, web);
}

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Skater box columns. PTS is derived (goals + assists); the rest read straight
// from the ESPN box keys.
const SKATER_COLUMNS: ReadonlyArray<{ label: string; get: (p: HockeyPlayerLine) => string }> = [
  { label: "G",   get: (p) => p.stats.goals ?? "0" },
  { label: "A",   get: (p) => p.stats.assists ?? "0" },
  { label: "PTS", get: (p) => String(num(p.stats.goals) + num(p.stats.assists)) },
  { label: "+/-", get: (p) => p.stats.plusMinus ?? "" },
  { label: "S",   get: (p) => p.stats.shotsTotal ?? "" },
  { label: "PIM", get: (p) => p.stats.penaltyMinutes ?? "" },
  { label: "TOI", get: (p) => p.stats.timeOnIce ?? "" },
];

const GOALIE_COLUMNS: ReadonlyArray<{ label: string; get: (p: HockeyPlayerLine) => string }> = [
  { label: "SA",  get: (p) => p.stats.shotsAgainst ?? "" },
  { label: "SV",  get: (p) => p.stats.saves ?? "" },
  { label: "GA",  get: (p) => p.stats.goalsAgainst ?? "" },
  { label: "SV%", get: (p) => p.stats.savePct ?? "" },
  { label: "TOI", get: (p) => p.stats.timeOnIce ?? "" },
];

// Standings columns. Hockey ranks by points (2 for a W, 1 for an OTL). DIFF is
// goal differential (ESPN's pointDifferential); L10 is trimmed from ESPN's
// verbose "2-0-0, 0 PTS" to just the record.
const l10 = (dv: string) => dv.split(",")[0]!.trim();
// Column widths (% of the fixed-layout table) sized for END-OF-SEASON worst
// cases: PTS "135", DIFF "-130", L10 "10-0-0" (6 chars), STRK "W15", and long
// nicknames ("Golden Knights"). Rank 5 + team 26 + stats 69 = 100.
const STANDINGS_COLUMNS: ReadonlyArray<{ key: string; label: string; w: string; fmt?: (dv: string) => string }> = [
  { key: "gamesPlayed", label: "GP", w: "7%" },
  { key: "wins", label: "W", w: "7%" },
  { key: "losses", label: "L", w: "7%" },
  { key: "otLosses", label: "OTL", w: "8%" },
  { key: "points", label: "PTS", w: "9%" },
  { key: "pointDifferential", label: "DIFF", w: "10%" },
  { key: "Last Ten Games", label: "L10", w: "12%", fmt: l10 },
  { key: "streak", label: "STRK", w: "9%" },
];
const STANDINGS_COLGROUP =
  `<colgroup><col style="width:5%" /><col style="width:26%" />` +
  `${STANDINGS_COLUMNS.map((c) => `<col style="width:${c.w}" />`).join("")}</colgroup>`;

export function renderHockeyContent(data: HockeyData, navSports: NavSport[] = []): string {
  return renderBody(data, true, navSports);
}
export function renderHockeyEmailContent(data: HockeyData, navSports: NavSport[] = []): string {
  return renderBody(data, false, navSports);
}

function renderBody(data: HockeyData, web: boolean, navSports: NavSport[]): string {
  const masthead = renderMasthead({
    date: data.date, sport: "nhl", surface: web ? "web" : "email", navSports,
  });
  const sections = data.isPlayoffs
    ? [
        masthead,
        renderResults(data, "Yesterday’s games", web),
        renderPlayoffSeries(data, web),
        renderTodaysGames(data, web),
        renderUpcomingGames(data, web),
      ]
    : [
        masthead,
        renderStandingsColumns(data.standings, web),
        renderLeaders(data.leaders, web),
        renderYesterdayResults(data, web),
        renderTodaysGames(data, web),
        renderResults(data, "Box scores", web),
        renderTransactions(data.transactions),
      ];
  // .hk scopes the hockey-only overrides (fixed-layout dense standings that fit a
  // 400px email) so the shared bb-* basketball styles are untouched.
  return `<div class="hk">${sections.filter((s) => s.length > 0).join("\n")}</div>`;
}

// ---- Yesterday's results (compact score-line list) ------------------------

function renderYesterdayResults(data: HockeyData, web: boolean): string {
  const games = data.games.filter((g) => g.event.status === "final" || g.event.status === "in_progress");
  if (games.length === 0) return "";
  const lines = games.map((g) => {
    const { away, home, status, statusDetail } = g.event;
    const aScore = away.score ?? 0;
    const hScore = home.score ?? 0;
    const aClass = aScore > hScore ? "winner" : "";
    const hClass = hScore > aScore ? "winner" : "";
    const tag = status === "final"
      ? (/\/(OT|SO)/.test(statusDetail) ? ` <span class="game-line-status">(${escapeHtml(statusDetail.replace("Final", "").replace(/^\//, ""))})</span>` : "")
      : ` <span class="game-line-status">(${escapeHtml(statusDetail || status)})</span>`;
    return `<div class="game-score-line">
      <span class="${aClass}">${teamNameLink(away.team.name, web)} ${aScore}</span>, <span class="${hClass}">${teamNameLink(home.team.name, web)} ${hScore}</span>${tag}
    </div>`;
  }).join("");
  return `<div class="games-section">
  <div class="games-section-title">Yesterday’s Results</div>
  <div class="games-grid">${lines}</div>
</div>`;
}

// ---- Box scores -----------------------------------------------------------

function buildRecordMap(standings: HockeyStandings): Map<string, string> {
  const out = new Map<string, string>();
  for (const conf of standings.conferences) {
    for (const e of conf.entries) {
      const w = e.stats["wins"]?.displayValue;
      const l = e.stats["losses"]?.displayValue;
      const otl = e.stats["otLosses"]?.displayValue;
      if (w && l) out.set(e.team.id, otl ? `${w}-${l}-${otl}` : `${w}-${l}`);
    }
  }
  return out;
}

function renderResults(data: HockeyData, title: string, web: boolean): string {
  const finalsAndLive = data.games.filter((g) => g.event.status === "final" || g.event.status === "in_progress");
  if (finalsAndLive.length === 0) {
    const total = data.games.length;
    return `
<section class="bb-section">
  <h2 class="bb-section-title">${escapeHtml(title)}</h2>
  <p class="bb-empty">${total === 0 ? "No games scheduled." : `${total} game${total === 1 ? "" : "s"} on the slate, none final yet.`}</p>
</section>`.trim();
  }
  const records = buildRecordMap(data.standings);
  const blocks = finalsAndLive.map((g) => renderGameBlock(g.event, g.box, web, records));
  return `
<section class="bb-section">
  <h2 class="bb-section-title">${escapeHtml(title)}</h2>
  <div class="bb-boxscores">${blocks.join("\n")}</div>
</section>`.trim();
}

export function renderGameBlock(
  event: HockeyScoreboardEvent,
  box: HockeyBoxscore | undefined,
  web: boolean,
  records?: Map<string, string>,
): string {
  const lineScore = renderLineScore(event, records);
  const scoring = box ? renderScoringPlays(box) : "";
  const boxTables = box ? renderBoxScore(box, web) : "";
  const round = event.roundName;
  const summary = event.series?.summary;
  const contextText = round ? (summary ? `${round} (${summary})` : round) : summary ?? "";
  const context = contextText ? `<div class="bb-game-context">${escapeHtml(contextText)}</div>` : "";
  const matchup = `${teamNameLink(event.away.team.name, web)} @ ${teamNameLink(event.home.team.name, web)}`;
  return `
<article class="bb-game">
  ${context}
  <header class="bb-game-header">
    <span class="bb-game-matchup">${matchup}</span>
    <span class="bb-game-status">${escapeHtml(event.statusDetail || event.status)}</span>
  </header>
  ${lineScore}
  ${scoring}
  ${boxTables}
</article>`.trim();
}

function periodName(p: number): string {
  if (p === 1) return "1st Period";
  if (p === 2) return "2nd Period";
  if (p === 3) return "3rd Period";
  if (p === 4) return "Overtime";
  return "Shootout";
}

// Goal summary grouped by period. ESPN's play text already names scorer +
// assists, so we surface it as-is with the scoring team's abbreviation. Sized to
// match the 12px box-score tables (period headers mirror the 10px table headers)
// via inline styles so it stays consistent in web and email with no new CSS.
function renderScoringPlays(box: HockeyBoxscore): string {
  if (box.scoringPlays.length === 0) return "";
  const abbr = new Map(box.teams.map((t) => [t.team.id, t.team.abbreviation]));
  const byPeriod = new Map<number, HockeyScoringPlay[]>();
  for (const p of box.scoringPlays) {
    (byPeriod.get(p.period) ?? byPeriod.set(p.period, []).get(p.period)!).push(p);
  }
  const perHead = "font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#6a6354;margin:5px 0 1px";
  const row = "font-size:12px;line-height:1.35;padding:1px 0";
  const clockStyle = "color:#6a6354;font-variant-numeric:tabular-nums";
  const blocks = [...byPeriod.keys()].sort((a, b) => a - b).map((per) => {
    const rows = byPeriod.get(per)!.map((p) => {
      const clock = p.clock ? `<span style="${clockStyle}">${escapeHtml(p.clock)}</span> ` : "";
      return `<div style="${row}">${clock}<b>${escapeHtml(abbr.get(p.teamId) ?? "")}</b> ${escapeHtml(p.text)}</div>`;
    }).join("");
    return `<div style="${perHead}">${escapeHtml(periodName(per))}</div>${rows}`;
  }).join("");
  return `<h3 class="bb-team-caption">Scoring</h3>${blocks}`;
}

function periodLabel(i: number): string {
  if (i <= 3) return String(i);
  if (i === 4) return "OT";
  return "SO";
}

function renderLineScore(event: HockeyScoreboardEvent, records?: Map<string, string>): string {
  const maxPeriods = Math.max(event.away.linescores.length, event.home.linescores.length, 3);
  const periods: string[] = [];
  for (let i = 1; i <= maxPeriods; i++) periods.push(periodLabel(i));

  const renderRow = (side: HockeyScoreboardEvent["away"]) => {
    const cells = periods.map((_, i) => {
      const ls = side.linescores[i];
      return `<td class="bb-ls-cell">${ls ? ls.value : ""}</td>`;
    }).join("");
    const total = side.score == null ? "" : String(side.score);
    const label = escapeHtml(side.team.abbreviation || side.team.name);
    const rec = records?.get(side.team.id) ?? side.record;
    const recHtml = rec ? ` <span class="bb-ls-rec">(${escapeHtml(rec)})</span>` : "";
    return `<tr><th class="bb-ls-team">${label}${recHtml}</th>${cells}<td class="bb-ls-total">${total}</td></tr>`;
  };

  return `
<table class="bb-linescore" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <thead>
    <tr>
      <th class="bb-ls-team-head"></th>
      ${periods.map((p) => `<th class="bb-ls-cell">${p}</th>`).join("")}
      <th class="bb-ls-total">T</th>
    </tr>
  </thead>
  <tbody>
    ${renderRow(event.away)}
    ${renderRow(event.home)}
  </tbody>
</table>`.trim();
}

function renderBoxScore(box: HockeyBoxscore, web: boolean): string {
  return `<div class="bb-box">
  ${box.teams.map((t) => renderBoxTeam(t, web)).join("\n")}
</div>`;
}

function toiToSeconds(v: string | undefined): number {
  if (!v) return 0;
  const [m, s] = v.split(":").map(Number);
  return (m || 0) * 60 + (s || 0);
}

function renderBoxTeam(team: HockeyBoxTeam, web: boolean): string {
  const skaters = [...team.skaters].sort((a, b) => {
    const pa = num(a.stats.goals) + num(a.stats.assists);
    const pb = num(b.stats.goals) + num(b.stats.assists);
    return pb - pa || num(b.stats.goals) - num(a.stats.goals);
  });
  const goalies = [...team.goalies].sort((a, b) => toiToSeconds(b.stats.timeOnIce) - toiToSeconds(a.stats.timeOnIce));

  return `
<h3 class="bb-team-caption">${teamNameLink(team.team.name, web)}</h3>
${renderStatTable(skaters, SKATER_COLUMNS, web)}
${goalies.length ? renderStatTable(goalies, GOALIE_COLUMNS, web) : ""}`.trim();
}

function renderStatTable(
  players: HockeyPlayerLine[],
  columns: ReadonlyArray<{ label: string; get: (p: HockeyPlayerLine) => string }>,
  web: boolean,
): string {
  const rows = players.map((p) => {
    const cells = columns.map((c) => `<td class="bb-pl-stat">${escapeHtml(c.get(p))}</td>`).join("");
    const name = playerNameLink(p.athleteId, p.displayName, initialLast(p.displayName), web);
    const pos = p.position ? ` <span class="bb-pl-pos">${escapeHtml(p.position.toLowerCase())}</span>` : "";
    return `<tr><td class="bb-pl-name">${name}${pos}</td>${cells}</tr>`;
  }).join("");
  return `
<table class="bb-player-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <thead>
    <tr>
      <th class="bb-pl-name">Player</th>
      ${columns.map((c) => `<th class="bb-pl-stat">${c.label}</th>`).join("")}
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`.trim();
}

export function initialLast(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  const initial = (parts[0] ?? "").charAt(0);
  const last = lastName(full);
  return initial ? `${initial}. ${last}` : last;
}

// ---- Standings ------------------------------------------------------------

function renderStandingsColumns(standings: HockeyStandings, web: boolean): string {
  if (standings.conferences.length === 0) return "";
  const cols = standings.conferences.map((c) => renderConferenceSection(c, web)).join("\n");
  return `<div class="bb-standings-cols">${cols}</div>`;
}

function renderConferenceSection(conf: HockeyConferenceStandings, web: boolean): string {
  return `
<section class="bb-section">
  <h2 class="bb-section-title">${escapeHtml(conf.name)} Standings</h2>
  ${renderConference(conf, web)}
</section>`.trim();
}

function renderConference(conf: HockeyConferenceStandings, web: boolean): string {
  const sorted = [...conf.entries].sort((a, b) => {
    const seedA = a.stats.playoffSeed?.value;
    const seedB = b.stats.playoffSeed?.value;
    if (seedA && seedB) return seedA - seedB;
    return (b.stats.points?.value ?? 0) - (a.stats.points?.value ?? 0);
  });
  const rows = sorted.map((e, i) => renderStandingsRow(e, i + 1, web)).join("");
  return `
<table class="bb-standings-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  ${STANDINGS_COLGROUP}
  <thead>
    <tr>
      <th class="bb-st-rank">#</th>
      <th class="bb-st-team">Team</th>
      ${STANDINGS_COLUMNS.map((c) => `<th class="bb-st-stat">${c.label}</th>`).join("")}
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`.trim();
}

function renderStandingsRow(entry: HockeyStandingsEntry, rank: number, web: boolean): string {
  const cells = STANDINGS_COLUMNS.map((c) => {
    const dv = entry.stats[c.key]?.displayValue ?? "";
    return `<td class="bb-st-stat">${escapeHtml(c.fmt ? c.fmt(dv) : dv)}</td>`;
  }).join("");
  return `<tr><td class="bb-st-rank">${rank}</td><td class="bb-st-team">${teamNameLink(entry.team.name, web)}</td>${cells}</tr>`;
}

// ---- Playoff series -------------------------------------------------------

type SeriesEntry = { round: string; awayName: string; homeName: string; summary: string };

function collectSeries(data: HockeyData): SeriesEntry[] {
  const map = new Map<string, SeriesEntry>();
  const visit = (event: HockeyScoreboardEvent) => {
    if (!event.series && !event.roundName) return;
    const key = [event.away.team.id, event.home.team.id].sort().join("-");
    if (map.has(key)) return;
    map.set(key, {
      round: event.roundName ?? "Playoffs",
      awayName: event.away.team.name,
      homeName: event.home.team.name,
      summary: event.series?.summary ?? "",
    });
  };
  data.games.forEach((g) => visit(g.event));
  data.upcomingEvents.forEach(visit);
  return [...map.values()];
}

function renderPlayoffSeries(data: HockeyData, web: boolean): string {
  const series = collectSeries(data);
  if (series.length === 0) {
    return `
<section class="bb-section">
  <h2 class="bb-section-title">Playoff series</h2>
  <p class="bb-empty">No active series in this window.</p>
</section>`.trim();
  }
  const byRound = new Map<string, SeriesEntry[]>();
  for (const s of series) (byRound.get(s.round) ?? byRound.set(s.round, []).get(s.round)!).push(s);
  const rounds = [...byRound.entries()].map(([round, list]) => {
    const rows = list.map((s) =>
      `<div class="bb-bracket-series">
        <div class="bb-bracket-matchup">${teamNameLink(s.awayName, web)} <span class="bb-bracket-vs">vs</span> ${teamNameLink(s.homeName, web)}</div>
        ${s.summary ? `<div class="bb-bracket-summary">${escapeHtml(s.summary)}</div>` : `<div class="bb-bracket-summary">Series tied 0&ndash;0</div>`}
      </div>`,
    ).join("");
    return `
<div class="bb-bracket-round">
  <h3 class="bb-bracket-round-title">${escapeHtml(round)}</h3>
  ${rows}
</div>`.trim();
  }).join("\n");
  return `
<section class="bb-section">
  <h2 class="bb-section-title">Playoff series</h2>
  ${rounds}
</section>`.trim();
}

// ---- Upcoming / today -----------------------------------------------------

function etDayLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric",
  }).format(new Date(iso));
}
const etCalendarDate = etDateFromISO;

export function txDateLabel(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function digestDatePlusOne(digestDate: string): string {
  const [y, m, d] = digestDate.split("-").map(Number);
  const r = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return `${r.getUTCFullYear()}-${String(r.getUTCMonth() + 1).padStart(2, "0")}-${String(r.getUTCDate()).padStart(2, "0")}`;
}

function renderTodaysGames(data: HockeyData, web: boolean): string {
  const todayEt = digestDatePlusOne(data.date);
  const games = data.upcomingEvents
    .filter((e) => etCalendarDate(e.date) === todayEt)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (games.length === 0) return "";
  const rows = games.map((e) => {
    const matchup = `${teamNameLink(e.away.team.name, web)} @ ${teamNameLink(e.home.team.name, web)}`;
    return `<li class="bb-upcoming-row">
      <span class="bb-upcoming-matchup">${matchup}</span>
      <span class="bb-upcoming-time">${escapeHtml(timeInET(e.date))}</span>
    </li>`;
  }).join("");
  return `
<section class="bb-section">
  <h2 class="bb-section-title">Today&rsquo;s games</h2>
  <ul class="bb-upcoming">${rows}</ul>
</section>`.trim();
}

function renderUpcomingGames(data: HockeyData, web: boolean): string {
  const todayEt = digestDatePlusOne(data.date);
  const upcoming = data.upcomingEvents
    .filter((e) => etCalendarDate(e.date) !== todayEt)
    .filter((e) => e.status === "scheduled" || e.status === "in_progress")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12);
  if (upcoming.length === 0) return "";
  const byDay = new Map<string, HockeyScoreboardEvent[]>();
  for (const e of upcoming) (byDay.get(etCalendarDate(e.date)) ?? byDay.set(etCalendarDate(e.date), []).get(etCalendarDate(e.date))!).push(e);
  const days = [...byDay.entries()].map(([, events]) => {
    const rows = events.map((e) => {
      const round = e.roundName ? ` · ${e.roundName}` : "";
      const matchup = `${teamNameLink(e.away.team.name, web)} @ ${teamNameLink(e.home.team.name, web)}`;
      return `<li class="bb-upcoming-row">
        <span class="bb-upcoming-matchup">${matchup}</span>
        <span class="bb-upcoming-time">${escapeHtml(timeInET(e.date))}${escapeHtml(round)}</span>
      </li>`;
    }).join("");
    return `<div class="bb-upcoming-day">
  <h3 class="bb-upcoming-day-title">${escapeHtml(etDayLabel(events[0]!.date))}</h3>
  <ul class="bb-upcoming">${rows}</ul>
</div>`;
  }).join("\n");
  return `
<section class="bb-section">
  <h2 class="bb-section-title">Upcoming games</h2>
  ${days}
</section>`.trim();
}

// ---- Leaders --------------------------------------------------------------

function renderLeaders(leaders: HockeyLeaders, web: boolean): string {
  const nonEmpty = leaders.categories.filter((c) => c.entries.length > 0);
  if (nonEmpty.length === 0) return "";
  const tables = nonEmpty.map((c) => renderLeaderCategory(c, web)).join("\n");
  return `
<section class="bb-section">
  <h2 class="bb-section-title">NHL League Leaders</h2>
  <div class="bb-leaders-cols">${tables}</div>
</section>`.trim();
}

function renderLeaderCategory(cat: LeaderCategory, web: boolean): string {
  const rows = cat.entries.map((e) =>
    `<tr>
      <td class="bb-ldr-rank">${e.rank}</td>
      <td class="bb-ldr-name">${playerNameLink(e.athleteId, e.athleteName, initialLast(e.athleteName), web)}</td>
      <td class="bb-ldr-team">${escapeHtml(e.teamAbbr)}</td>
      <td class="bb-ldr-value">${escapeHtml(e.displayValue)}</td>
    </tr>`,
  ).join("");
  return `
<div class="bb-ldr-cat">
<h3 class="bb-ldr-caption">${escapeHtml(cat.label)}${cat.abbrev ? ` <span class="bb-ldr-abbrev">${escapeHtml(cat.abbrev)}</span>` : ""}</h3>
<table class="bb-leader-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tbody>${rows}</tbody>
</table>
</div>`.trim();
}

// ---- Transactions ---------------------------------------------------------

function renderTransactions(transactions: HockeyTransaction[]): string {
  if (transactions.length === 0) return "";
  const byDay = new Map<string, HockeyTransaction[]>();
  for (const t of transactions) {
    const day = etCalendarDate(t.date);
    if (!day) continue;
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(t);
  }
  const blocks = [...byDay.keys()].sort((a, b) => b.localeCompare(a)).map((day) => {
    const rows = byDay.get(day)!
      .sort((a, b) => (a.teamAbbr ?? "").localeCompare(b.teamAbbr ?? "") || a.description.localeCompare(b.description))
      .map((t) => {
        const team = t.teamAbbr ? `<span class="bb-tx-team">${escapeHtml(t.teamAbbr)}</span>` : "";
        return `<li class="bb-tx-row">${team}<span class="bb-tx-desc">${escapeHtml(t.description)}</span></li>`;
      }).join("");
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

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] ?? c));
}

// Hockey-only overrides appended after BASKETBALL_EMAIL_STYLES for the NHL email
// (see lib/emails/templates.ts). Hockey's standings carry more columns than
// basketball (GP/W/L/OTL/PTS/DIFF/L10/STRK), so a fixed layout + tight cells is
// required to fit a 400px email without horizontal scroll; the box-score tables
// already use table-layout:fixed. Scoped to .hk so basketball is untouched. The
// SAME rules live in app/globals.css for the web surface (keep them in sync).
export const HOCKEY_EMAIL_STYLES = `
.hk .bb-standings-table { table-layout: fixed; width: 100%; }
.hk .bb-standings-table th, .hk .bb-standings-table td {
  padding: 2px 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
`;
