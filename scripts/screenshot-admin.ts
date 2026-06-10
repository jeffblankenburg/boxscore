// Screenshot an admin page from the running dev server. Used by Claude as
// part of the post-UI-change workflow so visual regressions get caught
// before they ship — see memory feedback_screenshot_ui_changes.md.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/screenshot-admin.ts <path> [out]
//
// Examples:
//   npx tsx --env-file=.env.local scripts/screenshot-admin.ts /admin/mlb
//   npx tsx --env-file=.env.local scripts/screenshot-admin.ts /admin/historical /tmp/historical.png
//   npx tsx --env-file=.env.local scripts/screenshot-admin.ts /admin/historical/67524 /tmp/larsen.png
//
// Seeds an admin session via createSession(ADMIN_EMAIL) directly against
// the same Supabase the dev server reads, then sets the session cookie
// on puppeteer and captures a full-page PNG.

import puppeteer from "puppeteer-core";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { createSession, ADMIN_SESSION_COOKIE } from "../lib/admin-auth";

const CHROME = process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Boxscore's dev server runs on 3001 (Jeff's machine has another Next app
// on 3000). Set DEV_BASE_URL to override.
const ORIGIN = process.env.DEV_BASE_URL ?? "http://localhost:3001";

async function main() {
  const path = process.argv[2] ?? "/admin/mlb";
  const outArg = process.argv[3] ?? `/tmp/admin${path.replace(/\//g, "-")}.png`;
  const outPath = resolve(outArg);
  await mkdir(resolve(outPath, ".."), { recursive: true });

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) throw new Error("ADMIN_EMAIL env var required");

  // Seed admin session in the same Supabase the dev server is reading.
  const { token } = await createSession(adminEmail);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1440, height: 2000, deviceScaleFactor: 2 },
  });

  try {
    const page = await browser.newPage();
    // Cookie must be set BEFORE navigating to a protected route.
    await page.setCookie({
      name: ADMIN_SESSION_COOKIE,
      value: token,
      domain: new URL(ORIGIN).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    });
    await page.goto(ORIGIN + path, { waitUntil: "networkidle0", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);

    await page.screenshot({ path: outPath as `${string}.png`, fullPage: true });
    console.log(outPath);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
