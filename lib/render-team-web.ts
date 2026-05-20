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
import { timeInET, prevDay, nextDay } from "./dates";
import {
  esc, pad, fmtAvg, fmtEra, lastName,
  renderGame, renderDateline, renderTransactions, renderDivisionTable,
} from "./render";
import type { TeamEmailData } from "./render-team-email";

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
  if (!data.division) return "";
  const label = DIVISION_NAMES[data.division.division.id] ?? "Division";
  return renderDivisionTable(label, data.division, { date: data.date });
}

function renderYesterdayBox(data: TeamEmailData): string {
  const g = data.yesterdayGame;
  if (!g || !g.box || !g.scoring || g.game.status.codedGameState !== "F") {
    return `<div class="no-games-note">No game played on ${esc(data.prettyDate)}.</div>`;
  }
  return renderGame(
    g as Parameters<typeof renderGame>[0],
    data.liveAbbrev,
  );
}

function isPitcher(p: RosterPlayer): boolean {
  if (p.position === "P" || p.position === "SP" || p.position === "RP") return true;
  return parseFloat(p.pitching?.inningsPitched ?? "0") > 0;
}

function isHitter(p: RosterPlayer): boolean {
  if ((p.hitting?.atBats ?? 0) > 0) return true;
  return !isPitcher(p);
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
      <td class="player-col">${jersey}${esc(lastName(p.fullName))}${pos}</td>
      <td>${pad(h.gamesPlayed)}</td>
      <td>${pad(h.atBats)}</td>
      <td>${pad(h.runs)}</td>
      <td>${pad(h.hits)}</td>
      <td>${pad(h.homeRuns)}</td>
      <td>${pad(h.rbi)}</td>
      <td>${pad(h.baseOnBalls)}</td>
      <td>${pad(h.strikeOuts)}</td>
      <td>${pad(h.stolenBases)}</td>
      <td>${fmtAvg(h.avg)}</td>
      <td>${esc(h.ops ?? "—")}</td>
    </tr>`;
  }).join("");
  return `<div class="stats-subheader">Hitters</div>
    <table class="team-stat-table">
      <thead><tr>
        <th class="player-col">Player</th>
        <th>G</th><th>AB</th><th>R</th><th>H</th><th>HR</th>
        <th>RBI</th><th>BB</th><th>SO</th><th>SB</th>
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
      <td class="player-col">${jersey}${esc(lastName(p.fullName))}</td>
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
      <td class="player-col">${esc(lastName(p.fullName))}</td>
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
      <td class="player-col">${esc(lastName(p.fullName))}</td>
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

// Team-digest day-state mirrors render-team-email's TeamDigestMode — same
// classifier, same section ordering. Kept in sync by hand so the email and
// web views show the same content layout.
type TeamDigestMode = "game" | "no-game" | "offseason";

function classifyMode(data: TeamEmailData): TeamDigestMode {
  const g = data.yesterdayGame;
  const hasGame = !!(g && g.box && g.scoring && g.game.status.codedGameState === "F");
  if (hasGame) return "game";
  if (data.upcoming.length > 0) return "no-game";
  return "offseason";
}

export function renderTeamWebContent(data: TeamEmailData): string {
  const mode = classifyMode(data);
  // Team digests live at /{sport}/{slug}/{date}. Prev/next arrows let
  // readers walk back through past days for the same team.
  const datelineOpts = {
    prevUrl: `/${data.team.sport}/${data.team.slug}/${prevDay(data.date)}`,
    nextUrl: `/${data.team.sport}/${data.team.slug}/${nextDay(data.date)}`,
  };
  const parts: string[] = [renderDateline(data.prettyDate, datelineOpts), teamHeading(data)];

  if (mode === "game") {
    parts.push(
      renderStandings(data),
      renderYesterdayBox(data),
      renderStatSheet(data),
      renderAdvancedStats(data),
      renderUpcoming(data),
      renderTransactions(data.transactions),
    );
  } else if (mode === "no-game") {
    parts.push(
      renderStandings(data),
      renderUpcoming(data),
      renderTransactions(data.transactions),
    );
  } else {
    parts.push(renderTransactions(data.transactions));
  }

  return parts.join("\n");
}
