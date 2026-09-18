// Postseason bracket — a symmetric two-sided bracket (AL flows right, NL flows
// left, the World Series sits in the center), the way a newspaper sports page
// would print it: grayscale, hairline rules, no color, no logos. It replaces
// standings + leaders on postseason digests.
//
// Modern MLB format (per league): seeds 1-2 get a bye to the Division Series;
// seeds 3-6 play the Wild Card round (3v6, 4v5). WC winners meet the byes in the
// DS (1 vs 4/5 winner, 2 vs 3/6 winner), DS winners meet in the Championship
// Series, and the two pennant winners meet in the World Series. Seeds come from
// the adapter (derived from final regular-season standings).

import type {
  PostseasonBracket,
  PostseasonSeries,
  PostseasonEntrant,
} from "../canonical";
import type { MlbLeague } from "../types";
import { sectionH } from "@/lib/render-email";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── shaping the flat series list into bracket positions ───────────────────

type Side = {
  wc: PostseasonSeries[];   // ordered top→bottom: [3v6, 4v5]
  ds: PostseasonSeries[];   // ordered top→bottom: [seed-2 side, seed-1 side]
  cs: PostseasonSeries | undefined;
};

function seedOf(e: PostseasonEntrant): number {
  return e.seed ?? 99;
}
function minSeed(s: PostseasonSeries): number {
  return Math.min(seedOf(s.top), seedOf(s.bottom));
}
// The bye in a DS is the entrant seeded 1 or 2 (the other came through the WC).
function byeSeed(s: PostseasonSeries): number {
  const a = seedOf(s.top), b = seedOf(s.bottom);
  return Math.min(a, b);
}

function sideFor(bracket: PostseasonBracket, league: MlbLeague): Side {
  const of = (round: PostseasonSeries["round"]) =>
    bracket.series.filter((s) => s.league === league && s.round === round);
  // WC: 3v6 (min seed 3) above 4v5 (min seed 4).
  const wc = of("wild-card").sort((a, b) => minSeed(a) - minSeed(b));
  // DS: seed-2's series above seed-1's series (matches the WC ordering above,
  // since seed 2 hosts the 3/6 winner and seed 1 hosts the 4/5 winner).
  const ds = of("division-series").sort((a, b) => byeSeed(b) - byeSeed(a));
  return { wc, ds, cs: of("lcs")[0] };
}

// ─── one team line ─────────────────────────────────────────────────────────

// A single team row inside a matchup box: seed, name/abbr, series wins. The
// series winner is bold (grayscale-safe emphasis); the loser is muted.
function teamRow(
  s: PostseasonSeries | undefined,
  e: PostseasonEntrant | undefined,
  align: "l" | "r",
): string {
  if (!s || !e) {
    return `<div class="psb-team psb-tbd psb-${align}"><span class="psb-nm">TBD</span></div>`;
  }
  const won = s.winnerTeamId === e.teamId;
  const seed = e.seed != null ? `<span class="psb-seed">${e.seed}</span>` : "";
  const nm = `<span class="psb-nm">${esc(e.abbr)}</span>`;
  const w = `<span class="psb-w">${e.wins}</span>`;
  const cls = `psb-team psb-${align}${won ? " psb-won" : " psb-lost"}`;
  // Seed + name on the outer edge, wins on the inner edge (toward the center),
  // so the numbers line up along the connector side.
  return align === "l"
    ? `<div class="${cls}">${seed}${nm}${w}</div>`
    : `<div class="${cls}">${w}${nm}${seed}</div>`;
}

function matchBox(s: PostseasonSeries | undefined, align: "l" | "r"): string {
  const top = s?.top, bottom = s?.bottom;
  return `<div class="psb-match">
    ${teamRow(s, top, align)}
    ${teamRow(s, bottom, align)}
  </div>`;
}

// A round column: a label + its matchup boxes, spaced to spread vertically.
// `key` (wc/ds/cs) drives the connector CSS between columns.
function roundCol(label: string, boxes: string[], side: "l" | "r", key: string): string {
  return `<div class="psb-round psb-round-${side} psb-round-${key}">
    <div class="psb-round-label">${esc(label)}</div>
    <div class="psb-round-body">${boxes.join("\n")}</div>
  </div>`;
}

// ─── the World Series center block ─────────────────────────────────────────

function centerBlock(bracket: PostseasonBracket): string {
  const ws = bracket.series.find((s) => s.round === "world-series");
  const champLine = (e: PostseasonEntrant | undefined) => {
    if (!ws || !e) return `<div class="psb-ws-team psb-tbd">TBD</div>`;
    const won = ws.winnerTeamId === e.teamId;
    return `<div class="psb-ws-team${won ? " psb-won" : " psb-lost"}">
      <span class="psb-nm">${esc(e.name)}</span> <span class="psb-w">${e.wins}</span>
    </div>`;
  };
  return `<div class="psb-center">
    <div class="psb-ws-title">World Series</div>
    <div class="psb-ws-box">
      ${champLine(ws?.top)}
      ${champLine(ws?.bottom)}
    </div>
  </div>`;
}

// ─── assemble both sides ───────────────────────────────────────────────────

function sideCols(bracket: PostseasonBracket, league: MlbLeague, side: "l" | "r"): string[] {
  const s = sideFor(bracket, league);
  const wcLabel = `${league} Wild Card`;
  const dsLabel = league === "AL" ? "ALDS" : "NLDS";
  const csLabel = league === "AL" ? "ALCS" : "NLCS";
  const wcCol = roundCol(wcLabel, s.wc.map((m) => matchBox(m, side)), side, "wc");
  const dsCol = roundCol(dsLabel, s.ds.map((m) => matchBox(m, side)), side, "ds");
  const csCol = roundCol(csLabel, [matchBox(s.cs, side)], side, "cs");
  // Left side reads WC→DS→CS toward the center; right side mirrors CS→DS→WC.
  return side === "l" ? [wcCol, dsCol, csCol] : [csCol, dsCol, wcCol];
}

// Wide (desktop) layout: AL flows right, NL flows left, World Series centered.
function wideHtml(bracket: PostseasonBracket): string {
  const left = sideCols(bracket, "AL", "l");
  const right = sideCols(bracket, "NL", "r");
  return `<div class="psb psb-wide">
  <div class="psb-side psb-side-l">${left.join("\n")}</div>
  ${centerBlock(bracket)}
  <div class="psb-side psb-side-r">${right.join("\n")}</div>
</div>`;
}

// One league as a left-flowing bracket (WC→DS→CS), for the stacked layout.
function oneSide(bracket: PostseasonBracket, league: MlbLeague, title: string): string {
  const cols = sideCols(bracket, league, "l");
  return `<div class="psb-half">
    <div class="psb-half-title">${esc(title)}</div>
    <div class="psb psb-oneside"><div class="psb-side psb-side-l">${cols.join("\n")}</div></div>
  </div>`;
}

// Stacked (narrow/phone) layout: AL bracket, then NL bracket, then the World
// Series — each half fits a phone without horizontal scroll.
function stackHtml(bracket: PostseasonBracket): string {
  return `<div class="psb-stack">
  ${oneSide(bracket, "AL", "American League")}
  ${oneSide(bracket, "NL", "National League")}
  ${centerBlock(bracket)}
</div>`;
}

// Both layouts ship; CSS shows one per viewport width (see .psb-wide/.psb-stack).
function bracketHtml(bracket: PostseasonBracket): string {
  return `${wideHtml(bracket)}\n${stackHtml(bracket)}`;
}

// ─── surface wrappers ──────────────────────────────────────────────────────

export function renderPostseasonBracketWeb(bracket: PostseasonBracket): string {
  return `<div class="section">
  <div class="ps-bracket-title">Postseason</div>
  ${bracketHtml(bracket)}
</div>`;
}

// ─── Email bracket (table + inline styles) ─────────────────────────────────
//
// Email clients strip flexbox and CSS pseudo-elements, and Gmail strips the
// <style> block entirely, so the email bracket is a plain <table> with all
// styling inline and connector lines drawn as collapsed cell borders — which
// align by construction, no pixel math. Always the stacked one-league form
// (AL, then NL, then the World Series); the wide symmetric layout can't survive
// a phone-width inbox.
//
// Row grid per league (6 body rows). Wild Card and Division series sit at the
// same height (1-to-1); the Championship box is centered in rows 3-4, and a
// ]-shaped border in the connector column merges the two Division series into
// it:
//   r1  WC 3v6 top   | ── | DS bye/win top | ── |
//   r2  WC 3v6 bot   |    | DS bye/win bot |  | |
//   r3                                     |  | | CS top
//   r4                                     |  | | CS bot
//   r5  WC 4v5 top   | ── | DS bye/win top | ─| |
//   r6  WC 4v5 bot   |    | DS bye/win bot |    |

const EM_LINE = "#333333";
const EM_WON = "#000000";
const EM_LOST = "#999999";

function emTeam(s: PostseasonSeries | undefined, e: PostseasonEntrant | undefined): string {
  if (!s || !e) return `<i style="color:${EM_LOST}">TBD</i>`;
  const won = s.winnerTeamId === e.teamId;
  const color = won ? EM_WON : EM_LOST;
  const weight = won ? 700 : 400;
  const seed = e.seed != null ? `<span style="color:${EM_LOST};font-weight:700">${e.seed}</span> ` : "";
  return `${seed}<span style="color:${color};font-weight:${weight}">${esc(e.abbr)}</span>` +
    ` <span style="color:${color};font-weight:${weight}">${e.wins}</span>`;
}

function emBox(content: string): string {
  return `<td width="74" style="border:1px solid ${EM_LINE};padding:4px 7px;` +
    `font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.2;` +
    `white-space:nowrap;background:#ffffff">${content}</td>`;
}
function emEmpty(w: number): string {
  return `<td width="${w}"></td>`;
}
function emConn(bottom: boolean, right: boolean): string {
  const b: string[] = [];
  if (bottom) b.push(`border-bottom:1px solid ${EM_LINE}`);
  if (right) b.push(`border-right:1px solid ${EM_LINE}`);
  return `<td width="16" style="${b.join(";")}"></td>`;
}
function emRow(cells: string[]): string {
  return `<tr>${cells.join("")}</tr>`;
}

function emSideTable(bracket: PostseasonBracket, league: MlbLeague): string {
  const s = sideFor(bracket, league);
  const wcT = s.wc[0], wcB = s.wc[1], dsT = s.ds[0], dsB = s.ds[1], cs = s.cs;
  const dsLabel = league === "AL" ? "ALDS" : "NLDS";
  const csLabel = league === "AL" ? "ALCS" : "NLCS";
  const lbl = (t: string) =>
    `<td style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;` +
    `letter-spacing:.04em;text-transform:uppercase;color:${EM_LINE};text-align:center;` +
    `padding:0 0 3px">${esc(t)}</td>`;

  // "Wild Card" without the league prefix — the league is already the block
  // header, and "AL WILD CARD" wraps in the narrow email column.
  const header = emRow([lbl("Wild Card"), `<td></td>`, lbl(dsLabel), `<td></td>`, lbl(csLabel)]);
  const rows = [
    emRow([emBox(emTeam(wcT, wcT?.top)),    emConn(true, false),  emBox(emTeam(dsT, dsT?.top)),    emConn(true, false),  emEmpty(74)]),
    emRow([emBox(emTeam(wcT, wcT?.bottom)), emConn(false, false), emBox(emTeam(dsT, dsT?.bottom)), emConn(false, true),  emEmpty(74)]),
    emRow([emEmpty(74),                     emConn(false, false), emEmpty(74),                     emConn(false, true),  emBox(emTeam(cs, cs?.top))]),
    emRow([emEmpty(74),                     emConn(false, false), emEmpty(74),                     emConn(false, true),  emBox(emTeam(cs, cs?.bottom))]),
    emRow([emBox(emTeam(wcB, wcB?.top)),    emConn(true, false),  emBox(emTeam(dsB, dsB?.top)),    emConn(true, true),   emEmpty(74)]),
    emRow([emBox(emTeam(wcB, wcB?.bottom)), emConn(false, false), emBox(emTeam(dsB, dsB?.bottom)), emConn(false, false), emEmpty(74)]),
  ];
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
    `style="border-collapse:collapse;margin:0 0 6px">${header}${rows.join("")}</table>`;
}

function emLeagueBlock(bracket: PostseasonBracket, league: MlbLeague, title: string): string {
  return `<div style="margin:6px 0 14px">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;` +
    `letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid ${EM_LINE};` +
    `padding-bottom:3px;margin-bottom:8px">${esc(title)}</div>
    ${emSideTable(bracket, league)}
  </div>`;
}

function emWorldSeries(bracket: PostseasonBracket): string {
  const ws = bracket.series.find((s) => s.round === "world-series");
  const line = (e: PostseasonEntrant | undefined, top: boolean) => {
    const border = top ? "" : `border-top:1px solid ${EM_LINE};`;
    if (!ws || !e) {
      return `<tr><td style="${border}padding:5px 8px;font-family:Arial,Helvetica,sans-serif;` +
        `font-size:13px;color:${EM_LOST}"><i>TBD</i></td><td style="${border}"></td></tr>`;
    }
    const won = ws.winnerTeamId === e.teamId;
    const color = won ? EM_WON : EM_LOST;
    const weight = won ? 700 : 400;
    const star = won ? " ★" : "";
    return `<tr>` +
      `<td style="${border}padding:5px 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;` +
      `color:${color};font-weight:${weight}">${esc(e.name)}${star}</td>` +
      `<td align="right" style="${border}padding:5px 8px;font-family:Arial,Helvetica,sans-serif;` +
      `font-size:13px;color:${color};font-weight:${weight}">${e.wins}</td></tr>`;
  };
  return `<div style="margin:6px 0 0">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;` +
    `letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">World Series</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
    `style="border-collapse:collapse;border:2px solid ${EM_WON};width:280px;background:#ffffff">` +
    `${line(ws?.top, true)}${line(ws?.bottom, false)}</table>
  </div>`;
}

export function renderPostseasonBracketEmail(bracket: PostseasonBracket): string {
  return `<div class="es-section">
  ${sectionH("Postseason")}
  ${emLeagueBlock(bracket, "AL", "American League")}
  ${emLeagueBlock(bracket, "NL", "National League")}
  ${emWorldSeries(bracket)}
</div>`;
}
