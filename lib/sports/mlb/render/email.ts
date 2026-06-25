// Canonical email renderer. Takes CanonicalDailyData and returns the
// email-body HTML the production renderer at lib/render-email.ts produces
// — but reading canonical field names directly, with no DailyData-shaped
// intermediate. When we cut over the email send pipeline to canonical,
// this file replaces lib/render-email.ts entirely.
//
// Identity contract: for any date that comes out of the statsapi adapter,
// this renderer's HTML output should match lib/render-email.ts's output
// section-by-section. The canonical preview at
// /admin/preview/canonical/[date]?source=statsapi&surface=email is the
// validation surface for that contract.
//
// EMAIL_STYLES (the <style> block injected into <head>) lives in
// lib/render-email.ts and is shared — both renderers produce body
// markup against the same class names so the wrapping templates don't
// have to know which renderer produced the body.

import type { CanonicalDailyData } from "../canonical";
import type {
  MlbBoxPlayer,
  MlbBoxScore,
  MlbBoxTeam,
  MlbDivisionStandings,
  MlbDivision,
  MlbGame,
  MlbInningLine,
  MlbLeaderboard,
  MlbLeaderCategory,
  MlbLeague,
  MlbPlayerRef,
  MlbScoringPlay,
  MlbStandingRow,
  MlbTransaction,
  MlbWildCardStandings,
} from "../types";

import type { DigestMode } from "@/lib/digest-mode";
import { findTeam } from "@/lib/teams";
import { nextDay, prettyDate } from "@/lib/dates";
import { lastName } from "@/lib/names";
import { lastNameLinkEmail } from "@/lib/player-links";
import { EMAIL_LINK_BASE } from "@/lib/site";
import {
  esc, pad, fmtAvg, fmtOps, fmtEra, dateline, sectionH,
} from "@/lib/render-email";

// ─── Display tables (name-keyed) ─────────────────────────────────────────
// Mirrors the canonical web renderer's maps so this file stands on its
// own once the legacy lib/render-email.ts is deleted.

const DIVISION_ORDER: Record<MlbLeague, MlbDivision[]> = {
  AL: ["East", "Central", "West"],
  NL: ["East", "Central", "West"],
};

const CITY_OF: Record<string, string> = {
  "Arizona Diamondbacks": "Arizona", "Atlanta Braves": "Atlanta",
  "Baltimore Orioles": "Baltimore", "Boston Red Sox": "Boston",
  "Chicago Cubs": "Chi. Cubs", "Chicago White Sox": "Chi. White Sox",
  "Cincinnati Reds": "Cincinnati", "Cleveland Guardians": "Cleveland",
  "Colorado Rockies": "Colorado", "Detroit Tigers": "Detroit",
  "Houston Astros": "Houston", "Kansas City Royals": "Kansas City",
  "Los Angeles Angels": "Los Angeles", "Los Angeles Dodgers": "L.A. Dodgers",
  "Miami Marlins": "Miami", "Milwaukee Brewers": "Milwaukee",
  "Minnesota Twins": "Minnesota", "New York Mets": "N.Y. Mets",
  "New York Yankees": "New York", "Athletics": "Athletics",
  "Oakland Athletics": "Athletics", "Philadelphia Phillies": "Philadelphia",
  "Pittsburgh Pirates": "Pittsburgh", "San Diego Padres": "San Diego",
  "San Francisco Giants": "San Francisco", "Seattle Mariners": "Seattle",
  "St. Louis Cardinals": "St. Louis", "Tampa Bay Rays": "Tampa Bay",
  "Texas Rangers": "Texas", "Toronto Blue Jays": "Toronto",
  "Washington Nationals": "Washington",
};

const NICKNAME_OF: Record<string, string> = {
  "Arizona Diamondbacks": "Diamondbacks", "Atlanta Braves": "Braves",
  "Baltimore Orioles": "Orioles", "Boston Red Sox": "Red Sox",
  "Chicago Cubs": "Cubs", "Chicago White Sox": "White Sox",
  "Cincinnati Reds": "Reds", "Cleveland Guardians": "Guardians",
  "Colorado Rockies": "Rockies", "Detroit Tigers": "Tigers",
  "Houston Astros": "Astros", "Kansas City Royals": "Royals",
  "Los Angeles Angels": "Angels", "Los Angeles Dodgers": "Dodgers",
  "Miami Marlins": "Marlins", "Milwaukee Brewers": "Brewers",
  "Minnesota Twins": "Twins", "New York Mets": "Mets",
  "New York Yankees": "Yankees", "Athletics": "Athletics",
  "Oakland Athletics": "Athletics", "Philadelphia Phillies": "Phillies",
  "Pittsburgh Pirates": "Pirates", "San Diego Padres": "Padres",
  "San Francisco Giants": "Giants", "Seattle Mariners": "Mariners",
  "St. Louis Cardinals": "Cardinals", "Tampa Bay Rays": "Rays",
  "Texas Rangers": "Rangers", "Toronto Blue Jays": "Blue Jays",
  "Washington Nationals": "Nationals",
};

const TLA_OF: Record<string, string> = {
  "Arizona Diamondbacks": "ARI", "Atlanta Braves": "ATL",
  "Baltimore Orioles": "BAL", "Boston Red Sox": "BOS",
  "Chicago Cubs": "CHC", "Chicago White Sox": "CWS",
  "Cincinnati Reds": "CIN", "Cleveland Guardians": "CLE",
  "Colorado Rockies": "COL", "Detroit Tigers": "DET",
  "Houston Astros": "HOU", "Kansas City Royals": "KC",
  "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD",
  "Miami Marlins": "MIA", "Milwaukee Brewers": "MIL",
  "Minnesota Twins": "MIN", "New York Mets": "NYM",
  "New York Yankees": "NYY", "Athletics": "ATH",
  "Oakland Athletics": "ATH", "Philadelphia Phillies": "PHI",
  "Pittsburgh Pirates": "PIT", "San Diego Padres": "SD",
  "San Francisco Giants": "SF", "Seattle Mariners": "SEA",
  "St. Louis Cardinals": "STL", "Tampa Bay Rays": "TB",
  "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR",
  "Washington Nationals": "WSH",
};

const city     = (name: string): string => CITY_OF[name] ?? name;
const nickname = (name: string): string => NICKNAME_OF[name] ?? name;
const tla      = (name: string): string => TLA_OF[name] ?? name;

const padRhe = (n: number | null | undefined) => (n == null ? " —" : String(n).padStart(2));

const fmtDiff = (scored: number, allowed: number) => {
  const d = scored - allowed;
  return d > 0 ? `+${d}` : d < 0 ? String(d) : "0";
};

const fmtPct = (v: number): string => v.toFixed(3).replace(/^0/, "");

const fmtGb = (v: number): string => {
  if (v <= 0) return "-";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

const fmtWcgb = (v: number | null): string => {
  if (v == null) return "—";
  if (v === 0) return "-";
  if (v < 0) {
    const abs = -v;
    return Number.isInteger(abs) ? `+${abs}` : `+${abs.toFixed(1)}`;
  }
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

const fmtIp = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return "-";
  return v.toFixed(1);
};

// ─── Mode classifier ────────────────────────────────────────────────────

const POSTSEASON_TYPES = new Set(["wild-card", "division-series", "lcs", "world-series"]);
const PRESEASON_TYPES  = new Set(["spring", "exhibition"]);

function classifyMode(games: MlbGame[], date: string): DigestMode {
  const types = new Set(games.map((g) => g.gameType));
  if (games.length === 0) return "no-games";
  if (games.every((g) => g.gameType === "all-star")) return "all-star";
  if (games.some((g) => POSTSEASON_TYPES.has(g.gameType))) return "postseason";
  if (games.every((g) => PRESEASON_TYPES.has(g.gameType))) return "preseason";
  if (types.has("regular")) return "regular";
  return "regular";
}

// team.id → "W-L" for the Today's Games strip
function buildTeamRecordMap(standings: MlbDivisionStandings[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const div of standings) {
    for (const t of div.teams) {
      out.set(t.team.id, `${t.wins}-${t.losses}`);
    }
  }
  return out;
}

// ─── Section helpers ─────────────────────────────────────────────────────

const subH = (t: string) => `<h3 class="es-sub-h">${esc(t)}</h3>`;
const gameH = (t: string) => `<h3 class="es-game-h">${esc(t)}</h3>`;

// ─── Standings + wild card ──────────────────────────────────────────────

function standingsColgroup(): string {
  return `<colgroup>
    <col width="22%"><col width="5%"><col width="5%"><col width="8%">
    <col width="7%"><col width="9%"><col width="10%"><col width="10%">
    <col width="9%"><col width="9%">
  </colgroup>`;
}

function standingsTableHead(label: string = "GB"): string {
  const nowrap = `style="white-space:nowrap"`;
  return `<thead><tr>
    <th align="left"  ${nowrap}>Team</th>
    <th align="right" ${nowrap}>W</th>
    <th align="right" ${nowrap}>L</th>
    <th align="right" ${nowrap}>Pct</th>
    <th align="right" ${nowrap}>${label}</th>
    <th align="right" ${nowrap}>Diff</th>
    <th align="right" ${nowrap}>Home</th>
    <th align="right" ${nowrap}>Away</th>
    <th align="right" ${nowrap}>L10</th>
    <th align="right" ${nowrap}>Strk</th>
  </tr></thead>`;
}

function standingsRowCells(
  r: {
    nickname: string; wins: number; losses: number; pct: string;
    gb: string; diff: string; home: string; away: string; l10: string; strk: string;
    teamHref?: string;
  },
  rowClass = "",
): string {
  const cls = rowClass ? ` class="${rowClass}"` : "";
  const nameCell = r.teamHref
    ? `<a href="${r.teamHref}" class="es-team-link" style="color:inherit;text-decoration:none">${esc(r.nickname)}</a>`
    : esc(r.nickname);
  const nowrap = `style="white-space:nowrap"`;
  return `<tr${cls}>
    <td align="left"  ${nowrap}>${nameCell}</td>
    <td align="right" ${nowrap}>${r.wins}</td>
    <td align="right" ${nowrap}>${r.losses}</td>
    <td align="right" ${nowrap}>${esc(r.pct)}</td>
    <td align="right" ${nowrap}>${esc(r.gb)}</td>
    <td align="right" ${nowrap}>${esc(r.diff)}</td>
    <td align="right" ${nowrap}>${esc(r.home)}</td>
    <td align="right" ${nowrap}>${esc(r.away)}</td>
    <td align="right" ${nowrap}>${esc(r.l10)}</td>
    <td align="right" ${nowrap}>${esc(r.strk)}</td>
  </tr>`;
}

function renderDivisionTable(
  label: string,
  d: MlbDivisionStandings,
  editionDate: string,
): string {
  const sorted = [...d.teams].sort((a, b) => a.divisionRank - b.divisionRank);
  const rows = sorted.map((t) => {
    const team = findTeam("mlb", t.team.id);
    const teamHref = team
      ? `${EMAIL_LINK_BASE}/mlb/${team.slug}/${editionDate}`
      : undefined;
    return standingsRowCells({
      nickname: nickname(t.team.name),
      wins: t.wins, losses: t.losses,
      pct: fmtPct(t.leagueRecord.pct),
      gb: fmtGb(t.gamesBehind),
      diff: fmtDiff(t.runsScored, t.runsAllowed),
      home: `${t.homeRecord.wins}-${t.homeRecord.losses}`,
      away: `${t.awayRecord.wins}-${t.awayRecord.losses}`,
      l10: `${t.lastTenRecord.wins}-${t.lastTenRecord.losses}`,
      strk: t.streak ?? "—",
      teamHref,
    });
  }).join("");
  return `${subH(label + " Division")}
    <table class="es-table es-fixed" cellpadding="0" cellspacing="0" border="0">
      ${standingsColgroup()}
      ${standingsTableHead()}
      <tbody>${rows}</tbody>
    </table>`;
}

function renderWildCardTable(wc: MlbWildCardStandings): string {
  // Wild card omitted from email body per the legacy renderer's choice —
  // the email stays tighter without it; the full wild card race is on
  // the web. Kept as a function for parity with the web renderer in
  // case we revisit.
  void wc;
  return "";
}

function renderLeague(label: string, league: MlbLeague, data: CanonicalDailyData, editionDate: string): string {
  const order = DIVISION_ORDER[league];
  const standingsHtml = order.map((divName) => {
    const div = data.standings.find((d) => d.league === league && d.division === divName);
    return div ? renderDivisionTable(divName, div, editionDate) : "";
  }).join("");
  return `${sectionH(label + " Standings")}${standingsHtml}`;
}

// ─── Leaders ────────────────────────────────────────────────────────────

const LEADER_LABELS: Record<MlbLeaderCategory, { label: string; valueLabel: string }> = {
  battingAverage:     { label: "Batting Average", valueLabel: "AVG"  },
  homeRuns:           { label: "Home Runs",       valueLabel: "HR"   },
  runsBattedIn:       { label: "Runs Batted In",  valueLabel: "RBI"  },
  stolenBases:        { label: "Stolen Bases",    valueLabel: "SB"   },
  ops:                { label: "OPS",             valueLabel: "OPS"  },
  onBasePercentage:   { label: "On-Base %",       valueLabel: "OBP"  },
  sluggingPercentage: { label: "Slugging %",      valueLabel: "SLG"  },
  hits:               { label: "Hits",            valueLabel: "H"    },
  wins:               { label: "Wins",            valueLabel: "W"    },
  earnedRunAverage:   { label: "ERA",             valueLabel: "ERA"  },
  strikeoutsPitching: { label: "Strikeouts",      valueLabel: "K"    },
  saves:              { label: "Saves",           valueLabel: "SV"   },
  whip:               { label: "WHIP",            valueLabel: "WHIP" },
  inningsPitched:     { label: "Innings Pitched", valueLabel: "IP"   },
};

const LEADER_ORDER: MlbLeaderCategory[] = [
  "battingAverage", "homeRuns", "runsBattedIn", "stolenBases",
  "wins", "earnedRunAverage", "strikeoutsPitching", "saves",
];

function formatLeaderValue(category: MlbLeaderCategory, v: number): string {
  switch (category) {
    case "battingAverage":
    case "ops":
    case "onBasePercentage":
    case "sluggingPercentage":
    case "whip":
      return v.toFixed(3).replace(/^0/, "");
    case "earnedRunAverage":
      return v.toFixed(2);
    default:
      return String(Math.round(v));
  }
}

function leadersThroughTies<T extends { rank: number }>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) return rows;
  const lastRank = rows[limit - 1]?.rank;
  if (lastRank == null) return rows.slice(0, limit);
  let i = limit;
  while (i < rows.length && rows[i]?.rank === lastRank) i++;
  return rows.slice(0, i);
}

function renderLeaderCategory(board: MlbLeaderboard, limit = 5): string {
  const rows = leadersThroughTies(board.entries, limit).map((L) => {
    const teamAbbr = L.team ? esc(tla(L.team.name)) : "—";
    return `<tr>
      <td align="left">${L.rank}. ${lastNameLinkEmail(L.player)}, ${teamAbbr}</td>
      <td align="right">${esc(formatLeaderValue(board.category, L.value))}</td>
    </tr>`;
  }).join("");
  const meta = LEADER_LABELS[board.category];
  return `${subH(meta?.label ?? board.category)}
    <table class="es-table" cellpadding="0" cellspacing="0" border="0">
      <tbody>${rows}</tbody>
    </table>`;
}

function renderSingleLeagueLeaders(leagueLabel: string, boards: MlbLeaderboard[], limit = 5): string {
  // Order categories per LEADER_ORDER, filtering out any not present
  const ordered: MlbLeaderboard[] = [];
  for (const cat of LEADER_ORDER) {
    const b = boards.find((x) => x.category === cat);
    if (b) ordered.push(b);
  }
  const half = Math.ceil(ordered.length / 2);
  const left = ordered.slice(0, half);
  const right = ordered.slice(half);
  return `${sectionH(`${leagueLabel} Leaders`)}
    <table class="es-leaders-cols" cellpadding="0" cellspacing="0" border="0">
      <tbody><tr>
        <td width="50%">${left.map((g) => renderLeaderCategory(g, limit)).join("")}</td>
        <td width="50%">${right.map((g) => renderLeaderCategory(g, limit)).join("")}</td>
      </tr></tbody>
    </table>`;
}

// ─── Box scores ─────────────────────────────────────────────────────────

const MAX_INNINGS_INLINE = 19;
const EXTRAS_THRESHOLD = 20;

function inningCellWidth(innings: MlbInningLine[]): number {
  let w = 1;
  for (const inn of innings.slice(0, 9)) {
    w = Math.max(w, String(inn.awayRuns ?? 0).length, String(inn.homeRuns ?? 0).length);
  }
  return w;
}

function inningGroups(innings: MlbInningLine[], side: "away" | "home", width: number): string {
  const digits = innings.slice(0, MAX_INNINGS_INLINE).map((inn) => {
    const v = side === "away" ? inn.awayRuns : inn.homeRuns;
    const s = v == null ? "x" : String(v);
    return s.padStart(width);
  });
  const padTo = Math.max(9, Math.ceil(digits.length / 3) * 3);
  while (digits.length < padTo) digits.push(" ".repeat(width));
  const sep = width === 1 ? "" : " ";
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 3) {
    groups.push(digits.slice(i, i + 3).join(sep));
  }
  return groups.join(" ");
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

function renderInningLine(team: string, line: string): string {
  return `<tr>
    <td align="left" style="font-size:13px;font-weight:700;padding:1px 0;white-space:nowrap;">${esc(team)}</td>
    <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:13px;white-space:pre;padding:1px 0;">${esc(line)}</td>
  </tr>`;
}

function renderBatting(team: MlbBoxTeam, cityName: string): string {
  const ordered = team.batters;
  const rows = ordered.map((p) => {
    const b = p.batting;
    if (!b) return "";
    if (b.atBats == null && b.baseOnBalls == null && b.strikeOuts == null && b.hits == null) return "";
    const pos = (p.allPositionsAbbr && p.allPositionsAbbr.length > 0
      ? p.allPositionsAbbr.join("-")
      : p.positionAbbr).toLowerCase();
    const avg = fmtAvg(formatRate3(p.seasonBatting?.battingAverage ?? null));
    const ops = fmtOps(formatRate3(p.seasonBatting?.ops ?? null));
    const indent = p.isStarter ? "" : ' style="padding-left:10px;"';
    return `<tr>
      <td align="left"${indent}>${lastNameLinkEmail(p.player)} <span class="es-mut">${esc(pos)}</span></td>
      <td align="right">${pad(b.atBats)}</td>
      <td align="right">${pad(b.runs)}</td>
      <td align="right">${pad(b.hits)}</td>
      <td align="right">${pad(b.rbi)}</td>
      <td align="right">${pad(b.baseOnBalls)}</td>
      <td align="right">${pad(b.strikeOuts)}</td>
      <td align="right">${avg}</td>
      <td align="right">${ops}</td>
    </tr>`;
  }).join("");
  const ts = team.totals;
  const totals = `<tr class="es-totals">
    <td align="left">Totals</td>
    <td align="right">${pad(ts.atBats)}</td>
    <td align="right">${pad(ts.runs)}</td>
    <td align="right">${pad(ts.hits)}</td>
    <td align="right">${pad(ts.rbi)}</td>
    <td align="right">${pad(ts.baseOnBalls)}</td>
    <td align="right">${pad(ts.strikeOuts)}</td>
    <td></td>
    <td></td>
  </tr>`;
  const extras = hittingExtras(ordered, team.pitchers);
  return `<div class="es-team-label">${esc(cityName)} Batting</div>
    <table class="es-table es-fixed" cellpadding="0" cellspacing="0" border="0">
      <colgroup>
        <col width="30%"><col width="8%"><col width="8%"><col width="8%">
        <col width="8%"><col width="8%"><col width="8%"><col width="10%"><col width="12%">
      </colgroup>
      <thead><tr>
        <th align="left">Batter</th>
        <th align="right">AB</th>
        <th align="right">R</th>
        <th align="right">H</th>
        <th align="right">RBI</th>
        <th align="right">BB</th>
        <th align="right">SO</th>
        <th align="right">Avg</th>
        <th align="right">OPS</th>
      </tr></thead>
      <tbody>${rows}${totals}</tbody>
    </table>
    ${extras ? `<p class="es-info" style="border-bottom:1px dotted #e8e2d4;padding-bottom:4px;">${extras}</p>` : ""}`;
}

function formatRate3(v: number | null): string | undefined {
  if (v == null) return undefined;
  return v.toFixed(3);
}

function hittingExtras(batters: MlbBoxPlayer[], pitchers: MlbBoxPlayer[]): string {
  type Bucket = { last: string; season: number };
  const cat = { "2B": [] as Bucket[], "3B": [] as Bucket[], HR: [] as Bucket[], SB: [] as Bucket[], RBI: [] as Bucket[], E: [] as Bucket[] };
  const push = (bucket: Bucket[], name: string, gameCount: number, seasonTotal: number) => {
    for (let k = 0; k < gameCount; k++) {
      bucket.push({ last: name, season: seasonTotal - gameCount + k + 1 });
    }
  };
  for (const p of batters) {
    const b = p.batting;
    if (!b) continue;
    const s = p.seasonBatting;
    const name = lastName(p.player.fullName);
    push(cat["2B"], name, b.doubles,     s?.doubles     ?? 0);
    push(cat["3B"], name, b.triples,     s?.triples     ?? 0);
    push(cat.HR,   name, b.homeRuns,     s?.homeRuns    ?? 0);
    push(cat.SB,   name, b.stolenBases,  s?.stolenBases ?? 0);
    push(cat.RBI,  name, b.rbi,          s?.rbi         ?? 0);
  }
  // Errors come from anyone who took the field. Union batters + pitchers
  // and dedupe by player id so two-way players (Ohtani) aren't counted
  // twice, but AL pitchers who didn't bat still surface here.
  const seen = new Set<string>();
  for (const p of [...batters, ...pitchers]) {
    if (p.errors === 0) continue;
    const key = p.player.id;
    if (seen.has(key)) continue;
    seen.add(key);
    push(cat.E, lastName(p.player.fullName), p.errors, p.seasonErrors);
  }
  const parts: string[] = [];
  for (const [label, list] of Object.entries(cat)) {
    if (list.length === 0) continue;
    const names = list.map((p) => `${esc(p.last)} (${p.season})`).join(", ");
    parts.push(`<b>${label}:</b> ${names}.`);
  }
  return parts.join(" ");
}

function renderPitching(team: MlbBoxTeam, cityName: string): string {
  const ordered = team.pitchers;
  const rows = ordered.map((p) => {
    const pi = p.pitching;
    if (!pi) return "";
    const era = fmtEra(formatRate2(p.seasonPitching?.era ?? null));
    const note = pi.decisionNote
      ? ` <span style="color:#6a6354;font-weight:400;">${esc(pi.decisionNote)}</span>`
      : "";
    return `<tr>
      <td align="left">${lastNameLinkEmail(p.player)}${note}</td>
      <td align="right">${esc(fmtIp(pi.inningsPitched))}</td>
      <td align="right">${pad(pi.hits)}</td>
      <td align="right">${pad(pi.runs)}</td>
      <td align="right">${pad(pi.earnedRuns)}</td>
      <td align="right">${pad(pi.baseOnBalls)}</td>
      <td align="right">${pad(pi.strikeOuts)}</td>
      <td align="right">${pad(pi.homeRuns)}</td>
      <td align="right">${pad(pi.battersFaced)}</td>
      <td align="right">${era}</td>
    </tr>`;
  }).join("");
  const extras = pitchingExtras(ordered);
  return `<div class="es-team-label">${esc(cityName)} Pitching</div>
    <table class="es-table es-fixed" cellpadding="0" cellspacing="0" border="0">
      <colgroup>
        <col width="30%"><col width="7%"><col width="7%"><col width="6%">
        <col width="7%"><col width="7%"><col width="7%"><col width="7%">
        <col width="8%"><col width="14%">
      </colgroup>
      <thead><tr>
        <th align="left">Pitcher</th>
        <th align="right">IP</th>
        <th align="right">H</th>
        <th align="right">R</th>
        <th align="right">ER</th>
        <th align="right">BB</th>
        <th align="right">K</th>
        <th align="right">HR</th>
        <th align="right">BF</th>
        <th align="right">ERA</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${extras ? `<p class="es-info" style="border-bottom:1px dotted #e8e2d4;padding-bottom:4px;">${extras}</p>` : ""}`;
}

function formatRate2(v: number | null): string | undefined {
  if (v == null) return undefined;
  return v.toFixed(2);
}

function pitchingExtras(players: MlbBoxPlayer[]): string {
  type Row = { last: string; p: number; s: number };
  const rows: Row[] = [];
  for (const p of players) {
    const pi = p.pitching;
    if (!pi) continue;
    const pitches = pi.pitchesThrown ?? 0;
    if (pitches === 0) continue;
    rows.push({ last: lastName(p.player.fullName), p: pitches, s: pi.strikes ?? 0 });
  }
  if (rows.length === 0) return "";
  const pcst = rows.map((r) => `${esc(r.last)} (${r.s}-${r.p})`).join(", ");
  return `<b>ST-PC:</b> ${pcst}.`;
}

function renderScoringNotes(plays: MlbScoringPlay[]): string {
  if (plays.length === 0) return "";
  const items = plays.map((p) => {
    const arrow = p.half === "top" ? "▲" : "▼";
    const inn = `${arrow}${p.inning}`;
    const score = `${p.awayScore}-${p.homeScore}`;
    return `<p><span class="inn">${inn} ${score}</span> <span class="ev">${esc(p.description)}</span></p>`;
  }).join("");
  return `<div class="es-scoring-block es-scoring">
    <div class="es-scoring-h">Scoring Plays</div>
    ${items}
  </div>`;
}

function renderGameInfo(info: { label: string; value: string }[]): string {
  const order = ["Umpires", "Weather", "T", "Att"];
  const map = new Map(info.map((i) => [i.label, i.value ?? ""]));
  const parts = order
    .filter((label) => map.has(label))
    .map((label) => `<b>${esc(label)}:</b> ${esc(map.get(label) ?? "")}`);
  if (parts.length === 0) return "";
  return `<p class="es-info">${parts.join(" &nbsp; ")}</p>`;
}

function renderGame(game: MlbGame, box: MlbBoxScore, scoring: MlbScoringPlay[]): string {
  const aScore = game.awayScore ?? 0;
  const hScore = game.homeScore ?? 0;
  const winnerFirst = hScore >= aScore
    ? `${nickname(game.homeTeam.name)} ${hScore}, ${nickname(game.awayTeam.name)} ${aScore}`
    : `${nickname(game.awayTeam.name)} ${aScore}, ${nickname(game.homeTeam.name)} ${hScore}`;
  const innings = game.innings;
  const w = inningCellWidth(innings);
  const aLine = `${inningGroups(innings, "away", w)}  —  ${padRhe(game.awayScore)} ${padRhe(game.awayHits)} ${padRhe(game.awayErrors)}`;
  const hLine = `${inningGroups(innings, "home", w)}  —  ${padRhe(game.homeScore)} ${padRhe(game.homeHits)} ${padRhe(game.homeErrors)}`;
  const d = game.decisions;
  const decisionLine = [
    d?.winner && `<b>W:</b> ${lastNameLinkEmail(d.winner)}`,
    d?.loser  && `<b>L:</b> ${lastNameLinkEmail(d.loser)}`,
    d?.save   && `<b>Sv:</b> ${lastNameLinkEmail(d.save)}`,
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");
  return `<div class="es-game">
    ${gameH(winnerFirst)}
    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      <tbody>
        ${renderInningLine(tla(game.awayTeam.name), aLine)}
        ${renderInningLine(tla(game.homeTeam.name), hLine)}
      </tbody>
    </table>
    ${innings.length >= EXTRAS_THRESHOLD ? `<p class="es-info"><b>Extras:</b> Game ended in the ${ordinal(innings.length)} — see Scoring for details.</p>` : ""}
    ${decisionLine ? `<p class="es-note">${decisionLine}</p>` : ""}
    ${renderBatting(box.away, city(game.awayTeam.name))}
    ${renderBatting(box.home, city(game.homeTeam.name))}
    ${renderPitching(box.away, city(game.awayTeam.name))}
    ${renderPitching(box.home, city(game.homeTeam.name))}
    ${renderScoringNotes(scoring)}
    ${renderGameInfo(box.info)}
  </div>`;
}

function renderBoxScores(data: CanonicalDailyData): string {
  const completed = data.games.filter((g) => g.status === "final" && data.boxScores.has(g.id));
  if (completed.length === 0) return "";
  return `${sectionH("Yesterday's Box Scores")}
    ${completed.map((g) => renderGame(g, data.boxScores.get(g.id)!, data.scoringPlays.get(g.id) ?? [])).join("")}`;
}

function renderAllStarGame(data: CanonicalDailyData): string {
  const asg = data.games.find((g) => g.gameType === "all-star");
  if (!asg) return "";
  const box = data.boxScores.get(asg.id);
  if (!box) return "";
  return `${sectionH("All-Star Game")}
<p class="es-asg-note">Stats don't count toward season totals.</p>
${renderGame(asg, box, data.scoringPlays.get(asg.id) ?? [])}`;
}

// ─── Today's Games ──────────────────────────────────────────────────────

function timeInET(iso: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York",
    });
    return fmt.format(new Date(iso)) + " ET";
  } catch {
    return iso;
  }
}

function renderTodaysGames(
  games: MlbGame[],
  teamRecords: Map<string, string>,
): string {
  if (games.length === 0) return "";
  const probable = (p: MlbGame["awayProbablePitcher"]) => {
    if (!p) return "TBD";
    const parts: string[] = [esc(lastName(p.fullName))];
    const detail: string[] = [];
    if (p.wins != null && p.losses != null) detail.push(`${p.wins}-${p.losses}`);
    if (p.era != null) detail.push(p.era.toFixed(2));
    if (detail.length > 0) parts.push(`(${detail.join(", ")})`);
    return parts.join(" ");
  };
  const teamWithRecord = (name: string, teamId: string) => {
    const tlaName = esc(tla(name));
    const record = teamRecords.get(teamId);
    if (!record) return tlaName;
    return `${tlaName} <span style="font-weight:400;">(${esc(record)})</span>`;
  };
  const rows = games.map((g) => {
    const isOff = g.status === "postponed" || g.status === "cancelled" || g.status === "suspended";
    const right = isOff ? (g.statusDetail || g.status) : timeInET(g.startTime);
    const matchup = `${teamWithRecord(g.awayTeam.name, g.awayTeam.id)} @ ${teamWithRecord(g.homeTeam.name, g.homeTeam.id)}`;
    const pitchers = `${probable(g.awayProbablePitcher)} vs ${probable(g.homeProbablePitcher)}`;
    return `<tr>
      <td align="left" style="font-size:13px;font-weight:700;padding:3px 0 0;">${matchup}</td>
      <td align="right" style="font-size:13px;color:#6a6354;padding:3px 0 0;white-space:nowrap;">${esc(right)}</td>
    </tr>
    <tr>
      <td colspan="2" style="font-size:12px;color:#6a6354;padding:0 0 4px;border-bottom:1px dotted #e8e2d4;">${pitchers}</td>
    </tr>`;
  }).join("");
  return `${sectionH("Today's Games")}
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:14px;">
      <tbody>${rows}</tbody>
    </table>`;
}

// ─── Transactions ───────────────────────────────────────────────────────

function renderTransactions(txs: MlbTransaction[]): string {
  if (txs.length === 0) return "";
  const items = txs.map((t) => `<p class="es-tx">
    <span class="es-tx-type">${esc(t.typeLabel)}</span> ${esc(t.description)}
  </p>`).join("");
  return `${sectionH("Transactions")}<div class="es-tx-block">${items}</div>`;
}

// ─── Entry ──────────────────────────────────────────────────────────────

export function renderCanonicalEmail(data: CanonicalDailyData): string {
  const editionDate = nextDay(data.date);
  const teamRecords = buildTeamRecordMap(data.standings);
  const mode = classifyMode(data.games, data.date);

  if (mode === "no-games") {
    return `<div class="es">
${dateline(prettyDate(editionDate))}
<p class="es-no-games">No games yesterday.</p>
${renderTodaysGames(data.nextDayGames, teamRecords)}
${renderTransactions(data.transactions)}
</div>`;
  }

  if (mode === "all-star") {
    return `<div class="es">
${dateline(prettyDate(editionDate))}
<div class="es-edition">All-Star Game Edition</div>
${renderLeague("American League", "AL", data, editionDate)}
${renderSingleLeagueLeaders("American League", data.leaderboards.filter((b) => b.league === "AL"), 15)}
${renderLeague("National League", "NL", data, editionDate)}
${renderSingleLeagueLeaders("National League", data.leaderboards.filter((b) => b.league === "NL"), 15)}
${renderTodaysGames(data.nextDayGames, teamRecords)}
${renderAllStarGame(data)}
${renderTransactions(data.transactions)}
</div>`;
  }

  return `<div class="es">
${dateline(prettyDate(editionDate))}
${renderLeague("American League", "AL", data, editionDate)}
${renderSingleLeagueLeaders("American League", data.leaderboards.filter((b) => b.league === "AL"))}
${renderLeague("National League", "NL", data, editionDate)}
${renderSingleLeagueLeaders("National League", data.leaderboards.filter((b) => b.league === "NL"))}
${renderTodaysGames(data.nextDayGames, teamRecords)}
${renderBoxScores(data)}
${renderTransactions(data.transactions)}
</div>`;
}
