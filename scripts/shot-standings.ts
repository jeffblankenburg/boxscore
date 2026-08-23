// Throwaway visual check for the standings magic-number + clinch-letter work.
// Renders a real league's standings for a chosen date using the production
// renderers, wraps it in globals.css, and screenshots at 400px. Not wired into
// any cron — safe to delete.
//
// Usage: npx tsx --env-file=.env.local scripts/shot-standings.ts

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { getStandings, getWildCardStandings, fetchScheduleRaw, fetchStandingsRaw, fetchWildCardRaw } from "../lib/mlb";
import { renderDivisionTable, renderWildCardTable } from "../lib/render";
import { EMAIL_STYLES, renderDivisionStandings, renderClinchKeyEmail } from "../lib/render-email";
import { adaptStatsapiDailyRaw } from "../lib/sports/mlb/adapters/from-statsapi";
import { renderCanonicalWeb } from "../lib/sports/mlb/render/web";
import type { DailyRaw } from "../lib/daily-raw";
import { showMagicNumbers, clinchLetter, eliminatedFromWildCard, clinchKeyLine } from "../lib/standings-format";

// Build the canonical daily digest HTML for a real date straight from live
// statsapi (schedule forces "regular" mode so standings render). Verifies the
// SHIPPING path — adapter populates magicNumber/clinchIndicator/eliminated, and
// the canonical renderer emits the MN column + clinch letters + key.
async function canonicalWeb(season: number, date: string): Promise<string> {
  const [schedule, standings, wildCard] = await Promise.all([
    fetchScheduleRaw(date), fetchStandingsRaw(season, date), fetchWildCardRaw(season, date),
  ]);
  const raw: DailyRaw = { schedule, standings, wildCard, leaders: {}, games: {} };
  return renderCanonicalWeb(adaptStatsapiDailyRaw(date, raw));
}

const DIVS = {
  AL: [{ id: 201, name: "East Division" }, { id: 202, name: "Central Division" }, { id: 200, name: "West Division" }],
  NL: [{ id: 204, name: "East Division" }, { id: 205, name: "Central Division" }, { id: 203, name: "West Division" }],
} as const;
const LEAGUE_ID = { AL: 103, NL: 104 } as const;

async function standingsColumn(league: "AL" | "NL", season: number, date: string): Promise<string> {
  const standings = await getStandings(season, date);
  const wildCard = await getWildCardStandings(season, date);
  const showMagic = showMagicNumbers(date);
  const tables = DIVS[league].map((d) => {
    const rec = standings.find((r) => r.division.id === d.id);
    return rec ? renderDivisionTable(d.name, rec, { showMagic }) : "";
  }).join("");
  const wc = wildCard.find((r) => r.league.id === LEAGUE_ID[league]);
  const wcHtml = wc ? renderWildCardTable(wc) : "";
  const present = new Set<string>();
  for (const d of DIVS[league]) {
    const rec = standings.find((r) => r.division.id === d.id);
    for (const t of rec?.teamRecords ?? []) { const c = clinchLetter(t); if (c) present.add(c); }
  }
  for (const t of wc?.teamRecords ?? []) { if (!eliminatedFromWildCard(t)) { const c = clinchLetter(t); if (c) present.add(c); } }
  const keyLine = clinchKeyLine(present);
  const keyHtml = keyLine ? `<div class="standings-key">${keyLine}</div>` : "";
  return `<div class="boxscores-title">${league} Standings</div>${tables}${wcHtml}${keyHtml}`;
}

async function emailColumn(league: "AL" | "NL", season: number, date: string): Promise<string> {
  const standings = await getStandings(season, date);
  const recs = DIVS[league].map((d) => standings.find((r) => r.division.id === d.id))
    .filter((r): r is NonNullable<typeof r> => r != null);
  const tables = DIVS[league].map((d) => {
    const rec = standings.find((r) => r.division.id === d.id);
    return rec ? renderDivisionStandings(d.name.replace(" Division", ""), rec, { date }) : "";
  }).join("");
  return `${tables}${renderClinchKeyEmail(recs)}`;
}

async function main() {
  const css = await readFile(resolve("app/globals.css"), "utf8");
  // Two panels: a mid-Sept date (real magic numbers on unclinched leaders) and
  // a late-Sept date (multiple clinch letters + wild-card elimination trimming).
  const panels = [
    { title: "NL — 2025-09-15 (MN + clinch mix)", html: await standingsColumn("NL", 2025, "2025-09-15") },
    { title: "AL — 2025-09-27 (all clinched)", html: await standingsColumn("AL", 2025, "2025-09-27") },
  ];
  const body = panels.map((p) =>
    `<div style="margin-bottom:28px"><div style="font:700 12px sans-serif;color:#999;margin-bottom:6px">${p.title}</div><div class="newspaper">${p.html}</div></div>`
  ).join("");
  const doc = `<!doctype html><html><head><meta charset="utf8"><style>${css}</style></head>
    <body style="margin:0;padding:10px;background:#fff"><div style="max-width:400px">${body}</div></body></html>`;
  await writeFile("/tmp/standings-check.html", doc);

  // Email panels — same data, email renderer + EMAIL_STYLES.
  const emailPanels = [
    { title: "EMAIL NL — 2025-09-15", html: await emailColumn("NL", 2025, "2025-09-15") },
    { title: "EMAIL AL — 2025-09-27", html: await emailColumn("AL", 2025, "2025-09-27") },
  ];
  const emailBody = emailPanels.map((p) =>
    `<div style="margin-bottom:28px"><div style="font:700 12px sans-serif;color:#999;margin-bottom:6px">${p.title}</div>${p.html}</div>`
  ).join("");
  const emailDoc = `<!doctype html><html><head><meta charset="utf8"><style>${EMAIL_STYLES}</style></head>
    <body style="margin:0;padding:10px;background:#fff"><div style="max-width:400px">${emailBody}</div></body></html>`;
  await writeFile("/tmp/standings-email.html", emailDoc);

  // Canonical (shipping) daily-digest web path.
  const canonHtml = await canonicalWeb(2025, "2025-09-15");
  const canonDoc = `<!doctype html><html><head><meta charset="utf8"><style>${css}</style></head>
    <body style="margin:0;padding:10px;background:#fff"><div class="newspaper" style="max-width:400px">${canonHtml}</div></body></html>`;
  await writeFile("/tmp/standings-canon.html", canonDoc);

  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    defaultViewport: { width: 400, height: 900, deviceScaleFactor: 2 },
  });
  for (const file of ["standings-check", "standings-email", "standings-canon"] as const) {
    const page = await browser.newPage();
    await page.goto(`file:///tmp/${file}.html`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => (document as any).fonts?.ready ?? Promise.resolve());
    // For the canonical full-page render, screenshot just the standings columns.
    const target = file === "standings-canon" ? await page.$(".col-standings") : null;
    const png = (target
      ? await target.screenshot({ type: "png" })
      : await page.screenshot({ type: "png", fullPage: true })) as Uint8Array;
    await writeFile(`/tmp/${file}.png`, Buffer.from(png));
    console.log(`wrote /tmp/${file}.png`, `${Buffer.from(png).readUInt32BE(16)}x${Buffer.from(png).readUInt32BE(20)}`);
    await page.close();
  }
  await browser.close();
}
main();
