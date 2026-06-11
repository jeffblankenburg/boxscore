import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  await page.goto("http://localhost:3001/games/linescordle", { waitUntil: "networkidle0", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "/tmp/linescordle-after-rename.png", fullPage: true });
  await browser.close();
  console.log("ok");
})().catch(e => { console.error(e); process.exit(1); });
