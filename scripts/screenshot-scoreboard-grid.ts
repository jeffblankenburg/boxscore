// One-off visual check for the scoreboard-image grid layout across slate sizes.
// Renders ScoreboardImage to static HTML for a range of game counts and
// screenshots each 1200×630 canvas so we can confirm tiles stay boxes (not the
// tall ribbon a lone game used to stretch into). Not wired into any cron.
//
// Run: node_modules/.bin/tsx scripts/screenshot-scoreboard-grid.ts

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
// The lib is compiled with the classic JSX runtime (React.createElement), which
// expects React in scope; provide it globally for this standalone tsx run.
(globalThis as { React?: unknown }).React = React;
import puppeteer from "puppeteer-core";
import { ScoreboardImage, type ScoreTile } from "@/lib/scoreboard-image";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const TLAS = ["CAR", "ARI", "KC", "BUF", "DAL", "PHI", "SF", "SEA", "GB", "CHI", "NE", "NYJ", "MIA", "CIN", "BAL", "PIT", "LAR", "DEN", "LV", "HOU", "IND", "JAX", "TEN", "CLE", "DET", "MIN", "NO", "TB", "ATL", "WAS", "NYG", "LAC"];

function fakeTiles(n: number): ScoreTile[] {
  return Array.from({ length: n }, (_, i) => ({
    away: TLAS[(i * 2) % TLAS.length]!,
    home: TLAS[(i * 2 + 1) % TLAS.length]!,
    aR: 20 + ((i * 7) % 20),
    hR: 13 + ((i * 5) % 20),
  }));
}

async function main() {
  const outDir = resolve("docs/screenshots/scoreboard-grid");
  await mkdir(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1200, height: 630, deviceScaleFactor: 2 },
  });

  try {
    const page = await browser.newPage();
    for (const n of [1, 2, 3, 5, 6, 14, 16, 20, 25, 40]) {
      const body = renderToStaticMarkup(
        ScoreboardImage({
          scores: fakeTiles(n),
          date: "Thursday, August 6, 2026",
          sport: "nfl",
        }),
      );
      const html = `<!doctype html><html><head><meta charset="utf-8">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap">
        <style>html,body{margin:0;padding:0}</style></head><body>${body}</body></html>`;
      const file = resolve(outDir, `n${String(n).padStart(2, "0")}.html`);
      await writeFile(file, html);
      await page.goto(pathToFileURL(file).toString(), { waitUntil: "networkidle0" });
      await page.evaluateHandle("document.fonts.ready");
      await new Promise((r) => setTimeout(r, 150));
      const png = resolve(outDir, `n${String(n).padStart(2, "0")}.png`);
      await page.screenshot({ path: png as `${string}.png`, clip: { x: 0, y: 0, width: 1200, height: 630 } });
      console.log(`  n=${n} -> ${png}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
