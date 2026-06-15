// Screenshot the public /advertise page from the running dev server.
// Used by Claude as part of the post-UI-change workflow so visual
// regressions get caught before they ship — see memory
// feedback_screenshot_ui_changes.md.
//
// Usage:
//   npx tsx scripts/screenshot-advertise.ts [out]
//
// Examples:
//   npx tsx scripts/screenshot-advertise.ts
//   npx tsx scripts/screenshot-advertise.ts /tmp/advertise.png

import puppeteer from "puppeteer-core";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const CHROME = process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.DEV_BASE_URL ?? "http://localhost:3001";

async function main() {
  const outArg = process.argv[2] ?? "/tmp/advertise.png";
  const outPath = resolve(outArg);
  await mkdir(resolve(outPath, ".."), { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1440, height: 2000, deviceScaleFactor: 2 },
  });

  try {
    const page = await browser.newPage();
    await page.goto(ORIGIN + "/advertise", { waitUntil: "networkidle0", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    // Scroll the page so reveal-on-scroll + count-up animations have a
    // chance to settle before the screenshot, then back to top.
    await page.evaluate(async () => {
      const step = window.innerHeight * 0.8;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 250));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 400));
    });

    await page.screenshot({ path: outPath as `${string}.png`, fullPage: true });
    console.log(outPath);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
