// Web renderer for a single-team daily digest. Parallel to
// render-team-email.ts; same data shape (TeamEmailData from loadTeamEmailData),
// different markup. Web version uses globals.css classes (.batting-table,
// .pitching-table, .standings-table, .dateline, .boxscores-title, etc.) so
// the page matches the league digest visually.
//
// Render is invoked from the generate cron (writes to team_digests.html);
// the page at /[sport]/[slug]/[date] just dangerouslySetInnerHTML's the
// cached output. No request-time rendering.

import type { ScheduleGame, RosterPlayer } from "./mlb";
import { prettyDate, prevDay, nextDay, timeInET } from "./dates";
import {
  esc, pad, fmtAvg, fmtEra, lastName,
  renderGame, renderDateline, renderTransactions, renderDivisionTable,
} from "./render";
import { lastNameLinkWeb } from "./player-links";
import {
  teamPlayedGames, classifyTeamMode,
  seriesRoundName, seriesState, seriesGameNumber, signoffStatusLine, leagueListText,
  type TeamEmailData,
} from "./render-team-email";
import { renderPostseasonBracketWeb } from "./sports/mlb/render/postseason";
import { showMagicNumbers, clinchLetter, clinchKeyLine } from "./standings-format";

const DIVISION_NAMES: Record<number, string> = {
  200: "AL West",
  201: "AL East",
  202: "AL Central",
  203: "NL West",
  204: "NL East",
  205: "NL Central",
};

function formatRecord(r: { wins: number; losses: number; gamesBack: string }): string {
  return `(${r.wins}-${r.losses})`;
}

function teamHeading(data: TeamEmailData): string {
  const title = data.record
    ? `${data.team.name} ${formatRecord(data.record)}`
    : data.team.name;
  return `<div class="team-name-header">${esc(title)}</div>`;
}

function renderStandings(data: TeamEmailData): string {
  // October: standings feed is empty; show the full bracket (same as the league
  // digest) in the standings slot.
  if (data.postseasonBracket) {
    return renderPostseasonBracketWeb(data.postseasonBracket);
  }
  if (!data.division) return "";
  const label = DIVISION_NAMES[data.division.division.id] ?? "Division";
  const showMagic = showMagicNumbers(data.date);
  const table = renderDivisionTable(label, data.division, { date: data.date, showMagic });
  const present = new Set<string>();
  for (const t of data.division.teamRecords) { const c = clinchLetter(t); if (c) present.add(c); }
  const keyLine = clinchKeyLine(present);
  const keyHtml = keyLine ? `<div class="standings-key">${esc(keyLine)}</div>` : "";
  return `${table}${keyHtml}`;
}

function renderYesterdayBox(data: TeamEmailData): string {
  const played = teamPlayedGames(data);
  if (played.length === 0) {
    return `<div class="no-games-note">No game played on ${esc(data.prettyDate)}.</div>`;
  }
  // Postseason framing: round + game number + series state above the box.
  const label = data.teamSeries
    ? `<div style="font-weight:700;margin:0 0 4px;">${esc(seriesRoundName(data.teamSeries))} — Game ${seriesGameNumber(data.teamSeries)} <span style="font-weight:400;opacity:.7;">(${esc(seriesState(data.teamSeries))})</span></div>`
    : "";
  // Both halves of a doubleheader, in schedule order (postseason has none).
  return label + played
    .map((g) => renderGame(g as Parameters<typeof renderGame>[0], data.liveAbbrev))
    .join("");
}

function isPitcher(p: RosterPlayer): boolean {
  if (p.position === "P" || p.position === "SP" || p.position === "RP") return true;
  return parseFloat(p.pitching?.inningsPitched ?? "0") > 0;
}

function isHitter(p: RosterPlayer): boolean {
  if ((p.hitting?.atBats ?? 0) > 0) return true;
  return !isPitcher(p);
}

function ilTag(p: RosterPlayer): string {
  return p.statusCode?.startsWith("D") ? ` <span class="pos">(IL)</span>` : "";
}

function sortedRosters(data: TeamEmailData): { hitters: RosterPlayer[]; pitchers: RosterPlayer[] } {
  const players = data.roster.players;
  const hitters = players
    .filter(isHitter)
    .slice()
    .sort((a, b) => (b.hitting?.atBats ?? 0) - (a.hitting?.atBats ?? 0));
  const pitchers = players
    .filter(isPitcher)
    .slice()
    .sort((a, b) =>
      parseFloat(b.pitching?.inningsPitched ?? "0") -
      parseFloat(a.pitching?.inningsPitched ?? "0"),
    );
  return { hitters, pitchers };
}

function renderSeasonHitters(players: RosterPlayer[]): string {
  if (players.length === 0) return "";
  const rows = players.map((p) => {
    const h = p.hitting ?? {};
    const jersey = p.jerseyNumber ? `<span class="jersey">#${esc(p.jerseyNumber)}</span> ` : "";
    const pos = p.position ? ` <span class="pos">${esc(p.position.toLowerCase())}</span>` : "";
    return `<tr>
      <td class="player-col">${jersey}${lastNameLinkWeb(p)}${pos}${ilTag(p)}</td>
      <td>${pad(h.gamesPlayed)}</td>
      <td>${pad(h.atBats)}</td>
      <td>${pad(h.runs)}</td>
      <td>${pad(h.hits)}</td>
      <td>${pad(h.homeRuns)}</td>
      <td>${pad(h.rbi)}</td>
      <td>${pad(h.baseOnBalls)}</td>
      <td>${pad(h.strikeOuts)}</td>
      <td>${pad(h.stolenBases)}</td>
      <td>${pad(p.fieldingErrors)}</td>
      <td>${fmtAvg(h.avg)}</td>
      <td>${esc(h.ops ?? "—")}</td>
    </tr>`;
  }).join("");
  return `<div class="stats-subheader">Hitters</div>
    <table class="team-stat-table">
      <thead><tr>
        <th class="player-col">Player</th>
        <th>G</th><th>AB</th><th>R</th><th>H</th><th>HR</th>
        <th>RBI</th><th>BB</th><th>SO</th><th>SB</th><th>E</th>
        <th>AVG</th><th>OPS</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderSeasonPitchers(players: RosterPlayer[]): string {
  if (players.length === 0) return "";
  const rows = players.map((p) => {
    const pi = p.pitching ?? {};
    const jersey = p.jerseyNumber ? `<span class="jersey">#${esc(p.jerseyNumber)}</span> ` : "";
    return `<tr>
      <td class="player-col">${jersey}${lastNameLinkWeb(p)}${ilTag(p)}</td>
      <td>${pad(pi.gamesPlayed)}</td>
      <td>${pad(pi.wins)}</td>
      <td>${pad(pi.losses)}</td>
      <td>${pad(pi.saves)}</td>
      <td>${esc(pi.inningsPitched ?? "—")}</td>
      <td>${pad(pi.hits)}</td>
      <td>${pad(pi.earnedRuns)}</td>
      <td>${pad(pi.baseOnBalls)}</td>
      <td>${pad(pi.strikeOuts)}</td>
      <td>${fmtEra(pi.era)}</td>
      <td>${esc(pi.whip ?? "—")}</td>
    </tr>`;
  }).join("");
  return `<div class="stats-subheader">Pitchers</div>
    <table class="team-stat-table">
      <thead><tr>
        <th class="player-col">Player</th>
        <th>G</th><th>W</th><th>L</th><th>SV</th><th>IP</th>
        <th>H</th><th>ER</th><th>BB</th><th>K</th>
        <th>ERA</th><th>WHIP</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderStatSheet(data: TeamEmailData): string {
  const { hitters, pitchers } = sortedRosters(data);
  // .game-header matches the box-score's "Guardians 8, Tigers 2" line so
  // section-level dividers all sit at the same weight. Hitters/Pitchers
  // stay on .stats-subheader since they're sub-sections within this one.
  return `<div class="game-header">Team Statistics</div>
    ${renderSeasonHitters(hitters)}
    ${renderSeasonPitchers(pitchers)}`;
}

function fmtIso(slg: string | undefined, avg: string | undefined): string {
  if (!slg || !avg) return "—";
  const s = parseFloat(slg);
  const a = parseFloat(avg);
  if (!isFinite(s) || !isFinite(a)) return "—";
  const iso = s - a;
  if (iso < 0) return "—";
  return iso.toFixed(3).replace(/^0/, "");
}

function fmtPct(num: number | undefined, denom: number | undefined): string {
  if (num == null || denom == null || denom === 0) return "—";
  return `${(num / denom * 100).toFixed(1)}%`;
}

function renderAdvancedHitters(players: RosterPlayer[]): string {
  if (players.length === 0) return "";
  const rows = players.map((p) => {
    const h = p.hitting ?? {};
    return `<tr>
      <td class="player-col">${lastNameLinkWeb(p)}${ilTag(p)}</td>
      <td>${pad(h.plateAppearances)}</td>
      <td>${fmtAvg(h.avg)}</td>
      <td>${fmtAvg(h.obp)}</td>
      <td>${fmtAvg(h.slg)}</td>
      <td>${fmtIso(h.slg, h.avg)}</td>
      <td>${fmtAvg(h.babip)}</td>
      <td>${fmtPct(h.strikeOuts, h.plateAppearances)}</td>
      <td>${fmtPct(h.baseOnBalls, h.plateAppearances)}</td>
    </tr>`;
  }).join("");
  return `<div class="stats-subheader">Hitters</div>
    <table class="team-stat-table">
      <thead><tr>
        <th class="player-col">Player</th>
        <th>PA</th><th>AVG</th><th>OBP</th><th>SLG</th>
        <th>ISO</th><th>BABIP</th><th>K%</th><th>BB%</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderAdvancedPitchers(players: RosterPlayer[]): string {
  if (players.length === 0) return "";
  const rows = players.map((p) => {
    const pi = p.pitching ?? {};
    return `<tr>
      <td class="player-col">${lastNameLinkWeb(p)}${ilTag(p)}</td>
      <td>${esc(pi.inningsPitched ?? "—")}</td>
      <td>${esc(pi.strikeoutsPer9Inn ?? "—")}</td>
      <td>${esc(pi.walksPer9Inn ?? "—")}</td>
      <td>${esc(pi.strikeoutWalkRatio ?? "—")}</td>
      <td>${esc(pi.homeRunsPer9 ?? "—")}</td>
      <td>${fmtAvg(pi.babip)}</td>
    </tr>`;
  }).join("");
  return `<div class="stats-subheader">Pitchers</div>
    <table class="team-stat-table">
      <thead><tr>
        <th class="player-col">Player</th>
        <th>IP</th><th>K/9</th><th>BB/9</th><th>K/BB</th>
        <th>HR/9</th><th>BABIP</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderAdvancedStats(data: TeamEmailData): string {
  const { hitters, pitchers } = sortedRosters(data);
  return `<div class="game-header">Advanced Stats</div>
    ${renderAdvancedHitters(hitters)}
    ${renderAdvancedPitchers(pitchers)}`;
}

function shortDate(isoTs: string): string {
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric",
    timeZone: "America/New_York",
  }).format(d);
}

function renderUpcoming(data: TeamEmailData): string {
  if (data.upcoming.length === 0) {
    return `<div class="stats-subheader">Upcoming Games</div>
      <div class="no-games-note">No games scheduled this week.</div>`;
  }
  const probable = (
    full: string | undefined,
    stats: { wins: number; losses: number; era: string | null } | undefined,
  ): string => {
    if (!full) return "TBD";
    const parts: string[] = [esc(lastName(full))];
    const detail: string[] = [];
    if (stats) {
      detail.push(`${stats.wins}-${stats.losses}`);
      if (stats.era && stats.era !== "-.--" && stats.era !== "—") {
        detail.push(stats.era);
      }
    }
    if (detail.length > 0) parts.push(`(${detail.join(", ")})`);
    return parts.join(" ");
  };
  const rows = data.upcoming.map((g: ScheduleGame) => {
    const isHome = g.teams.home.team.id === data.team.mlbApiId;
    const opp = isHome ? g.teams.away.team : g.teams.home.team;
    const venue = isHome ? "vs" : "@";
    const when = shortDate(g.gameDate);
    const time = timeInET(g.gameDate);
    const ap = g.teams.away.probablePitcher;
    const hp = g.teams.home.probablePitcher;
    const aStats = ap ? data.probables.get(ap.id) : undefined;
    const hStats = hp ? data.probables.get(hp.id) : undefined;
    const matchup = `${probable(ap?.fullName, aStats)} vs ${probable(hp?.fullName, hStats)}`;
    return `<div class="upcoming-row">
      <div class="upcoming-line">
        <span class="upcoming-when">${esc(when)}</span>
        <span class="upcoming-opp">${esc(venue)} ${esc(opp.name)}</span>
        <span class="upcoming-time">${esc(time)}</span>
      </div>
      <div class="upcoming-matchup">${matchup}</div>
    </div>`;
  }).join("");
  return `<div class="stats-subheader">Upcoming Games</div>
    <div class="upcoming-list">${rows}</div>`;
}

// Season farewell — mirrors renderTeamSignoff in the email renderer: sincere
// thank-you, the retention line (emails stop on their own until spring), then a
// CTA to the leagues that are live now. Relative links since this is the web page.
function renderSignoff(data: TeamEmailData): string {
  // The whole farewell reads as a centered article column so it doesn't hug the
  // left edge under a full-width masthead. Prose stays left-aligned within the
  // column; the CTA is centered. NOT .no-games-note (centered italic, wrong here).
  const para = "font-size:15px;line-height:1.55;color:var(--text-secondary);text-align:left;margin:0 0 14px;";
  const status = `<div style="font-size:18px;font-weight:700;line-height:1.35;margin:4px 0 16px;">${esc(signoffStatusLine(data))}</div>`;
  const thanks = `<p style="${para}">Thank you for being a subscriber this season. A morning box score in your inbox only works because readers like you keep showing up for it, and we're genuinely grateful you spent part of your mornings with us.</p>`;
  const farewell = `<p style="${para}">This is your last scheduled ${esc(data.team.name)} email until next season. We won't email you over the winter. Your subscription stays active, and your daily digest will pick right back up on its own when spring training begins. There's nothing you need to do to keep it.</p>`;
  let cta = "";
  if (data.otherLeagues.length > 0) {
    const list = leagueListText(data.otherLeagues.map((l) => l.name));
    const verb = data.otherLeagues.length === 1 ? "season is" : "seasons are";
    const btnLabel = data.otherLeagues.length === 1
      ? `Subscribe to the ${data.otherLeagues[0]!.name} digest`
      : "Subscribe to another league";
    cta = `<div style="border-top:1px solid #c4baa5;margin-top:24px;padding-top:20px;text-align:center;">
      <p style="font-size:15px;line-height:1.55;color:var(--text-secondary);margin:0 0 16px;">The ${esc(list)} ${verb} underway. Keep the box scores coming all winter.</p>
      <a href="/settings" style="display:inline-block;background:#161410;color:#f9f7f1;font-weight:700;font-size:15px;text-decoration:none;padding:13px 28px;border-radius:6px;">${esc(btnLabel)}</a>
    </div>`;
  }
  return `<div style="max-width:560px;margin:8px auto 0;">${status}${thanks}${farewell}${cta}</div>`;
}

export function renderTeamWebContent(data: TeamEmailData): string {
  const mode = classifyTeamMode(data);
  // Team digests live at /{sport}/{slug}/{edition_date}. data.date is the
  // games_date the digest was built from; editionDate = games_date + 1.
  const editionDate = nextDay(data.date);
  const parts: string[] = [
    renderDateline(prettyDate(editionDate)),
    teamHeading(data),
  ];

  if (mode === "game") {
    parts.push(
      renderStandings(data),
      renderYesterdayBox(data),
    );
    // Skip the regular-season stat sheets in the playoffs (see email renderer).
    if (!data.postseasonBracket) {
      parts.push(renderStatSheet(data), renderAdvancedStats(data));
    }
    parts.push(
      renderUpcoming(data),
      renderTransactions(data.transactions),
    );
  } else if (mode === "no-game") {
    parts.push(
      renderStandings(data),
      renderUpcoming(data),
      renderTransactions(data.transactions),
    );
  } else if (mode === "signoff") {
    parts.push(renderSignoff(data));
  } else {
    parts.push(renderTransactions(data.transactions));
  }

  return parts.join("\n");
}
