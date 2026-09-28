// Renders a lineup card (issue #140) to a self-contained HTML document that the
// share-image pipeline screenshots to a 1200×1200 PNG. Matches the existing
// social cards (lib/scoreboard-image.tsx): cream paper, near-black ink, Source
// Sans, logo + "boxscore" wordmark header, tagline + URL footer. No color, no
// team logos (rights) — the boxscore aesthetic.

import { BRAND } from "@/lib/brand";
import type { LineupCardData, LineupCardTeam } from "./lineup-card";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function startTimeET(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }).format(d) + " ET";
}
function dateET(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York",
  }).format(d);
}

function handLabel(hand: string): string {
  return hand === "L" ? "LHP" : hand === "R" ? "RHP" : "SP";
}
function fmtOdds(v: number | null): string {
  if (v == null) return "—";
  return v > 0 ? `+${v}` : String(v);
}
function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : full;
}

// Capture-time line under the odds grid — the book for each market is labeled
// on the market itself (see oddsStrip), so this is just the "as of" stamp.
function oddsAsOf(o: NonNullable<LineupCardData["odds"]>): string {
  if (!o.capturedAt) return "";
  return `Lines as of ${dateET(o.capturedAt)} ${startTimeET(o.capturedAt)}`;
}

function oddsStrip(data: LineupCardData): string {
  const o = data.odds;
  if (!o) return "";
  // A labeled row ("LABEL  value"); two of them stack into a cell (away/home,
  // over/under, NRFI/YRFI).
  const row = (label: string, val: string) =>
    `<span class="odds-row"><span class="odds-t">${esc(label)}</span>${val}</span>`;
  const twoLine = (awayVal: string, homeVal: string) =>
    row(data.away.abbr, awayVal) + row(data.home.abbr, homeVal);
  const ml = twoLine(fmtOdds(o.awayMl), fmtOdds(o.homeMl));
  const rlVal = (s: { line: string; odds: number | null }) =>
    `${esc(s.line)}${s.odds != null ? ` (${fmtOdds(s.odds)})` : ""}`;
  const rl = o.runLine ? twoLine(rlVal(o.runLine.away), rlVal(o.runLine.home)) : "—";
  // Total as two lines (over/under) so each side's juice shows, mirroring ML.
  const withJuice = (juice: number | null) => (juice != null ? ` (${fmtOdds(juice)})` : "");
  const total = o.total != null
    ? row("O", `${o.total}${withJuice(o.overOdds)}`) + row("U", `${o.total}${withJuice(o.underOdds)}`)
    : "—";
  // NRFI (no runs) over YRFI (yes runs), mirroring the ML/run-line two-line rows.
  const firstInning = o.nrfi != null || o.yrfi != null
    ? row("NRFI", fmtOdds(o.nrfi)) + row("YRFI", fmtOdds(o.yrfi))
    : "—";
  const book = o.book.toUpperCase();
  // Each market carries its own source label: game lines come from DraftKings
  // (via ESPN), the first-inning market from FanDuel. Only label a market that
  // actually has a price.
  const cell = (k: string, v: string, src: string | null) =>
    `<div class="odds-cell"><span class="odds-k">${k}</span><span class="odds-v">${v}</span>` +
    `${src ? `<span class="odds-src">${esc(src)}</span>` : ""}</div>`;
  const hasMl = o.awayMl != null || o.homeMl != null;
  const hasFirst = o.nrfi != null || o.yrfi != null;
  return `<div class="odds">
      ${cell("Moneyline", ml, hasMl ? book : null)}
      ${cell("Run line", rl, o.runLine ? book : null)}
      ${cell("Total", total, o.total != null ? book : null)}
      ${cell("1st Inning", firstInning, hasFirst ? "FANDUEL" : null)}
    </div>
    <div class="src">${esc(oddsAsOf(o))}</div>
    <div class="rg">Odds for entertainment. Must be 21+. Gambling problem? Call 1-800-GAMBLER.</div>`;
}

// Primary TV + radio only — keep it to the one place to watch and the one place
// to listen, so the line stays clean. Returns HTML (values pre-escaped).
function bcLine(t: LineupCardTeam): string {
  const parts: string[] = [];
  if (t.broadcasts.tv[0]) parts.push(`<span class="bc-k">TV</span>${esc(t.broadcasts.tv[0])}`);
  if (t.broadcasts.radio[0]) parts.push(`<span class="bc-k">Radio</span>${esc(t.broadcasts.radio[0])}`);
  return parts.join(`<span class="bc-sep"></span>`);
}

// The team's OWN starting pitcher, as its own compact table (no W-L per Jeff).
function pitcherTable(sp: NonNullable<LineupCardData["home"]["probable"]>): string {
  return `<table class="lineup pt">
    <thead><tr>
      <th class="bat">Starting Pitcher</th>
      <th class="s">ERA</th><th class="s">WHIP</th><th class="s">K/9</th><th class="s">BB/9</th><th class="s">HR/9</th><th class="s">1ST ERA</th><th class="s">IP/G</th>
    </tr></thead>
    <tbody><tr>
      <td class="bat">${esc(sp.name)} <span class="hand">${handLabel(sp.hand)}</span></td>
      <td class="s">${esc(sp.era)}</td><td class="s">${esc(sp.whip)}</td><td class="s">${esc(sp.k9)}</td><td class="s">${esc(sp.bb9)}</td><td class="s">${esc(sp.hr9)}</td><td class="s">${esc(sp.firstEra)}</td><td class="s">${esc(sp.ipPerApp)}</td>
    </tr></tbody>
  </table>`;
}

// t = the batting team (its own pitcher shown above its lineup); opposing = the
// pitcher this lineup faces (names the career-vs column).
function teamColumn(t: LineupCardTeam, opposing: LineupCardData["home"]["probable"]): string {
  const oppLast = opposing ? esc(lastName(opposing.name)) : "";
  const rows = t.batters.map((b) => `
    <tr>
      <td class="ord">${b.order}</td>
      <td class="pos">${esc(b.pos)}</td>
      <td class="bat">${esc(b.name)}${b.bats ? ` <span class="bats">${esc(b.bats)}</span>` : ""}</td>
      <td class="s">${esc(b.ba)}</td>
      <td class="s">${esc(b.ops)}</td>
      <td class="s">${b.r}</td>
      <td class="s">${b.hr}</td>
      <td class="s">${b.rbi}</td>
      <td class="s sb">${b.sb}</td>
      <td class="vs">${b.vsLine === "first meeting" ? `<span class="dim">first meeting</span>` : esc(b.vsLine)}</td>
    </tr>`).join("");
  return `<div class="col">
    <div class="col-head"><div class="col-team">${esc(t.name)}${t.record ? ` <span class="rec">(${esc(t.record)})</span>` : ""}</div></div>
    ${t.probable ? pitcherTable(t.probable) : ""}
    <table class="lineup">
      <thead><tr>
        <th class="ord"></th><th class="pos"></th><th class="bat">Batter</th>
        <th class="s">AVG</th><th class="s">OPS</th><th class="s">R</th><th class="s">HR</th><th class="s">RBI</th><th class="s sb">SB</th>
        <th class="vs">${opposing ? `Career vs. ${oppLast}` : ""}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${bcLine(t) ? `<div class="bc">${bcLine(t)}</div>` : ""}
  </div>`;
}

// logoSrc: pass a data URI for offline/screenshot rendering, or "/icon.png" when
// rendering at the site origin (matches lib/scoreboard-image.tsx).
export function renderLineupCardHtml(data: LineupCardData, logoSrc = "/icon.png"): string {
  const nat = data.national.length ? `<div class="nat">National TV: ${esc(data.national.join(", "))}</div>` : "";
  const url = "boxscore.email/mlb";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,300..900;1,400..800&display=swap">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  /* Portrait, phone-first: 1080 wide (retina-native on a phone feed), teams
     STACKED full-width with large type so the tables stay readable when the
     image scales into a mobile timeline. Natural height, screenshot in full. */
  body { width: 1080px; background: #f9f7f1; color: #161410;
    font-family: 'Source Sans 3', 'Segoe UI', Helvetica, Arial, sans-serif;
    padding: 44px 44px; }
  /* Brand strip — mirrors scoreboard-image.tsx */
  .brand { display: flex; justify-content: space-between; align-items: center;
    border-bottom: 2px solid #161410; padding-bottom: 16px; }
  .brand-left { display: flex; align-items: center; gap: 16px; font-size: 46px; font-weight: 800; letter-spacing: -0.01em; }
  .brand-left img { width: 66px; height: 66px; border-radius: 10px; display: block; }
  .brand-right { text-align: right; }
  .kicker { font-size: 21px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.09em; }
  /* Matchup */
  .match { display: flex; justify-content: space-between; align-items: flex-end; margin: 30px 0 4px; }
  .teams { font-size: 92px; font-weight: 800; letter-spacing: -0.03em; line-height: 0.95; }
  .meta { text-align: right; font-size: 28px; font-weight: 700; line-height: 1.3; }
  .meta .venue { color: #6a6354; font-size: 21px; font-weight: 400; }
  .nat { margin-top: 16px; font-size: 19px; font-weight: 700; }
  /* Teams stacked vertically (one per row) for mobile legibility. */
  .cols { display: grid; grid-template-columns: 1fr; gap: 34px; margin-top: 30px; }
  .col:first-child { border-bottom: 1px solid #d8d1c0; padding-bottom: 34px; }
  .col-head { border-bottom: 2px solid #161410; padding-bottom: 6px; margin-bottom: 8px; }
  .col-team { font-size: 40px; font-weight: 800; letter-spacing: -0.01em; }
  .col-team .rec { color: #6a6354; font-weight: 700; font-size: 27px; }
  /* Starting-pitcher table sits above the lineup, its own compact table. */
  .pt { margin-bottom: 20px; }
  .pt .hand { color: #6a6354; font-weight: 700; font-size: 19px; }
  table.lineup { width: 100%; border-collapse: collapse; }
  .lineup th { font-size: 15px; text-transform: uppercase; letter-spacing: 0.04em;
    color: #6a6354; text-align: left; padding: 4px 3px; border-bottom: 1px solid #cdc6b5; }
  .lineup th.s, .lineup th.vs { text-align: right; }
  .lineup td { font-size: 27px; padding: 10px 3px; border-bottom: 1px solid #e7e1d2; }
  .lineup .ord { width: 30px; color: #9b937f; font-weight: 800; }
  .lineup .pos { width: 54px; color: #6a6354; font-weight: 700; font-size: 20px; }
  .lineup .bat { font-weight: 700; white-space: nowrap; }
  /* Bat side (L/R/S) as a small muted cap after the name, echoing the SP hand. */
  .lineup .bats { color: #9b937f; font-weight: 800; font-size: 17px; }
  /* Right-aligned, auto width, equal left gap → uniform spacing between the five
     stat columns; the SB right pad + the divider's left pad use that same gap. */
  .lineup .s { text-align: right; font-variant-numeric: tabular-nums; padding-left: 30px; padding-right: 0; }
  .lineup .sb { padding-right: 30px; }
  .lineup .vs { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;
    border-left: 1px solid #e7e1d2; padding-left: 30px; }
  .lineup th.vs { border-left: 1px solid #cdc6b5; padding-left: 30px; }
  .lineup .vs .dim, .dim { color: #a8a08c; font-style: italic; font-weight: 400; font-size: 22px; }
  .bc { margin-top: 12px; font-size: 19px; color: #6a6354; line-height: 1.35; }
  .bc-k { color: #9b937f; font-weight: 800; text-transform: uppercase; font-size: 14px;
    letter-spacing: 0.05em; margin-right: 6px; }
  .bc-sep { display: inline-block; width: 26px; }
  /* Odds — 2×2 on the portrait card so each line has room. */
  .odds { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px 40px;
    margin-top: 28px; border-top: 2px solid #161410; padding-top: 18px; }
  .odds-cell { display: flex; flex-direction: column; }
  .odds-k { font-size: 16px; text-transform: uppercase; letter-spacing: 0.07em; color: #6a6354; font-weight: 800; margin-bottom: 3px; }
  .odds-v { font-size: 30px; font-weight: 800; font-variant-numeric: tabular-nums;
    display: flex; flex-direction: column; gap: 2px; }
  .odds-row { display: flex; gap: 12px; }
  .odds-t { color: #6a6354; font-weight: 700; min-width: 56px; }
  .odds-src { margin-top: 6px; font-size: 14px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.08em; color: #9b937f; }
  .src { margin-top: 14px; font-size: 16px; color: #6a6354; font-weight: 700; }
  .rg { margin-top: 6px; font-size: 15px; color: #8a8270; }
  /* Footer — tagline + URL, mirrors scoreboard-image.tsx */
  .foot { display: flex; justify-content: space-between; align-items: baseline;
    margin-top: 26px; padding-top: 12px; border-top: 1px solid #161410; font-size: 20px; }
  .foot .tag { font-style: italic; color: #161410; }
  .foot .url { text-transform: uppercase; letter-spacing: 0.16em; font-weight: 800; }
</style></head>
<body>
  <div class="brand">
    <div class="brand-left"><img src="${esc(logoSrc)}" alt="">boxscore</div>
    <div class="brand-right"><div class="kicker">MLB Starting Lineups</div></div>
  </div>
  <div class="match">
    <div class="teams">${esc(data.away.abbr)} @ ${esc(data.home.abbr)}</div>
    <div class="meta"><div>${esc(dateET(data.startUtc))}</div><div>${esc(startTimeET(data.startUtc))}</div><div class="venue">${esc(data.venue)}</div></div>
  </div>
  ${nat}
  <div class="cols">
    ${teamColumn(data.away, data.home.probable)}
    ${teamColumn(data.home, data.away.probable)}
  </div>
  ${oddsStrip(data)}
  <div class="foot"><span class="tag">${esc(BRAND.tagline)}</span><span class="url">${esc(url)}</span></div>
</body></html>`;
}
