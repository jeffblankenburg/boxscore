// Football digest renderer. One body builder that produces the same HTML
// for web and email — both consume `fb-` prefixed classes that live in
// globals.css (web) and FOOTBALL_EMAIL_STYLES (email). The fb- prefix keeps
// these rules disjoint from MLB's es-* and basketball's bb-*.
//
// Recap-only (no preview edition — Jeff's call). Sections, top to bottom:
//   1. Dateline — send date
//   2. Rankings — AP + CFP/Coaches top 25 (NCAAF only)
//   3. Results — every game: quarter line score, scoring summary, and full
//      passing/rushing/receiving/defense/kicking tables per team
//   4. Standings — division (NFL) / conference (NCAAF) tables
//
// Shared by NFL and NCAAF off the one canonical bundle; `league` toggles the
// college-only sections (rankings) and the ranked-first game ordering.

import type { CanonicalFootballDailyData } from "../canonical";
import type {
  FootballGame,
  FootballBoxScore,
  FootballTeamBox,
  FootballTeamTotals,
  FootballTeamRef,
  FootballScoringPlay,
  FootballRanking,
  FootballLeaderboard,
  FootballLeaderEntry,
  FootballStandingsGroup,
  FootballStandingsRow,
  FootballTransaction,
  FootballPeriodLine,
  FootballPlayerRef,
  FootballLeague,
} from "../types";
import { prettyDate, nextDay } from "../../../dates";
import { findTeam } from "../../../teams";
import { EMAIL_LINK_BASE } from "../../../site";
import { footballPlayerPath } from "../player-links";
import { scopeToConference, type NcaafConference } from "../conferences";

// Anchor for a player/team page. Web uses a relative href + the site's
// hover-underline class; email uses an ABSOLUTE url (relative links don't
// resolve in mail) + inline color/decoration overrides, mirroring MLB's
// es-player-link / es-team-link treatment. Exported for the team-page renderer.
export function linkAnchor(path: string, inner: string, web: boolean, webClass: string, emailClass: string): string {
  return web
    ? `<a class="${webClass}" href="${escapeHtml(path)}">${inner}</a>`
    : `<a class="${emailClass}" href="${escapeHtml(EMAIL_LINK_BASE + path)}" style="color:inherit;text-decoration:none">${inner}</a>`;
}

// Defense tables in college can list 20+ tacklers; cap them so a 60-game
// Saturday email stays merely long, not absurd. Offensive groups are short
// enough (ESPN only lists players with a stat line) to show in full.
const DEFENSE_ROW_CAP = 8;

// An upset flags when an unranked team beats a ranked one, or a team beats
// another ranked at least this many spots higher. Tunable single knob.
const UPSET_RANK_GAP = 10;

export function renderFootballContent(data: CanonicalFootballDailyData): string {
  // Web surface: player/team names link to their pages with relative hrefs.
  return renderBody(data, prettyDate(data.date), true);
}

export function renderFootballEmailContent(data: CanonicalFootballDailyData): string {
  // Newspaper convention: today's edition recaps yesterday's games, so the
  // email dateline is the day it goes out (digest date + 1). Email links use
  // absolute EMAIL_LINK_BASE urls (relative ones don't resolve in mail).
  return renderBody(data, prettyDate(nextDay(data.date)), false);
}

// ---- Conference digest ----------------------------------------------------

// A conference digest is the daily NCAAF data scoped to one conference's teams:
// full rankings, then that conference's standings / scores / all box scores /
// transactions. (Leaders are omitted until NCAAF leader data is wired — see the
// tracked follow-up.) Reuses the same section renderers on the scoped data.
export function renderFootballConferenceContent(
  data: CanonicalFootballDailyData,
  conf: NcaafConference,
): string {
  return renderConferenceBody(scopeToConference(data, conf), conf, prettyDate(data.date), true);
}

export function renderFootballConferenceEmailContent(
  data: CanonicalFootballDailyData,
  conf: NcaafConference,
): string {
  return renderConferenceBody(
    scopeToConference(data, conf),
    conf,
    prettyDate(nextDay(data.date)),
    false,
  );
}

// A conference's upcoming matchups: the earliest upcoming week among its games
// in the look-ahead window. Reuses the shared matchup section rendering.
function renderConferenceMatchups(data: CanonicalFootballDailyData): string {
  const first = [...data.nextGames].sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
  if (!first) return "";
  const games = data.nextGames.filter(
    (g) => g.week === first.week && g.seasonType === first.seasonType,
  );
  if (games.length === 0) return "";
  return matchupSection(data, matchupSectionTitle(first, "Upcoming"), games);
}

function renderConferenceBody(
  scoped: CanonicalFootballDailyData,
  conf: NcaafConference,
  dateline: string,
  web: boolean,
): string {
  // No rankings section — a team's AP rank shows inline in the standings. On
  // wide web two paired rows sit side by side (fb-conf-2col): Standings|Leaders
  // and Scores|Matchups; box scores span full width below. Leaders is an empty
  // slot until NCAAF leader data lands (tracked follow-up) — which also keeps
  // the standings at half-width rather than stretched across the page.
  const standings = renderStandings(scoped, web);
  const leaders = ""; // TODO(#118): conference leaders once NCAAF leader data exists
  const scores = renderGameScores(scoped);
  const matchups = renderConferenceMatchups(scoped);
  const row = (a: string, b: string) =>
    a || b ? `<div class="fb-conf-2col">${a}${b}</div>` : "";
  const sections = [
    renderDateline(dateline),
    `<div class="fb-conf-heading">${escapeHtml(conf.short)}</div>`,
    row(standings, leaders),
    row(scores, matchups),
    renderBoxScores(scoped, web, false), // all of the conference's games
    renderTransactions(scoped),
  ];
  return sections.filter((s) => s.length > 0).join("\n");
}

// ---- Body -----------------------------------------------------------------

function renderBody(data: CanonicalFootballDailyData, dateline: string, web: boolean): string {
  // Section order mirrors the MLB league digest: Standings, Leaders, Game
  // Scores, Next Matchups, Box Scores, Transactions. (Rankings lead for NCAAF.)
  const sections = [
    renderDateline(dateline),
    renderRankings(data.rankings),
    renderStandings(data, web),
    renderLeaders(data, web),
    renderGameScores(data),
    renderThisWeekMatchups(data),
    renderNextWeekMatchups(data),
    renderBoxScores(data, web, data.league === "ncaaf"),
    renderTransactions(data),
  ];
  return sections.filter((s) => s.length > 0).join("\n");
}

function renderDateline(dateline: string): string {
  return `<div class="fb-dateline"><div class="fb-dateline-text">${escapeHtml(dateline)}</div></div>`;
}

// ---- Rankings (NCAAF) -----------------------------------------------------

function renderRankings(rankings: FootballRanking[]): string {
  if (rankings.length === 0) return "";
  // Show at most two polls to keep the header tight: the AP poll always, and
  // the CFP rankings when they exist (mid-season on) — otherwise the Coaches
  // poll. adaptRankings already filtered to FBS-relevant polls in order.
  const cfp = rankings.find((r) => /CFP|College Football Playoff/i.test(r.poll));
  const ap = rankings.find((r) => /AP Top 25/i.test(r.poll));
  const chosen = [ap, cfp ?? rankings.find((r) => /Coaches/i.test(r.poll))].filter(
    (r): r is FootballRanking => Boolean(r),
  );
  if (chosen.length === 0) return "";

  const tables = chosen.map((poll) => {
    const rows = poll.entries.map((e) => {
      // AP row: school name, record, conference, trend. Solid triangles, no
      // color — the digests are monochrome; direction (▲/▼) carries the meaning.
      const trend =
        e.previousRank == null
          ? '<span class="fb-rk-new">NR</span>'
          : e.previousRank === e.rank
            ? '<span class="fb-rk-flat">&ndash;</span>'
            : e.previousRank > e.rank
              ? `<span class="fb-rk-up">&#9650;${e.previousRank - e.rank}</span>`
              : `<span class="fb-rk-down">&#9660;${e.rank - e.previousRank}</span>`;
      // School name ("Ohio State"), not the mascot ("Buckeyes") — the poll feed
      // carries only the mascot in `name`, so prefer `location`.
      const school = escapeHtml(e.team.location ?? e.team.name);
      return `<tr>
        <td class="fb-rk-rank">${e.rank}</td>
        <td class="fb-rk-team">${school}</td>
        <td class="fb-rk-rec">${escapeHtml(e.record ?? "")}</td>
        <td class="fb-rk-conf">${escapeHtml(e.team.conference ?? "")}</td>
        <td class="fb-rk-trend">${trend}</td>
      </tr>`;
    }).join("");
    return `
<div class="fb-rank-block">
  <h3 class="fb-rank-caption">${escapeHtml(poll.poll)}</h3>
  <table class="fb-rank-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <thead><tr>
      <th class="fb-rk-rank">#</th><th class="fb-rk-team">Team</th>
      <th class="fb-rk-rec">Rec</th><th class="fb-rk-conf">Conf</th><th class="fb-rk-trend">Trend</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`.trim();
  }).join("\n");

  return `
<section class="fb-section">
  <h2 class="fb-section-title">Rankings</h2>
  <div class="fb-rank-grid">${tables}</div>
</section>`.trim();
}

// ---- Game Scores (compact) ------------------------------------------------

function playedGames(data: CanonicalFootballDailyData): FootballGame[] {
  const played = data.games.filter((g) => g.status === "final" || g.status === "live");
  return orderGamesForRecap(played, data.league);
}

// Mascot for NFL, full name for college — matches the standings convention.
// Compact team name: NFL → mascot ("Cowboys"); college → school name ("Troy"),
// not the long full name ("Troy Trojans"). `location` is the school; game refs
// get it enriched from the standings (the scoreboard feed omits it).
function teamShort(data: CanonicalFootballDailyData, t: FootballTeamRef): string {
  return escapeHtml(data.league === "nfl" ? mascot(t.name) : (t.location ?? t.name));
}

// The week these games belong to, for section titles ("Week 14 Scores").
function gameWeek(games: FootballGame[]): number | null {
  return games.find((g) => g.week != null)?.week ?? null;
}
function weekPrefix(games: FootballGame[]): string {
  const w = gameWeek(games);
  return w != null ? `Week ${w} ` : "";
}

// Email subject: "NFL Week 5, Thursday Digest" — the week plus the RECAPPED
// games' weekday (per the games'-day convention, not the send day). Returns
// null when there's no week (bowls / non-week games) or no recapped games, so
// the send cron falls back to the generic "{SPORT} - {date}" subject.
export function footballEmailSubject(data: CanonicalFootballDailyData): string | null {
  const games = playedGames(data);
  const week = gameWeek(games);
  const first = games[0];
  if (week == null || !first) return null;
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(new Date(first.startTime));
  return `${data.league.toUpperCase()} Week ${week}, ${day} Digest`;
}

function renderGameScores(data: CanonicalFootballDailyData): string {
  const games = playedGames(data);
  if (games.length === 0) return "";
  const lines = games
    .map((g) => {
      const a = g.awayScore ?? 0;
      const h = g.homeScore ?? 0;
      const aCls = a > h ? "fb-gs-win" : "";
      const hCls = h > a ? "fb-gs-win" : "";
      const note = /^final$/i.test(g.statusDetail)
        ? ""
        : ` <span class="fb-gs-note">(${escapeHtml(g.statusDetail)})</span>`;
      return `<div class="fb-gs-line"><span class="${aCls}">${teamShort(data, g.awayTeam)} ${a}</span>, <span class="${hCls}">${teamShort(data, g.homeTeam)} ${h}</span>${note}</div>`;
    })
    .join("");
  return `
<section class="fb-section">
  <h2 class="fb-section-title">${escapeHtml(weekPrefix(games))}Scores</h2>
  <div class="fb-gs-grid">${lines}</div>
</section>`.trim();
}

// ---- Next Matchups --------------------------------------------------------

function kickoffET(iso: string): string {
  if (!iso) return "TBD";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso)) + " ET";
  } catch {
    return "TBD";
  }
}

// Day of week (0=Sun … 6=Sat) of the recapped games, in ET.
function recapDayET(iso: string): number {
  if (!iso) return -1;
  try {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date(iso));
    return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[wd] ?? -1;
  } catch {
    return -1;
  }
}

function matchupSectionTitle(g: FootballGame, verb: "Upcoming" | "Remaining"): string {
  return g.seasonType === "post"
    ? `${verb} Playoff Matchups`
    : g.week != null
      ? `${verb} Week ${g.week} Matchups`
      : `${verb} Matchups`;
}

// The next week's games — but only on the Sunday/Monday recap editions (recap
// day Sun=0 / Mon=1), and only when a later week exists. Returns [] otherwise.
// Shared so the this-week block knows whether the next-week block will render
// (and thus whether to say "Remaining Week n" vs "Upcoming Week n").
function followingWeekGames(data: CanonicalFootballDailyData): FootballGame[] {
  const recap = playedGames(data)[0];
  if (!recap) return [];
  if (![0, 1].includes(recapDayET(recap.startTime))) return [];
  const recapKey = `${recap.seasonType}:${recap.week}`;
  const first = data.nextGames
    .filter((g) => `${g.seasonType}:${g.week}` !== recapKey)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
  if (!first) return [];
  return data.nextGames.filter(
    (g) => g.week === first.week && g.seasonType === first.seasonType,
  );
}

function matchupSection(data: CanonicalFootballDailyData, title: string, games: FootballGame[]): string {
  const rows = games
    .map(
      (g) => `<li class="fb-next-row">
        <span class="fb-next-matchup">${teamShort(data, g.awayTeam)} at ${teamShort(data, g.homeTeam)}</span>
        <span class="fb-next-time">${escapeHtml(kickoffET(g.startTime))}</span>
      </li>`,
    )
    .join("");
  return `
<section class="fb-section">
  <h2 class="fb-section-title">${escapeHtml(title)}</h2>
  <ul class="fb-next-list">${rows}</ul>
</section>`.trim();
}

// THIS week's remaining games — the recap week's games not yet played. Always
// shown when non-empty (e.g. the Friday edition previews Sunday/Monday; the
// Monday edition still has Monday Night to preview). When the next-week block
// also renders below it (Sun/Mon editions), this is labeled "Remaining Week n"
// so it reads as the leftover games rather than a second "Upcoming".
function renderThisWeekMatchups(data: CanonicalFootballDailyData): string {
  const recap = playedGames(data)[0];
  if (!recap) return "";
  const games = data.nextGames.filter(
    (g) => g.week === recap.week && g.seasonType === recap.seasonType,
  );
  if (games.length === 0) return "";
  const verb = followingWeekGames(data).length > 0 ? "Remaining" : "Upcoming";
  return matchupSection(data, matchupSectionTitle(games[0]!, verb), games);
}

// NEXT week's games — only on the Sunday/Monday recap editions once the week is
// essentially done (see followingWeekGames).
function renderNextWeekMatchups(data: CanonicalFootballDailyData): string {
  const games = followingWeekGames(data);
  if (games.length === 0) return "";
  return matchupSection(data, matchupSectionTitle(games[0]!, "Upcoming"), games);
}

// ---- Leaders --------------------------------------------------------------

// Short unit shown in the value-column header, mirroring MLB's leader tables
// (which pair the category label with a short stat abbreviation).
function leaderUnit(label: string): string {
  if (/Yards$/.test(label)) return "Yds";
  if (/TD$/.test(label)) return "TD";
  if (label === "Tackles For Loss") return "TFL";
  if (label === "Tackles") return "Tkl";
  if (label === "Receptions") return "Rec";
  return label; // "Sacks"
}

// Everything after the first name — keeps compound surnames ("St. Brown",
// "Smith-Njigba") intact, unlike a bare last-token split.
function lastNameOf(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length < 2 ? full : parts.slice(1).join(" ");
}

// Top `limit` entries, extended through ties: if entries past the cutoff share
// the cutoff's value, keep them too (MLB's leadersThroughTies).
function leadersThroughTies(entries: FootballLeaderEntry[], limit: number): FootballLeaderEntry[] {
  if (entries.length <= limit) return entries;
  const cutoff = entries[limit - 1]!.value;
  let i = limit;
  while (i < entries.length && entries[i]!.value === cutoff) i++;
  return entries.slice(0, i);
}

function renderLeaders(data: CanonicalFootballDailyData, web: boolean): string {
  const boards = data.leaders;
  if (boards.length === 0) return "";
  const cards = boards
    .map((b) => {
      // MLB template: "Rank. LastName, TEAM" in one player cell + a value cell.
      // Web links the name to the player page; email keeps it plain.
      const rows = leadersThroughTies(b.entries, 5)
        .map((e, i) => {
          const last = escapeHtml(lastNameOf(e.player.fullName));
          const name = e.player.id
            ? linkAnchor(
                footballPlayerPath(data.league, { id: e.player.id, slug: e.player.slug }),
                last,
                web,
                "player-link",
                "es-player-link",
              )
            : last;
          return `<tr>
          <td class="fb-ldr-player">${i + 1}. ${name}, ${escapeHtml(e.teamAbbr)}</td>
          <td class="fb-ldr-val">${escapeHtml(e.displayValue)}</td>
        </tr>`;
        })
        .join("");
      return `
<div class="fb-ldr-card">
  <h3 class="fb-ldr-caption">${escapeHtml(b.label)}</h3>
  <table class="fb-ldr-table" role="presentation" cellpadding="0" cellspacing="0" border="0">
    <thead><tr><th class="fb-ldr-player">Player</th><th class="fb-ldr-val">${escapeHtml(leaderUnit(b.label))}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`.trim();
    })
    .join("");
  return `
<section class="fb-section">
  <h2 class="fb-section-title">${escapeHtml(data.league.toUpperCase())} Stat Leaders</h2>
  <div class="fb-ldr-grid">${cards}</div>
</section>`.trim();
}

// ---- Box Scores (full detail) ---------------------------------------------

// Team ids currently in the AP Top 25 (both game and ranking refs key `id` off
// the lowercased abbreviation, so they match).
function apTop25Ids(data: CanonicalFootballDailyData): Set<string> {
  const ap = data.rankings.find((r) => /AP Top 25/i.test(r.poll));
  return new Set((ap?.entries ?? []).map((e) => e.team.id));
}

function renderBoxScores(data: CanonicalFootballDailyData, web: boolean, onlyTop25: boolean): string {
  let games = playedGames(data);
  // The NCAAF *league* digest is a Top-25 digest: with ~80 games a day, only
  // games involving a currently-AP-ranked team get a full box score. The
  // conference/team digests pass onlyTop25=false and show every game in their
  // (already-scoped) slate. NFL always shows every game.
  const top25 = onlyTop25;
  if (top25) {
    const ranked = apTop25Ids(data);
    games = games.filter((g) => ranked.has(g.awayTeam.id) || ranked.has(g.homeTeam.id));
  }
  if (games.length === 0) return "";
  const blocks = games.map((g) => renderGameBlock(data, g, data.boxScores.get(g.id), web)).join("\n");
  const heading = top25 ? `${weekPrefix(games)}Top 25 Box Scores` : `${weekPrefix(games)}Box Scores`;
  // Box scores flow into CSS columns on wide web (same technique as the MLB/NBA
  // digests) — 2 → 1 by viewport. Football box scores are wider than
  // basketball's (per-team passing/rushing/receiving/defense tables), so 2 is
  // the ceiling. The .fb-boxscores class is web-only (absent from
  // FOOTBALL_EMAIL_STYLES), so email falls back to a single stacked column.
  return `
<section class="fb-section">
  <h2 class="fb-section-title">${escapeHtml(heading)}</h2>
  <div class="fb-boxscores">${blocks}</div>
</section>`.trim();
}

// ---- Transactions ---------------------------------------------------------

function renderTransactions(data: CanonicalFootballDailyData): string {
  const txs = data.transactions;
  if (txs.length === 0) return "";
  // Alphabetical by full team name (falls back to abbr / description) so the
  // list scans by team rather than by ESPN's reverse-chronological order.
  const teamName = (abbr: string | null): string =>
    abbr ? (findTeam(data.league, abbr.toLowerCase())?.name ?? abbr) : "";
  const rows = [...txs]
    .sort((a, b) => teamName(a.teamAbbr).localeCompare(teamName(b.teamAbbr)) || a.description.localeCompare(b.description))
    .slice(0, 25)
    .map(
      (t) => `<li class="fb-tx-row">
        <span class="fb-tx-team">${escapeHtml(t.teamAbbr ?? "")}</span>
        <span class="fb-tx-desc">${escapeHtml(t.description)}</span>
      </li>`,
    )
    .join("");
  return `
<section class="fb-section">
  <h2 class="fb-section-title">Transactions</h2>
  <ul class="fb-tx-list">${rows}</ul>
</section>`.trim();
}

// NFL: keep canonical (kickoff-time) order. NCAAF: pin games involving
// ranked teams to the top, best rank first, so the marquee Saturday
// matchups lead; unranked games follow in their canonical order.
function orderGamesForRecap(games: FootballGame[], league: string): FootballGame[] {
  if (league !== "ncaaf") return games;
  const bestRank = (g: FootballGame): number =>
    Math.min(g.awayTeam.rank ?? 99, g.homeTeam.rank ?? 99);
  return [...games]
    .map((g, i) => ({ g, i, r: bestRank(g) }))
    .sort((a, b) => (a.r !== b.r ? a.r - b.r : a.i - b.i))
    .map((x) => x.g);
}

// Full name + rank badge — box-score TEAM headers ("#2 Troy Trojans").
function teamLabel(t: FootballTeamRef): string {
  const rank = t.rank ? `<span class="fb-rank-badge">#${t.rank}</span> ` : "";
  return `${rank}${escapeHtml(t.name)}`;
}
// School name + rank — box-score TITLES ("#2 Troy at Clemson"); no mascot.
function teamTitle(t: FootballTeamRef): string {
  const rank = t.rank ? `<span class="fb-rank-badge">#${t.rank}</span> ` : "";
  return `${rank}${escapeHtml(t.location ?? t.name)}`;
}

// An upset: the loser was ranked and either the winner was unranked or the
// winner was ranked ≥ UPSET_RANK_GAP spots below the loser.
function isUpset(g: FootballGame): boolean {
  if (g.awayScore == null || g.homeScore == null || g.awayScore === g.homeScore) return false;
  const [winner, loser] =
    g.awayScore > g.homeScore ? [g.awayTeam, g.homeTeam] : [g.homeTeam, g.awayTeam];
  if (loser.rank == null) return false;
  if (winner.rank == null) return true;
  return winner.rank - loser.rank >= UPSET_RANK_GAP;
}

// `web` links box-score player names to their player pages; defaults true so
// the team page (which reuses this) links them. The email digest passes false.
export function renderGameBlock(data: CanonicalFootballDailyData, g: FootballGame, box: FootballBoxScore | undefined, web = true): string {
  const upset = isUpset(g) ? `<span class="fb-upset">Upset</span>` : "";
  const context =
    g.postseasonLabel || g.neutralSite
      ? `<div class="fb-game-context">${escapeHtml(
          [g.postseasonLabel, g.neutralSite ? "neutral site" : null, box?.venueName]
            .filter(Boolean)
            .join(" · "),
        )}</div>`
      : "";
  // NFL: mascots only ("Panthers at Buccaneers"). NCAAF keeps rank + full name
  // since rankings are the story there.
  // NFL: mascots. College: school name + rank in the TITLE (no mascot); the
  // per-team headers below keep the full "school + mascot" via teamLabel.
  const head = (t: FootballTeamRef) => (data.league === "nfl" ? teamShort(data, t) : teamTitle(t));

  return `
<article class="fb-game">
  ${context}
  <header class="fb-game-header">
    <span class="fb-game-matchup">${head(g.awayTeam)} @ ${head(g.homeTeam)} ${upset}</span>
    <span class="fb-game-status">${escapeHtml(g.statusDetail)}</span>
  </header>
  ${renderLineScore(g)}
  ${box ? renderScoringSummary(box.scoringPlays) : ""}
  ${box ? renderBox(box, data.league, web) : ""}
</article>`.trim();
}

function renderLineScore(g: FootballGame): string {
  const periods = Math.max(g.awayLine.length, g.homeLine.length, 4);
  const labels: string[] = [];
  for (let i = 1; i <= periods; i++) labels.push(i <= 4 ? String(i) : `OT${i - 4}`);

  const row = (ref: FootballTeamRef, line: FootballPeriodLine[], total: number | null) => {
    const cells = labels
      .map((_, i) => `<td class="fb-ls-cell">${line[i]?.points ?? ""}</td>`)
      .join("");
    return `<tr><th class="fb-ls-team">${escapeHtml(ref.abbr)}</th>${cells}<td class="fb-ls-total">${total ?? ""}</td></tr>`;
  };

  return `
<table class="fb-linescore" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <thead><tr>
    <th class="fb-ls-team-head"></th>
    ${labels.map((l) => `<th class="fb-ls-cell">${l}</th>`).join("")}
    <th class="fb-ls-total">T</th>
  </tr></thead>
  <tbody>
    ${row(g.awayTeam, g.awayLine, g.awayScore)}
    ${row(g.homeTeam, g.homeLine, g.homeScore)}
  </tbody>
</table>`.trim();
}

function renderScoringSummary(plays: FootballScoringPlay[]): string {
  if (plays.length === 0) return "";
  const rows = plays
    .map(
      (p) => `<li class="fb-score-row">
        <span class="fb-score-clock">${escapeHtml(p.team.abbr)} Q${p.period} ${escapeHtml(p.clock)}</span>
        <span class="fb-score-text">${escapeHtml(p.text)}</span>
        <span class="fb-score-tally">${p.awayScore}&ndash;${p.homeScore}</span>
      </li>`,
    )
    .join("");
  return `<ul class="fb-score-list">${rows}</ul>`;
}

// ---- Box score ------------------------------------------------------------

function renderBox(box: FootballBoxScore, league: FootballLeague, web: boolean): string {
  return `<div class="fb-box">
  ${renderTeamStatsTable(box)}
  ${renderTeamBox(box.away, league, web)}
  ${renderTeamBox(box.home, league, web)}
</div>`;
}

// Box-score player name cell. Links to the player page (compact "D. Prescott"
// text) on both surfaces — relative on web, absolute on email. Unlinked only
// when the player carries no id.
function playerNameCell(league: FootballLeague, player: FootballPlayerRef, web: boolean): string {
  const text = nameCell(player.fullName);
  if (!player.id) return text;
  const path = footballPlayerPath(league, { id: player.id, slug: player.slug });
  return linkAnchor(path, text, web, "player-link", "es-player-link");
}

// Team-stats comparison table (away vs home) — replaces the old one-line totals
// strip and surfaces more team-level stats now that it has room.
function renderTeamStatsTable(box: FootballBoxScore): string {
  const a = box.away.totals;
  const h = box.home.totals;
  const fmt = (v: number | string | null): string => (v == null ? "–" : String(v));
  const third = (t: FootballTeamTotals): string =>
    t.thirdDownConversions != null && t.thirdDownAttempts != null
      ? `${t.thirdDownConversions}/${t.thirdDownAttempts}`
      : "–";
  const pen = (t: FootballTeamTotals): string =>
    t.penalties != null && t.penaltyYards != null ? `${t.penalties}-${t.penaltyYards}` : "–";
  const rows: Array<[string, string, string]> = [
    ["First Downs", fmt(a.firstDowns), fmt(h.firstDowns)],
    ["Total Yards", fmt(a.totalYards), fmt(h.totalYards)],
    ["Passing Yards", fmt(a.passingYards), fmt(h.passingYards)],
    ["Rushing Yards", fmt(a.rushingYards), fmt(h.rushingYards)],
    ["Total Plays", fmt(a.totalPlays), fmt(h.totalPlays)],
    ["3rd Down", third(a), third(h)],
    ["Penalties", pen(a), pen(h)],
    ["Turnovers", fmt(a.turnovers), fmt(h.turnovers)],
    ["Time of Poss.", a.possession ?? "–", h.possession ?? "–"],
  ];
  const body = rows
    .map(
      ([label, av, hv]) =>
        `<tr><td class="fb-ts-label">${escapeHtml(label)}</td><td class="fb-ts-val">${escapeHtml(av)}</td><td class="fb-ts-val">${escapeHtml(hv)}</td></tr>`,
    )
    .join("");
  return `
<table class="fb-ts-table" role="presentation" cellpadding="0" cellspacing="0" border="0">
  <thead><tr><th class="fb-ts-label">Team Stats</th><th class="fb-ts-val">${escapeHtml(box.away.team.abbr)}</th><th class="fb-ts-val">${escapeHtml(box.home.team.abbr)}</th></tr></thead>
  <tbody>${body}</tbody>
</table>`.trim();
}

function renderTeamBox(t: FootballTeamBox, league: FootballLeague, web: boolean): string {
  const nm = (p: { player: FootballPlayerRef }) => playerNameCell(league, p.player, web);
  const passing = statTable(
    ["C/ATT", "YDS", "TD", "INT", "RTG"],
    t.passing.map((p) => [
      nm(p),
      `${p.completions}/${p.attempts}`,
      p.yards,
      p.touchdowns,
      p.interceptions,
      p.rating ?? "",
    ]),
    "Passing",
  );
  const rushing = statTable(
    ["CAR", "YDS", "TD", "LG"],
    t.rushing.map((p) => [nm(p), p.carries, p.yards, p.touchdowns, p.long]),
    "Rushing",
  );
  const receiving = statTable(
    ["REC", "YDS", "TD", "LG"],
    t.receiving.map((p) => [nm(p), p.receptions, p.yards, p.touchdowns, p.long]),
    "Receiving",
  );
  const defense = statTable(
    ["TOT", "SOLO", "SACK", "TFL", "PD"],
    [...t.defense]
      .sort((a, b) => b.tackles - a.tackles)
      .slice(0, DEFENSE_ROW_CAP)
      .map((p) => [
        nm(p),
        p.tackles,
        p.soloTackles,
        p.sacks,
        p.tacklesForLoss,
        p.passesDefended,
      ]),
    "Defense",
  );
  const kicking = statTable(
    ["FG", "XP", "PTS"],
    t.kicking.map((p) => [
      nm(p),
      `${p.fgMade}/${p.fgAttempts}`,
      `${p.xpMade}/${p.xpAttempts}`,
      p.points,
    ]),
    "Kicking",
  );

  return `
<div class="fb-team-box">
  <h3 class="fb-team-caption">${teamLabel(t.team)}</h3>
  ${passing}${rushing}${receiving}${defense}${kicking}
</div>`.trim();
}

// Generic compact stat table. `rows` cells are pre-formatted; the first cell
// is the (already-HTML) player-name cell, the rest are stat values. Returns
// "" when there are no rows so empty groups don't leave a stray header.
function statTable(cols: string[], rows: Array<Array<string | number>>, label: string): string {
  if (rows.length === 0) return "";
  const head = cols.map((c) => `<th class="fb-st-cell">${escapeHtml(c)}</th>`).join("");
  const body = rows
    .map((r) => {
      const [name, ...stats] = r;
      const cells = stats.map((s) => `<td class="fb-st-cell">${escapeHtml(String(s))}</td>`).join("");
      return `<tr><td class="fb-st-name">${name}</td>${cells}</tr>`;
    })
    .join("");
  return `
<table class="fb-stat-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <thead><tr><th class="fb-st-name">${escapeHtml(label)}</th>${head}</tr></thead>
  <tbody>${body}</tbody>
</table>`.trim();
}

// ---- Standings ------------------------------------------------------------

// Win percentage → ".588" / "1.000" (drop the leading zero, MLB-style).
function fmtPct(p: number | null): string {
  if (p == null) return "";
  const s = p.toFixed(3);
  return s.startsWith("0.") ? s.slice(1) : s;
}

// `w` is the fixed-layout column width (% of table). Narrow for single-digit
// columns (W/L/T), wider for the 4-char record columns (Home/Road/Div/Conf/Strk)
// so their headers don't overlap when the table is squeezed.
type StandingsCol = { label: string; get: (r: FootballStandingsRow) => string | number; w?: string };

// NFL: the full column set Jeff asked for, in his order —
// W L T PCT STRK PF PA HOME ROAD DIV CONF.
export const NFL_STANDINGS_COLS: StandingsCol[] = [
  { label: "W", get: (r) => r.wins, w: "5%" },
  { label: "L", get: (r) => r.losses, w: "5%" },
  { label: "T", get: (r) => r.ties, w: "4%" },
  { label: "Pct", get: (r) => fmtPct(r.pct), w: "8%" },
  { label: "Strk", get: (r) => r.streak ?? "", w: "9%" },
  { label: "PF", get: (r) => r.pointsFor ?? "", w: "7%" },
  { label: "PA", get: (r) => r.pointsAgainst ?? "", w: "7%" },
  { label: "Home", get: (r) => r.home ?? "", w: "10%" },
  { label: "Road", get: (r) => r.road ?? "", w: "10%" },
  { label: "Div", get: (r) => r.divisionRecord ?? "", w: "9%" },
  { label: "Conf", get: (r) => r.conferenceRecord ?? "", w: "10%" },
];

// NCAAF: leaner set (no divisions/home-road split in the college model yet).
const NCAAF_STANDINGS_COLS: StandingsCol[] = [
  { label: "W", get: (r) => r.wins },
  { label: "L", get: (r) => r.losses },
  { label: "Pct", get: (r) => fmtPct(r.pct) },
  { label: "Conf", get: (r) => r.conferenceRecord ?? "" },
  { label: "Strk", get: (r) => r.streak ?? "" },
];

function renderStandings(data: CanonicalFootballDailyData, web: boolean): string {
  if (data.standings.length === 0) return "";
  const cols = data.league === "nfl" ? NFL_STANDINGS_COLS : NCAAF_STANDINGS_COLS;

  // When the groups split cleanly into exactly two conferences (the NFL:
  // AFC / NFC), lay them out as two side-by-side conference columns at wide
  // widths — the fb-standings-2col grid collapses to one column on narrow
  // screens and email. NCAAF (many conferences) stays single-column.
  // NFL standings use the bare mascot ("Cowboys") — no city — to keep the
  // 12-column table narrow enough to fit two-up at tablet and whole on mobile.
  const useMascot = data.league === "nfl";

  const conferences = [...new Set(data.standings.map((g) => g.conference).filter(Boolean))];
  if (conferences.length === 2) {
    // Mirror the MLB standings layout: a centered conference title, then each
    // division as a sub-header + its own column-header row + team rows, all in
    // one fixed-layout table so columns line up top-to-bottom. Two conferences
    // sit in the 2-col grid (collapses to one column on narrow widths).
    const tables = conferences
      .map((conf) => renderConferenceTable(conf!, data.standings.filter((g) => g.conference === conf), cols, useMascot, data.league, web))
      .join("\n");
    return `
<section class="fb-section">
  <div class="fb-standings-2col">${tables}</div>
</section>`.trim();
  }

  const tables = data.standings.map((grp) => renderStandingsGroup(grp, cols, useMascot, data.league, web)).join("\n");
  return `
<section class="fb-section">
  <h2 class="fb-section-title">Standings</h2>
  <div class="fb-standings-grid">${tables}</div>
</section>`.trim();
}

// NFL team mascot = the last token of the full name ("Dallas Cowboys" →
// "Cowboys", "San Francisco 49ers" → "49ers"). Every NFL nickname is a single
// trailing word, so no lookup table is needed.
export function mascot(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] || fullName;
}

// One conference rendered MLB-style: a centered conference title over a single
// fixed-layout table. Each division is a full-width sub-header row, followed by
// a repeated column-header row, then its team rows — matching the MLB standings
// structure so the two leagues/conferences resemble each other. Fixed layout +
// the team-column width keeps every column aligned top-to-bottom.
// "American Football Conference" → "AFC Standings" (and NFC); anything else
// just gets " Standings" appended.
function conferenceTitle(confName: string): string {
  if (/American Football Conference/i.test(confName)) return "AFC Standings";
  if (/National Football Conference/i.test(confName)) return "NFC Standings";
  return `${confName} Standings`;
}

// Standings team-name cell. Links to the team page (MLB convention: only
// standings link team names) — relative on web, absolute on email. `league`
// is needed to resolve the canonical slug; a ref that doesn't resolve stays
// unlinked.
function teamNameCell(
  ref: FootballTeamRef,
  useMascot: boolean,
  league: FootballLeague | undefined,
  web: boolean,
): string {
  // NFL: bare mascot ("Cowboys"). College: the school name ("North Texas"),
  // not the full "North Texas Mean Green" — prefer ESPN's location.
  const name = escapeHtml(useMascot ? mascot(ref.name) : (ref.location ?? ref.name));
  // AP rank trails the name in college standings ("Miami (2)"). Enriched onto
  // the ref by scopeToConference; null for NFL and unranked teams.
  const rank = ref.rank ? ` <span class="fb-sd-rank">(${ref.rank})</span>` : "";
  const team = league ? findTeam(league, ref.id) : undefined;
  const linked = team ? linkAnchor(`/${league}/${team.slug}`, name, web, "team-link", "es-team-link") : name;
  return `${linked}${rank}`;
}

function renderConferenceTable(confName: string, divisions: FootballStandingsGroup[], cols: StandingsCol[], useMascot: boolean, league?: FootballLeague, web = true): string {
  const colgroup = `<colgroup><col class="fb-sd-teamcol" />${cols.map((c) => `<col${c.w ? ` style="width:${c.w}"` : ""} />`).join("")}</colgroup>`;
  const headRow = `<tr class="fb-sd-headrow"><th class="fb-sd-team">Team</th>${cols.map((c) => `<th class="fb-sd-stat">${escapeHtml(c.label)}</th>`).join("")}</tr>`;
  const body = divisions
    .map((div) => {
      const divRow = `<tr class="fb-sd-divrow"><td class="fb-sd-divhead-cell" colspan="${cols.length + 1}">${escapeHtml(div.group)}</td></tr>`;
      const teamRows = div.rows
        .map((r) => {
          const cells = cols
            .map((c) => `<td class="fb-sd-stat">${escapeHtml(String(c.get(r)))}</td>`)
            .join("");
          return `<tr><td class="fb-sd-team">${teamNameCell(r.team, useMascot, league, web)}</td>${cells}</tr>`;
        })
        .join("");
      return divRow + headRow + teamRows;
    })
    .join("");
  return `
<div class="fb-standings-block">
  <div class="fb-conf-title">${escapeHtml(conferenceTitle(confName))}</div>
  <table class="fb-standings-table" role="presentation" cellpadding="0" cellspacing="0" border="0">
    ${colgroup}
    <tbody>${body}</tbody>
  </table>
</div>`.trim();
}

export function renderStandingsGroup(grp: FootballStandingsGroup, cols: StandingsCol[], useMascot: boolean, league?: FootballLeague, web = true): string {
  const head = cols.map((c) => `<th class="fb-sd-stat">${escapeHtml(c.label)}</th>`).join("");
  const rows = grp.rows
    .map((r) => {
      const cells = cols
        .map((c) => `<td class="fb-sd-stat">${escapeHtml(String(c.get(r)))}</td>`)
        .join("");
      return `<tr><td class="fb-sd-team">${teamNameCell(r.team, useMascot, league, web)}</td>${cells}</tr>`;
    })
    .join("");
  // NFL (mascot) uses the same colgroup as the daily conference tables — a
  // narrow 16% team column + each stat column's width hint — so the full
  // 11-column set fits mobile without clipping headers to "Hor"/"Roa"/"Con".
  // NCAAF has few columns and full team names, so it gets a generous 40% team
  // column and even stat columns.
  const colgroup = useMascot
    ? `<colgroup><col class="fb-sd-teamcol" />${cols.map((c) => `<col${c.w ? ` style="width:${c.w}"` : ""} />`).join("")}</colgroup>`
    : `<colgroup><col style="width:40%" />${cols.map(() => "<col />").join("")}</colgroup>`;
  return `
<div class="fb-standings-block">
  <h3 class="fb-conf-caption">${escapeHtml(grp.group)}</h3>
  <table class="fb-standings-table" role="presentation" cellpadding="0" cellspacing="0" border="0">
    ${colgroup}
    <thead><tr><th class="fb-sd-team">Team</th>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`.trim();
}

// ---- Helpers --------------------------------------------------------------

// "Dak Prescott" → "D. Prescott". Falls back to the full string for
// single-token names; keeps hyphenated/multi-word surnames intact.
function nameCell(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return escapeHtml(full);
  const initial = parts[0]!.charAt(0);
  const last = parts.slice(1).join(" ");
  return escapeHtml(`${initial}. ${last}`);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- Email CSS ------------------------------------------------------------
// Concatenated onto EMAIL_STYLES in lib/render-email.ts. Web uses the same
// class names from app/globals.css. Palette matches MLB/basketball: ink
// #161410, muted #6a6354, light rule #c4baa5, dotted #e8e2d4.

export const FOOTBALL_EMAIL_STYLES = `
.es-player-link, .es-player-link:visited,
.es-team-link, .es-team-link:visited { color: inherit !important; text-decoration: none !important; }
.fb-section { margin: 18px 0 24px; }
.fb-section-title {
  font-size: 20px; font-weight: 800; letter-spacing: 0.01em;
  margin: 22px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #161410;
}
.fb-dateline {
  border-top: 3px double #161410; border-bottom: 1px solid #161410;
  padding: 8px 0; margin: 0 0 14px; text-align: center;
}
.fb-conf-heading { font-size: 24px; font-weight: 800; letter-spacing: -0.01em;
                   margin: 4px 0 10px; text-align: center; }
.fb-conf-2col { display: block; }
.fb-sd-rank { color: #6a6354; font-size: 10px; }
.fb-standings-table tbody tr:nth-child(even) td { background: rgba(0,0,0,0.025); }
.fb-dateline-text {
  font-style: italic; font-weight: 800; letter-spacing: -0.005em;
  font-size: 22px; font-size: clamp(16px, 4.2vw, 24px);
}

.fb-rank-grid { display: block; }
.fb-rank-block { margin: 8px 0 14px; }
.fb-rank-caption {
  margin: 10px 0 2px; padding: 0 0 2px; font-size: 13px; font-weight: 700;
  border-bottom: 1px solid #161410;
}
.fb-rank-table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 4px 0 12px; }
.fb-rank-table th, .fb-rank-table td { padding: 1px 3px; white-space: nowrap; }
.fb-rank-table tbody tr:nth-child(even) td { background: rgba(0,0,0,0.025); }
.fb-rank-table th {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.04em; border-bottom: 1px solid #161410; text-align: left;
}
.fb-rk-rank { width: 24px; text-align: right !important; color: #6a6354; }
.fb-rk-team { text-align: left; font-weight: 700; }
.fb-rk-rec  { text-align: left; color: #6a6354; }
.fb-rk-conf { text-align: left; color: #6a6354; }
.fb-rk-trend { width: 44px; text-align: right !important; }
.fb-rk-flat { color: #6a6354; }
.fb-rk-new { color: #6a6354; font-style: italic; }

.fb-game { margin: 18px 0 8px; padding-top: 6px; border-top: 1px solid #c4baa5; }
.fb-game-context { font-size: 11px; font-style: italic; color: #6a6354;
                   letter-spacing: 0.04em; margin-bottom: 2px; }
.fb-game-header { display: flex; justify-content: space-between; align-items: baseline;
                  margin: 0 0 4px; padding-bottom: 3px; border-bottom: 1px solid #161410; }
.fb-game-matchup { font-size: 16px; font-weight: 700; }
.fb-game-status  { font-size: 11px; color: #6a6354; font-style: italic; }
.fb-rank-badge { font-size: 11px; font-weight: 700; color: #6a6354; }
.fb-upset {
  font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
  border: 1px solid #161410; padding: 0 3px; margin-left: 4px; vertical-align: middle;
}

.fb-linescore { width: 100%; border-collapse: collapse; margin: 0 0 6px;
                font-size: 12px; table-layout: fixed; }
.fb-linescore th, .fb-linescore td { padding: 1px 3px; text-align: right; white-space: nowrap; }
.fb-linescore thead th { font-size: 10px; font-weight: 700; text-transform: uppercase;
                         letter-spacing: 0.04em; border-bottom: 1px solid #161410; }
.fb-ls-team { text-align: left !important; font-weight: 700; width: 18%; font-size: 12px; }
.fb-ls-team-head { text-align: left !important; }
.fb-ls-total { font-weight: 700; }
.fb-ls-cell { min-width: 22px; }
.fb-linescore tbody tr:nth-child(even) td { background: rgba(0,0,0,0.025); }

.fb-score-list { list-style: none; padding: 0; margin: 4px 0 8px; }
.fb-score-row { display: flex; gap: 8px; align-items: baseline; padding: 2px 0;
                border-bottom: 1px dotted #e8e2d4; font-size: 11px; line-height: 1.35; }
.fb-score-row:last-child { border-bottom: none; }
.fb-score-row:nth-child(even) { background: rgba(0,0,0,0.025); }
.fb-score-clock { flex-shrink: 0; min-width: 72px; font-weight: 700; color: #2a2620;
                  font-size: 10px; letter-spacing: 0.02em; }
.fb-score-text { flex: 1; }
.fb-score-tally { flex-shrink: 0; font-weight: 700; min-width: 44px; text-align: right; }

.fb-box { display: block; margin: 6px 0 0; }
.fb-team-box { margin: 8px 0 4px; }
.fb-team-caption { margin: 10px 0 2px; padding: 0 0 2px; font-size: 13px; font-weight: 700;
                   border-bottom: 1px solid #161410; }
/* Team-stats comparison table (away vs home). */
.fb-ts-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 12px; margin: 4px 0 10px; }
.fb-ts-table th, .fb-ts-table td { padding: 1px 8px; white-space: nowrap; }
.fb-ts-table thead th { font-size: 10px; font-weight: 700; text-transform: uppercase;
                        letter-spacing: 0.04em; border-bottom: 1px solid #161410; }
.fb-ts-table tbody tr:nth-child(even) td { background: rgba(0,0,0,0.025); }
.fb-ts-label { text-align: left; width: 60%; }
.fb-ts-val { text-align: right; font-weight: 700; width: 20%; }
.fb-ts-table thead .fb-ts-val { font-weight: 700; }

.fb-stat-table { width: 100%; border-collapse: collapse; font-size: 12px;
                 margin: 4px 0 8px; table-layout: fixed; }
.fb-stat-table th, .fb-stat-table td { padding: 1px 3px; text-align: right; white-space: nowrap; }
.fb-stat-table thead th { font-size: 10px; font-weight: 700; text-transform: uppercase;
                          letter-spacing: 0.04em; border-bottom: 1px solid #161410; }
.fb-st-name { text-align: left !important; font-size: 12px; width: 34%;
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fb-stat-table thead .fb-st-name { font-weight: 700; }
.fb-st-cell { min-width: 30px; }
.fb-stat-table tbody tr:nth-child(even) td { background: rgba(0,0,0,0.025); }

.fb-standings-grid { display: block; }
/* Standings — mirrors the MLB standings look (see globals.css base table rules):
   a 14px fixed-layout table, centered conference title, division sub-headers,
   and a repeated column-header row per division. Fixed layout + overflow:hidden
   means the table always fits its container (over-long cells clip) instead of
   scrolling — the same mechanism MLB uses to fit a phone. Two conferences sit in
   the 2-col grid, collapsing to one column below 1250px. */
.fb-standings-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 28px; align-items: start; }
.fb-standings-col { min-width: 0; }
.fb-standings-block { margin: 8px 0 14px; min-width: 0; }
.fb-conf-title {
  text-align: center; font-size: 22px; font-weight: 700;
  margin: 10px 0; padding-bottom: 4px; border-bottom: 2px solid #161410;
}
/* NCAAF single-column path still uses per-conference captions. */
.fb-conf-caption { margin: 10px 0 2px; padding: 0 0 2px; font-size: 14px; font-weight: 700;
                   border-bottom: 1px solid #161410; }
.fb-standings-table {
  width: 100%; border-collapse: collapse; table-layout: fixed;
  font-size: 14px; margin: 0 0 8px;
}
.fb-standings-table th, .fb-standings-table td {
  text-align: right; overflow: hidden; line-height: 1.15; padding: 0 2px; white-space: nowrap;
}
.fb-standings-table th { font-weight: 700; border-bottom: 1px solid #161410; }
.fb-sd-team { text-align: left !important; }
.fb-sd-teamcol { width: 16%; }
.fb-standings-table .fb-sd-divhead-cell {
  text-align: left; font-weight: 700; padding: 8px 2px 2px; border-bottom: 1px solid #161410;
}

/* Game Scores (compact final-score list). */
.fb-gs-grid { display: block; margin: 4px 0 0; }
.fb-gs-line { font-size: 14px; padding: 2px 0; border-bottom: 1px dotted #e8e2d4; }
.fb-gs-line:last-child { border-bottom: none; }
.fb-gs-win { font-weight: 700; }
.fb-gs-note { color: #6a6354; font-style: italic; font-size: 12px; }

/* Next Matchups. */
.fb-next-list { list-style: none; padding: 0; margin: 4px 0 0; }
.fb-next-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
               padding: 3px 0; border-bottom: 1px dotted #e8e2d4; font-size: 14px; }
.fb-next-row:last-child { border-bottom: none; }
.fb-next-matchup { font-weight: 700; }
.fb-next-time { color: #6a6354; font-style: italic; white-space: nowrap; }

/* Leaders — two columns of small ranked tables. */
/* Leaders — MLB template: cards flow into 2 balanced columns (column-count),
   each a small "Rank. LastName, TEAM | value" table with a Player/unit header. */
.fb-ldr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 22px; align-items: start; }
.fb-ldr-card { min-width: 0; margin: 0 0 12px; }
.fb-ldr-caption { margin: 0 0 3px; padding: 0 0 2px; font-size: 14px; font-weight: 700;
                  border-bottom: 1px solid #161410; }
.fb-ldr-table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
.fb-ldr-table th, .fb-ldr-table td { padding: 0 2px; white-space: nowrap; text-align: right; line-height: 1.35; }
.fb-ldr-table th { font-weight: 700; border-bottom: 1px solid #161410; }
.fb-ldr-player { text-align: left !important; width: 78%; overflow: hidden; text-overflow: ellipsis; }
.fb-ldr-val { text-align: right; }

/* Transactions. */
.fb-tx-list { list-style: none; padding: 0; margin: 4px 0 0; }
.fb-tx-row { display: flex; gap: 10px; padding: 3px 0; border-bottom: 1px dotted #e8e2d4;
             font-size: 13px; line-height: 1.4; }
.fb-tx-row:last-child { border-bottom: none; }
.fb-tx-team { flex-shrink: 0; min-width: 34px; font-weight: 700; color: #2a2620;
              font-size: 12px; padding-top: 1px; }
.fb-tx-desc { font-size: 13px; }

@media only screen and (max-width: 1250px) {
  .fb-standings-2col { display: block; }
}
@media only screen and (max-width: 600px) {
  .fb-standings-table { font-size: 11px; }
  .fb-standings-table th, .fb-standings-table td { padding: 0 1px; }
  .fb-conf-title { font-size: 18px; }
}
@media only screen and (max-width: 480px) {
  .fb-stat-table td, .fb-rank-table td { font-size: 11px; padding: 1px 2px; }
  .fb-stat-table th, .fb-rank-table th { font-size: 9px; }
  .fb-score-clock { min-width: 60px; }
}
`;
