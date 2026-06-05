// Diagnostic-only: mints an admin session, points headless Chrome at the
// local /admin/followers page, and saves a screenshot. Lets me actually see
// the page so the bio/header/sort visuals can be verified end-to-end instead
// of trusting CSS math. Drop this file once we're done iterating.
//
// Run: tsx --env-file=.env.local scripts/screenshot-followers.ts [path]

import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { createSession, ADMIN_SESSION_COOKIE, getAdminEmails } from "../lib/admin-auth";

function findLocalChrome(): string {
  return process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

async function main() {
  const targetPath = process.argv[2] ?? "/admin/followers";
  const outPath = resolve(`/tmp/followers${targetPath.replace(/\//g, "_")}.png`);
  const port = process.env.PORT ?? "3001";
  const url = `http://localhost:${port}${targetPath}`;

  const admins = await getAdminEmails();
  const admin = admins[0];
  if (!admin) throw new Error("No admin emails configured");
  const { token } = await createSession(admin);
  console.log(`Minted session for ${admin}`);

  const browser = await puppeteer.launch({
    executablePath: findLocalChrome(),
    headless: true,
    defaultViewport: { width: 1400, height: 1800, deviceScaleFactor: 1 },
  });
  try {
    const page = await browser.newPage();
    // Set the admin cookie before any navigation so requireAdmin() sees it.
    await page.setCookie({
      name: ADMIN_SESSION_COOKIE,
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
    });
    await page.goto(url, { waitUntil: "networkidle0", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    // Viewport-only by default — full-page on a 2k-row table produces a
    // postage-stamp preview. Pass FULL_PAGE=1 to override.
    await page.screenshot({
      path: outPath as `${string}.png`,
      fullPage: process.env.FULL_PAGE === "1",
    });
    console.log(`Wrote ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
