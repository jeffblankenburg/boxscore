// Local screenshot tool for the scoreline-alignment PR. Renders the verify
// fixture and captures (a) the whole boxscores grid and (b) per-game zooms
// for the interesting edge cases. Designed to run twice from the PR script:
// once with the new grid code ("after"), once after `git stash` to get the
// old figure-space code ("before").
//
// Run: node_modules/.bin/tsx scripts/screenshot-scoreline.ts <label>
//   <label> is appended to filenames, e.g. "before" or "after".

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

function findLocalChrome(): string {
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

async function main() {
  const label = process.argv[2];
  if (!label) {
    console.error("Usage: tsx scripts/screenshot-scoreline.ts <label>");
    process.exit(1);
  }

  const outDir = resolve("docs/screenshots/alignment-fix");
  await mkdir(outDir, { recursive: true });

  const fixture = pathToFileURL(resolve("out/verify-scoreline.html")).toString();

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? findLocalChrome(),
    headless: true,
    defaultViewport: { width: 1280, height: 1600, deviceScaleFactor: 2 },
  });

  try {
    const page = await browser.newPage();
    await page.goto(fixture, { waitUntil: "networkidle0" });
    // Source Sans 3 ships from Google Fonts; make sure it's actually loaded
    // before screenshotting or we'd capture system-font fallback widths.
    await page.evaluateHandle("document.fonts.ready");

    // Whole boxscores grid.
    const grid = await page.$(".boxscores-container");
    if (grid) {
      const png = resolve(outDir, `grid-${label}.png`);
      await grid.screenshot({ path: png as `${string}.png`, type: "png" });
      console.log(`  ${png}`);
    }

    // Per-game zooms. The verify fixture has 6 games in this order.
    const labels = [
      "01-standard-nine",        // Marlins/Rays — common case, bot-9 "x"
      "02-home-walkoff",         // Reds/Guardians — bot-9 "x"
      "03-extras-eleven",        // Cubs/White Sox — 11 innings
      "04-extras-twelve",        // Mets/Braves — 12 innings, away wins
      "05-big-inning",           // Giants/Athletics — 12-run inning
      "06-big-inning-and-extras",// Astros/Rangers — both flags
    ];
    const games = await page.$$(".game-container");
    for (let i = 0; i < Math.min(games.length, labels.length); i++) {
      const el = games[i];
      if (!el) continue;
      const png = resolve(outDir, `${labels[i]}-${label}.png`);
      await el.screenshot({ path: png as `${string}.png`, type: "png" });
      console.log(`  ${png}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
