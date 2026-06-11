import puppeteer from "puppeteer-core";
import { resolve } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://localhost:3001";

async function shoot(path: string, viewport: { width: number; height: number }, out: string) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { ...viewport, deviceScaleFactor: 2 },
  });
  try {
    const page = await browser.newPage();
    await page.goto(ORIGIN + path, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(out) as `${string}.png`, fullPage: true });
    console.log(out);
  } finally {
    await browser.close();
  }
}

(async () => {
  // Landing
  await shoot("/games", { width: 390, height: 844 }, "/tmp/games-landing-mobile.png");
  await shoot("/games", { width: 1280, height: 900 }, "/tmp/games-landing-desktop.png");
  // Linescordle inside the new shell
  await shoot("/games/linescordle", { width: 390, height: 844 }, "/tmp/games-linescordle-mobile.png");
  await shoot("/games/linescordle", { width: 1280, height: 1000 }, "/tmp/games-linescordle-desktop.png");
})().catch((e) => { console.error(e); process.exit(1); });
