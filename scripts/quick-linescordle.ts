import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  await page.goto("http://localhost:3001/games/linescordle", { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  // Type a guess + submit, verify it scores
  await page.keyboard.type("AAAAAAAAAAAAA");
  await page.keyboard.press("Enter");
  await new Promise(r => setTimeout(r, 1500));   // wait for server action round-trip
  const tiles = await page.evaluate(() => {
    const row = document.querySelectorAll(".linescordle-row")[0];
    if (!row) return null;
    return Array.from(row.querySelectorAll(".linescordle-tile")).map((t) => {
      const cls = t.className;
      const text = t.textContent;
      return { state: cls.match(/linescordle-tile-(\w+)/)?.[1] ?? "?", letter: text };
    });
  });
  console.log("First row after guess:", JSON.stringify(tiles));
  await page.screenshot({ path: "/tmp/linescordle-after-guess.png", fullPage: true });
  await browser.close();
})();
