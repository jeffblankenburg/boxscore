// Verify the season-record labels in per-game box scores render correctly, at
// the same box width the social share-image capture uses. Renders a real
// digest (from cached data) offline, injects globals.css + the single-column
// share flattening, and screenshots the first game block per sport.
//
// Run: npx tsx --env-file=.env.local scripts/verify-boxscore-records.ts <sport> <date>
//   sport ∈ mlb | wnba | nba | nfl | ncaaf ; date = games date (YYYY-MM-DD)

import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Per-sport: render fn + the game-block selector + share box width (matches
// SPORT_SHARE_SPECS in lib/render-images.ts).
async function renderFor(sport: string, date: string): Promise<{ html: string; selector: string; box: number; container: string }> {
  if (sport === "mlb") {
    const { loadDailyRaw } = await import("@/lib/daily");
    const { adaptStatsapiDailyRaw } = await import("@/lib/sports/mlb/adapters/from-statsapi");
    const { getCanonicalPlayerLookup } = await import("@/lib/canonical-players");
    const { renderCanonicalWeb } = await import("@/lib/sports/mlb/render/web");
    const raw = await loadDailyRaw(date);
    await getCanonicalPlayerLookup();
    const canonical = adaptStatsapiDailyRaw(date, raw);
    return { html: renderCanonicalWeb(canonical), selector: ".game-container", box: 540, container: ".boxscores-container" };
  }
  if (sport === "nba" || sport === "wnba") {
    const { loadNbaData } = await import("@/lib/nba");
    const { loadWnbaData } = await import("@/lib/wnba");
    const { renderBasketballContent } = await import("@/lib/render-basketball");
    const data = sport === "nba" ? await loadNbaData(date) : await loadWnbaData(date);
    return { html: renderBasketballContent(data), selector: ".bb-game", box: 640, container: ".bb-boxscores" };
  }
  // football
  const { loadFootballData } = await import("@/lib/sports/football/data");
  const { renderFootballContent } = await import("@/lib/sports/football/render/digest");
  const data = await loadFootballData(sport as "nfl" | "ncaaf", date);
  return { html: renderFootballContent(data), selector: ".fb-game", box: 680, container: ".fb-boxscores" };
}

async function main() {
  const sport = process.argv[2] ?? "mlb";
  const date = process.argv[3];
  if (!date) { console.error("Usage: ... <sport> <date>"); process.exit(1); }

  const { html, selector, box, container } = await renderFor(sport, date);
  const css = readFileSync(resolve("app/globals.css"), "utf8");
  const outDir = resolve("docs/screenshots/boxscore-records");
  await mkdir(outDir, { recursive: true });

  const doc = `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap">
    <style>${css}</style>
    <style>
      body { background:#f9f7f1; padding:20px; }
      ${container} { column-count:1 !important; }
      ${selector} { width:${box}px !important; max-width:${box}px !important; background:#fff; padding:16px 18px; }
    </style></head><body><div class="newspaper">${html}</div></body></html>`;

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: box + 60, height: 1000, deviceScaleFactor: 2 } });
  try {
    const page = await browser.newPage();
    await page.setContent(doc, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const recCount = await page.$$eval("[class$='ls-rec'], .ls-rec", (els) => els.length).catch(() => 0);
    const el = await page.$(selector);
    if (!el) { console.error(`no ${selector} found — no games for ${sport} ${date}?`); process.exit(2); }
    const png = resolve(outDir, `${sport}-${date}.png`);
    await el.screenshot({ path: png as `${string}.png` });
    console.log(`ok ${sport} ${date} — record spans on page: ${recCount} — ${png}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
