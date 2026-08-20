import puppeteer from "puppeteer-core";
import { resolve } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://localhost:3000";
const URL = ORIGIN + "/games/teammates?date=2026-08-20"; // Astros/Red Sox/Blue Jays/Yankees

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
    // Seed a few prior days' wins so the streak display has something to show.
    await page.evaluate(() => {
      for (const d of ["2026-08-17", "2026-08-18", "2026-08-19"]) {
        localStorage.setItem("teammates:" + d, JSON.stringify({ solvedTeams: [], mistakes: 0, guesses: [], status: "won" }));
      }
    });
    await page.screenshot({ path: resolve("/tmp/teammates-initial.png") as `${string}.png`, fullPage: true });
    console.log("/tmp/teammates-initial.png");

    // Auto-solve all four groups to reach the win screen (colored bands + trap reveal).
    const groups = [
      ["Mel Ott", "Bill Terry", "Travis Jackson", "Whitey Lockman"],
      ["Vernon Wells", "Lloyd Moseby", "Ernie Whitt", "Vladimir Guerrero Jr."],
      ["Paul Waner", "Pee Wee Reese", "Zack Wheat", "Jackie Robinson"],
      ["Dick Allen", "Jim Thome", "Nellie Fox", "Frank Thomas"],
    ];
    const clickByText = (text: string) =>
      page.evaluate((t: string) => {
        const el = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === t) as HTMLButtonElement | undefined;
        el?.click();
      }, text);

    // Trigger a wrong guess to show the "Not a team" flash — capture proves the
    // controls below don't move (fixed-height flash slot).
    for (const n of ["Mel Ott", "Vernon Wells", "Jackie Robinson", "Frank Thomas"]) { await clickByText(n); await new Promise((r) => setTimeout(r, 60)); }
    await clickByText("Submit");
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: resolve("/tmp/teammates-flash.png") as `${string}.png`, fullPage: true });
    console.log("/tmp/teammates-flash.png");
    await page.evaluate(() => { const d = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Deselect") as HTMLButtonElement | undefined; d?.click(); });
    await new Promise((r) => setTimeout(r, 200));

    for (const g of groups) {
      for (const name of g) { await clickByText(name); await new Promise((r) => setTimeout(r, 60)); }
      await new Promise((r) => setTimeout(r, 120));
      await clickByText("Submit");
      await new Promise((r) => setTimeout(r, 700)); // band animation
    }
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: resolve("/tmp/teammates-won.png") as `${string}.png`, fullPage: true });
    console.log("/tmp/teammates-won.png");

    // Expand the Brooklyn Dodgers accordion band to reveal its player cards.
    await page.evaluate(() => {
      const band = [...document.querySelectorAll(".tm-band")].find((b) => b.textContent?.includes("Chicago White Sox")) as HTMLElement | undefined;
      band?.click();
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: resolve("/tmp/teammates-cards-nyy.png") as `${string}.png`, fullPage: true });
    console.log("/tmp/teammates-cards-nyy.png");
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
