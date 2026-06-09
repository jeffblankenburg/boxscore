// Player page renderer. /mlb/player/[id] hits this with a loaded
// PlayerPageData and gets back the inner HTML for the page. Web-only — the
// player page is intentionally not part of the daily email; subscriber emails
// link into these pages via player-name anchors.
//
// Header (name + pos + team with record) sits under the dateline. Beneath it,
// a season-totals block (slash line + counting stats) and a "last 15 games"
// log. Hitters and pitchers use different stat columns; two-way players are
// rendered as whichever group matches their primary position for now.

import { issueNumber, prettyDate, prevDay, nextDay, volumeNumber, yesterdayInET } from "./dates";
import { esc, fmtAvg, fmtEra, fmtOps, pad, renderDateline } from "./render";
import {
  fetchPersonRaw, parsePerson,
  fetchPersonSplitsRaw, parseSplitsBundle,
  fetchPersonFieldingRaw, parseFielding,
  fetchStandingsRaw, parseStandings,
  fetchScheduleRangeRaw, parseSchedule,
  type DivisionStandings, type FieldingSplit, type GameLogEntry, type Person, type ScheduleGame, type SplitsBundle,
} from "./mlb";

const DIVISION_NAMES: Record<number, string> = {
  200: "AL West",
  201: "AL East",
  202: "AL Central",
  203: "NL West",
  204: "NL East",
  205: "NL Central",
};

export type PlayerPageData = {
  person: Person;
  hitting: SplitsBundle;
  pitching: SplitsBundle;
  fielding: FieldingSplit[];
  standings: DivisionStandings[];
  // gamePk → final-score row, looked up from a date-range schedule fetch.
  scheduleByPk: Map<number, ScheduleGame>;
};

type Kind = "hitter" | "pitcher";

function classify(p: Person, hitting: SplitsBundle, pitching: SplitsBundle): Kind {
  const pos = p.primaryPosition.abbreviation;
  if (pos === "P" || pos === "SP" || pos === "RP") return "pitcher";
  // Position-player flag wins by default; only fall to pitcher if hitting log
  // is empty but pitching log has entries.
  if (hitting.gameLog.length === 0 && pitching.gameLog.length > 0) return "pitcher";
  return "hitter";
}

function findRecord(
  standings: DivisionStandings[],
  teamId: number | undefined,
): { wins: number; losses: number; rank: string; division: string } | null {
  if (teamId == null) return null;
  for (const div of standings) {
    const tr = div.teamRecords.find((t) => t.team.id === teamId);
    if (tr) {
      return {
        wins: tr.wins,
        losses: tr.losses,
        rank: tr.divisionRank,
        division: DIVISION_NAMES[div.division.id] ?? "",
      };
    }
  }
  return null;
}

function ordinalRank(rank: string): string {
  const n = parseInt(rank, 10);
  if (!Number.isFinite(n)) return rank;
  const last = n % 10, last2 = n % 100;
  if (last2 >= 11 && last2 <= 13) return `${n}th`;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

function renderHeader(data: PlayerPageData): string {
  const p = data.person;
  const pos = p.primaryPosition.abbreviation;
  const jersey = p.primaryNumber;
  const team = p.currentTeam;
  const record = findRecord(data.standings, team?.id);
  const teamText = team
    ? record
      ? `${team.name} (${record.wins}-${record.losses}, ${ordinalRank(record.rank)} ${record.division})`
      : team.name
    : "";
  // Sub-line: "#23, CF, New York Yankees (32-21, 1st AL East)". Each piece is
  // optional; separators only appear when both flanking pieces are present.
  const parts: string[] = [];
  if (jersey) parts.push(`<span class="player-jersey">#${esc(jersey)}</span>`);
  if (pos) parts.push(`<span class="pos">${esc(pos)}</span>`);
  if (teamText) parts.push(`<span class="player-team">${esc(teamText)}</span>`);
  const posLine = parts.length > 0
    ? `<div class="player-sub">${parts.join(", ")}</div>`
    : "";
  return `<div class="team-name-header">${esc(p.fullName)}</div>${posLine}`;
}

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

// Mirror the team-digest advanced-stat formatters so player and team pages
// agree on display (ISO with leading zero stripped; percentages to 1 dp).
function fmtIso(slg: string, avg: string): string {
  if (!slg || !avg) return "—";
  const s = parseFloat(slg), a = parseFloat(avg);
  if (!isFinite(s) || !isFinite(a)) return "—";
  const iso = s - a;
  if (iso < 0) return "—";
  return iso.toFixed(3).replace(/^0/, "");
}

function fmtPct(n: number, denom: number): string {
  if (denom <= 0) return "—";
  return `${(n / denom * 100).toFixed(1)}%`;
}

// Hitter season totals row — same column shape as a hitter game-log row, so
// it can sit in <tfoot> and the columns line up exactly with the game rows
// above. Result/Opp/Date collapse via colspan. 2B/3B/SB live in the Advanced
// table since they're noisy as a per-game column.
function hitterSeasonRow(stat: Record<string, unknown> | null, gp: number): string {
  if (!stat) return "";
  return `<tr class="gl-totals">
    <td colspan="3" class="gl-summary">Season (${gp} G)</td>
    <td class="gl-stat">${pad(num(stat.atBats))}</td>
    <td class="gl-stat">${pad(num(stat.runs))}</td>
    <td class="gl-stat">${pad(num(stat.hits))}</td>
    <td class="gl-stat">${pad(num(stat.homeRuns))}</td>
    <td class="gl-stat">${pad(num(stat.rbi))}</td>
    <td class="gl-stat">${pad(num(stat.baseOnBalls))}</td>
    <td class="gl-stat">${pad(num(stat.strikeOuts))}</td>
    <td class="gl-rate">${fmtOps(str(stat.ops))}</td>
    <td class="gl-rate">${fmtAvg(str(stat.avg))}</td>
  </tr>`;
}

// Pitcher season totals row — W-L and saves live in the summary cell since
// the per-game pitcher decision is shown in the result column.
function pitcherSeasonRow(stat: Record<string, unknown> | null, gp: number): string {
  if (!stat) return "";
  const w = num(stat.wins), l = num(stat.losses), sv = num(stat.saves);
  const head = `Season (${gp} G, ${w}-${l}${sv > 0 ? `, ${sv} SV` : ""})`;
  return `<tr class="gl-totals">
    <td colspan="3" class="gl-summary">${esc(head)}</td>
    <td class="gl-stat">${esc(str(stat.inningsPitched) || "—")}</td>
    <td class="gl-stat">${pad(num(stat.hits))}</td>
    <td class="gl-stat">${pad(num(stat.runs))}</td>
    <td class="gl-stat">${pad(num(stat.earnedRuns))}</td>
    <td class="gl-stat">${pad(num(stat.baseOnBalls))}</td>
    <td class="gl-stat">${pad(num(stat.strikeOuts))}</td>
    <td class="gl-stat">${pad(num(stat.homeRuns))}</td>
    <td class="gl-stat">${pad(num(stat.battersFaced))}</td>
    <td class="gl-rate">${fmtEra(str(stat.era))}</td>
  </tr>`;
}

// ─── Advanced stats ───────────────────────────────────────────────────────
// One-row tables mirroring the team-digest advanced sheets. Columns match
// what each player kind's pickHitting / pickPitching extracts, so the player
// page surfaces the same numbers the team page does for the same player.

// Hitter advanced + extras. Picks up the counting stats we left out of the
// per-game table (2B, 3B, SB) so they're not lost, alongside the rate stats
// that mirror the team-digest advanced sheet.
function renderHitterAdvanced(season: Record<string, unknown> | null): string {
  if (!season) return "";
  const pa = num(season.plateAppearances);
  const avg = str(season.avg), obp = str(season.obp), slg = str(season.slg);
  const babip = str(season.babip);
  return `<div class="stats-subheader">Advanced</div>
    <table class="team-stat-table">
      <thead><tr>
        <th class="player-col">Season</th>
        <th>PA</th><th>2B</th><th>3B</th><th>SB</th>
        <th>OBP</th><th>SLG</th><th>ISO</th><th>BABIP</th><th>K%</th><th>BB%</th>
      </tr></thead>
      <tbody><tr>
        <td class="player-col">Totals</td>
        <td>${pad(pa || undefined)}</td>
        <td>${pad(num(season.doubles) || undefined)}</td>
        <td>${pad(num(season.triples) || undefined)}</td>
        <td>${pad(num(season.stolenBases) || undefined)}</td>
        <td>${fmtAvg(obp)}</td>
        <td>${fmtAvg(slg)}</td>
        <td>${fmtIso(slg, avg)}</td>
        <td>${fmtAvg(babip)}</td>
        <td>${fmtPct(num(season.strikeOuts), pa)}</td>
        <td>${fmtPct(num(season.baseOnBalls), pa)}</td>
      </tr></tbody>
    </table>`;
}

function renderPitcherAdvanced(
  season: Record<string, unknown> | null,
  seasonAdvanced: Record<string, unknown> | null,
): string {
  if (!season) return "";
  const ip = str(season.inningsPitched);
  // Pitcher BABIP only lives in seasonAdvanced — fall back to season just in
  // case MLB ever moves it.
  const babip = str(seasonAdvanced?.babip ?? season.babip);
  return `<div class="stats-subheader">Advanced</div>
    <table class="team-stat-table">
      <thead><tr>
        <th class="player-col">Season</th>
        <th>IP</th><th>K/9</th><th>BB/9</th><th>K/BB</th>
        <th>HR/9</th><th>BABIP</th>
      </tr></thead>
      <tbody><tr>
        <td class="player-col">Totals</td>
        <td>${esc(ip || "—")}</td>
        <td>${esc(str(season.strikeoutsPer9Inn) || "—")}</td>
        <td>${esc(str(season.walksPer9Inn) || "—")}</td>
        <td>${esc(str(season.strikeoutWalkRatio) || "—")}</td>
        <td>${esc(str(season.homeRunsPer9) || "—")}</td>
        <td>${fmtAvg(babip)}</td>
      </tr></tbody>
    </table>`;
}

// ─── Fielding ─────────────────────────────────────────────────────────────
// One row per position the player actually appeared at (DH-only slots are
// filtered upstream). Columns mirror the standard fielding line you see on
// reference sites: G, GS, Inn, TC, PO, A, E, DP, Fld%.

function renderFielding(splits: FieldingSplit[]): string {
  if (splits.length === 0) return "";
  const rows = splits.map((sp) => `<tr>
    <td class="player-col">${esc(sp.position)}</td>
    <td>${pad(sp.games || undefined)}</td>
    <td>${pad(sp.gamesStarted || undefined)}</td>
    <td>${esc(sp.innings)}</td>
    <td>${pad(sp.chances || undefined)}</td>
    <td>${pad(sp.putOuts || undefined)}</td>
    <td>${pad(sp.assists || undefined)}</td>
    <td>${pad(sp.errors || undefined)}</td>
    <td>${pad(sp.doublePlays || undefined)}</td>
    <td>${fmtAvg(sp.fielding)}</td>
  </tr>`).join("");
  return `<div class="stats-subheader">Fielding</div>
    <table class="team-stat-table">
      <thead><tr>
        <th class="player-col">Pos</th>
        <th>G</th><th>GS</th><th>Inn</th><th>TC</th><th>PO</th>
        <th>A</th><th>E</th><th>DP</th><th>Fld%</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ─── Game log ──────────────────────────────────────────────────────────────

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
}

const TEAM_ABBREV: Record<number, string> = {
  108: "LAA", 109: "ARI", 110: "BAL", 111: "BOS", 112: "CHC", 113: "CIN",
  114: "CLE", 115: "COL", 116: "DET", 117: "HOU", 118: "KC",  119: "LAD",
  120: "WSH", 121: "NYM", 133: "ATH", 134: "PIT", 135: "SD",  136: "SEA",
  137: "SF",  138: "STL", 139: "TB",  140: "TEX", 141: "TOR", 142: "MIN",
  143: "PHI", 144: "ATL", 145: "CWS", 146: "MIA", 147: "NYY", 158: "MIL",
};

function abbrevFor(teamName: string, teamId: number): string {
  return TEAM_ABBREV[teamId] ?? teamName.slice(0, 3).toUpperCase();
}

type Result = { outcome: "W" | "L" | "T" | ""; score: string };

function resultFromSched(
  entry: GameLogEntry,
  sched: ScheduleGame | undefined,
): Result {
  if (!sched) {
    if (entry.isWin) return { outcome: "W", score: "" };
    if (entry.isLoss) return { outcome: "L", score: "" };
    return { outcome: "", score: "" };
  }
  const home = sched.linescore?.teams.home.runs ?? sched.teams.home.score ?? 0;
  const away = sched.linescore?.teams.away.runs ?? sched.teams.away.score ?? 0;
  const teamIsHome = sched.teams.home.team.id === entry.team.id;
  const teamScore = teamIsHome ? home : away;
  const oppScore = teamIsHome ? away : home;
  const outcome = teamScore > oppScore ? "W" : teamScore < oppScore ? "L" : "T";
  return { outcome, score: `${teamScore}-${oppScore}` };
}

function hitterRow(e: GameLogEntry, sched: ScheduleGame | undefined): string {
  const s = e.stat;
  const res = resultFromSched(e, sched);
  const opp = `${e.isHome ? "vs " : "@ "}${abbrevFor(e.opponent.name, e.opponent.id)}`;
  return `<tr>
    <td class="gl-date">${esc(shortDate(e.date))}</td>
    <td class="gl-opp">${esc(opp)}</td>
    <td class="gl-result"><span class="gl-out gl-out-${res.outcome.toLowerCase() || "x"}">${esc(res.outcome || "—")}</span>${res.score ? ` <span class="gl-score">${esc(res.score)}</span>` : ""}</td>
    <td class="gl-stat">${pad(num(s.atBats))}</td>
    <td class="gl-stat">${pad(num(s.runs))}</td>
    <td class="gl-stat">${pad(num(s.hits))}</td>
    <td class="gl-stat">${pad(num(s.homeRuns))}</td>
    <td class="gl-stat">${pad(num(s.rbi))}</td>
    <td class="gl-stat">${pad(num(s.baseOnBalls))}</td>
    <td class="gl-stat">${pad(num(s.strikeOuts))}</td>
    <td class="gl-rate">${fmtOps(str(s.ops))}</td>
    <td class="gl-rate">${fmtAvg(str(s.avg))}</td>
  </tr>`;
}

function pitcherRow(e: GameLogEntry, sched: ScheduleGame | undefined): string {
  const s = e.stat;
  const res = resultFromSched(e, sched);
  const opp = `${e.isHome ? "vs " : "@ "}${abbrevFor(e.opponent.name, e.opponent.id)}`;
  // Pitcher decision (W/L/Sv/Hd/BS) sits beside the team result so a non-
  // decision relief outing is still visible.
  const pd = num(s.wins) > 0 ? "W" : num(s.losses) > 0 ? "L" : num(s.saves) > 0 ? "Sv" : num(s.holds) > 0 ? "Hd" : num(s.blownSaves) > 0 ? "BS" : "";
  return `<tr>
    <td class="gl-date">${esc(shortDate(e.date))}</td>
    <td class="gl-opp">${esc(opp)}</td>
    <td class="gl-result"><span class="gl-out gl-out-${res.outcome.toLowerCase() || "x"}">${esc(res.outcome || "—")}</span>${res.score ? ` <span class="gl-score">${esc(res.score)}</span>` : ""}${pd ? ` <span class="gl-dec">${esc(pd)}</span>` : ""}</td>
    <td class="gl-stat">${esc(str(s.inningsPitched) || "—")}</td>
    <td class="gl-stat">${pad(num(s.hits))}</td>
    <td class="gl-stat">${pad(num(s.runs))}</td>
    <td class="gl-stat">${pad(num(s.earnedRuns))}</td>
    <td class="gl-stat">${pad(num(s.baseOnBalls))}</td>
    <td class="gl-stat">${pad(num(s.strikeOuts))}</td>
    <td class="gl-stat">${pad(num(s.homeRuns))}</td>
    <td class="gl-stat">${pad(num(s.battersFaced))}</td>
    <td class="gl-rate">${fmtEra(str(s.era))}</td>
  </tr>`;
}

// One combined table per player kind: thead = column labels, tbody = last
// 15 game rows (newest first), tfoot = season totals row. Single table
// guarantees columns line up across the season summary and the per-game
// detail since they share one column-width computation.
function renderPlayerTable(
  season: Record<string, unknown> | null,
  log: GameLogEntry[],
  scheduleByPk: Map<number, ScheduleGame>,
  kind: Kind,
  label: string,
): string {
  const last = log.slice(-15).reverse();
  if (kind === "pitcher") {
    const totals = pitcherSeasonRow(season, log.length);
    const rows = last.map((e) => pitcherRow(e, scheduleByPk.get(e.gamePk))).join("");
    return `<div class="stats-subheader">${esc(label)}</div>
      <table class="gamelog-table gamelog-pitcher">
        <thead><tr>
          <th class="gl-date">Date</th>
          <th class="gl-opp">Opp</th>
          <th class="gl-result">Result</th>
          <th class="gl-stat">IP</th>
          <th class="gl-stat">H</th>
          <th class="gl-stat">R</th>
          <th class="gl-stat">ER</th>
          <th class="gl-stat">BB</th>
          <th class="gl-stat">K</th>
          <th class="gl-stat">HR</th>
          <th class="gl-stat">BF</th>
          <th class="gl-rate">ERA</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>${totals}</tfoot>
      </table>`;
  }
  const totals = hitterSeasonRow(season, log.length);
  const rows = last.map((e) => hitterRow(e, scheduleByPk.get(e.gamePk))).join("");
  return `<div class="stats-subheader">${esc(label)}</div>
    <table class="gamelog-table gamelog-hitter">
      <thead><tr>
        <th class="gl-date">Date</th>
        <th class="gl-opp">Opp</th>
        <th class="gl-result">Result</th>
        <th class="gl-stat">AB</th>
        <th class="gl-stat">R</th>
        <th class="gl-stat">H</th>
        <th class="gl-stat">HR</th>
        <th class="gl-stat">RBI</th>
        <th class="gl-stat">BB</th>
        <th class="gl-stat">SO</th>
        <th class="gl-rate">OPS</th>
        <th class="gl-rate">Avg</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>${totals}</tfoot>
    </table>`;
}

// ─── Page assembly ─────────────────────────────────────────────────────────

export function renderPlayerContent(data: PlayerPageData): string {
  const kind = classify(data.person, data.hitting, data.pitching);
  // Edition date drives the dateline; player pages don't have a "date" of
  // their own, so we use the same edition convention as the league page
  // (yesterday's games rolled forward by one day).
  const editionDate = nextDay(yesterdayInET());
  const datelineOpts = {
    volume: volumeNumber(editionDate),
    issue: issueNumber(editionDate),
    prevUrl: `/mlb/${prevDay(editionDate)}`,
    nextUrl: `/mlb/${nextDay(editionDate)}`,
  };

  const parts: string[] = [
    renderDateline(prettyDate(editionDate), datelineOpts),
    renderHeader(data),
  ];

  if (kind === "pitcher") {
    parts.push(renderPlayerTable(data.pitching.season, data.pitching.gameLog, data.scheduleByPk, "pitcher", "Pitching"));
    parts.push(renderPitcherAdvanced(data.pitching.season, data.pitching.seasonAdvanced));
  } else {
    parts.push(renderPlayerTable(data.hitting.season, data.hitting.gameLog, data.scheduleByPk, "hitter", "Hitting"));
    parts.push(renderHitterAdvanced(data.hitting.season));
    if (data.pitching.gameLog.length > 0) {
      parts.push(renderPlayerTable(data.pitching.season, data.pitching.gameLog, data.scheduleByPk, "pitcher", "Pitching"));
      parts.push(renderPitcherAdvanced(data.pitching.season, data.pitching.seasonAdvanced));
    }
  }
  parts.push(renderFielding(data.fielding));

  return parts.join("\n");
}

// ─── Loader ────────────────────────────────────────────────────────────────
// Pulls everything the page needs. Returns null if MLB has no record for the
// given personId so the route handler can 404 cleanly.

export async function loadPlayerPageData(personId: number): Promise<PlayerPageData | null> {
  const season = parseInt(yesterdayInET().slice(0, 4), 10);
  // Look up the person first so we can skip the irrelevant split group —
  // pitchers don't need a hitting gameLog (and vice versa). Saves one MLB
  // round trip per render.
  const personRaw = await fetchPersonRaw(personId);
  const person = parsePerson(personRaw);
  if (!person) return null;
  const pos = person.primaryPosition.abbreviation;
  const isPitcher = pos === "P" || pos === "SP" || pos === "RP";
  const empty: SplitsBundle = { season: null, seasonAdvanced: null, gameLog: [] };
  const [hittingRaw, pitchingRaw, fieldingRaw, standingsRaw] = await Promise.all([
    isPitcher ? Promise.resolve(null) : fetchPersonSplitsRaw(personId, season, "hitting"),
    isPitcher ? fetchPersonSplitsRaw(personId, season, "pitching") : Promise.resolve(null),
    fetchPersonFieldingRaw(personId, season),
    fetchStandingsRaw(season, yesterdayInET()),
  ]);
  const hitting = hittingRaw ? parseSplitsBundle(hittingRaw) : empty;
  const pitching = pitchingRaw ? parseSplitsBundle(pitchingRaw) : empty;
  const fielding = parseFielding(fieldingRaw);
  const standings = parseStandings(standingsRaw);

  // Window covering the last-15 entries from whichever logs exist. The
  // schedule call resolves final scores so the result column can render
  // `w 7-4` instead of just `w`.
  const window = [
    ...hitting.gameLog.slice(-15),
    ...pitching.gameLog.slice(-15),
  ];
  let scheduleByPk = new Map<number, ScheduleGame>();
  const dates = window.map((e) => e.date).sort();
  const start = dates[0];
  const end = dates[dates.length - 1];
  if (start && end) {
    const games = parseSchedule(await fetchScheduleRangeRaw(start, end));
    scheduleByPk = new Map(games.map((g) => [g.gamePk, g]));
  }

  return { person, hitting, pitching, fielding, standings, scheduleByPk };
}
