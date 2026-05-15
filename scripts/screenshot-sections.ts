import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

// Captures share-sized PNGs of each major section of the daily digest by
// loading the live web page in a headless browser. Same HTML/CSS/fonts as
// the website, so the images look pixel-identical to what visitors see.

const BRAND_FOOTER_CSS = `
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
  font-weight: 600;
  font-size: 12px;
  color: #6a6354;
  text-align: center;
  padding: 14px 0 4px;
  letter-spacing: 0.02em;
`;

async function main() {
  const date = process.argv[2] ?? "2026-05-14";
  const sport = "mlb";
  const url = `http://localhost:3001/${sport}/${date}`;
  const outDir = resolve("out/share", date);
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1024 },
    deviceScaleFactor: 2, // sharper @2x output
  });

  console.log(`Loading ${url} ...`);
  await page.goto(url, { waitUntil: "networkidle" });

  // Force single-column layout so each section gets a usable share size
  // (the default 4-column boxscores grid would screenshot at ~290px each).
  await page.addStyleTag({
    content: `
      .boxscores-container { column-count: 1 !important; max-width: 640px; margin: 0 auto !important; }
      .column-container { flex-direction: column !important; gap: 0 !important; }
      .col-standings, .col-leaders { width: 100% !important; }
      .leaders-cols { column-count: 1 !important; }
      .games-grid { grid-template-columns: 1fr !important; }
    `,
  });

  // Append a "boxscore.email" footer to each capturable section so each
  // screenshot includes the brand without any post-processing.
  await page.evaluate((css) => {
    const sel = ".col-standings, .col-leaders, .game-container";
    document.querySelectorAll(sel).forEach((el) => {
      const f = document.createElement("div");
      f.style.cssText = css;
      f.textContent = "boxscore.email";
      el.appendChild(f);
    });
  }, BRAND_FOOTER_CSS);

  // Wait for layout to settle after CSS injection
  await page.waitForTimeout(300);

  const standings = await page.locator(".col-standings").all();
  const leaders = await page.locator(".col-leaders").all();
  const games = await page.locator(".game-container").all();

  const shots: Array<{ locator: typeof standings[0]; file: string }> = [];
  if (standings[0]) shots.push({ locator: standings[0], file: "al-standings.png" });
  if (leaders[0]) shots.push({ locator: leaders[0], file: "al-leaders.png" });
  if (standings[1]) shots.push({ locator: standings[1], file: "nl-standings.png" });
  if (leaders[1]) shots.push({ locator: leaders[1], file: "nl-leaders.png" });
  for (let i = 0; i < games.length; i++) {
    shots.push({
      locator: games[i]!,
      file: `boxscore-${String(i + 1).padStart(2, "0")}.png`,
    });
  }

  for (const { locator, file } of shots) {
    await locator.scrollIntoViewIfNeeded();
    await locator.screenshot({ path: resolve(outDir, file) });
    console.log(`  ${file}`);
  }

  console.log(`\nWrote ${shots.length} images to ${outDir}`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
