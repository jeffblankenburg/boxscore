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
  BasketballConferenceStandings,
  BasketballStandings,
  BasketballStandingsEntry,
  BasketballLeaders,
  BasketballRanking,
  BasketballTeam,
  LeaderCategory,
  BasketballTransaction,
} from "./basketball";
import { lastName } from "./render-email";
import { timeInET, etDateFromISO } from "./dates";
import { renderBracket } from "./playoff-bracket";
import { renderMasthead, type NavSport } from "./masthead";
import {
  teamLinkByNickname,
  playerLink,
  slugifyName,
  escText,
  linkAnchor,
  teamLinkByEspnId,
  type BasketballLeague,
} from "./basketball-links";
import { BASKETBALL_LEADER_CATEGORY_SLUG } from "./basketball-leaders";
import type { BasketballConference } from "./basketball-conferences";

// Link a team by its ESPN nickname ("Cavaliers") to its team page; a player by
// ESPN athlete id to their player page. `web` picks relative vs absolute href +
// the unstyled team-link/player-link (web) or es-*-link (email) class. Both
// return escape-safe HTML, so call sites pass raw names (no pre-escaping).
export function teamNameLink(name: string, web: boolean, league: BasketballLeague): string {
  return teamLinkByNickname(league, name, name, web);
}

function isCollege(league: BasketballLeague): boolean {
  return league === "ncaam" || league === "ncaaw";
}

// AP rank badge for a ranked college team.
function rankBadge(rank: number | null | undefined): string {
  return rank ? `<span class="bb-rank">${rank}</span> ` : "";
}

// A team's label in scores/box headers: rank badge + linked name. College shows
// the SCHOOL (location) and links by espnId — nicknames collide across 362
// teams; the pros show the nickname and link by it.
function teamLabel(team: BasketballTeam, web: boolean, league: BasketballLeague): string {
  if (isCollege(league)) {
    const display = team.location || team.name;
    return rankBadge(team.rank) + teamLinkByEspnId(league, team.id, display, web);
  }
  return teamNameLink(team.name, web, league);
}

// Order games ranked-first for college (best AP rank leads); feed order
// otherwise. A game's sort key is the better (lower) rank of its two teams.
function orderGamesForCollege<T extends { event: BasketballScoreboardEvent }>(games: T[], league: BasketballLeague): T[] {
  if (!isCollege(league)) return games;
  const key = (e: BasketballScoreboardEvent) => Math.min(e.away.team.rank ?? 999, e.home.team.rank ?? 999);
  return [...games].sort((a, b) => key(a.event) - key(b.event));
}

// A game involving at least one ranked (Top 25) team — the college box-score filter.
function isRankedGame(e: BasketballScoreboardEvent): boolean {
  return e.away.team.rank != null || e.home.team.rank != null;
}

// One upcoming/today row. Web uses the flex layout (matchup left, time right, TV
// wraps). Email can't: mail clients shrink-wrap the flex row so space-between
// collapses and the spans run together, and Gmail strips the <style> block —
// so email gets inline styles + an explicit gap + TV on its own line, which
// survive every client. `matchup` is anchor HTML; `meta`/`tv` are escaped text.
function upcomingRow(matchup: string, meta: string, tv: string, web: boolean): string {
  if (web) {
    return `<li class="bb-upcoming-row">
      <span class="bb-upcoming-matchup">${matchup}</span>
      <span class="bb-upcoming-time">${meta}</span>
      ${tv ? `<span class="bb-upcoming-tv">${tv}</span>` : ""}
    </li>`;
  }
  return `<li style="padding:5px 0;border-bottom:1px dotted #e8e2d4;list-style:none">`
    + `<span style="font-weight:700">${matchup}</span>`
    + (meta ? `<span style="color:#6a6354;font-style:italic">&nbsp;&nbsp;${meta}</span>` : "")
    + (tv ? `<br><span style="font-size:11px;color:#6a6354">${tv}</span>` : "")
    + `</li>`;
}
export function playerNameLink(
  id: string,
  fullName: string,
  visible: string,
  web: boolean,
  league: BasketballLeague,
): string {
  if (!id) return escText(visible);
  return playerLink(league, { id, slug: slugifyName(fullName) }, visible, web);
}

// 7-column box score per Jeff's call. The full ESPN set has 14; these are
// the high-signal ones for a glance. Tweak this array to change the line.
const PLAYER_STAT_COLUMNS: ReadonlyArray<{ key: string; label: string }> = [
  // Keys are ESPN's own box-score column names (the `names` array). Shooting
  // is grouped after PTS (FG, then 3PT); TO trails the defensive counts.
  { key: "MIN", label: "MIN" },
  { key: "PTS", label: "PTS" },
  { key: "FG", label: "FG" },
  { key: "3PT", label: "3PT" },
  { key: "REB", label: "REB" },
  { key: "AST", label: "AST" },
  { key: "STL", label: "STL" },
  { key: "BLK", label: "BLK" },
  { key: "TO", label: "TO" },
];

// Standings columns. The standings "stats" map uses these ESPN names.
const STANDINGS_COLUMNS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "wins", label: "W" },
  { key: "losses", label: "L" },
  { key: "winPercent", label: "PCT" },
  { key: "gamesBehind", label: "GB" },
  { key: "streak", label: "STRK" },
];

export function renderBasketballContent(data: BasketballData, navSports: NavSport[] = []): string {
  return renderBody(data, true, navSports);
}

export function renderBasketballEmailContent(data: BasketballData, navSports: NavSport[] = []): string {
  return renderBody(data, false, navSports);
}

// A conference-scoped digest (college): the full conference standings — which
// the ranked-focused league digest omits — plus that conference's scores and
// every one of its box scores. Web-only (like the football conference page);
// `data` should already be scoped via scopeBasketballToConference.
export function renderBasketballConferenceContent(
  data: BasketballData,
  conf: BasketballConference,
  navSports: NavSport[] = [],
  web = true,
): string {
  const league = data.sport;
  const masthead = renderMasthead({ date: data.date, sport: data.sport, surface: web ? "web" : "email", navSports });
  const header = `<div class="bb-team-heading">${escapeHtml(conf.short)}</div>`;
  const sections = [
    masthead,
    header,
    renderStandingsColumns(data.standings, web, league, data.isPreseason),
    renderYesterdayResults(data, web, league),
    renderResults(data, "Box Scores", web, league, true),
  ];
  return sections.filter((s) => s.length > 0).join("\n");
}

// Email variant of the conference digest (same body, email surface). Wrapped by
// the send-conference-email cron in the teamDailyEmail shell + BASKETBALL styles.
export function renderBasketballConferenceEmailContent(
  data: BasketballData,
  conf: BasketballConference,
  navSports: NavSport[] = [],
): string {
  return renderBasketballConferenceContent(data, conf, navSports, false);
}

// ---- Body -----------------------------------------------------------------

function renderBody(data: BasketballData, web: boolean, navSports: NavSport[]): string {
  const league = data.sport;
  const masthead = renderMasthead({
    date: data.date, sport: data.sport, surface: web ? "web" : "email", navSports,
  });
  // College (NCAAM/NCAAW): ranked-focused, and it NEVER uses the best-of-series
  // playoff branch below — the NCAA tournament is single-elimination (its
  // bracket is a separate, later feature), and the 14-day upcoming window would
  // otherwise flip isPlayoffs true in March and hijack the layout. AP Top 25
  // leads, then the day's scores (ranked first), Top-25 box scores, league-wide
  // leaders, tonight's ranked matchups. No full standings — 31 conferences
  // would bloat the email; they live on the conference pages.
  if (isCollege(league)) {
    const sections = [
      masthead,
      renderRankings(data.rankings, web, league),
      renderYesterdayResults(data, web, league),
      renderResults(data, "Top 25 Box Scores", web, league),
      renderLeaders(data.leaders, data.sport, web, league, data.isPreseason),
      renderTodaysGames(data, web, league),
      renderTransactions(data.transactions, web),
    ];
    return sections.filter((s) => s.length > 0).join("\n");
  }

  // Playoffs and regular-season modes use different section orders. Playoffs
  // leads with the result (the big news is the game just played), then the
  // current series state, then what's coming up. Regular season mirrors
  // baseball: league context first (standings + leaders), then today's
  // schedule, then yesterday's box scores, then transactions.
  if (data.isPlayoffs) {
    // Prefer the reconstructed visual bracket; fall back to the text series
    // glance if the bracket scan turned up nothing (e.g. a brand-new postseason
    // with a single game's worth of data).
    const bracket = data.bracket
      ? renderBracket(data.bracket, (name) => teamNameLink(name, web, league))
      : "";
    const sections = [
      masthead,
      renderResults(data, "Yesterday\u2019s games", web, league),
      bracket || renderPlayoffSeries(data, web, league),
      // Today's games surfaces a Game N of an ongoing series scheduled for
      // tonight — should always be visible above the broader upcoming
      // list. Upcoming then covers the rest of the postseason window.
      renderTodaysGames(data, web, league),
      renderUpcomingGames(data, web, league),
    ];
    return sections.filter((s) => s.length > 0).join("\n");
  }

  const sections = [
    masthead,
    renderStandingsColumns(data.standings, web, league, data.isPreseason),
    renderLeaders(data.leaders, data.sport, web, league, data.isPreseason),
    renderYesterdayResults(data, web, league),
    renderTodaysGames(data, web, league),
    renderResults(data, data.isPreseason ? "Box scores (Preseason)" : "Box scores", web, league),
    renderTransactions(data.transactions),
  ];
  return sections.filter((s) => s.length > 0).join("\n");
}

// ---- Rankings (college only) ----------------------------------------------

// AP Top 25 (+ Coaches), shown side by side like the football digest. Each
// entry: rank, school (linked), record, and a trend glyph vs the previous poll.
function renderRankings(rankings: BasketballRanking[], web: boolean, league: BasketballLeague): string {
  const polls = rankings.filter((p) => p.entries.length > 0).slice(0, 2);
  if (polls.length === 0) return "";
  const tables = polls.map((poll) => {
    const rows = poll.entries.map((e) => {
      const trend = e.previousRank == null
        ? `<span class="bb-rk-new">NR</span>`
        : e.previousRank > e.rank
          ? `<span class="bb-rk-up">▲</span>`
          : e.previousRank < e.rank
            ? `<span class="bb-rk-down">▼</span>`
            : `<span class="bb-rk-flat">–</span>`;
      const link = teamLinkByEspnId(league, e.team.id, e.team.school, web);
      return `<tr>
        <td class="bb-rk-rank">${e.rank}</td>
        <td class="bb-rk-team">${link}${e.record ? ` <span class="bb-rk-rec">(${escapeHtml(e.record)})</span>` : ""}</td>
        <td class="bb-rk-trend">${trend}</td>
      </tr>`;
    }).join("");
    return `<div class="bb-rk-col">
  <h3 class="bb-rk-caption">${escapeHtml(poll.poll)}</h3>
  <table class="bb-rk-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tbody>${rows}</tbody></table>
</div>`;
  }).join("");
  return `
<section class="bb-section">
  <h2 class="bb-section-title">Rankings</h2>
  <div class="bb-rk-cols">${tables}</div>
</section>
`.trim();
}

// ---- Yesterday's results (compact score-line list) ------------------------

// Mirrors the MLB digest's "Yesterday's Results" section — a compact grid of
// one-line scores (winner bolded) that sits between league leaders and
// today's games, above the full box scores. Reuses the sport-neutral
// games-section / games-grid / game-score-line classes so the web styling is
// identical to MLB with no new CSS; the email surface gets matching rules in
// BASKETBALL_EMAIL_STYLES.
function renderYesterdayResults(data: BasketballData, web: boolean, league: BasketballLeague): string {
  const games = orderGamesForCollege(
    data.games.filter((g) => g.event.status === "final" || g.event.status === "in_progress"),
    league,
  );
  if (games.length === 0) return "";
  const lines = games.map((g) => {
    const { away, home, status, statusDetail } = g.event;
    const aScore = away.score ?? 0;
    const hScore = home.score ?? 0;
    const aClass = aScore > hScore ? "winner" : "";
    const hClass = hScore > aScore ? "winner" : "";
    const tag = status === "final"
      ? ""
      : ` <span class="game-line-status">(${escapeHtml(statusDetail || status)})</span>`;
    return `<div class="game-score-line">
      <span class="${aClass}">${teamLabel(away.team, web, league)} ${aScore}</span>, <span class="${hClass}">${teamLabel(home.team, web, league)} ${hScore}</span>${tag}
    </div>`;
  }).join("");
  const title = isCollege(league) ? "Scores" : data.isPreseason ? "Preseason Results" : "Yesterday’s Results";
  return `<div class="games-section">
  <div class="games-section-title">${title}</div>
  <div class="games-grid">${lines}</div>
</div>`;
}

// ---- Yesterday's box scores -----------------------------------------------

// team id → "W-L" from the conference standings, for the linescore labels.
function buildRecordMap(standings: BasketballStandings): Map<string, string> {
  const out = new Map<string, string>();
  for (const conf of standings.conferences) {
    for (const e of conf.entries) {
      const w = e.stats["wins"]?.displayValue;
      const l = e.stats["losses"]?.displayValue;
      if (w && l) out.set(e.team.id, `${w}-${l}`);
    }
  }
  return out;
}

function renderResults(data: BasketballData, title: string, web: boolean, league: BasketballLeague, allGames = false): string {
  let finalsAndLive = data.games.filter(
    (g) => g.event.status === "final" || g.event.status === "in_progress",
  );
  // College LEAGUE digest shows only Top-25 box scores (a full D1 night is 100+
  // games), ranked games first — the compact Scores list covers the rest. The
  // conference page passes allGames=true to show every conference game.
  if (isCollege(league)) {
    const filtered = allGames ? finalsAndLive : finalsAndLive.filter((g) => isRankedGame(g.event));
    finalsAndLive = orderGamesForCollege(filtered, league);
  }
  if (finalsAndLive.length === 0) {
    // College: no ranked games today — hide the Top-25 box section entirely
    // (the Scores list already covered the full slate).
    if (isCollege(league)) return "";
    const total = data.games.length;
    return `
<section class="bb-section">
  <h2 class="bb-section-title">${escapeHtml(title)}</h2>
  <p class="bb-empty">${total === 0 ? "No games scheduled." : `${total} game${total === 1 ? "" : "s"} on the slate, none final yet.`}</p>
</section>
`.trim();
  }
  const records = buildRecordMap(data.standings);
  const blocks = finalsAndLive.map((g) => renderGameBlock(g.event, g.box, web, league, records));
  // Box scores flow into CSS columns on wide web (same technique as the MLB
  // digest's .boxscores-container) — 3 → 2 → 1 by viewport. The .bb-boxscores
  // class is web-only; it's absent from BASKETBALL_EMAIL_STYLES, so email
  // falls back to a single stacked column (CSS columns aren't email-safe).
  return `
<section class="bb-section">
  <h2 class="bb-section-title">${escapeHtml(title)}</h2>
  <div class="bb-boxscores">${blocks.join("\n")}</div>
</section>
`.trim();
}

// Individual box-score blocks — for the cross-sport home page masonry. College
// shows only ranked games (a full D1 night is 100+), matching the league digest.
export function renderBasketballGames(data: BasketballData, web: boolean, league: BasketballLeague): string[] {
  let games = data.games.filter((g) => g.event.status === "final" || g.event.status === "in_progress");
  if (isCollege(league)) games = orderGamesForCollege(games.filter((g) => isRankedGame(g.event)), league);
  if (games.length === 0) return [];
  const records = buildRecordMap(data.standings);
  return games.map((g) => renderGameBlock(g.event, g.box, web, league, records));
}

export function renderGameBlock(
  event: BasketballScoreboardEvent,
  box: BasketballBoxscore | undefined,
  web: boolean,
  league: BasketballLeague,
  records?: Map<string, string>,
): string {
  const lineScore = renderLineScore(event, league, records);
  const boxTables = box ? renderBoxScore(box, web, league) : "";
  // Playoff series context: round + current state above the matchup. Only
  // present on postseason events; regular-season game blocks skip it. Round
  // leads ("NBA Finals"), series state trails in parens ("NBA Finals (NY
  // leads series 3-1)") — a bare summary with no round read as a mystery
  // "wins series 4-1" line before the round label was wired up.
  const round = event.roundName;
  const summary = event.series?.summary;
  // Exhibition games (seasonType=1) get a "Preseason" tag in the same context
  // slot the playoffs use for the round, so a box score is never mistaken for
  // one that counts. Postseason context takes precedence when both somehow set.
  const preseasonTag = event.seasonType === 1 ? "Preseason" : "";
  const contextText = round
    ? summary ? `${round} (${summary})` : round
    : summary || preseasonTag;
  const context = contextText
    ? `<div class="bb-game-context">${escapeHtml(contextText)}</div>`
    : "";
  // Consistent box-score header (matches MLB): road team first, score each,
  // with an overtime note. Nicknames link to their team page; college shows the
  // school + AP rank badge. "Final" is implied on a results page, so it's gone.
  const regP = isCollege(league) ? 2 : 4;
  const otP = Math.max(event.away.linescores.length, event.home.linescores.length) - regP;
  const otLabel = otP === 1 ? " (OT)" : otP > 1 ? ` (${otP}OT)` : "";
  const head =
    `${teamLabel(event.away.team, web, league)} ${event.away.score ?? ""}, ` +
    `${teamLabel(event.home.team, web, league)} ${event.home.score ?? ""}${otLabel}`;
  const header = web
    ? `<header class="bb-game-header"><span class="bb-game-matchup">${head}</span></header>`
    : `<header style="margin:0 0 4px"><span style="font-weight:700">${head}</span></header>`;
  return `
<article class="bb-game">
  ${header}
  ${context}
  ${lineScore}
  ${boxTables}
</article>
`.trim();
}

function renderLineScore(event: BasketballScoreboardEvent, league: BasketballLeague, records?: Map<string, string>): string {
  // Regulation is 2 halves in college, 4 quarters in the pros; anything beyond
  // is overtime. Render whichever periods either side has a linescore for.
  // ESPN's linescores arrays are sorted by period, so max length covers both.
  const regPeriods = isCollege(league) ? 2 : 4;
  const maxPeriods = Math.max(
    event.away.linescores.length,
    event.home.linescores.length,
    regPeriods,
  );
  const periodLabels: string[] = [];
  for (let i = 1; i <= maxPeriods; i++) {
    periodLabels.push(
      i <= regPeriods ? (regPeriods === 2 ? `H${i}` : `Q${i}`) : `OT${i - regPeriods}`,
    );
  }

  // No winner highlight per the newspaper aesthetic — the score column
  // tells you who won; styling restraint stays consistent with baseball.
  const renderRow = (side: BasketballScoreboardEvent["away"]) => {
    const cells = periodLabels.map((_, i) => {
      const ls = side.linescores[i];
      return `<td class="bb-ls-cell">${ls ? ls.value : ""}</td>`;
    }).join("");
    const total = side.score == null ? "" : String(side.score);
    const label = escapeHtml(side.team.abbreviation || side.team.name);
    const rec = records?.get(side.team.id);
    const recHtml = rec ? ` <span class="bb-ls-rec">(${escapeHtml(rec)})</span>` : "";
    return `<tr><th class="bb-ls-team">${label}${recHtml}</th>${cells}<td class="bb-ls-total">${total}</td></tr>`;
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

function renderBoxScore(box: BasketballBoxscore, web: boolean, league: BasketballLeague): string {
  return `<div class="bb-box">
  ${box.teams.map((t) => renderBoxTeam(t, web, league)).join("\n")}
</div>`;
}

function renderBoxTeam(team: BasketballBoxTeam, web: boolean, league: BasketballLeague): string {
  // Official box-score order: the five starters first (in ESPN's listed
  // order, which already follows the official position order), then the
  // bench. We deliberately do NOT re-sort by minutes — the request was to
  // mirror the official box, which groups starters vs reserves.
  const played = team.players.filter(
    (p) => !p.didNotPlay && Object.keys(p.stats).length > 0,
  );
  const starters = played.filter((p) => p.starter);
  const reserves = played.filter((p) => !p.starter);
  const ordered = [...starters, ...reserves];

  // Mark the first bench row so CSS can draw a subtle rule between the
  // starters and reserves, the way the printed box score separates them.
  const benchStart =
    starters.length > 0 && reserves.length > 0 ? starters.length : -1;
  const rows = ordered
    .map((p, i) => renderPlayerRow(p, web, league, i === benchStart))
    .join("");
  const totals = renderTotalsRow(team);

  // Team name (nickname link) renders as an h3 sibling above the table
  // (matches MLB's sub-h pattern) rather than a <caption> inside — captions
  // don't reliably span table width across email clients.
  return `
<h3 class="bb-team-caption">${teamLabel(team.team, web, league)}</h3>
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

function renderPlayerRow(p: BasketballPlayerLine, web: boolean, league: BasketballLeague, benchStart = false): string {
  const cells = PLAYER_STAT_COLUMNS.map((c) =>
    `<td class="bb-pl-stat">${escapeHtml(p.stats[c.key] ?? "")}</td>`,
  ).join("");
  // Last name only ("Doncic"), matching baseball's box convention. With nine
  // stat columns the name has to stay narrow to keep the whole box inside
  // 400px; the first initial was costing width we need for the numbers.
  const name = playerNameLink(p.athleteId, p.displayName, lastName(p.displayName), web, league);
  const pos = p.position ? p.position.toLowerCase() : "";
  const nameCell = pos
    ? `${name} <span class="bb-pl-pos">${escapeHtml(pos)}</span>`
    : name;
  const trClass = benchStart ? ' class="bb-pl-bench"' : "";
  return `<tr${trClass}><td class="bb-pl-name">${nameCell}</td>${cells}</tr>`;
}

// "Devin Vassell" → "D. Vassell". Falls back to the full string for one-word
// names. Hyphenated/multi-word last names ("Gilgeous-Alexander",
// "Antetokounmpo") survive intact because lastName() handles them.
export function initialLast(full: string): string {
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

// ---- Standings ------------------------------------------------------------

// Standings order: by playoff seed once ESPN assigns them (late season /
// postseason), otherwise by win% with explicit tiebreakers — more wins, then
// fewer losses — so two 1.000 teams never show the 2-0 above the 3-0. Teams
// with an identical record keep ESPN's order (stable sort), preserving its
// official head-to-head tiebreak. Shared by the league digest and the team
// page so both order standings the same way.
export function compareBasketballStanding(a: BasketballStandingsEntry, b: BasketballStandingsEntry): number {
  const seedA = a.stats.playoffSeed?.value;
  const seedB = b.stats.playoffSeed?.value;
  // Only trust the seed when it actually distinguishes the two — ESPN has been
  // seen handing the same seed to multiple teams early season, so an equal seed
  // falls through to the record tiebreakers below.
  if (seedA && seedB && seedA !== seedB) return seedA - seedB;
  const pct = (b.stats.winPercent?.value ?? 0) - (a.stats.winPercent?.value ?? 0);
  if (pct !== 0) return pct;
  const wins = (b.stats.wins?.value ?? 0) - (a.stats.wins?.value ?? 0);
  if (wins !== 0) return wins;
  return (a.stats.losses?.value ?? 0) - (b.stats.losses?.value ?? 0);
}

function renderConference(conf: BasketballConferenceStandings, web: boolean, league: BasketballLeague): string {
  const sorted = [...conf.entries].sort(compareBasketballStanding);

  // No inner caption — the section's h2 ("Eastern Conference Standings")
  // already labels the table; a repeated <h3> here was a double header.
  const rows = sorted.map((e, i) => renderStandingsRow(e, i + 1, web, league)).join("");
  return `
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

function renderStandingsRow(entry: BasketballStandingsEntry, rank: number, web: boolean, league: BasketballLeague): string {
  const team = entry.team;
  const cells = STANDINGS_COLUMNS.map((c) => {
    const stat = entry.stats[c.key];
    const display = stat?.displayValue ?? "";
    return `<td class="bb-st-stat">${escapeHtml(display)}</td>`;
  }).join("");
  // Pros show the nickname ("Cavaliers", like baseball); college shows the
  // school ("Michigan") and links by espnId via teamLabel.
  const name = isCollege(league) ? teamLabel(team, web, league) : teamNameLink(team.name, web, league);
  return `<tr><td class="bb-st-rank">${rank}</td><td class="bb-st-team">${name}</td>${cells}</tr>`;
}

// ---- Playoff series (Glance) ----------------------------------------------
//
// Newspaper-style "Playoff Glance": collects active series from today's games
// plus the upcoming window, dedupes by sorted competitor pair, and groups by
// round name. The "state" of each series comes straight from ESPN's
// `series.summary` text ("SA leads series 1-0") so we don't have to recompute.

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

function renderPlayoffSeries(data: BasketballData, web: boolean, league: BasketballLeague): string {
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
        <div class="bb-bracket-matchup">${teamNameLink(s.awayName, web, league)} <span class="bb-bracket-vs">vs</span> ${teamNameLink(s.homeName, web, league)}</div>
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
const etCalendarDate = etDateFromISO;

// "Sat, Aug 16" — compact header for a transaction day group. Exported so the
// team renderer groups identically. Input is a YYYY-MM-DD (ET); render in UTC
// so the label matches the key it was grouped under.
export function txDateLabel(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function renderUpcomingGames(data: BasketballData, web: boolean, league: BasketballLeague): string {
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
      const matchup = `${teamNameLink(e.away.team.name, web, league)} @ ${teamNameLink(e.home.team.name, web, league)}`;
      return upcomingRow(matchup, `${escapeHtml(tipoff)}${escapeHtml(round)}`, e.tv.length ? escapeHtml(e.tv.join(" / ")) : "", web);
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

// The two conference sections sit side by side on wide web (bb-standings-cols
// is a 2-col grid, mirroring MLB's AL/NL league-layout); email and narrow
// viewports stack them. Empty conferences → "" so the wrapper never emits a
// bare grid.
function renderStandingsColumns(standings: BasketballData["standings"], web: boolean, league: BasketballLeague, preseason = false): string {
  if (standings.conferences.length === 0) return "";
  const cols = standings.conferences.map((c) => renderConferenceSection(c, web, league, preseason)).join("\n");
  return `<div class="bb-standings-cols">${cols}</div>`;
}

// Each conference renders as its own section ("Eastern Conference Standings" /
// "Western Conference Standings") rather than packed into a single "Standings"
// box — matches baseball's per-league sectioning. The "(Preseason)" qualifier
// makes clear the W-L is exhibition, not the real season.
function renderConferenceSection(conf: BasketballConferenceStandings, web: boolean, league: BasketballLeague, preseason = false): string {
  const table = renderConference(conf, web, league);
  const suffix = preseason ? " Standings (Preseason)" : " Standings";
  return `
<section class="bb-section">
  <h2 class="bb-section-title">${escapeHtml(conf.name)}${suffix}</h2>
  ${table}
</section>
`.trim();
}

// ---- League leaders -------------------------------------------------------

function renderLeaders(leaders: BasketballLeaders, sport: BasketballData["sport"], web: boolean, league: BasketballLeague, preseason = false): string {
  const nonEmpty = leaders.categories.filter((c) => c.entries.length > 0);
  // ESPN doesn't aggregate preseason into its byathlete leaderboard, so this is
  // normally empty in the preseason and the section hides — but if a future
  // feed ever populates it, label it so exhibition numbers aren't mistaken for
  // real-season leaders.
  if (nonEmpty.length === 0) return "";
  const tables = nonEmpty.map((c) => renderLeaderCategory(c, web, league)).join("\n");
  // "NBA League Leaders" / "WNBA League Leaders" — this renderer is shared
  // by both leagues, so the label comes from the slug, not a constant.
  const title = preseason ? `${sport.toUpperCase()} Preseason Leaders` : `${sport.toUpperCase()} League Leaders`;
  return `
<section class="bb-section">
  <h2 class="bb-section-title">${title}</h2>
  <div class="bb-leaders-cols">${tables}</div>
</section>
`.trim();
}

function renderLeaderCategory(cat: LeaderCategory, web: boolean, league: BasketballLeague): string {
  const rows = cat.entries.map((e) =>
    `<tr>
      <td class="bb-ldr-rank">${e.rank}</td>
      <td class="bb-ldr-name">${playerNameLink(e.athleteId, e.athleteName, initialLast(e.athleteName), web, league)}</td>
      <td class="bb-ldr-team">${escapeHtml(e.teamAbbr)}</td>
      <td class="bb-ldr-value">${escapeHtml(e.displayValue)}</td>
    </tr>`,
  ).join("");
  // The category heading links to the full-season leaderboard for that stat.
  const slug = BASKETBALL_LEADER_CATEGORY_SLUG[cat.key];
  const captionLabel = slug
    ? linkAnchor(`/${league}/leaders/${slug}`, cat.label, web, "leader-cat-link", "es-leader-cat-link")
    : escapeHtml(cat.label);
  // Wrapped so caption + table stay together as one unit when the parent
  // flows into columns (bb-leaders-cols sets break-inside: avoid on this).
  return `
<div class="bb-ldr-cat">
<h3 class="bb-ldr-caption">${captionLabel}${cat.abbrev ? ` <span class="bb-ldr-abbrev">${escapeHtml(cat.abbrev)}</span>` : ""}</h3>
<table class="bb-leader-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tbody>${rows}</tbody>
</table>
</div>
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

function renderTodaysGames(data: BasketballData, web: boolean, league: BasketballLeague): string {
  const todayEt = digestDatePlusOne(data.date);
  // Don't filter by status — historical regens see these events as
  // 'final' now, but the section is "what was scheduled today" and the
  // tipoff time is still meaningful (and consistent across regens).
  let games = data.upcomingEvents
    .filter((e) => etCalendarDate(e.date) === todayEt)
    .sort((a, b) => a.date.localeCompare(b.date));
  // College: only ranked matchups (a full slate is 100+ games), ranked first.
  if (isCollege(league)) games = games.filter(isRankedGame).sort((a, b) =>
    Math.min(a.away.team.rank ?? 999, a.home.team.rank ?? 999) - Math.min(b.away.team.rank ?? 999, b.home.team.rank ?? 999));
  if (games.length === 0) return "";

  const rows = games.map((e) => {
    const tipoff = timeInET(e.date);
    const matchup = `${teamLabel(e.away.team, web, league)} @ ${teamLabel(e.home.team, web, league)}`;
    return upcomingRow(matchup, escapeHtml(tipoff), e.tv.length ? escapeHtml(e.tv.join(" / ")) : "", web);
  }).join("");

  return `
<section class="bb-section">
  <h2 class="bb-section-title">Today&rsquo;s games</h2>
  <ul class="bb-upcoming">${rows}</ul>
</section>
`.trim();
}

// ---- Transactions --------------------------------------------------------

function renderTransactions(transactions: BasketballTransaction[], web = true): string {
  if (transactions.length === 0) return "";
  // The list spans every move since the previous league game (see
  // transactionsSinceLastLeagueGame), so group by ET day — newest first — with
  // a date header; an off-day move reads as its own day even a week later.
  const byDay = new Map<string, BasketballTransaction[]>();
  for (const t of transactions) {
    const day = etCalendarDate(t.date);
    if (!day) continue;
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(t);
  }
  const blocks = [...byDay.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((day) => {
      const rows = byDay.get(day)!
        .sort((a, b) => (a.teamAbbr ?? "").localeCompare(b.teamAbbr ?? "") || a.description.localeCompare(b.description))
        .map((t) => {
          const abbr = t.teamAbbr ? escapeHtml(t.teamAbbr) : "";
          // Web: flex row (abbr column + desc). Email can't rely on flex, so
          // inline-style with an explicit gap so the abbr doesn't fuse into the
          // description.
          if (!web) {
            const team = abbr ? `<span style="font-weight:700">${abbr}</span>&nbsp;&nbsp;` : "";
            return `<li style="padding:4px 0;list-style:none">${team}<span>${escapeHtml(t.description)}</span></li>`;
          }
          const team = abbr ? `<span class="bb-tx-team">${abbr}</span>` : "";
          return `<li class="bb-tx-row">
      ${team}
      <span class="bb-tx-desc">${escapeHtml(t.description)}</span>
    </li>`;
        })
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

// ---- utility --------------------------------------------------------------

export function escapeHtml(s: string): string {
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
.es-team-link, .bb-team-link { color: inherit !important; text-decoration: none !important; }
.es-player-link, .bb-player-link { color: inherit !important; text-decoration: none !important; }
.bb-team-heading { font-size: 24px; font-weight: 800; letter-spacing: -0.01em;
                   margin: 4px 0 10px; text-align: center; }
.bb-team-record { font-weight: 400; color: #6a6354; }
.bb-standings-table tr.bb-st-me td { background-color: rgba(0, 0, 0, 0.07); font-weight: 700; }
.bb-dateline {
  border-top: 3px double #161410; border-bottom: 1px solid #161410;
  padding: 8px 0; margin: 0 0 14px; text-align: center;
}
.bb-dateline-text {
  font-style: italic; font-weight: 800; letter-spacing: -0.005em;
  font-size: 22px;
  font-size: clamp(16px, 4.2vw, 24px);
}
.bb-empty { font-size: 13px; color: #6a6354; font-style: italic;
            margin: 6px 0; text-align: center; }

/* Compact "Yesterday's Results" — mirrors the web games-section, but stacks
   single-column for email reliability (CSS grid is spotty across clients). */
.games-section { padding: 10px 0; border-top: 2px solid #161410; }
.games-section-title { font-size: 16px; font-weight: 700; margin-bottom: 8px;
                       border-bottom: 1px solid #161410; padding-bottom: 4px; }
.games-grid { display: block; }
.game-score-line { font-size: 14px; line-height: 1.5; padding: 2px 0;
                   border-bottom: 1px dotted #e8e2d4; }
.game-score-line .winner { font-weight: 700; }
.game-line-status { color: #6a6354; }

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

/* Visual bracket — email stacks rounds vertically (flex is unreliable in
   Outlook); the same markup lays out horizontally on the web via globals.css. */
.pb-bracket { margin: 6px 0 2px; }
.pb-col { margin: 0 0 14px; }
.pb-round-label {
  font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
  padding-bottom: 2px; margin-bottom: 6px; border-bottom: 1px solid #161410;
}
.pb-series { border: 1px solid #161410; background: #ffffff; margin-bottom: 6px; }
.pb-team {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 4px 7px; font-size: 13px;
}
.pb-team + .pb-team { border-top: 1px solid #cfc8b8; }
.pb-team .pb-nm { font-weight: 400; }
.pb-team .pb-w { font-variant-numeric: tabular-nums; color: #6a6354; padding-left: 10px; }
.pb-win .pb-nm { font-weight: 700; }
.pb-win .pb-w { color: #161410; font-weight: 700; }

/* College AP rank badge + rankings tables — email stacks the two polls. */
.bb-rank { font-size: 10px; font-weight: 700; color: #6a6354; }
.bb-rank:before { content: "#"; }
.bb-rk-caption {
  margin: 0 0 4px; padding-bottom: 2px; font-size: 13px; font-weight: 700;
  border-bottom: 1px solid #161410;
}
.bb-rk-col { margin-bottom: 14px; }
.bb-rk-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.bb-rk-table td { padding: 2px 0; vertical-align: baseline; }
.bb-rk-rank { width: 22px; text-align: right; padding-right: 8px; color: #6a6354; }
.bb-rk-rec { color: #6a6354; font-size: 11px; }
.bb-rk-trend { width: 16px; text-align: right; font-size: 11px; }
.bb-rk-new { font-weight: 700; font-size: 9px; }

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

.bb-tx-day { margin-top: 10px; }
.bb-tx-day:first-child { margin-top: 0; }
.bb-tx-date { font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
              text-transform: uppercase; color: #6a6354; margin: 0;
              padding-bottom: 2px; border-bottom: 1px solid #161410; }
.bb-tx-list { list-style: none; padding: 0; margin: 6px 0 0; }
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
.bb-upcoming-tv { flex-basis: 100%; font-size: 11px; color: #6a6354; }

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
                    width: 26%; white-space: nowrap; font-size: 12px; }
.bb-ls-team .bb-ls-rec { font-weight: 400; color: #6a6354; }
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
  padding: 2px 2px; text-align: right; white-space: nowrap;
}
.bb-player-table th {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.03em;
  border-bottom: 1px solid #161410;
}
.bb-pl-name      { text-align: left !important; font-size: 12px;
                   width: 24%; white-space: normal; word-break: break-word; }
.bb-pl-pos       { font-size: 10px; color: #6a6354; margin-left: 3px;
                   text-transform: lowercase; letter-spacing: 0.04em;
                   white-space: nowrap; font-weight: 400; }
.bb-pl-jersey    { font-size: 10px; color: #6a6354; font-weight: 400; }
.bb-pl-inj       { font-size: 10px; color: #6a6354; font-style: italic; }
/* Nine stat columns at phone width: last-name-only keeps the name column
   narrow (24%) so the numerics get comfortable room without clipping. */
.bb-pl-stat      { font-size: 11px; }
/* Soft rule between the starters and the bench, mirroring the printed box. */
.bb-player-table tbody tr.bb-pl-bench td { border-top: 1px solid #c9c2b4; }
.bb-player-table tfoot td { font-weight: 700; border-top: 1px solid #161410; }

.bb-standings-table { width: 100%; border-collapse: collapse;
                      font-size: 12px; margin: 6px 0 14px; }
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
