// Screenshot a rendered football digest HTML file (from football-render-smoke)
// at newspaper width. Full-page PNG to /tmp. Dev-only, not shipped.
//   npx tsx scripts/football-shot.ts /tmp/football-nfl-2025-09-07.html [pxHeightCap]
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

function chrome(): string {
  for (const p of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ]) if (existsSync(p)) return p;
  throw new Error("No Chrome found");
}

async function main() {
  const htmlPath = process.argv[2]!;
  const out = htmlPath.replace(/\.html$/, ".png");
  const clipH = process.argv[3] ? Number(process.argv[3]) : null;
  const browser = await puppeteer.launch({
    executablePath: chrome(),
    headless: true,
    defaultViewport: { width: 720, height: 1200, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });
  if (clipH) {
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 720, height: clipH } });
  } else {
    await page.screenshot({ path: out, fullPage: true });
  }
  await browser.close();
  console.log(out);
}
main().catch((e) => { console.error(e); process.exit(1); });
