// Special screenshot helper for the side-by-side preview. Plain
// networkidle0 fires before nested iframes finish painting, so we
// explicitly poll each iframe's contentDocument.body until it has
// material content before snapping.

import puppeteer from "puppeteer-core";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { createSession, ADMIN_SESSION_COOKIE } from "../lib/admin-auth";

const CHROME = process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.DEV_BASE_URL ?? "http://localhost:3001";

async function main() {
  const path = process.argv[2];
  const outArg = process.argv[3];
  if (!path || !outArg) {
    console.error("usage: screenshot-sxs.ts <path> <out.png>");
    process.exit(1);
  }
  const outPath = resolve(outArg);
  await mkdir(resolve(outPath, ".."), { recursive: true });

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) throw new Error("ADMIN_EMAIL env var required");
  const { token } = await createSession(adminEmail);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 2200, height: 2000, deviceScaleFactor: 2 },
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
    await page.goto(ORIGIN + path, { waitUntil: "networkidle0", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);

    // Wait until both iframes' bodies have meaningful content. Caps at
    // 30s so this doesn't hang forever if a frame route errors out.
    await page.waitForFunction(() => {
      const frames = document.querySelectorAll("iframe");
      if (frames.length < 2) return false;
      for (const f of Array.from(frames)) {
        const doc = (f as HTMLIFrameElement).contentDocument;
        if (!doc || !doc.body || doc.body.innerHTML.trim().length < 200) return false;
      }
      return true;
    }, { timeout: 30_000 });
    // Small extra settle so layout reflows finish.
    await new Promise((r) => setTimeout(r, 800));

    await page.screenshot({ path: outPath as `${string}.png`, fullPage: true });
    console.log(outPath);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
