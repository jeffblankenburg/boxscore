// Screenshot the /mlb/transactions page from the running dev server.
// Captures the MLB-default view and (optionally) one team view.
//
// Usage:
//   npx tsx scripts/screenshot-transaction.ts [out]

import puppeteer from "puppeteer-core";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const CHROME = process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.DEV_BASE_URL ?? "http://localhost:3001";

async function shot(url: string, out: string) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1440, height: 2000, deviceScaleFactor: 2 },
  });
  try {
    const page = await browser.newPage();
    await page.goto(ORIGIN + url, { waitUntil: "networkidle0", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: out as `${string}.png`, fullPage: true });
    console.log(out);
  } finally {
    await browser.close();
  }
}

async function main() {
  const outArg = process.argv[2] ?? "/tmp/transactions-mlb.png";
  const out = resolve(outArg);
  await mkdir(resolve(out, ".."), { recursive: true });
  await shot("/mlb/transactions", out);
  await shot("/mlb/transactions?team=lad", resolve("/tmp/transactions-lad.png"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
