import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 390, height: 1200, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  await page.goto("http://localhost:3001/games/linescordle?test=yaz", { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  const dims = await page.evaluate(() => {
    const el = document.querySelector(".linescordle-tile") as HTMLElement | null;
    const row = document.querySelector(".linescordle-row") as HTMLElement | null;
    const tr = el?.getBoundingClientRect();
    const rr = row?.getBoundingClientRect();
    return {
      tileWidth: tr?.width ?? 0,
      tileHeight: tr?.height ?? 0,
      rowWidth: rr?.width ?? 0,
      rowHeight: rr?.height ?? 0,
      cols: row?.style.getPropertyValue("--cols") ?? "?",
      tileCount: document.querySelectorAll(".linescordle-tile").length,
    };
  });
  console.log(JSON.stringify(dims));
  await browser.close();
})();
