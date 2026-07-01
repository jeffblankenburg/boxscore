import puppeteer from "puppeteer-core";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const CHROME = process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.DEV_BASE_URL ?? "http://localhost:3001";

async function main() {
  const outArg = process.argv[2] ?? "/tmp/predictions.png";
  const outPath = resolve(outArg);
  await mkdir(resolve(outPath, ".."), { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1100, height: 1800, deviceScaleFactor: 2 },
  });
  try {
    const page = await browser.newPage();
    await page.goto(ORIGIN + "/mlb/predictions", { waitUntil: "networkidle0", timeout: 120_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: outPath, fullPage: true });
    console.log("wrote", outPath);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
