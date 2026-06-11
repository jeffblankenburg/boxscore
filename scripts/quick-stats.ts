import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
(async () => {
  for (const vp of [{ w: 390, h: 844, label: "mobile" }, { w: 1280, h: 800, label: "desktop" }]) {
    const browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      defaultViewport: { width: vp.w, height: vp.h, deviceScaleFactor: 2 },
    });
    const page = await browser.newPage();
    await page.goto("http://localhost:3001/games/linescordle/stats", { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `/tmp/linescordle-stats-${vp.label}.png`, fullPage: true });
    await browser.close();
    console.log(`/tmp/linescordle-stats-${vp.label}.png`);
  }
})();
