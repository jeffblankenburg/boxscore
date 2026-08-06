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
import { BRAND } from "./brand";

export type ManifestEntry =
  | { file: string; subId: string; type: "standings"; league: "AL" | "NL" }
  | { file: string; subId: string; type: "leaders"; league: "AL" | "NL" }
  | { file: string; subId: string; type: "boxscore"; title: string; teams: [string, string] }
  | { file: string; subId: string; type: "full"; gameCount: number }
  | { file: string; subId: string; type: "scoreboard"; gameCount: number };

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
    // DPR=1 in serverless: @sparticuz/chromium-min has been observed painting
    // the page TWICE into the canvas when deviceScaleFactor=2 (the .newspaper
    // boundingBox matches local, the DOM has exactly one of every marker, but
    // the resulting PNG shows the digest twice). Same code at DPR=1 with
    // system Chrome locally produces a single digest. Drop DPR to 1 here to
    // dodge the bug — image is half-resolution but still 1280 CSS px wide so
    // text remains legible.
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(SPARTICUZ_CHROMIUM_URL),
      headless: true,
      defaultViewport: { width: 1280, height: 1024, deviceScaleFactor: 1 },
    });
  }
  const executablePath = process.env.CHROME_PATH ?? findLocalChrome();
  return puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1280, height: 1024, deviceScaleFactor: 2 },
  });
}

// Per-sport share config. MLB is the original; nba/wnba/nfl/ncaaf reuse the
// same capture machinery with a different game-block selector, title parsing,
// box width, and footer URL. Only MLB emits standings/leaders/full-digest
// images — the other sports ship a scoreboard plus one image per game.
type BoxParse = { title: string; teams: [string, string] };

export type SportShareSpec = {
  sport: string;
  // Element selector for a single game's box-score block.
  gameSelector: string;
  // Selector (within the game element) whose text is the box title.
  gameTitleSelector: string;
  // Sub-selectors removed from the title element before reading its text
  // (paper-mode short nicknames for MLB, the "Upset" badge for football).
  stripFromTitle: string[];
  // Turn the cleaned title text into a display title + [away/loser, home/winner].
  parseTitle: (text: string) => BoxParse;
  // Multi-column container to flatten to one column so each game block stays
  // intact for element capture (null when the layout is already single-column).
  boxContainerSelector: string | null;
  // Box element width in CSS px in the share layout.
  boxWidth: number;
  // MLB-only sections.
  standingsAndLeaders: boolean;
  fullDigest: boolean;
};

// MLB game header text is "Winner 5, Loser 3" (winner first), optionally with a
// " · " detail tail. Strip the tail, then pull the two team nicknames.
function parseMlbTitle(text: string): BoxParse {
  const titleOnly = text.split(" · ")[0]?.trim() ?? text.trim();
  const m = titleOnly.match(/^(.+?)\s+\d+,\s+(.+?)\s+\d+$/);
  const teams: [string, string] = m ? [m[1]!.trim(), m[2]!.trim()] : ["", ""];
  return { title: titleOnly, teams };
}

// Basketball/football matchup text reads "Away @ Home" (nicknames), no score.
function parseAtMatchup(text: string): BoxParse {
  const titleOnly = text.replace(/\s+/g, " ").trim();
  const parts = titleOnly.split(" @ ");
  const teams: [string, string] =
    parts.length === 2 ? [parts[0]!.trim(), parts[1]!.trim()] : ["", ""];
  return { title: titleOnly, teams };
}

const SPORT_SHARE_SPECS: Record<string, SportShareSpec> = {
  mlb: {
    sport: "mlb",
    gameSelector: ".game-container",
    gameTitleSelector: ".game-header",
    stripFromTitle: [".nick-short"],
    parseTitle: parseMlbTitle,
    boxContainerSelector: ".boxscores-container",
    boxWidth: 540,
    standingsAndLeaders: true,
    fullDigest: true,
  },
  nba: {
    sport: "nba",
    gameSelector: ".bb-game",
    gameTitleSelector: ".bb-game-matchup",
    stripFromTitle: [],
    parseTitle: parseAtMatchup,
    boxContainerSelector: ".bb-boxscores",
    boxWidth: 640,
    standingsAndLeaders: false,
    fullDigest: false,
  },
  wnba: {
    sport: "wnba",
    gameSelector: ".bb-game",
    gameTitleSelector: ".bb-game-matchup",
    stripFromTitle: [],
    parseTitle: parseAtMatchup,
    boxContainerSelector: ".bb-boxscores",
    boxWidth: 640,
    standingsAndLeaders: false,
    fullDigest: false,
  },
  nfl: {
    sport: "nfl",
    gameSelector: ".fb-game",
    gameTitleSelector: ".fb-game-matchup",
    stripFromTitle: [".fb-upset"],
    parseTitle: parseAtMatchup,
    boxContainerSelector: ".fb-boxscores",
    boxWidth: 680,
    standingsAndLeaders: false,
    fullDigest: false,
  },
  ncaaf: {
    sport: "ncaaf",
    gameSelector: ".fb-game",
    gameTitleSelector: ".fb-game-matchup",
    stripFromTitle: [".fb-upset"],
    parseTitle: parseAtMatchup,
    boxContainerSelector: ".fb-boxscores",
    boxWidth: 680,
    standingsAndLeaders: false,
    fullDigest: false,
  },
};

function shareSpecFor(sport: string): SportShareSpec {
  const spec = SPORT_SHARE_SPECS[sport];
  if (!spec) throw new Error(`renderShareImages: unsupported sport "${sport}"`);
  return spec;
}

// Shared brand+date header / tagline+URL footer styling for every per-section
// share image, plus the box-block chrome for the given sport.
function shareCssFor(spec: SportShareSpec): string {
  const chrome = `
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

  /* Footer for per-section share images. Stacked vertically (tagline above
     URL) because the narrowest column (MLB leaders, 360 CSS px) can't fit the
     space-between layout used on the wide scoreboard image without wrapping. */
  .share-footer {
    display: flex; flex-direction: column; align-items: center;
    padding-top: 10px; margin-top: 12px !important;
    border-top: 1px solid #c4baa5;
    font-family: 'Source Sans 3', Helvetica, Arial, sans-serif;
    text-align: center;
  }
  .share-footer .tagline { font-size: 13px; font-style: italic; color: #6a6354; margin-bottom: 4px; }
  .share-footer .url { font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700; color: #161410; }
  `;

  // MLB flattens its two-up standings/leaders and three-column boxscores into a
  // single column, and fixes column widths. Kept verbatim from the original.
  const mlb = `
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
  .col-standings .boxscores-title,
  .col-leaders .boxscores-title { margin: 0 !important; padding: 14px 0 !important; }
  `;

  // Every sport: flatten the box container to one column so each game block is
  // captured intact, then give the game block a fixed width, white background,
  // and padding.
  const boxes = `
  ${spec.boxContainerSelector ? `${spec.boxContainerSelector} { column-count: 1 !important; }` : ""}
  ${spec.gameSelector} {
    max-width: ${spec.boxWidth}px; width: ${spec.boxWidth}px;
    margin: 0 auto 18px; padding: 18px 20px;
    background: #fff; box-sizing: border-box;
  }
  ${spec.gameSelector} ${spec.gameTitleSelector} { margin: 0 !important; padding: 14px 0 !important; }
  `;

  return `${chrome}\n${spec.standingsAndLeaders ? mlb : ""}\n${boxes}`;
}

async function injectShareChrome(
  page: Page,
  spec: SportShareSpec,
  editionDateStr: string,
  gamesDateStr: string,
  tagline: string,
): Promise<void> {
  await page.addStyleTag({ content: shareCssFor(spec) });
  await page.evaluate(
    (args: {
      edition: string;
      games: string;
      tagline: string;
      sport: string;
      gameSelector: string;
      standingsAndLeaders: boolean;
    }) => {
      const header = (d: string) => `
        <div class="share-header">
          <div class="brand-cell">
            <img src="/icon.png" alt="">
            <span class="brand">boxscore</span>
          </div>
          <div class="share-date">${d}</div>
        </div>`;
      const footer = `
        <div class="share-footer">
          <div class="tagline">${args.tagline}</div>
          <div class="url">boxscore.email/${args.sport}</div>
        </div>`;
      if (args.standingsAndLeaders) {
        // MLB only. Standings + leaders are a snapshot of the morning the
        // digest ships, so they get stamped with the edition date.
        const standings = Array.from(document.querySelectorAll(".col-standings"));
        standings.forEach((el, i) => {
          const league = i === 0 ? "American League" : "National League";
          const title = el.querySelector(".boxscores-title");
          if (title) title.textContent = `${league} Standings`;
          el.insertAdjacentHTML("afterbegin", header(args.edition));
          el.insertAdjacentHTML("beforeend", footer);
        });
        const leaders = Array.from(document.querySelectorAll(".col-leaders"));
        leaders.forEach((el, i) => {
          const league = i === 0 ? "American League" : "National League";
          const title = el.querySelector(".boxscores-title");
          if (title) title.textContent = `${league} Leaders`;
          el.insertAdjacentHTML("afterbegin", header(args.edition));
          el.insertAdjacentHTML("beforeend", footer);
        });
      }
      // Box scores describe one game played on a specific day, so they get
      // stamped with the games date — not the day the digest happens to ship.
      const games = Array.from(document.querySelectorAll(args.gameSelector));
      games.forEach((el) => {
        el.insertAdjacentHTML("afterbegin", header(args.games));
        el.insertAdjacentHTML("beforeend", footer);
      });
    },
    {
      edition: editionDateStr,
      games: gamesDateStr,
      tagline,
      sport: spec.sport,
      gameSelector: spec.gameSelector,
      standingsAndLeaders: spec.standingsAndLeaders,
    },
  );
}

// Capture the scoreboard share-image using an already-launched browser.
// Used by both the single-shot renderScoreboardShareImage (which boots its
// own browser) and renderShareImages (which reuses the same browser to
// capture multiple images per cron invocation).
async function captureScoreboardOnBrowser(
  browser: Browser,
  args: { sport: string; editionDate: string; baseUrl: string; conf?: string },
): Promise<{ png: Uint8Array; width: number; height: number; gameCount: number }> {
  // MLB serves its own /share/mlb/[date] page; every other sport uses the
  // generic /share/[sport]/[date] canvas, with NCAAF taking an optional
  // ?conf=<slug> for its per-conference boards.
  const query = args.conf ? `?conf=${encodeURIComponent(args.conf)}` : "";
  const url = `${args.baseUrl}/share/${args.sport}/${args.editionDate}${query}`;
  const page = await browser.newPage();
  try {
    await page.evaluateOnNewDocument(
      "globalThis.__name = globalThis.__name || (function(fn){ return fn; });",
    );
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: "networkidle0", timeout: 60_000 });
    await ensureFontsLoaded(page);
    await new Promise((r) => setTimeout(r, 200));

    // Count rendered game tiles for use in social-post captions ("15 games")
    // and the manifest entry. Marker attribute set on each <Tile> in
    // lib/scoreboard-image.tsx.
    const gameCount = await page.$$eval(
      "[data-share-tile]",
      (els) => els.length,
    );

    const buffer = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });
    const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
    return {
      png: new Uint8Array(buffer),
      width: 1200 * dpr,
      height: 630 * dpr,
      gameCount,
    };
  } finally {
    await page.close();
  }
}

// Force the Source Sans 3 webfont fully loaded before a screenshot. The app
// serves the font via an @import in globals.css that does NOT reliably
// register in document.fonts inside the headless render — so
// `document.fonts.ready` can resolve with zero faces and the capture falls
// back to a system font, which renders some glyphs at the wrong size (the
// share-image footer URL was the tell). Inject the stylesheet if it's absent,
// then explicitly load the weights we use and await readiness.
async function ensureFontsLoaded(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const href =
      "https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap";
    if (![...document.styleSheets].some((s) => (s.href || "").includes("fonts.googleapis"))) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
      await new Promise((r) => {
        link.onload = r;
        link.onerror = r;
      });
    }
    const specs = ["400", "italic 400", "600", "700", "800", "900"].map((w) => `${w} 16px 'Source Sans 3'`);
    try {
      await Promise.all(specs.map((s) => document.fonts.load(s)));
    } catch {
      /* best-effort */
    }
    await document.fonts.ready;
  });
}

// Render a single DOM element on `url` (matched by `selector`) to a PNG.
// Reuses the shared browser launch (system Chrome locally, @sparticuz/
// chromium-min on Vercel). Used by the /mlb/art image route to turn any
// historical game's card into a downloadable share image on demand.
export async function renderElementPng(args: {
  url: string;
  selector: string;
}): Promise<Uint8Array> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    try {
      await page.evaluateOnNewDocument(
        "globalThis.__name = globalThis.__name || (function(fn){ return fn; });",
      );
      await page.goto(args.url, { waitUntil: "networkidle0", timeout: 60_000 });
      await ensureFontsLoaded(page);
      // Strip anything that could overlap the element capture: app chrome and
      // — when generated against a dev server — the Next.js dev-indicator
      // badge (fixed bottom-left; bleeds into a tall card as a black
      // half-circle). No-op in production, where neither is present.
      await page.evaluate(() => {
        const s = document.createElement("style");
        s.textContent =
          ".site-header,.site-footer,.paper-toggle{display:none!important}nextjs-portal{display:none!important}";
        document.head.appendChild(s);
        document.querySelectorAll("nextjs-portal").forEach((e) => e.remove());
      });
      await new Promise((r) => setTimeout(r, 200));
      const el = await page.$(args.selector);
      if (!el) throw new Error(`renderElementPng: no element for ${args.selector}`);
      const buffer = await el.screenshot({ type: "png" });
      return new Uint8Array(buffer);
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

// Render the 1200×630 scoreboard share-image — the OG-image for
// /mlb/[editionDate] link previews and the lead image on the daily Twitter,
// Bluesky, and Facebook posts. Single-shot version (boots + closes its own
// browser); inside renderShareImages, captureScoreboardOnBrowser is used
// directly to share one launch across multiple captures.
export async function renderScoreboardShareImage(args: {
  editionDate: string;
  baseUrl: string;
  sport?: string;
  conf?: string;
}): Promise<{ png: Uint8Array; width: number; height: number }> {
  const browser = await launchBrowser();
  try {
    const { png, width, height } = await captureScoreboardOnBrowser(browser, {
      sport: args.sport ?? "mlb",
      editionDate: args.editionDate,
      baseUrl: args.baseUrl,
      conf: args.conf,
    });
    return { png, width, height };
  } finally {
    await browser.close();
  }
}

export async function renderShareImages(args: {
  date: string;
  baseUrl: string; // e.g. "https://boxscore.email" or "http://localhost:3001"
  sport?: string;  // defaults to "mlb"
}): Promise<RenderedImage[]> {
  const { date, baseUrl } = args;
  const spec = shareSpecFor(args.sport ?? "mlb");
  // Caller passes games_date; the public page now lives at edition_date.
  const url = `${baseUrl}/${spec.sport}/${nextDay(date)}`;
  // Per-section captures use two different date stamps:
  //   - standings + leaders: edition date (a "this morning" snapshot)
  //   - box scores: games date (anchored to when the game was actually played)
  // The full-day capture stays on edition date — it's the whole digest, not
  // a single game.
  const editionDateStr = prettyDate(nextDay(date));
  const gamesDateStr = prettyDate(date);

  const browser = await launchBrowser();
  try {
    const results: RenderedImage[] = [];

    // FIRST capture: the 1200×630 scoreboard share-image from /share/mlb/[date].
    // Goes at index 0 so the post-* crons (which loop and post one image per
    // platform call) put the scoreboard at the top of the daily Twitter,
    // Bluesky, and Facebook series. Render failures are caught — losing the
    // scoreboard shouldn't block the rest of the per-section captures.
    try {
      const sb = await captureScoreboardOnBrowser(browser, {
        sport: spec.sport, editionDate: nextDay(date), baseUrl,
      });
      // Skip an empty scoreboard (0 completed games — All-Star break, offseason);
      // a blank grid isn't worth posting to social.
      if (sb.gameCount > 0) {
        results.push({
          entry: {
            file: "scoreboard.png",
            subId: "scoreboard",
            type: "scoreboard",
            gameCount: sb.gameCount,
          },
          png: sb.png,
          mime: "image/png",
          width: sb.width,
          height: sb.height,
        });
      }
    } catch (err) {
      console.error(`scoreboard capture failed: ${(err as Error).message}`);
    }

    const page = await browser.newPage();
    // Stub esbuild's __name helper in the page context. When this lib is
    // imported by a tsx-run script (the share-image backfill, the various
    // dev scripts), esbuild rewrites every arrow function with a __name(fn)
    // wrapper. That helper exists in tsx's runtime but isn't transferred to
    // the puppeteer page, so any page.evaluate call throws "__name is not
    // defined". Defining it as identity here is a no-op for Next.js-compiled
    // callers (whose page.evaluate code never references __name) and a fix
    // for tsx callers. String form is required because if we passed an arrow
    // function here, that arrow function itself would be wrapped in __name.
    await page.evaluateOnNewDocument(
      "globalThis.__name = globalThis.__name || (function(fn){ return fn; });",
    );
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
    await ensureFontsLoaded(page);
    await new Promise((r) => setTimeout(r, 200));

    // Pull the actual device pixel ratio from the page — it's 2 in local
    // Chrome and 1 in @sparticuz/chromium-min on Vercel (see launchBrowser).
    // We use this to convert CSS-px boundingBox dimensions to physical-px
    // dimensions for RenderedImage.width/height so the downstream Bluesky
    // aspectRatio is correct in both environments.
    const dpr = await page.evaluate(() => window.devicePixelRatio || 1);

    // Capture the full-day image FIRST, against the natural web layout —
    // two-up standings/leaders, three-column boxscores. Doing this before
    // injectShareChrome avoids the single-column flattening that the
    // per-section CSS imposes. MLB-only for now: the dedup pass and the
    // header/footer chrome inside captureFullDigest are MLB-specific.
    const gameCount = (await page.$$(spec.gameSelector)).length;
    if (spec.fullDigest) {
      const fullImage = await captureFullDigest(page, editionDateStr, gameCount, dpr);
      if (fullImage) results.push(fullImage);
    }

    // Now flatten the page for per-section captures.
    await injectShareChrome(page, spec, editionDateStr, gamesDateStr, BRAND.tagline);
    await ensureFontsLoaded(page);
    await new Promise((r) => setTimeout(r, 200));

    const games = await page.$$(spec.gameSelector);

    const captures: Array<{ handle: typeof games[0]; entry: ManifestEntry }> = [];

    // Standings + leaders are MLB-only. Other sports ship scoreboard + per-game
    // box scores only.
    if (spec.standingsAndLeaders) {
      const standings = await page.$$(".col-standings");
      const leaders = await page.$$(".col-leaders");
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
    }

    for (let i = 0; i < games.length; i++) {
      const game = games[i]!;
      const headerEl = await game.$(spec.gameTitleSelector);
      // Strip sport-specific noise before reading the title text: MLB's paper-
      // mode short nicknames (`.nick-short`, e.g. "D-Backs" vs "Diamondbacks")
      // and football's "Upset" badge, so captions carry only the matchup.
      const text = headerEl
        ? (await headerEl.evaluate((el, strip: string[]) => {
            const clone = el.cloneNode(true) as HTMLElement;
            for (const sel of strip) clone.querySelectorAll(sel).forEach((n) => n.remove());
            return clone.textContent ?? "";
          }, spec.stripFromTitle)) || ""
        : "";
      const { title: titleOnly, teams } = spec.parseTitle(text);
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
      // boundingBox is CSS px; physical pixels = CSS × deviceScaleFactor (dpr).
      const width = box ? Math.round(box.width * dpr) : 0;
      const height = box ? Math.round(box.height * dpr) : 0;
      results.push({ entry, png, mime: "image/png", width, height });
    }

    return results;
  } finally {
    await browser.close();
  }
}

// Full-day capture. Posted as the LEAD image — the goal is the
// crop-with-tap-to-expand preview on Twitter/Bluesky that hooks scrollers
// by showing "all of today's box scores in one shot", laid out the way the
// website lays them out: AL/NL standings + leaders two-up across the top,
// boxscores in three columns below.
//
// Captures the `.newspaper` wrapper at its natural width (max 1280 CSS px
// per globals.css), with the site header/footer hidden and a single clean
// brand+date header inserted at the top. Format is PNG — text-on-white
// compresses very efficiently via DEFLATE.
//
// Must be called BEFORE injectShareChrome flattens the layout into the
// single-column share format used for per-section images.
async function captureFullDigest(
  page: Page,
  dateStr: string,
  gameCount: number,
  dpr: number,
): Promise<RenderedImage | null> {
  await page.addStyleTag({
    content: `
      .site-header, .site-footer { display: none !important; }
      .newspaper { padding-top: 0 !important; }
      .full-share-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 18px 0 16px;
        margin: 0 0 20px;
        border-bottom: 2px solid #c4baa5;
        font-family: 'Source Sans 3', Helvetica, Arial, sans-serif;
      }
      .full-share-header .brand-cell { display: flex; align-items: center; gap: 10px; }
      .full-share-header .brand-cell img { width: 32px; height: 32px; border-radius: 5px; display: block; }
      .full-share-header .brand { font-size: 22px; font-weight: 800; letter-spacing: -0.01em; color: #161410; }
      .full-share-header .share-date { font-size: 17px; font-style: italic; color: #6a6354; }
      /* Mirror of .full-share-header — tagline + marketing URL at the bottom
         of the digest, hairline rule above instead of below. Matches every
         other share image's footer. */
      .full-share-footer {
        display: flex; align-items: baseline; justify-content: space-between;
        padding: 16px 0 18px;
        margin: 20px 0 0;
        border-top: 2px solid #c4baa5;
        font-family: 'Source Sans 3', Helvetica, Arial, sans-serif;
      }
      .full-share-footer .tagline { font-size: 17px; font-style: italic; color: #6a6354; }
      .full-share-footer .url { font-size: 14px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700; color: #161410; }
    `,
  });
  // Defensive: the rendered DOM has been observed to contain the digest
  // wrapper twice in puppeteer-driven renders (both Vercel chromium-min and
  // local system Chrome when invoked through the renderShareImages path) —
  // most likely an interaction between Next.js streaming RSC hydration and
  // the headless runtime. The duplication doesn't show up in plain `curl` or
  // in a minimal standalone puppeteer test, but it's consistent here.
  //
  // We don't know exactly which level of the tree duplicates, so be aggressive:
  // keep only the FIRST of each known marker (.newspaper, .no-next-day,
  // .dateline, .boxscores-container) and remove the rest, walking up to the
  // .newspaper-level sibling so we drop the whole duplicate block, not just
  // the marker node. Logs what it observed so we can debug if duplication
  // patterns shift in the future.
  const dedupReport = await page.evaluate(() => {
    function keepFirstWithinNewspaper(selector: string): number {
      const newspaper = document.querySelector(".newspaper");
      if (!newspaper) return 0;
      const matches = newspaper.querySelectorAll(selector);
      let removed = 0;
      for (let i = 1; i < matches.length; i++) {
        const start = matches[i];
        if (!start) continue;
        let node: Element | null = start;
        while (node && node.parentElement && node.parentElement !== newspaper) {
          node = node.parentElement;
        }
        if (node && node.parentElement === newspaper) {
          node.remove();
          removed++;
        }
      }
      return removed;
    }

    const newspapers = document.querySelectorAll(".newspaper");
    let removedNewspapers = 0;
    for (let i = 1; i < newspapers.length; i++) {
      newspapers[i]?.remove();
      removedNewspapers++;
    }

    return {
      newspapersBefore: newspapers.length,
      removedNewspapers,
      removedDuplicateDatelineBlocks: keepFirstWithinNewspaper(".dateline"),
      removedDuplicateNoNextDay: keepFirstWithinNewspaper(".no-next-day"),
      removedDuplicateBoxscoresContainer: keepFirstWithinNewspaper(".boxscores-container"),
    };
  });
  console.log(`[captureFullDigest] dedup pre-injection: ${JSON.stringify(dedupReport)}`);

  await page.evaluate(
    (args: { date: string; tagline: string }) => {
      const newspaper = document.querySelector(".newspaper");
      if (!newspaper) return;
      // Remove any pre-existing share-chrome (in case this function ran twice
      // somehow, or a prior injection wasn't cleaned up).
      newspaper.querySelectorAll(".full-share-header").forEach((el) => el.remove());
      newspaper.querySelectorAll(".full-share-footer").forEach((el) => el.remove());
      const header = document.createElement("div");
      header.className = "full-share-header";
      header.innerHTML = `
        <div class="brand-cell">
          <img src="/icon.png" alt="">
          <span class="brand">boxscore</span>
        </div>
        <div class="share-date">${args.date}</div>`;
      newspaper.insertBefore(header, newspaper.firstChild);
      const footer = document.createElement("div");
      footer.className = "full-share-footer";
      footer.innerHTML = `
        <div class="tagline">${args.tagline}</div>
        <div class="url">boxscore.email/mlb</div>`;
      newspaper.appendChild(footer);
    },
    { date: dateStr, tagline: BRAND.tagline },
  );

  await page.waitForFunction(() => document.fonts?.ready ?? Promise.resolve());
  await new Promise((r) => setTimeout(r, 300));

  // Pre-injection dedup found everything clean, but the final image still
  // duplicates — which means the duplicate appears after dedup but before the
  // screenshot, likely during the fonts/timeout wait above. Run a second pass
  // immediately before screenshotting AND clip the capture to a single-digest
  // height ceiling so even if a duplicate slips through, we only capture the
  // top digest. Log what the second pass found so we can confirm the theory.
  const lateDedup = await page.evaluate(() => {
    function keepFirstWithinNewspaper(selector: string): number {
      const newspaper = document.querySelector(".newspaper");
      if (!newspaper) return 0;
      const matches = newspaper.querySelectorAll(selector);
      let removed = 0;
      for (let i = 1; i < matches.length; i++) {
        const start = matches[i];
        if (!start) continue;
        let node: Element | null = start;
        while (node && node.parentElement && node.parentElement !== newspaper) {
          node = node.parentElement;
        }
        if (node && node.parentElement === newspaper) {
          node.remove();
          removed++;
        }
      }
      return removed;
    }
    const newspapers = document.querySelectorAll(".newspaper");
    let removedNewspapers = 0;
    for (let i = 1; i < newspapers.length; i++) {
      newspapers[i]?.remove();
      removedNewspapers++;
    }
    const newspaper = document.querySelector(".newspaper");
    return {
      removedNewspapers,
      removedDuplicateDatelineBlocks: keepFirstWithinNewspaper(".dateline"),
      removedDuplicateNoNextDay: keepFirstWithinNewspaper(".no-next-day"),
      removedDuplicateBoxscoresContainer: keepFirstWithinNewspaper(".boxscores-container"),
      removedDuplicateShareHeader: keepFirstWithinNewspaper(".full-share-header"),
      removedDuplicateShareFooter: keepFirstWithinNewspaper(".full-share-footer"),
      newspaperHeight: newspaper ? (newspaper as HTMLElement).getBoundingClientRect().height : 0,
    };
  });
  console.log(`[captureFullDigest] dedup pre-screenshot: ${JSON.stringify(lateDedup)}`);

  const newspaper = await page.$(".newspaper");
  if (!newspaper) return null;
  const box = await newspaper.boundingBox();
  if (!box) return null;

  // Defensive cap: a single MLB digest is reliably under 8500 CSS px tall
  // (~7700 typical, ~8000 on a 16-game day). If the box reports more than that
  // it's almost certainly because a duplicate digest got appended somewhere we
  // didn't catch — clip to the safe ceiling so only the first digest is in the
  // image. Use page.screenshot with explicit clip so we control coordinates.
  const SINGLE_DIGEST_MAX_HEIGHT = 8500;
  const captureHeight = Math.min(box.height, SINGLE_DIGEST_MAX_HEIGHT);
  console.log(`[captureFullDigest] box.height=${box.height} captureHeight=${captureHeight}`);

  // Encode as JPEG: at our typical ~1280×7700 native pixels with text-on-white
  // content, PNG runs ~2.9MB which exceeds Bluesky's 2MB cap and likely trips
  // Twitter's validation as well. JPEG q=92 drops to ~1.2-1.6MB with barely
  // perceptible artifacts at this DPR. Per-section images stay PNG.
  const bytes = (await page.screenshot({
    type: "jpeg",
    quality: 92,
    clip: { x: box.x, y: box.y, width: box.width, height: captureHeight },
  })) as Uint8Array;
  const width = Math.round(box.width * dpr);
  const height = Math.round(captureHeight * dpr);

  return {
    entry: { file: "full.jpg", subId: "full", type: "full", gameCount },
    png: bytes,
    mime: "image/jpeg",
    width,
    height,
  };
}
