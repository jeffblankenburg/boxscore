// Screenshot the /subscribe email-validation UX: rejects an invalid TLD
// (foo@bar.con) with a generic error, accepts any valid address. Verifies the
// client field added after the 2026-09-29 Resend batch incident.
// Usage: npx tsx scripts/screenshot-subscribe-validate.ts [width]

import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.DEV_BASE_URL ?? "http://localhost:3210";

async function main() {
  const width = Number(process.argv[2] ?? 400);
  await mkdir("/tmp/sub", { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    defaultViewport: { width, height: 700, deviceScaleFactor: 2 },
  });
  try {
    const page = await browser.newPage();
    await page.goto(ORIGIN + "/subscribe", { waitUntil: "networkidle0", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.type('input[name="email"]', "jepf@gmall.con");
    await page.evaluate(() => (document.querySelector('input[name="email"]') as HTMLInputElement)?.blur());
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "/tmp/sub/subscribe-invalid-tld.png" });
    console.log("captured invalid-TLD rejection");
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
