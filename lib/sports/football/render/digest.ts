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
  FootballTeamRef,
  FootballScoringPlay,
  FootballRanking,
  FootballStandingsGroup,
  FootballPeriodLine,
} from "../types";
import { prettyDate, nextDay } from "../../../dates";

// Defense tables in college can list 20+ tacklers; cap them so a 60-game
// Saturday email stays merely long, not absurd. Offensive groups are short
// enough (ESPN only lists players with a stat line) to show in full.
const DEFENSE_ROW_CAP = 8;

// An upset flags when an unranked team beats a ranked one, or a team beats
// another ranked at least this many spots higher. Tunable single knob.
const UPSET_RANK_GAP = 10;

export function renderFootballContent(data: CanonicalFootballDailyData): string {
  return renderBody(data, prettyDate(data.date));
}

export function renderFootballEmailContent(data: CanonicalFootballDailyData): string {
  // Newspaper convention: today's edition recaps yesterday's games, so the
  // email dateline is the day it goes out (digest date + 1).
  return renderBody(data, prettyDate(nextDay(data.date)));
}

// ---- Body -----------------------------------------------------------------

function renderBody(data: CanonicalFootballDailyData, dateline: string): string {
  const sections = [
    renderDateline(dateline),
    renderRankings(data.rankings),
    renderResults(data),
    renderStandings(data),
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
      const trend =
        e.previousRank == null
          ? '<span class="fb-rk-new">NR</span>'
          : e.previousRank === e.rank
            ? "&ndash;"
            : e.previousRank > e.rank
              ? `&uarr;${e.previousRank - e.rank}`
              : `&darr;${e.rank - e.previousRank}`;
      return `<tr>
        <td class="fb-rk-rank">${e.rank}</td>
        <td class="fb-rk-team">${escapeHtml(e.team.name)}${e.firstPlaceVotes ? ` <span class="fb-rk-fpv">(${e.firstPlaceVotes})</span>` : ""}</td>
        <td class="fb-rk-rec">${escapeHtml(e.record ?? "")}</td>
        <td class="fb-rk-trend">${trend}</td>
      </tr>`;
    }).join("");
    return `
<div class="fb-rank-block">
  <h3 class="fb-rank-caption">${escapeHtml(poll.poll)}</h3>
  <table class="fb-rank-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <thead><tr>
      <th class="fb-rk-rank">#</th><th class="fb-rk-team">Team</th>
      <th class="fb-rk-rec">Rec</th><th class="fb-rk-trend">Trend</th>
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

// ---- Results --------------------------------------------------------------

function renderResults(data: CanonicalFootballDailyData): string {
  // Only games that have started (final or in-progress) belong in a recap.
  const played = data.games.filter((g) => g.status === "final" || g.status === "live");
  if (played.length === 0) return "";

  const ordered = orderGamesForRecap(played, data.league);
  const blocks = ordered
    .map((g) => renderGameBlock(g, data.boxScores.get(g.id)))
    .join("\n");

  return `
<section class="fb-section">
  <h2 class="fb-section-title">Scores &amp; box scores</h2>
  ${blocks}
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

function teamLabel(t: FootballTeamRef): string {
  const rank = t.rank ? `<span class="fb-rank-badge">#${t.rank}</span> ` : "";
  return `${rank}${escapeHtml(t.name)}`;
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

function renderGameBlock(g: FootballGame, box: FootballBoxScore | undefined): string {
  const upset = isUpset(g) ? `<span class="fb-upset">Upset</span>` : "";
  const context =
    g.postseasonLabel || g.neutralSite
      ? `<div class="fb-game-context">${escapeHtml(
          [g.postseasonLabel, g.neutralSite ? "neutral site" : null, box?.venueName]
            .filter(Boolean)
            .join(" · "),
        )}</div>`
      : "";

  return `
<article class="fb-game">
  ${context}
  <header class="fb-game-header">
    <span class="fb-game-matchup">${teamLabel(g.awayTeam)} at ${teamLabel(g.homeTeam)} ${upset}</span>
    <span class="fb-game-status">${escapeHtml(g.statusDetail)}</span>
  </header>
  ${renderLineScore(g)}
  ${box ? renderScoringSummary(box.scoringPlays) : ""}
  ${box ? renderBox(box) : ""}
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

function renderBox(box: FootballBoxScore): string {
  return `<div class="fb-box">
  ${renderTeamBox(box.away)}
  ${renderTeamBox(box.home)}
</div>`;
}

function renderTeamBox(t: FootballTeamBox): string {
  const totals = renderTeamTotals(t);

  const passing = statTable(
    ["C/ATT", "YDS", "TD", "INT", "RTG"],
    t.passing.map((p) => [
      nameCell(p.player.fullName),
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
    t.rushing.map((p) => [nameCell(p.player.fullName), p.carries, p.yards, p.touchdowns, p.long]),
    "Rushing",
  );
  const receiving = statTable(
    ["REC", "YDS", "TD", "LG"],
    t.receiving.map((p) => [nameCell(p.player.fullName), p.receptions, p.yards, p.touchdowns, p.long]),
    "Receiving",
  );
  const defense = statTable(
    ["TOT", "SOLO", "SACK", "TFL", "PD"],
    [...t.defense]
      .sort((a, b) => b.tackles - a.tackles)
      .slice(0, DEFENSE_ROW_CAP)
      .map((p) => [
        nameCell(p.player.fullName),
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
      nameCell(p.player.fullName),
      `${p.fgMade}/${p.fgAttempts}`,
      `${p.xpMade}/${p.xpAttempts}`,
      p.points,
    ]),
    "Kicking",
  );

  return `
<div class="fb-team-box">
  <h3 class="fb-team-caption">${teamLabel(t.team)}</h3>
  ${totals}
  ${passing}${rushing}${receiving}${defense}${kicking}
</div>`.trim();
}

// A one-line team-totals strip above the per-player tables.
function renderTeamTotals(t: FootballTeamBox): string {
  const x = t.totals;
  const third =
    x.thirdDownConversions != null && x.thirdDownAttempts != null
      ? `${x.thirdDownConversions}/${x.thirdDownAttempts}`
      : "–";
  const parts = [
    `Total ${x.totalYards ?? "–"}`,
    `Pass ${x.passingYards ?? "–"}`,
    `Rush ${x.rushingYards ?? "–"}`,
    `3rd ${third}`,
    `TO ${x.turnovers ?? "–"}`,
    `Poss ${x.possession ?? "–"}`,
  ];
  return `<p class="fb-team-totals">${parts.map(escapeHtml).join(" &nbsp; ")}</p>`;
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

function renderStandings(data: CanonicalFootballDailyData): string {
  if (data.standings.length === 0) return "";
  const tables = data.standings.map((grp) => renderStandingsGroup(grp)).join("\n");
  return `
<section class="fb-section">
  <h2 class="fb-section-title">Standings</h2>
  <div class="fb-standings-grid">${tables}</div>
</section>`.trim();
}

function renderStandingsGroup(grp: FootballStandingsGroup): string {
  const rows = grp.rows
    .map((r) => {
      const conf =
        r.confWins != null && r.confLosses != null ? `${r.confWins}-${r.confLosses}` : "";
      return `<tr>
        <td class="fb-sd-team">${escapeHtml(r.team.name)}</td>
        <td class="fb-sd-stat">${r.wins}</td>
        <td class="fb-sd-stat">${r.losses}</td>
        <td class="fb-sd-stat">${r.ties || ""}</td>
        <td class="fb-sd-stat">${escapeHtml(conf)}</td>
        <td class="fb-sd-stat">${escapeHtml(r.streak ?? "")}</td>
      </tr>`;
    })
    .join("");
  return `
<div class="fb-standings-block">
  <h3 class="fb-conf-caption">${escapeHtml(grp.group)}</h3>
  <table class="fb-standings-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <thead><tr>
      <th class="fb-sd-team">Team</th>
      <th class="fb-sd-stat">W</th><th class="fb-sd-stat">L</th><th class="fb-sd-stat">T</th>
      <th class="fb-sd-stat">Conf</th><th class="fb-sd-stat">Strk</th>
    </tr></thead>
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

function escapeHtml(s: string): string {
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
.fb-section { margin: 18px 0 24px; }
.fb-section-title {
  font-size: 20px; font-weight: 800; letter-spacing: 0.01em;
  margin: 22px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #161410;
}
.fb-dateline {
  border-top: 3px double #161410; border-bottom: 1px solid #161410;
  padding: 8px 0; margin: 0 0 14px; text-align: center;
}
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
.fb-rank-table th, .fb-rank-table td { padding: 2px 4px; white-space: nowrap; }
.fb-rank-table th {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.04em; border-bottom: 1px solid #161410; text-align: left;
}
.fb-rk-rank { width: 24px; text-align: right !important; color: #6a6354; }
.fb-rk-team { text-align: left; }
.fb-rk-fpv { color: #6a6354; font-size: 10px; }
.fb-rk-rec { width: 44px; text-align: right !important; color: #6a6354; }
.fb-rk-trend { width: 44px; text-align: right !important; color: #6a6354; font-size: 11px; }
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
.fb-linescore th, .fb-linescore td { padding: 2px 4px; text-align: right; white-space: nowrap; }
.fb-linescore thead th { font-size: 10px; font-weight: 700; text-transform: uppercase;
                         letter-spacing: 0.04em; border-bottom: 1px solid #161410; }
.fb-ls-team { text-align: left !important; font-weight: 700; width: 18%; font-size: 12px; }
.fb-ls-team-head { text-align: left !important; }
.fb-ls-total { font-weight: 700; }
.fb-ls-cell { min-width: 22px; }

.fb-score-list { list-style: none; padding: 0; margin: 4px 0 8px; }
.fb-score-row { display: flex; gap: 8px; align-items: baseline; padding: 2px 0;
                border-bottom: 1px dotted #e8e2d4; font-size: 11px; line-height: 1.35; }
.fb-score-row:last-child { border-bottom: none; }
.fb-score-clock { flex-shrink: 0; min-width: 72px; font-weight: 700; color: #2a2620;
                  font-size: 10px; letter-spacing: 0.02em; }
.fb-score-text { flex: 1; }
.fb-score-tally { flex-shrink: 0; font-weight: 700; min-width: 44px; text-align: right; }

.fb-box { display: block; margin: 6px 0 0; }
.fb-team-box { margin: 8px 0 4px; }
.fb-team-caption { margin: 10px 0 2px; padding: 0 0 2px; font-size: 13px; font-weight: 700;
                   border-bottom: 1px solid #161410; }
.fb-team-totals { font-size: 11px; color: #2a2620; margin: 2px 0 6px; }

.fb-stat-table { width: 100%; border-collapse: collapse; font-size: 12px;
                 margin: 4px 0 8px; table-layout: fixed; }
.fb-stat-table th, .fb-stat-table td { padding: 2px 3px; text-align: right; white-space: nowrap; }
.fb-stat-table thead th { font-size: 10px; font-weight: 700; text-transform: uppercase;
                          letter-spacing: 0.04em; border-bottom: 1px solid #161410; }
.fb-st-name { text-align: left !important; font-size: 12px; width: 40%;
              white-space: normal; word-break: break-word; }
.fb-stat-table thead .fb-st-name { font-weight: 700; }
.fb-st-cell { min-width: 30px; }

.fb-standings-grid { display: block; }
.fb-standings-block { margin: 8px 0 14px; }
.fb-standings-table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 6px 0 14px; }
.fb-conf-caption { margin: 10px 0 2px; padding: 0 0 2px; font-size: 13px; font-weight: 700;
                   border-bottom: 1px solid #161410; }
.fb-standings-table th, .fb-standings-table td { padding: 2px 4px; text-align: right; white-space: nowrap; }
.fb-standings-table th { font-size: 10px; font-weight: 700; text-transform: uppercase;
                         letter-spacing: 0.04em; border-bottom: 1px solid #161410; }
.fb-sd-team { text-align: left !important; font-size: 12px; }
.fb-sd-stat { min-width: 34px; }

@media only screen and (max-width: 480px) {
  .fb-stat-table td, .fb-standings-table td, .fb-rank-table td { font-size: 11px; padding: 1px 2px; }
  .fb-stat-table th, .fb-standings-table th, .fb-rank-table th { font-size: 9px; }
  .fb-score-clock { min-width: 60px; }
}
`;
