// Walks Linescordle through several states and captures each. Used by
// Claude to self-verify the new hint + reveal flow before declaring
// the change done. See memory feedback_screenshot_ui_changes.

import puppeteer, { type Page } from "puppeteer-core";
import { resolve } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://localhost:3001";
const PATH = "/games/linescordle";

type State = "fresh" | "two-hints" | "win" | "lose";

const VIEWPORTS = [
  { label: "mobile",  width: 390, height: 844 },
  { label: "desktop", width: 1280, height: 1000 },
];

async function tapHint(page: Page, n: number): Promise<void> {
  // The hint buttons disappear as they're taken, so always click the
  // first remaining one n times.
  for (let i = 0; i < n; i++) {
    const btn = await page.$(".linescordle-hint-btn");
    if (!btn) return;
    await btn.click();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
  }
}

async function typeAndSubmit(page: Page, word: string): Promise<void> {
  for (const ch of word) {
    await page.keyboard.press(ch.toUpperCase() as Parameters<Page["keyboard"]["press"]>[0]);
  }
  await page.keyboard.press("Enter");
  await page.evaluate(() => new Promise((r) => setTimeout(r, 60)));
}

async function setUp(state: State, page: Page): Promise<void> {
  await page.goto(ORIGIN + PATH, { waitUntil: "networkidle0", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  if (state === "fresh") return;
  if (state === "two-hints") {
    await tapHint(page, 2);
    return;
  }
  if (state === "win") {
    // Pedro Martinez = 13 letters. Spell it correctly on attempt 1.
    await tapHint(page, 1);                   // take the line score hint so the reveal looks rich
    await typeAndSubmit(page, "PEDROMARTINEZ");
    return;
  }
  if (state === "lose") {
    // Take all three hints so the reveal headline shows "3 hints used."
    await tapHint(page, 3);
    // Six wrong guesses of the same length.
    for (let i = 0; i < 6; i++) await typeAndSubmit(page, "AAAAAAAAAAAAA");
    return;
  }
}

async function shoot(state: State, viewport: { label: string; width: number; height: number }) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: viewport.width, height: viewport.height, deviceScaleFactor: 2 },
  });
  try {
    const page = await browser.newPage();
    await setUp(state, page);
    const out = `/tmp/linescordle-${state}-${viewport.label}.png`;
    await page.screenshot({ path: resolve(out) as `${string}.png`, fullPage: true });
    console.log(out);
  } finally {
    await browser.close();
  }
}

(async () => {
  for (const state of ["fresh", "two-hints", "win", "lose"] as State[]) {
    for (const vp of VIEWPORTS) {
      await shoot(state, vp);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
