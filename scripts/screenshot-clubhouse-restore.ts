// Verifies the completed-puzzle RESTORE path: solve one group, lose the rest,
// reload, and confirm all four bands persist (regression check for the loss
// persistence bug where only solved-before-loss bands were saved).

import puppeteer from "puppeteer-core";
import { resolve } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:3000/games/clubhouse?date=2026-08-20";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 400, height: 900, deviceScaleFactor: 2 },
  });
  try {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);

    const click = (t: string) =>
      page.evaluate((label: string) => {
        const el = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
        el?.click();
      }, t);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Solve Boston Red Sox (one real band).
    for (const n of ["Dustin Pedroia", "Jim Rice", "Carl Yastrzemski", "Ted Williams"]) { await click(n); await wait(60); }
    await wait(150); await click("Submit"); await wait(700);

    // Lose: a cross-group set of 4, submitted four times.
    for (const n of ["Jeff Bagwell", "Roger Clemens", "Carlos Beltrán", "Roy Halladay"]) { await click(n); await wait(60); }
    for (let i = 0; i < 4; i++) { await click("Submit"); await wait(500); }

    // Reload — this is the moment the bug showed (only Red Sox came back).
    await page.reload({ waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await wait(300);

    const bands = await page.evaluate(() => document.querySelectorAll(".tm-band").length);
    console.log(`bands after reload: ${bands} (expect 4)`);
    await page.screenshot({ path: resolve("/tmp/clubhouse-restore.png") as `${string}.png`, fullPage: true });
    console.log("/tmp/clubhouse-restore.png");
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
