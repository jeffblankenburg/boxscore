// Generate the /redbaron77 box-score share PNGs.
//
// Screenshots each [data-rb-card] on the /redbaron77/raw route and writes
// public/redbaron77/<gamePk>.png. Run against a locally running server:
//
//   PORT=3111 npx next start -p 3111 &            # (or next dev)
//   npx tsx scripts/gen-redbaron77-images.ts [baseUrl]
//
// baseUrl defaults to http://localhost:3111. Idempotent — overwrites the PNGs.
// The two games are fixed history, so this is run by hand only when the card
// design changes, not on any cron.

import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { REDBARON_GAMES } from "../app/redbaron77/games";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean) as string[];

function findChrome(): string {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  throw new Error(`no Chrome found; set CHROME_PATH. Tried: ${CHROME_CANDIDATES.join(", ")}`);
}

async function main() {
  const baseUrl = process.argv[2] ?? "http://localhost:3111";
  const outDir = path.join(process.cwd(), "public", "redbaron77");
  mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    // DPR 2 → ~1200px-wide PNGs from the 600px cards (social-crisp).
    await page.setViewport({ width: 680, height: 1400, deviceScaleFactor: 2 });
    await page.goto(`${baseUrl}/redbaron77/raw`, { waitUntil: "networkidle0" });
    // Force the Source Sans 3 webfont fully loaded — the globals.css @import
    // doesn't reliably register in document.fonts in headless Chrome, so
    // without this the capture falls back to a system font (wrong glyph
    // sizes in the footer URL). Mirrors ensureFontsLoaded in render-images.ts.
    await page.evaluate(async () => {
      const href = "https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap";
      if (![...document.styleSheets].some((s) => (s.href || "").includes("fonts.googleapis"))) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        document.head.appendChild(link);
        await new Promise((r) => { link.onload = r; link.onerror = r; });
      }
      const specs = ["400", "italic 400", "700", "800", "900"].map((w) => `${w} 16px 'Source Sans 3'`);
      try { await Promise.all(specs.map((s) => document.fonts.load(s))); } catch { /* best-effort */ }
      await document.fonts.ready;
    });
    await new Promise((r) => setTimeout(r, 200));

    const cards = await page.$$("[data-rb-card]");
    if (cards.length !== REDBARON_GAMES.length) {
      throw new Error(`expected ${REDBARON_GAMES.length} cards, found ${cards.length}`);
    }
    for (let i = 0; i < cards.length; i++) {
      const file = REDBARON_GAMES[i]!.file;
      const dest = path.join(outDir, file);
      await cards[i]!.screenshot({ path: dest as `${string}.png` });
      console.log(`✓ ${file}`);
    }
  } finally {
    await browser.close();
  }
  console.log(`Done → public/redbaron77/ (${REDBARON_GAMES.length} images)`);
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
