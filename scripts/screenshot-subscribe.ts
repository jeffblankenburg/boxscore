// Screenshot the logged-in predictions checkout: plan chooser, then the
// Payment Element after selecting a plan. Mints a real session for <email>
// (must be a subscriber WITHOUT active access so the plans render).
// Usage: npx tsx --env-file=.env.local scripts/screenshot-subscribe.ts <email> [width]

import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import { findByEmail } from "@/lib/subscribers";
import { createSession, SUBSCRIBER_SESSION_COOKIE } from "@/lib/subscriber-auth";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.DEV_BASE_URL ?? "http://localhost:3000";

async function main() {
  const email = process.argv[2];
  const width = Number(process.argv[3] ?? 400);
  if (!email) { console.error("usage: <email> [width]"); process.exit(1); }
  const sub = await findByEmail(email);
  if (!sub) { console.error(`no subscriber for ${email}`); process.exit(1); }
  const { token } = await createSession({ subscriberId: sub.id });
  await mkdir("/tmp/sub", { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    defaultViewport: { width, height: 900, deviceScaleFactor: 2 },
  });
  try {
    const page = await browser.newPage();
    await page.setCookie({ name: SUBSCRIBER_SESSION_COOKIE, value: token, domain: "localhost", path: "/" });
    await page.goto(ORIGIN + "/mlb/predictions/subscribe", { waitUntil: "networkidle0", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: "/tmp/sub/1-plans.png" });
    console.log("captured plan chooser");

    // Select the weekly plan → mounts the Payment Element (real incomplete sub).
    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button.sub-plan"))
        .find((b) => /Weekly/.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!clicked) { console.log("no weekly button found"); return; }
    // Wait for the Stripe Payment Element iframe to appear + settle.
    await page.waitForSelector('iframe[name^="__privateStripeFrame"]', { timeout: 30_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3500));
    await page.screenshot({ path: "/tmp/sub/2-payment.png", fullPage: true });
    console.log("captured payment element");
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
