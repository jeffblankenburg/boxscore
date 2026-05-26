// Render share-images from a live boxscore.email page using a headless browser.
//
// Works in two environments:
//   - Local dev: puppeteer-core driving a system-installed Chrome
//   - Vercel:    puppeteer-core driving @sparticuz/chromium-min (Lambda-optimized
//                Chromium downloaded from a CDN at cold-start)
//
// Same entry point — `renderShareImages()` — used by the cron route, the
// admin "regenerate" action, and the local screenshot script.

import { existsSync } from "node:fs";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { nextDay, prettyDate } from "./dates";

export type ManifestEntry =
  | { file: string; subId: string; type: "standings"; league: "AL" | "NL" }
  | { file: string; subId: string; type: "leaders"; league: "AL" | "NL" }
  | { file: string; subId: string; type: "boxscore"; title: string; teams: [string, string] }
  | { file: string; subId: string; type: "full"; gameCount: number };

export type ImageMime = "image/png" | "image/jpeg";

export type RenderedImage = {
  entry: ManifestEntry;
  // Image bytes. Format is given by `mime` — historically PNG for per-section
  // images; the full-day capture is JPEG to fit Bluesky's 1MB cap.
  png: Uint8Array;
  mime: ImageMime;
  width: number;   // physical pixels
  height: number;  // physical pixels
};

// Must match the installed version of @sparticuz/chromium-min. The `pack.x64`
// asset is the x86_64 Linux binary that Vercel functions need.
// When bumping the npm package, update this constant to match.
const SPARTICUZ_VERSION = "147.0.0";
const SPARTICUZ_CHROMIUM_URL =
  `https://github.com/Sparticuz/chromium/releases/download/v${SPARTICUZ_VERSION}/chromium-v${SPARTICUZ_VERSION}-pack.x64.tar`;

function isServerless(): boolean {
  // Vercel sets VERCEL_ENV; AWS Lambda sets AWS_LAMBDA_FUNCTION_NAME.
  return !!(process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function findLocalChrome(): string {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : process.platform === "win32"
        ? [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ];
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(
    `No Chrome/Chromium found on this machine. Install Chrome or set CHROME_PATH.`,
  );
}

async function launchBrowser(): Promise<Browser> {
  if (isServerless()) {
    const mod = await import("@sparticuz/chromium-min");
    const chromium = mod.default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(SPARTICUZ_CHROMIUM_URL),
      headless: true,
      defaultViewport: { width: 1280, height: 1024, deviceScaleFactor: 2 },
    });
  }
  const executablePath = process.env.CHROME_PATH ?? findLocalChrome();
  return puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1280, height: 1024, deviceScaleFactor: 2 },
  });
}

const SHARE_CSS = `
  .column-container { flex-direction: column !important; gap: 0 !important; }
  .leaders-cols { column-count: 1 !important; }
  .games-grid { grid-template-columns: 1fr !important; }
  .boxscores-container { column-count: 1 !important; }

  .col-standings {
    max-width: 540px !important; width: 540px !important;
    margin: 0 auto !important; padding: 18px 20px !important;
    background: #fff !important; box-sizing: border-box !important;
  }
  .col-leaders {
    max-width: 360px !important; width: 360px !important;
    margin: 0 auto !important; padding: 18px 20px !important;
    background: #fff !important; box-sizing: border-box !important;
  }
  .game-container {
    max-width: 540px; width: 540px;
    margin: 0 auto 18px; padding: 18px 20px;
    background: #fff; box-sizing: border-box;
  }

  .share-header {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 10px; margin-bottom: 0 !important;
    border-bottom: 1px solid #c4baa5;
    font-family: 'Source Sans 3', Helvetica, Arial, sans-serif;
  }
  .share-header .brand-cell { display: flex; align-items: center; gap: 8px; }
  .share-header .brand-cell img { width: 22px; height: 22px; border-radius: 4px; display: block; }
  .share-header .brand { font-size: 14px; font-weight: 800; letter-spacing: -0.01em; color: #161410; }
  .share-header .brand .dot { color: #6a6354; }
  .share-header .share-date { font-size: 13px; font-style: italic; color: #6a6354; }

  .col-standings .boxscores-title,
  .col-leaders .boxscores-title,
  .game-container .game-header {
    margin: 0 !important;
    padding: 14px 0 !important;
  }
`;

async function injectShareChrome(page: Page, dateStr: string): Promise<void> {
  await page.addStyleTag({ content: SHARE_CSS });
  await page.evaluate((d: string) => {
    const FOOTER_HTML = "";
    void FOOTER_HTML;
    const HEADER_HTML = `
      <div class="share-header">
        <div class="brand-cell">
          <img src="/icon.png" alt="">
          <span class="brand">boxscore</span>
        </div>
        <div class="share-date">${d}</div>
      </div>`;
    const standings = Array.from(document.querySelectorAll(".col-standings"));
    standings.forEach((el, i) => {
      const league = i === 0 ? "American League" : "National League";
      const title = el.querySelector(".boxscores-title");
      if (title) title.textContent = `${league} Standings`;
      el.insertAdjacentHTML("afterbegin", HEADER_HTML);
    });
    const leaders = Array.from(document.querySelectorAll(".col-leaders"));
    leaders.forEach((el, i) => {
      const league = i === 0 ? "American League" : "National League";
      const title = el.querySelector(".boxscores-title");
      if (title) title.textContent = `${league} Leaders`;
      el.insertAdjacentHTML("afterbegin", HEADER_HTML);
    });
    const games = Array.from(document.querySelectorAll(".game-container"));
    games.forEach((el) => el.insertAdjacentHTML("afterbegin", HEADER_HTML));
  }, dateStr);
}

export async function renderShareImages(args: {
  date: string;
  baseUrl: string; // e.g. "https://boxscore.email" or "http://localhost:3001"
}): Promise<RenderedImage[]> {
  const { date, baseUrl } = args;
  // Caller passes games_date; the public page now lives at edition_date.
  const url = `${baseUrl}/mlb/${nextDay(date)}`;
  const dateStr = prettyDate(date);

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
    await injectShareChrome(page, dateStr);
    await page.waitForFunction(() => document.fonts?.ready ?? Promise.resolve());
    await new Promise((r) => setTimeout(r, 200));

    const results: RenderedImage[] = [];

    const standings = await page.$$(".col-standings");
    const leaders = await page.$$(".col-leaders");
    const games = await page.$$(".game-container");

    const captures: Array<{ handle: typeof standings[0]; entry: ManifestEntry }> = [];

    if (standings[0]) {
      captures.push({ handle: standings[0], entry: { file: "al-standings.png", subId: "al-standings", type: "standings", league: "AL" } });
    }
    if (leaders[0]) {
      captures.push({ handle: leaders[0], entry: { file: "al-leaders.png", subId: "al-leaders", type: "leaders", league: "AL" } });
    }
    if (standings[1]) {
      captures.push({ handle: standings[1], entry: { file: "nl-standings.png", subId: "nl-standings", type: "standings", league: "NL" } });
    }
    if (leaders[1]) {
      captures.push({ handle: leaders[1], entry: { file: "nl-leaders.png", subId: "nl-leaders", type: "leaders", league: "NL" } });
    }

    for (let i = 0; i < games.length; i++) {
      const game = games[i]!;
      const headerEl = await game.$(".game-header");
      // The header may contain `.nick-full` + `.nick-short` span pairs that
      // CSS swaps for paper mode (e.g. "Diamondbacks" vs "D-Backs"). Strip
      // the short forms before reading text so social posts and image
      // captions only carry the full nickname.
      const text = headerEl
        ? (await headerEl.evaluate((el) => {
            const clone = el.cloneNode(true) as HTMLElement;
            clone.querySelectorAll(".nick-short").forEach((n) => n.remove());
            return clone.textContent ?? "";
          })) || ""
        : "";
      const titleOnly = text.split(" · ")[0]?.trim() ?? text.trim();
      const m = titleOnly.match(/^(.+?)\s+\d+,\s+(.+?)\s+\d+$/);
      const teams: [string, string] = m
        ? [m[1]!.trim(), m[2]!.trim()]
        : ["", ""];
      const seq = String(i + 1).padStart(2, "0");
      captures.push({
        handle: game,
        entry: {
          file: `boxscore-${seq}.png`,
          subId: `boxscore-${seq}`,
          type: "boxscore",
          title: titleOnly,
          teams,
        },
      });
    }

    for (const { handle, entry } of captures) {
      await handle.scrollIntoView();
      const png = (await handle.screenshot({ type: "png" })) as Uint8Array;
      const box = await handle.boundingBox();
      // boundingBox is CSS px; physical pixels = CSS × deviceScaleFactor (=2 here).
      const width = box ? Math.round(box.width * 2) : 0;
      const height = box ? Math.round(box.height * 2) : 0;
      results.push({ entry, png, mime: "image/png", width, height });
    }

    // Full-day capture. Posted as the LEAD image — the goal is the tall,
    // crop-with-tap-to-expand preview on Twitter/Bluesky that hooks scrollers
    // by showing "all of today's box scores in one shot."
    //
    // Format: PNG. Text-on-white compresses extremely well via DEFLATE — a
    // 600×~8000 digest is typically a few hundred KB, well under Bluesky's
    // 1MB cap. JPEG would shave a bit more but introduces blocking artifacts
    // around glyph edges that defeat the dense-data-readable point of the
    // image. Twitter's 8192px dimension cap is the real constraint; 1x DPR
    // at 600px wide keeps us inside it for the typical 15-game day.
    //
    // The capture targets the whole document at 1x DPR after hiding the
    // site-header/footer chrome so only the digest content lands in the
    // image. Reusing the same page also means the share-CSS column layout
    // already injected stays in effect.
    const fullImage = await captureFullDigest(page, games.length);
    if (fullImage) {
      // Prepend so it's the first thing posted, before any per-section follow-ups.
      results.unshift(fullImage);
    }

    return results;
  } finally {
    await browser.close();
  }
}

const FULL_CAPTURE_WIDTH = 600;       // CSS px; matches the 540px share blocks + a little breathing room

async function captureFullDigest(page: Page, gameCount: number): Promise<RenderedImage | null> {
  // Hide the site header/footer that wrap the digest body — they're not part
  // of the data and would only add chrome noise to the share image.
  await page.addStyleTag({
    content: `
      .site-header, .site-footer { display: none !important; }
      body, .newspaper { background: #fff !important; }
    `,
  });
  // Drop to 1x DPR and snap viewport width so the captured page is tight
  // around the centered 540px column. Triggers a relayout; small wait lets
  // the column-flex reflow settle before screenshotting.
  await page.setViewport({
    width: FULL_CAPTURE_WIDTH,
    height: 1024,
    deviceScaleFactor: 1,
  });
  await page.waitForFunction(() => document.fonts?.ready ?? Promise.resolve());
  await new Promise((r) => setTimeout(r, 300));

  const dims = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  const png = (await page.screenshot({
    fullPage: true,
    type: "png",
  })) as Uint8Array;

  return {
    entry: { file: "full.png", subId: "full", type: "full", gameCount },
    png,
    mime: "image/png",
    width: dims.width,
    height: dims.height,
  };
}
