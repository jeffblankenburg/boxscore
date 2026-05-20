// Basketball digest renderer. One body builder that produces the same HTML
// for web and email — both consume class names that live in globals.css
// (web) and EMAIL_STYLES (email). The bb- prefix keeps these classes out of
// the way of MLB's existing styles.
//
// Sections (top to bottom):
//   1. Dateline — sport name + date
//   2. Yesterday's results — per game: line score + per-team box score
//   3. Standings — all conferences, all teams
//
// "Today's games" is deferred — the data layer fetches yesterday's
// scoreboard and the current standings; we'd need a separate next-day
// scoreboard fetch to render the upcoming slate. Easy to add when needed.

import type { BasketballData } from "./basketball-daily";
import type {
  BasketballScoreboardEvent,
  BasketballBoxscore,
  BasketballBoxTeam,
  BasketballPlayerLine,
  BasketballStandings,
  BasketballConferenceStandings,
  BasketballStandingsEntry,
  BasketballLeaders,
  LeaderCategory,
  BasketballTransaction,
} from "./basketball";
import { lastName } from "./render-email";
import { timeInET } from "./dates";

// 7-column box score per Jeff's call. The full ESPN set has 14; these are
// the high-signal ones for a glance. Tweak this array to change the line.
const PLAYER_STAT_COLUMNS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "MIN", label: "MIN" },
  { key: "PTS", label: "PTS" },
  { key: "REB", label: "REB" },
  { key: "AST", label: "AST" },
  { key: "3PT", label: "3PT" },
  { key: "STL", label: "STL" },
  { key: "BLK", label: "BLK" },
];

// Standings columns. The standings "stats" map uses these ESPN names.
const STANDINGS_COLUMNS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "wins", label: "W" },
  { key: "losses", label: "L" },
  { key: "winPercent", label: "PCT" },
  { key: "gamesBehind", label: "GB" },
  { key: "streak", label: "STRK" },
];

export function renderBasketballContent(data: BasketballData): string {
  return renderBody(data);
}

export function renderBasketballEmailContent(data: BasketballData): string {
  return renderBody(data);
}

// ---- Body -----------------------------------------------------------------

function renderBody(data: BasketballData): string {
  // Playoffs and regular-season modes use different section orders. Playoffs
  // leads with the result (the big news is the game just played), then the
  // current series state, then what's coming up. Regular season mirrors
  // baseball: league context first (standings + leaders), then today's
  // schedule, then yesterday's box scores, then transactions.
  if (data.isPlayoffs) {
    const sections = [
      renderDateline(data),
      renderResults(data, "Yesterday\u2019s games"),
      renderPlayoffSeries(data),
      // Today's games surfaces a Game N of an ongoing series scheduled for
      // tonight — should always be visible above the broader upcoming
      // list. Upcoming then covers the rest of the bracket window.
      renderTodaysGames(data),
      renderUpcomingGames(data),
    ];
    return sections.filter((s) => s.length > 0).join("\n");
  }

  const sections = [
    renderDateline(data),
    ...data.standings.conferences.map((c) => renderConferenceSection(c)),
    renderLeaders(data.leaders),
    renderTodaysGames(data),
    renderResults(data, "Box scores"),
    renderTransactions(data.transactions, data.date),
  ];
  return sections.filter((s) => s.length > 0).join("\n");
}

// Single-line plain dateline, matching baseball's es-dateline pattern. The
// sport label lives in the email subject + browser title, so the dateline
// itself stays focused on the date.
function renderDateline(data: BasketballData): string {
  return `<div class="bb-dateline">${escapeHtml(data.prettyDate)}</div>`;
}

// ---- Yesterday's results --------------------------------------------------

function renderResults(data: BasketballData, title: string): string {
  const finalsAndLive = data.games.filter(
    (g) => g.event.status === "final" || g.event.status === "in_progress",
  );
  if (finalsAndLive.length === 0) {
    const total = data.games.length;
    return `
<section class="bb-section">
  <h2 class="bb-section-title">${escapeHtml(title)}</h2>
  <p class="bb-empty">${total === 0 ? "No games scheduled." : `${total} game${total === 1 ? "" : "s"} on the slate, none final yet.`}</p>
</section>
`.trim();
  }
  const blocks = finalsAndLive.map((g) => renderGameBlock(g.event, g.box));
  return `
<section class="bb-section">
  <h2 class="bb-section-title">${escapeHtml(title)}</h2>
  ${blocks.join("\n")}
</section>
`.trim();
}

function renderGameBlock(
  event: BasketballScoreboardEvent,
  box: BasketballBoxscore | undefined,
): string {
  const lineScore = renderLineScore(event);
  const boxTables = box ? renderBoxScore(box) : "";
  // Playoff series context: round + current state above the matchup. Only
  // present on postseason events; regular-season game blocks skip it.
  const context = event.roundName || event.series
    ? `<div class="bb-game-context">${escapeHtml([event.roundName, event.series?.summary].filter(Boolean).join(" · "))}</div>`
    : "";
  return `
<article class="bb-game">
  ${context}
  <header class="bb-game-header">
    <span class="bb-game-matchup">${escapeHtml(event.shortName)}</span>
    <span class="bb-game-status">${escapeHtml(event.statusDetail || event.status)}</span>
  </header>
  ${lineScore}
  ${boxTables}
</article>
`.trim();
}

function renderLineScore(event: BasketballScoreboardEvent): string {
  // Periods 1-4 are quarters; 5+ are overtime. Render whichever periods
  // either side has a linescore for. ESPN's linescores arrays are sorted
  // by period, so taking the max length covers both sides.
  const maxPeriods = Math.max(
    event.away.linescores.length,
    event.home.linescores.length,
    4,
  );
  const periodLabels: string[] = [];
  for (let i = 1; i <= maxPeriods; i++) {
    periodLabels.push(i <= 4 ? `Q${i}` : `OT${i - 4}`);
  }

  // No winner highlight per the newspaper aesthetic — the score column
  // tells you who won; styling restraint stays consistent with baseball.
  const renderRow = (side: BasketballScoreboardEvent["away"]) => {
    const cells = periodLabels.map((_, i) => {
      const ls = side.linescores[i];
      return `<td class="bb-ls-cell">${ls ? ls.value : ""}</td>`;
    }).join("");
    const total = side.score == null ? "" : String(side.score);
    return `<tr><th class="bb-ls-team">${escapeHtml(side.team.abbreviation || side.team.name)}</th>${cells}<td class="bb-ls-total">${total}</td></tr>`;
  };

  return `
<table class="bb-linescore" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <thead>
    <tr>
      <th class="bb-ls-team-head"></th>
      ${periodLabels.map((p) => `<th class="bb-ls-cell">${p}</th>`).join("")}
      <th class="bb-ls-total">T</th>
    </tr>
  </thead>
  <tbody>
    ${renderRow(event.away)}
    ${renderRow(event.home)}
  </tbody>
</table>
`.trim();
}

function renderBoxScore(box: BasketballBoxscore): string {
  return `<div class="bb-box">
  ${box.teams.map((t) => renderBoxTeam(t)).join("\n")}
</div>`;
}

function renderBoxTeam(team: BasketballBoxTeam): string {
  // Players who played, sorted by minutes desc. ESPN's MIN comes as a
  // string ("25"); Number() handles the parse, NaN → 0 so DNPs sink.
  const played = team.players
    .filter((p) => !p.didNotPlay && Object.keys(p.stats).length > 0)
    .sort((a, b) => parseMinutes(b) - parseMinutes(a));

  const rows = played.map((p) => renderPlayerRow(p)).join("");
  const totals = renderTotalsRow(team);

  // Team name renders as an h3 sibling above the table (matches MLB's
  // sub-h pattern) rather than a <caption> inside — captions don't reliably
  // span table width across email clients.
  return `
<h3 class="bb-team-caption">${escapeHtml(team.team.displayName)}</h3>
<table class="bb-player-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <thead>
    <tr>
      <th class="bb-pl-name">Player</th>
      ${PLAYER_STAT_COLUMNS.map((c) => `<th class="bb-pl-stat">${c.label}</th>`).join("")}
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>${totals}</tfoot>
</table>
`.trim();
}

function renderPlayerRow(p: BasketballPlayerLine): string {
  const cells = PLAYER_STAT_COLUMNS.map((c) =>
    `<td class="bb-pl-stat">${escapeHtml(p.stats[c.key] ?? "")}</td>`,
  ).join("");
  // Basketball has more cell width than baseball's box, so we show first
  // initial + last name ("L. Doncic") rather than baseball's last-name-only
  // convention. Position stays lowercase as a small suffix.
  const name = initialLast(p.displayName);
  const pos = p.position ? p.position.toLowerCase() : "";
  const nameCell = pos
    ? `${escapeHtml(name)} <span class="bb-pl-pos">${escapeHtml(pos)}</span>`
    : escapeHtml(name);
  return `<tr><td class="bb-pl-name">${nameCell}</td>${cells}</tr>`;
}

// "Devin Vassell" → "D. Vassell". Falls back to the full string for one-word
// names. Hyphenated/multi-word last names ("Gilgeous-Alexander",
// "Antetokounmpo") survive intact because lastName() handles them.
function initialLast(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  const first = parts[0] ?? "";
  const initial = first.charAt(0);
  const last = lastName(full);
  return initial ? `${initial}. ${last}` : last;
}

function renderTotalsRow(team: BasketballBoxTeam): string {
  const cells = PLAYER_STAT_COLUMNS.map((c) =>
    `<td class="bb-pl-stat">${escapeHtml(team.totals[c.key] ?? "")}</td>`,
  ).join("");
  return `<tr><td class="bb-pl-name bb-pl-totals">Totals</td>${cells}</tr>`;
}

function parseMinutes(p: BasketballPlayerLine): number {
  const v = p.stats.MIN;
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---- Standings ------------------------------------------------------------

function renderStandings(standings: BasketballStandings, isPlayoffs: boolean): string {
  if (standings.conferences.length === 0) {
    const title = isPlayoffs ? "Playoff seeding" : "Standings";
    return `<section class="bb-section"><h2 class="bb-section-title">${title}</h2><p class="bb-empty">Standings unavailable.</p></section>`;
  }
  const tables = standings.conferences.map((c) => renderConference(c, isPlayoffs)).join("\n");
  // Playoff mode: show the eight teams in each conference's playoff field
  // ordered by seed. Full bracket-with-series-state is a follow-up; this is
  // the closest thing to a bracket we can render from standings alone.
  const title = isPlayoffs ? "Playoff seeding" : "Standings";
  return `
<section class="bb-section">
  <h2 class="bb-section-title">${title}</h2>
  <div class="bb-standings-grid">${tables}</div>
</section>
`.trim();
}

function renderConference(conf: BasketballConferenceStandings, isPlayoffs: boolean): string {
  // Sort by playoffSeed when present (postseason / late-season), falling
  // back to win percentage. ESPN sometimes returns seed=0 for non-playoff
  // teams; treat as "no seed" and sort by winPercent.
  const sorted = [...conf.entries].sort((a, b) => {
    const seedA = a.stats.playoffSeed?.value;
    const seedB = b.stats.playoffSeed?.value;
    if (seedA && seedB) return seedA - seedB;
    const pctA = a.stats.winPercent?.value ?? 0;
    const pctB = b.stats.winPercent?.value ?? 0;
    return pctB - pctA;
  });

  // Playoff mode: only the eight playoff seeds. ESPN reports playoffSeed
  // 1-10 in some windows (8 + 2 play-in); we cap at 8 for the bracket view.
  const shown = isPlayoffs
    ? sorted.filter((e) => {
        const s = e.stats.playoffSeed?.value;
        return typeof s === "number" && s >= 1 && s <= 8;
      })
    : sorted;

  const rows = shown.map((e, i) => renderStandingsRow(e, i + 1)).join("");
  return `
<h3 class="bb-conf-caption">${escapeHtml(conf.name)}</h3>
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
`.trim();
}

function renderStandingsRow(entry: BasketballStandingsEntry, rank: number): string {
  const team = entry.team;
  const cells = STANDINGS_COLUMNS.map((c) => {
    const stat = entry.stats[c.key];
    const display = stat?.displayValue ?? "";
    return `<td class="bb-st-stat">${escapeHtml(display)}</td>`;
  }).join("");
  // team.name = "Cavaliers" (no city). Matches baseball's convention of
  // showing just the nickname in standings tables.
  return `<tr><td class="bb-st-rank">${rank}</td><td class="bb-st-team">${escapeHtml(team.name)}</td>${cells}</tr>`;
}

// ---- Playoff bracket ------------------------------------------------------
//
// Collects active series from today's games + tomorrow's events (a 2-day
// window catches the typical 1-day gap between Conference Finals games),
// dedupes by sorted competitor pair, and groups by round name. The "state"
// of each series comes straight from ESPN's `series.summary` text
// ("SA leads series 1-0") so we don't have to recompute.

type SeriesEntry = {
  round: string;
  awayName: string;     // team name only ("Spurs"), no city
  homeName: string;
  summary: string;
};

function collectSeries(data: BasketballData): SeriesEntry[] {
  const map = new Map<string, SeriesEntry>();
  const visit = (event: BasketballScoreboardEvent) => {
    if (!event.series && !event.roundName) return;
    const key = [event.away.team.id, event.home.team.id].sort().join("-");
    if (map.has(key)) return; // first occurrence wins; same series state across all games
    map.set(key, {
      round: event.roundName ?? "Playoffs",
      awayName: event.away.team.name,
      homeName: event.home.team.name,
      summary: event.series?.summary ?? "",
    });
  };
  // Today's games first, then the upcoming-window events. Series that
  // haven't started yet (game 1 several days out) show up via upcoming.
  data.games.forEach((g) => visit(g.event));
  data.upcomingEvents.forEach(visit);
  return Array.from(map.values());
}

function renderPlayoffSeries(data: BasketballData): string {
  const series = collectSeries(data);
  if (series.length === 0) {
    return `
<section class="bb-section">
  <h2 class="bb-section-title">Playoff series</h2>
  <p class="bb-empty">No active series in this window.</p>
</section>
`.trim();
  }

  const byRound = new Map<string, SeriesEntry[]>();
  for (const s of series) {
    const list = byRound.get(s.round) ?? [];
    list.push(s);
    byRound.set(s.round, list);
  }

  const rounds = Array.from(byRound.entries()).map(([round, list]) => {
    const rows = list.map((s) =>
      `<div class="bb-bracket-series">
        <div class="bb-bracket-matchup">${escapeHtml(s.awayName)} <span class="bb-bracket-vs">vs</span> ${escapeHtml(s.homeName)}</div>
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
</section>
`.trim();
}

// ---- Upcoming games --------------------------------------------------------

// "Wed, May 21" — ET-localized human-readable date for the upcoming-day
// headers. Takes a full ISO timestamp (ESPN's event.date) so DST and TZ
// boundaries get sorted out by Intl.
function etDayLabel(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

// ET calendar date (YYYY-MM-DD) for the event. Group key for upcoming games.
function etCalendarDate(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function renderUpcomingGames(data: BasketballData): string {
  // Skip today's games — they live in the dedicated "Today's games"
  // section in both regular and playoff modes. Without this exclusion
  // playoffs would double-list tonight's Game N (once here, once above).
  const todayEt = digestDatePlusOne(data.date);
  const upcoming = data.upcomingEvents
    .filter((e) => etCalendarDate(e.date) !== todayEt)
    .filter((e) => e.status === "scheduled" || e.status === "in_progress")
    .sort((a, b) => a.date.localeCompare(b.date));
  if (upcoming.length === 0) return "";

  // Cap at 12 to keep email size predictable. During playoffs that's ~7-10
  // days of basketball; during regular season it's a day or two of the
  // packed slate. If we ever want a longer view, raise the cap.
  const shown = upcoming.slice(0, 12);

  // Group by ET calendar date so each day gets a small header. Events
  // arrive sorted by UTC date already; ET buckets follow that ordering.
  const byDay = new Map<string, BasketballScoreboardEvent[]>();
  for (const e of shown) {
    const key = etCalendarDate(e.date);
    const list = byDay.get(key) ?? [];
    list.push(e);
    byDay.set(key, list);
  }

  const days = Array.from(byDay.entries()).map(([_key, events]) => {
    const label = etDayLabel(events[0]!.date);
    const rows = events.map((e) => {
      const tipoff = timeInET(e.date);
      const round = e.roundName ? ` · ${e.roundName}` : "";
      return `<li class="bb-upcoming-row">
        <span class="bb-upcoming-matchup">${escapeHtml(e.shortName)}</span>
        <span class="bb-upcoming-time">${escapeHtml(tipoff)}${escapeHtml(round)}</span>
      </li>`;
    }).join("");
    return `<div class="bb-upcoming-day">
  <h3 class="bb-upcoming-day-title">${escapeHtml(label)}</h3>
  <ul class="bb-upcoming">${rows}</ul>
</div>`;
  }).join("\n");

  return `
<section class="bb-section">
  <h2 class="bb-section-title">Upcoming games</h2>
  ${days}
</section>
`.trim();
}

// ---- Conference standings (regular season) ------------------------------

// Each conference renders as its own top-level section ("Eastern Conference"
// / "Western Conference") rather than packed into a single "Standings" box —
// matches baseball's per-league sectioning.
function renderConferenceSection(conf: BasketballConferenceStandings): string {
  const table = renderConference(conf, false);
  return `
<section class="bb-section">
  <h2 class="bb-section-title">${escapeHtml(conf.name)}</h2>
  ${table}
</section>
`.trim();
}

// ---- League leaders -------------------------------------------------------

function renderLeaders(leaders: BasketballLeaders): string {
  const nonEmpty = leaders.categories.filter((c) => c.entries.length > 0);
  if (nonEmpty.length === 0) return "";
  const tables = nonEmpty.map((c) => renderLeaderCategory(c)).join("\n");
  return `
<section class="bb-section">
  <h2 class="bb-section-title">League leaders</h2>
  ${tables}
</section>
`.trim();
}

function renderLeaderCategory(cat: LeaderCategory): string {
  const rows = cat.entries.map((e) =>
    `<tr>
      <td class="bb-ldr-rank">${e.rank}</td>
      <td class="bb-ldr-name">${escapeHtml(initialLast(e.athleteName))}</td>
      <td class="bb-ldr-team">${escapeHtml(e.teamAbbr)}</td>
      <td class="bb-ldr-value">${e.value.toFixed(1)}</td>
    </tr>`,
  ).join("");
  return `
<h3 class="bb-ldr-caption">${escapeHtml(cat.label)} <span class="bb-ldr-abbrev">${escapeHtml(cat.abbrev)}</span></h3>
<table class="bb-leader-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tbody>${rows}</tbody>
</table>
`.trim();
}

// ---- Today's games (regular season) -------------------------------------

// Add one day to a YYYY-MM-DD digest date. Pure UTC math — used only for
// string comparison against `etCalendarDate` output, so DST doesn't bite.
function digestDatePlusOne(digestDate: string): string {
  const [y, m, d] = digestDate.split("-").map(Number);
  const r = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return `${r.getUTCFullYear()}-${String(r.getUTCMonth() + 1).padStart(2, "0")}-${String(r.getUTCDate()).padStart(2, "0")}`;
}

function renderTodaysGames(data: BasketballData): string {
  const todayEt = digestDatePlusOne(data.date);
  // Don't filter by status — historical regens see these events as
  // 'final' now, but the section is "what was scheduled today" and the
  // tipoff time is still meaningful (and consistent across regens).
  const games = data.upcomingEvents
    .filter((e) => etCalendarDate(e.date) === todayEt)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (games.length === 0) return "";

  const rows = games.map((e) => {
    const tipoff = timeInET(e.date);
    return `<li class="bb-upcoming-row">
      <span class="bb-upcoming-matchup">${escapeHtml(e.shortName)}</span>
      <span class="bb-upcoming-time">${escapeHtml(tipoff)}</span>
    </li>`;
  }).join("");

  return `
<section class="bb-section">
  <h2 class="bb-section-title">Today&rsquo;s games</h2>
  <ul class="bb-upcoming">${rows}</ul>
</section>
`.trim();
}

// ---- Transactions --------------------------------------------------------

function renderTransactions(
  transactions: BasketballTransaction[],
  digestDate: string,
): string {
  // Daily digest, daily transactions — filter to moves on the digest's ET
  // calendar date. ESPN's transaction.date is a full ISO timestamp, so we
  // normalize via etCalendarDate before comparing.
  const sameDay = transactions.filter(
    (t) => t.date && etCalendarDate(t.date) === digestDate,
  );
  if (sameDay.length === 0) return "";
  const sorted = sameDay.sort((a, b) => b.date.localeCompare(a.date));
  const rows = sorted.map((t) => {
    const team = t.teamAbbr ? `<span class="bb-tx-team">${escapeHtml(t.teamAbbr)}</span>` : "";
    return `<li class="bb-tx-row">
      ${team}
      <span class="bb-tx-desc">${escapeHtml(t.description)}</span>
    </li>`;
  }).join("");
  return `
<section class="bb-section">
  <h2 class="bb-section-title">Transactions</h2>
  <ul class="bb-tx-list">${rows}</ul>
</section>
`.trim();
}

// ---- utility --------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] ?? c));
}

// ---- Email styles ---------------------------------------------------------
//
// Appended to EMAIL_STYLES at injection time. Same class names as the web
// site so the body HTML doesn't need to diverge by target. Inline-style
// equivalents on table elements (cellpadding="0" cellspacing="0" border="0")
// belong in the body itself for Outlook safety; the CSS below handles the
// rest of the layout.

export const BASKETBALL_EMAIL_STYLES = `
.bb-section { margin: 18px 0 24px; }
.bb-section-title {
  font-size: 20px; font-weight: 800; letter-spacing: 0.01em;
  margin: 22px 0 6px; padding-bottom: 4px;
  border-bottom: 2px solid #161410;
}
.bb-dateline {
  border-top: 3px double #161410; border-bottom: 1px solid #161410;
  padding: 8px 0; margin: 0 0 14px; text-align: center;
  font-style: italic; font-weight: 800; letter-spacing: -0.005em;
  font-size: 22px;
  font-size: clamp(16px, 4.2vw, 24px);
}
.bb-empty { font-size: 13px; color: #6a6354; font-style: italic;
            margin: 6px 0; text-align: center; }

.bb-game { margin: 18px 0 6px; padding-top: 6px; border-top: 1px solid #c4baa5; }
.bb-game-context { font-size: 11px; font-style: italic; color: #6a6354;
                   letter-spacing: 0.04em; margin-bottom: 2px; }
.bb-game-header { display: flex; justify-content: space-between;
                  align-items: baseline; margin: 0 0 4px;
                  padding-bottom: 3px; border-bottom: 1px solid #161410; }
.bb-game-matchup { font-size: 16px; font-weight: 700; }
.bb-game-status  { font-size: 11px; color: #6a6354; font-style: italic; }

.bb-bracket-round { margin: 10px 0 14px; }
.bb-bracket-round-title {
  font-size: 13px; font-weight: 700;
  margin: 10px 0 2px; padding-bottom: 2px;
  border-bottom: 1px solid #161410;
}
.bb-bracket-series { padding: 4px 0; border-bottom: 1px dotted #e8e2d4; }
.bb-bracket-series:last-child { border-bottom: none; }
.bb-bracket-matchup { font-size: 14px; font-weight: 700; }
.bb-bracket-vs { font-weight: 400; color: #6a6354;
                 font-style: italic; padding: 0 4px; }
.bb-bracket-summary { font-size: 12px; color: #6a6354; margin-top: 2px; }

.bb-leader-table { width: 100%; border-collapse: collapse;
                   font-size: 12px; margin: 6px 0 14px; }
.bb-ldr-caption {
  margin: 10px 0 2px; padding: 0 0 2px;
  font-size: 13px; font-weight: 700;
  border-bottom: 1px solid #161410;
}
.bb-ldr-abbrev { font-size: 10px; color: #6a6354;
                 margin-left: 6px; letter-spacing: 0.04em;
                 font-weight: 400; text-transform: uppercase; }
.bb-leader-table th, .bb-leader-table td {
  padding: 2px 4px; white-space: nowrap;
}
.bb-ldr-rank  { width: 24px; text-align: right; color: #6a6354; }
.bb-ldr-name  { text-align: left; font-size: 12px; }
.bb-ldr-team  { width: 36px; text-align: right; color: #6a6354;
                font-size: 11px; }
.bb-ldr-value { width: 48px; text-align: right; font-weight: 700; }

.bb-tx-list { list-style: none; padding: 0; margin: 8px 0 0; }
.bb-tx-row { display: flex; gap: 10px; padding: 4px 0;
             border-bottom: 1px dotted #e8e2d4;
             font-size: 12px; line-height: 1.4; }
.bb-tx-row:last-child { border-bottom: none; }
.bb-tx-team { flex-shrink: 0; min-width: 40px;
              font-size: 11px; font-weight: 700;
              letter-spacing: 0.04em; color: #2a2620;
              padding-top: 1px; }
.bb-tx-desc { font-size: 12px; }

.bb-upcoming-day { margin: 8px 0 12px; }
.bb-upcoming-day-title {
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.08em;
  margin: 0 0 4px; padding-bottom: 2px;
  border-bottom: 1px solid #161410; color: #6a6354;
}
.bb-upcoming { list-style: none; padding: 0; margin: 0; }
.bb-upcoming-row { display: flex; justify-content: space-between;
                   align-items: baseline; gap: 8px;
                   padding: 4px 0; border-bottom: 1px dotted #e8e2d4;
                   font-size: 12px; }
.bb-upcoming-row:last-child { border-bottom: none; }
.bb-upcoming-matchup { font-weight: 700; }
.bb-upcoming-time { color: #6a6354; font-style: italic; }

.bb-linescore { width: 100%; border-collapse: collapse; margin: 0 0 6px;
                font-size: 12px; table-layout: fixed; }
.bb-linescore th, .bb-linescore td {
  padding: 2px 4px; text-align: right; white-space: nowrap;
}
.bb-linescore thead th {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em;
  border-bottom: 1px solid #161410;
}
.bb-ls-team       { text-align: left !important; font-weight: 700;
                    width: 18%; font-size: 12px; }
.bb-ls-team-head  { text-align: left !important; }
.bb-ls-total      { font-weight: 700; }
.bb-ls-cell       { min-width: 22px; }

.bb-box { display: block; margin: 4px 0 0; }
.bb-player-table { width: 100%; border-collapse: collapse;
                   font-size: 12px; margin: 6px 0 10px;
                   table-layout: fixed; }
.bb-team-caption {
  margin: 10px 0 2px; padding: 0 0 2px;
  font-size: 13px; font-weight: 700;
  border-bottom: 1px solid #161410;
}
.bb-player-table th, .bb-player-table td {
  padding: 2px 3px; text-align: right; white-space: nowrap;
}
.bb-player-table th {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em;
  border-bottom: 1px solid #161410;
}
.bb-pl-name      { text-align: left !important; font-size: 12px;
                   width: 38%; white-space: normal; word-break: break-word; }
.bb-pl-pos       { font-size: 10px; color: #6a6354; margin-left: 3px;
                   text-transform: lowercase; letter-spacing: 0.04em;
                   white-space: nowrap; font-weight: 400; }
.bb-pl-stat      { min-width: 22px; }
.bb-player-table tfoot td { font-weight: 700; border-top: 1px solid #161410; }

.bb-standings-grid { display: block; }
.bb-standings-table { width: 100%; border-collapse: collapse;
                      font-size: 12px; margin: 6px 0 14px; }
.bb-conf-caption {
  margin: 10px 0 2px; padding: 0 0 2px;
  font-size: 13px; font-weight: 700;
  border-bottom: 1px solid #161410;
}
.bb-standings-table th, .bb-standings-table td {
  padding: 2px 4px; text-align: right; white-space: nowrap;
}
.bb-standings-table th {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em;
  border-bottom: 1px solid #161410;
}
.bb-st-rank { width: 24px; text-align: right !important; color: #6a6354; }
.bb-st-team { text-align: left !important; font-size: 12px; }
.bb-st-stat { min-width: 36px; }
`;
