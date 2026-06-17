// Verify the sxs scroll-sync wiring actually mirrors between the two
// iframes. Loads the page, waits for both frames to populate, scrolls
// the left iframe, polls the right iframe's scrollY until it matches
// (or 3s timeout), then does the reverse. Exits non-zero on mismatch.

import puppeteer from "puppeteer-core";
import { createSession, ADMIN_SESSION_COOKIE } from "../lib/admin-auth";

const CHROME = process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.DEV_BASE_URL ?? "http://localhost:3001";
const URL_PATH = process.argv[2] ?? "/admin/preview/canonical/2026-06-15/sxs";

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) throw new Error("ADMIN_EMAIL env var required");
  const { token } = await createSession(adminEmail);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1800, height: 1000, deviceScaleFactor: 1 },
  });
  try {
    const page = await browser.newPage();
    await page.setCookie({
      name: ADMIN_SESSION_COOKIE,
      value: token,
      domain: new URL(ORIGIN).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    });
    await page.goto(ORIGIN + URL_PATH, { waitUntil: "networkidle0", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);

    // Wait until both iframes have material content before exercising.
    await page.waitForFunction(() => {
      const left  = document.getElementById("cx-sxs-left")  as HTMLIFrameElement | null;
      const right = document.getElementById("cx-sxs-right") as HTMLIFrameElement | null;
      if (!left || !right) return false;
      const lDoc = left.contentDocument;
      const rDoc = right.contentDocument;
      return Boolean(lDoc && rDoc && lDoc.body && rDoc.body
        && lDoc.body.innerHTML.trim().length > 200
        && rDoc.body.innerHTML.trim().length > 200);
    }, { timeout: 30_000 });

    type ProbeResult = { left: number; right: number };

    const exercise = async (driver: "left" | "right", target: number): Promise<ProbeResult> => {
      await page.evaluate((side, y) => {
        const id = side === "left" ? "cx-sxs-left" : "cx-sxs-right";
        const frame = document.getElementById(id) as HTMLIFrameElement;
        frame.contentWindow?.scrollTo({ top: y, left: 0, behavior: "auto" });
      }, driver, target);
      // Allow the follower's scroll handler to chain through.
      await new Promise((r) => setTimeout(r, 300));
      return page.evaluate(() => {
        const left  = document.getElementById("cx-sxs-left")  as HTMLIFrameElement;
        const right = document.getElementById("cx-sxs-right") as HTMLIFrameElement;
        return {
          left:  left.contentWindow?.scrollY  ?? -1,
          right: right.contentWindow?.scrollY ?? -1,
        };
      });
    };

    const tolerance = 4; // pixels — browser rounding
    const checks: Array<{ name: string; result: ProbeResult; expected: number }> = [];

    let r = await exercise("left", 500);
    checks.push({ name: "left → 500 mirrors right",  result: r, expected: 500 });
    r = await exercise("right", 1200);
    checks.push({ name: "right → 1200 mirrors left", result: r, expected: 1200 });
    r = await exercise("left", 0);
    checks.push({ name: "left → 0 mirrors right",    result: r, expected: 0 });

    let ok = true;
    for (const c of checks) {
      const lDelta = Math.abs(c.result.left  - c.expected);
      const rDelta = Math.abs(c.result.right - c.expected);
      const passed = lDelta <= tolerance && rDelta <= tolerance;
      console.log(`${passed ? "✓" : "✗"} ${c.name.padEnd(36)} L=${c.result.left} R=${c.result.right} (expected ~${c.expected})`);
      if (!passed) ok = false;
    }
    if (!ok) process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
