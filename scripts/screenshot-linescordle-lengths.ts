// Renders the Linescordle page with each of the three test puzzles
// (PEDROMARTINEZ=13, BABERUTH=8, YAZ=3) on mobile + desktop so the
// tile-grid auto-sizing can be verified visually.

import puppeteer from "puppeteer-core";
import { resolve } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://localhost:3001";

const TESTS = ["pedro", "babe", "yaz"] as const;
const VIEWPORTS = [
  { label: "mobile",  width: 390, height: 844 },
  { label: "desktop", width: 1280, height: 1000 },
];

async function shoot(testKey: string, viewport: { label: string; width: number; height: number }) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: viewport.width, height: viewport.height, deviceScaleFactor: 2 },
  });
  try {
    const page = await browser.newPage();
    await page.goto(`${ORIGIN}/games/linescordle?test=${testKey}`, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    const out = `/tmp/linescordle-len-${testKey}-${viewport.label}.png`;
    await page.screenshot({ path: resolve(out) as `${string}.png`, fullPage: true });
    console.log(out);
  } finally {
    await browser.close();
  }
}

(async () => {
  for (const test of TESTS) {
    for (const vp of VIEWPORTS) {
      await shoot(test, vp);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
