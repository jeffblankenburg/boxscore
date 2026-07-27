// Screenshot /advertise/sample-edition from the running dev server.
// Default: capture a clip around each ad placement so the ads are readable
// (the full edition is ~50k px tall). Post-UI-change verification.
// Usage: npx tsx scripts/screenshot-sample-edition.ts <outDir> [width]

import puppeteer from "puppeteer-core";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const CHROME = process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.DEV_BASE_URL ?? "http://localhost:3000";

async function main() {
  const outDir = resolve(process.argv[2] ?? "/tmp/se");
  const width = Number(process.argv[3] ?? 400);
  await mkdir(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width, height: 1200, deviceScaleFactor: 2 },
  });
  try {
    const page = await browser.newPage();
    await page.goto(ORIGIN + "/advertise/sample-edition", { waitUntil: "networkidle0", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);

    // Intro + first ad.
    await page.screenshot({ path: `${outDir}/00-intro.png` as `${string}.png` });

    // Clip a padded box around each ad placement so it's legible with context.
    const selectors = [
      ".ad-sponsor-line",
      ".ad-standings-strip",
      ".ad-display-box",
      ".ad-classifieds-block",
    ];
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (!el) { console.log(`(missing) ${sel}`); continue; }
      const box = await el.boundingBox();
      if (!box) { console.log(`(no box) ${sel}`); continue; }
      const pad = 60;
      const clip = {
        x: Math.max(0, box.x - 12),
        y: Math.max(0, box.y - pad),
        width: Math.min(width, box.width + 24),
        height: box.height + pad * 2,
      };
      const name = sel.replace(/[^a-z]/g, "");
      await page.screenshot({ path: `${outDir}/${name}.png` as `${string}.png`, clip });
      console.log(`ok ${sel} @ y=${Math.round(box.y)}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
