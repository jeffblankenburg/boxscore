// One-off visual check for the lineup card (issue #140). Assembles a real
// game's card data, renders the HTML, and screenshots the body to a PNG so we
// can eyeball column spacing (e.g. the OPS column) without a running server.
//
// Run: npx tsx --env-file=.env.local scripts/screenshot-lineup.ts <gamePk>

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { loadLineupCard, loadCardOdds } from "@/lib/sports/mlb/lineup-card";
import { renderLineupCardHtml } from "@/lib/sports/mlb/lineup-card-image";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  const gamePk = Number(process.argv[2]);
  if (!Number.isFinite(gamePk)) throw new Error("usage: screenshot-lineup.ts <gamePk>");

  const data = await loadLineupCard(gamePk);
  if (!data) throw new Error(`no card for ${gamePk} (lineups not posted?)`);
  try {
    const odds = await loadCardOdds(data.date);
    data.odds = odds(data.away.abbr, data.home.abbr);
  } catch (e) {
    console.warn(`odds skipped: ${(e as Error).message}`);
  }

  const html = renderLineupCardHtml(data, "");
  const outDir = resolve("docs/screenshots");
  await mkdir(outDir, { recursive: true });
  const out = resolve(outDir, `lineup-${gamePk}.png`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1080, height: 100, deviceScaleFactor: 1 },
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 500));
    const el = await page.$("body");
    if (!el) throw new Error("no body");
    await el.screenshot({ path: out as `${string}.png`, type: "png" });
    console.log(`wrote ${out} — ${data.away.abbr} @ ${data.home.abbr}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
