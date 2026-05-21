// Email renderer for a single-team daily digest.
//
// Three sections, in order:
//   1. Yesterday's game (full box score, skipped if team didn't play)
//   2. Team statistics (every active-roster player, hitters + pitchers tables)
//   3. Upcoming games (next 7 days)
//
// Reuses CSS classes and helpers from render-email.ts. Loader function
// (loadTeamEmailData) orchestrates the MLB-API fetches.

import { loadDailyData } from "./daily";
import {
  getTeamRoster, getTeamScheduleRange,
  fetchPersonSeasonPitchingRaw, parsePersonWL,
} from "./mlb";
import type {
  ScheduleGame, TeamRoster, RosterPlayer,
  DivisionStandings, Transaction,
} from "./mlb";
import { issueNumber, nextDay, prettyDate, timeInET, volumeNumber } from "./dates";
import type { Team } from "./teams";
import type { GameDetail } from "./render";
import {
  dateline, sectionH, renderGame, renderDivisionStandings,
  esc, pad, fmtAvg, fmtEra, lastName,
} from "./render-email";

type ProbableStats = { wins: number; losses: number; era: string | null };

export type TeamEmailData = {
  team: Team;
  date: string;
  prettyDate: string;
  yesterdayGame: GameDetail | null;
  roster: TeamRoster;
  upcoming: ScheduleGame[];
  liveAbbrev: Record<string, string>;
  division: DivisionStandings | null;
  record: { wins: number; losses: number; gamesBack: string } | null;
  transactions: Transaction[];
  probables: Map<number, ProbableStats>;
};

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function loadTeamEmailData(team: Team, date: string): Promise<TeamEmailData> {
  if (!team.mlbApiId) {
    throw new Error(`Team ${team.sport}/${team.slug} has no mlbApiId`);
  }
  const teamId = team.mlbApiId;
  const season = Number(date.slice(0, 4));
  const start = nextDay(date);
  const end = addDaysIso(start, 6);

  // Wave 1: parallel reads. loadDailyData covers yesterday's box scores,
  // standings, and transactions; the other two are team-scoped.
  const [daily, roster, upcoming] = await Promise.all([
    loadDailyData(date),
    getTeamRoster(teamId, season),
    getTeamScheduleRange(teamId, start, end),
  ]);

  const yesterdayGame = daily.games.find(
    (g) =>
      g.game.teams.away.team.id === teamId ||
      g.game.teams.home.team.id === teamId,
  ) ?? null;

  const division = daily.standings.find((d) =>
    d.teamRecords.some((tr) => tr.team.id === teamId),
  ) ?? null;
  const teamRec = division?.teamRecords.find((tr) => tr.team.id === teamId);
  const record = teamRec
    ? { wins: teamRec.wins, losses: teamRec.losses, gamesBack: teamRec.gamesBack }
    : null;

  const transactions = daily.transactions.filter(
    (t) => t.fromTeamId === teamId || t.toTeamId === teamId,
  );

  // Wave 2: fan-out for upcoming-game probable-pitcher stats.
  const probables = await fetchProbables(upcoming, season);

  return {
    team,
    date,
    prettyDate: prettyDate(date),
    yesterdayGame,
    roster,
    upcoming,
    liveAbbrev: daily.teamAbbrev,
    division,
    record,
    transactions,
    probables,
  };
}

async function fetchProbables(games: ScheduleGame[], season: number): Promise<Map<number, ProbableStats>> {
  const ids = new Set<number>();
  for (const g of games) {
    if (g.teams.away.probablePitcher?.id) ids.add(g.teams.away.probablePitcher.id);
    if (g.teams.home.probablePitcher?.id) ids.add(g.teams.home.probablePitcher.id);
  }
  const results = await Promise.all(
    Array.from(ids).map(async (id) => {
      const wl = parsePersonWL(await fetchPersonSeasonPitchingRaw(id, season));
      return [id, wl] as const;
    }),
  );
  const out = new Map<number, ProbableStats>();
  for (const [id, wl] of results) out.set(id, wl);
  return out;
}

// ─── sections ─────────────────────────────────────────────────────────────

function formatRecord(r: { wins: number; losses: number; gamesBack: string }): string {
  return `(${r.wins}-${r.losses})`;
}

function teamSectionHeading(data: TeamEmailData): string {
  const title = data.record
    ? `${data.team.name} ${formatRecord(data.record)}`
    : data.team.name;
  // Override font-size on this one header so the longest possible content
  // ("Arizona Diamondbacks (100-100, 12.5GB)") fits on a 390px mobile preview
  // without wrapping.
  return `<h2 class="es-section-h" style="font-size:17px;letter-spacing:0;">${esc(title)}</h2>`;
}

function renderTeamYesterdayBox(data: TeamEmailData): string {
  const g = data.yesterdayGame;
  if (!g || !g.box || !g.scoring || g.game.status.codedGameState !== "F") {
    return `<p class="es-info">No game played on ${esc(data.prettyDate)}.</p>`;
  }
  return renderGame(g as Required<GameDetail>, data.liveAbbrev);
}

// ─── standings ────────────────────────────────────────────────────────────

const DIVISION_NAMES: Record<number, string> = {
  200: "AL West",
  201: "AL East",
  202: "AL Central",
  203: "NL West",
  204: "NL East",
  205: "NL Central",
};

function renderTeamStandings(data: TeamEmailData): string {
  if (!data.division || !data.team.mlbApiId) return "";
  const label = DIVISION_NAMES[data.division.division.id] ?? "Division";
  // Pass sport + games_date so every team name becomes an invisible link
  // to that team's digest for the same date (current team links to itself
  // but renders the same — the highlight row makes "this is you" obvious).
  // Team-name links use the EDITION date (games_date + 1) so they point
  // at the same /{sport}/{slug}/{edition} URL shape used everywhere else.
  return `${sectionH("Standings")}${renderDivisionStandings(label, data.division, {
    highlightTeamId: data.team.mlbApiId,
    sport: data.team.sport,
    date: nextDay(data.date),
  })}`;
}

// A player is treated as a pitcher (for the pitching table) if their listed
// position is P/SP/RP, or if they have non-zero IP this season.
function isPitcher(p: RosterPlayer): boolean {
  if (p.position === "P" || p.position === "SP" || p.position === "RP") return true;
  return parseFloat(p.pitching?.inningsPitched ?? "0") > 0;
}

// A player is treated as a hitter if they have at-bats this season OR they
// aren't a pitcher. Catches two-way and bench players who haven't pitched.
function isHitter(p: RosterPlayer): boolean {
  if ((p.hitting?.atBats ?? 0) > 0) return true;
  return !isPitcher(p);
}

function renderHitters(players: RosterPlayer[]): string {
  if (players.length === 0) return "";
  const rows = players.map((p) => {
    const h = p.hitting ?? {};
    const jersey = p.jerseyNumber
      ? `<span class="es-mut">#${esc(p.jerseyNumber)}</span> `
      : "";
    const pos = p.position ? ` <span class="es-mut">${esc(p.position.toLowerCase())}</span>` : "";
    return `<tr>
      <td align="left">${jersey}${esc(lastName(p.fullName))}${pos}</td>
      <td align="right">${pad(h.gamesPlayed)}</td>
      <td align="right">${pad(h.atBats)}</td>
      <td align="right">${pad(h.runs)}</td>
      <td align="right">${pad(h.hits)}</td>
      <td align="right">${pad(h.homeRuns)}</td>
      <td align="right">${pad(h.rbi)}</td>
      <td align="right">${pad(h.baseOnBalls)}</td>
      <td align="right">${pad(h.strikeOuts)}</td>
      <td align="right">${pad(h.stolenBases)}</td>
      <td align="right">${fmtAvg(h.avg)}</td>
      <td align="right">${esc(h.ops ?? "—")}</td>
    </tr>`;
  }).join("");
  return `<div class="es-team-label">Hitters</div>
    <table class="es-table es-fixed" cellpadding="0" cellspacing="0" border="0">
      <colgroup>
        <col width="26%"><col width="5%"><col width="6%"><col width="5%">
        <col width="6%"><col width="5%"><col width="6%"><col width="5%">
        <col width="6%"><col width="5%"><col width="9%"><col width="9%">
      </colgroup>
      <thead><tr>
        <th align="left">Player</th>
        <th align="right">G</th>
        <th align="right">AB</th>
        <th align="right">R</th>
        <th align="right">H</th>
        <th align="right">HR</th>
        <th align="right">RBI</th>
        <th align="right">BB</th>
        <th align="right">SO</th>
        <th align="right">SB</th>
        <th align="right">AVG</th>
        <th align="right">OPS</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderPitchers(players: RosterPlayer[]): string {
  if (players.length === 0) return "";
  const rows = players.map((p) => {
    const pi = p.pitching ?? {};
    const jersey = p.jerseyNumber
      ? `<span class="es-mut">#${esc(p.jerseyNumber)}</span> `
      : "";
    return `<tr>
      <td align="left">${jersey}${esc(lastName(p.fullName))}</td>
      <td align="right">${pad(pi.gamesPlayed)}</td>
      <td align="right">${pad(pi.wins)}</td>
      <td align="right">${pad(pi.losses)}</td>
      <td align="right">${pad(pi.saves)}</td>
      <td align="right">${esc(pi.inningsPitched ?? "—")}</td>
      <td align="right">${pad(pi.hits)}</td>
      <td align="right">${pad(pi.earnedRuns)}</td>
      <td align="right">${pad(pi.baseOnBalls)}</td>
      <td align="right">${pad(pi.strikeOuts)}</td>
      <td align="right">${fmtEra(pi.era)}</td>
      <td align="right">${esc(pi.whip ?? "—")}</td>
    </tr>`;
  }).join("");
  return `<div class="es-team-label">Pitchers</div>
    <table class="es-table es-fixed" cellpadding="0" cellspacing="0" border="0">
      <colgroup>
        <col width="26%"><col width="5%"><col width="5%"><col width="5%">
        <col width="5%"><col width="9%"><col width="6%"><col width="6%">
        <col width="6%"><col width="6%"><col width="9%"><col width="9%">
      </colgroup>
      <thead><tr>
        <th align="left">Player</th>
        <th align="right">G</th>
        <th align="right">W</th>
        <th align="right">L</th>
        <th align="right">SV</th>
        <th align="right">IP</th>
        <th align="right">H</th>
        <th align="right">ER</th>
        <th align="right">BB</th>
        <th align="right">SO</th>
        <th align="right">ERA</th>
        <th align="right">WHIP</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderTeamStatSheet(data: TeamEmailData): string {
  const { hitters, pitchers } = sortedRosters(data);
  return `${sectionH("Team Statistics")}
${renderHitters(hitters)}
${renderPitchers(pitchers)}`;
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

// ─── advanced stats (Tier 2) ─────────────────────────────────────────────

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
    const jersey = p.jerseyNumber
      ? `<span class="es-mut">#${esc(p.jerseyNumber)}</span> `
      : "";
    return `<tr>
      <td align="left">${jersey}${esc(lastName(p.fullName))}</td>
      <td align="right">${pad(h.plateAppearances)}</td>
      <td align="right">${fmtAvg(h.avg)}</td>
      <td align="right">${fmtAvg(h.obp)}</td>
      <td align="right">${fmtAvg(h.slg)}</td>
      <td align="right">${fmtIso(h.slg, h.avg)}</td>
      <td align="right">${fmtAvg(h.babip)}</td>
      <td align="right">${fmtPct(h.strikeOuts, h.plateAppearances)}</td>
      <td align="right">${fmtPct(h.baseOnBalls, h.plateAppearances)}</td>
    </tr>`;
  }).join("");
  return `<div class="es-team-label">Hitters</div>
    <table class="es-table es-fixed" cellpadding="0" cellspacing="0" border="0">
      <colgroup>
        <col width="26%"><col width="7%"><col width="8%"><col width="8%">
        <col width="8%"><col width="8%"><col width="9%"><col width="9%"><col width="9%">
      </colgroup>
      <thead><tr>
        <th align="left">Player</th>
        <th align="right">PA</th>
        <th align="right">AVG</th>
        <th align="right">OBP</th>
        <th align="right">SLG</th>
        <th align="right">ISO</th>
        <th align="right">BABIP</th>
        <th align="right">K%</th>
        <th align="right">BB%</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderAdvancedPitchers(players: RosterPlayer[]): string {
  if (players.length === 0) return "";
  const rows = players.map((p) => {
    const pi = p.pitching ?? {};
    const jersey = p.jerseyNumber
      ? `<span class="es-mut">#${esc(p.jerseyNumber)}</span> `
      : "";
    return `<tr>
      <td align="left">${jersey}${esc(lastName(p.fullName))}</td>
      <td align="right">${esc(pi.inningsPitched ?? "—")}</td>
      <td align="right">${esc(pi.strikeoutsPer9Inn ?? "—")}</td>
      <td align="right">${esc(pi.walksPer9Inn ?? "—")}</td>
      <td align="right">${esc(pi.strikeoutWalkRatio ?? "—")}</td>
      <td align="right">${esc(pi.homeRunsPer9 ?? "—")}</td>
      <td align="right">${fmtAvg(pi.babip)}</td>
    </tr>`;
  }).join("");
  return `<div class="es-team-label">Pitchers</div>
    <table class="es-table es-fixed" cellpadding="0" cellspacing="0" border="0">
      <colgroup>
        <col width="30%"><col width="11%"><col width="10%"><col width="10%">
        <col width="11%"><col width="10%"><col width="12%">
      </colgroup>
      <thead><tr>
        <th align="left">Player</th>
        <th align="right">IP</th>
        <th align="right">K/9</th>
        <th align="right">BB/9</th>
        <th align="right">K/BB</th>
        <th align="right">HR/9</th>
        <th align="right">BABIP</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderAdvancedStats(data: TeamEmailData): string {
  const { hitters, pitchers } = sortedRosters(data);
  return `${sectionH("Advanced Stats")}
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

function renderTeamUpcoming(data: TeamEmailData): string {
  if (data.upcoming.length === 0) {
    return `${sectionH("Upcoming Games")}<p class="es-info">No games scheduled this week.</p>`;
  }
  const probable = (full: string | undefined, stats: ProbableStats | undefined): string => {
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
  const rows = data.upcoming.map((g) => {
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
    return `<tr>
      <td align="left" style="font-size:13px;font-weight:700;padding:3px 0 0;">${esc(when)}</td>
      <td align="left" style="font-size:13px;padding:3px 0 0;">${venue} ${esc(opp.name)}</td>
      <td align="right" style="font-size:13px;color:#6a6354;padding:3px 0 0;white-space:nowrap;">${esc(time)}</td>
    </tr>
    <tr>
      <td colspan="3" style="font-size:12px;color:#6a6354;padding:0 0 4px;border-bottom:1px dotted #e8e2d4;">${matchup}</td>
    </tr>`;
  }).join("");
  return `${sectionH("Upcoming Games")}
    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      <tbody>${rows}</tbody>
    </table>`;
}

function renderTeamTransactions(data: TeamEmailData): string {
  if (data.transactions.length === 0) return "";
  const items = data.transactions.map((t) => `<p class="es-tx">
    <span class="es-tx-type">${esc(t.typeDesc)}</span> ${esc(t.description)}
  </p>`).join("");
  return `${sectionH("Transactions")}<div class="es-tx-block">${items}</div>`;
}

// ─── entry ────────────────────────────────────────────────────────────────

// Team-digest day-state. Mirrors the MLB league digest's DigestMode
// classifier pattern — the section list shifts based on what's actually
// available, so single-team subscribers get a morning ritual every day
// without "no game played" filler taking up space.
//
//   "game"      — yesterday had a final game; the full game-day layout
//   "no-game"   — season is active but the team didn't play; surface
//                 standings + upcoming + transactions instead of placeholder
//   "offseason" — no game yesterday AND no upcoming games this week; show
//                 transactions only (hot stove still happens). Final regular-
//                 season standings are intentionally suppressed here to keep
//                 the spec literal — revisit if subscribers ask for them
type TeamDigestMode = "game" | "no-game" | "offseason";

function classifyTeamMode(data: TeamEmailData): TeamDigestMode {
  const g = data.yesterdayGame;
  const hasGame = !!(
    g && g.box && g.scoring && g.game.status.codedGameState === "F"
  );
  if (hasGame) return "game";
  if (data.upcoming.length > 0) return "no-game";
  return "offseason";
}

export function renderTeamEmailContent(data: TeamEmailData): string {
  const mode = classifyTeamMode(data);
  // Email dateline = the day this email goes out (i.e. digest date + 1).
  // Mirrors a newspaper: today's edition, yesterday's results.
  const sendIso = nextDay(data.date);
  const parts: string[] = [
    `<div class="es">`,
    dateline(prettyDate(sendIso), { volume: volumeNumber(sendIso), issue: issueNumber(sendIso) }),
  ];

  if (mode === "game") {
    parts.push(
      teamSectionHeading(data),
      renderTeamStandings(data),
      renderTeamYesterdayBox(data),
      renderTeamStatSheet(data),
      renderAdvancedStats(data),
      renderTeamUpcoming(data),
      renderTeamTransactions(data),
    );
  } else if (mode === "no-game") {
    // Active season, just no game today. Skip the "no game played"
    // placeholder and the stat-sheet/advanced-stats tables — subscribers
    // see those plenty on game days. Lead with team identity + record so
    // they know they're in the right inbox.
    parts.push(
      teamSectionHeading(data),
      renderTeamStandings(data),
      renderTeamUpcoming(data),
      renderTeamTransactions(data),
    );
  } else {
    // Offseason. Transactions are the only structured signal worth a
    // morning email here; if there aren't any, the cron should choose to
    // skip the send entirely (renderer still produces a thin shell).
    parts.push(
      teamSectionHeading(data),
      renderTeamTransactions(data),
    );
  }

  parts.push(`</div>`);
  return parts.join("\n");
}
