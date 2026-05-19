// Production before/after screenshot tool. Captures the live boxscore-six
// page (= "before", current production rendering with figure-space padding),
// then rewrites every .team-score DOM element into the new grid markup and
// injects the new CSS for a second pass (= "after"). Same live data on both
// passes — true apples-to-apples without needing the PR branch deployed.
//
// Writes to docs/screenshots/alignment-fix/ and overwrites whatever's there.
//
// Run: node_modules/.bin/tsx scripts/screenshot-live.ts

import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const LIVE = "https://boxscore-six.vercel.app/mlb";

function findLocalChrome(): string {
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

function slug(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

async function main() {
  const outDir = resolve("docs/screenshots/alignment-fix");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? findLocalChrome(),
    headless: true,
    defaultViewport: { width: 1280, height: 2400, deviceScaleFactor: 2 },
  });

  try {
    const page = await browser.newPage();
    await page.goto(LIVE, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);

    // Collect game labels in DOM order so before/after filenames match.
    const labels: string[] = await page.evaluate(() => {
      const games = Array.from(document.querySelectorAll(".game-container"));
      return games.map((g) => g.querySelector(".game-header")?.textContent?.trim() ?? "game");
    });

    // BEFORE: production as-is.
    const grid = await page.$(".boxscores-container");
    if (grid) {
      await grid.screenshot({ path: resolve(outDir, "grid-before.png") as `${string}.png` });
      console.log("  grid-before.png");
    }
    const gamesBefore = await page.$$(".game-container");
    for (let i = 0; i < gamesBefore.length; i++) {
      const name = `${String(i + 1).padStart(2, "0")}-${slug(labels[i] ?? "game")}`;
      await gamesBefore[i].screenshot({ path: resolve(outDir, `${name}-before.png`) as `${string}.png` });
      console.log(`  ${name}-before.png`);
    }

    // Transform every .team-score on the page into the new grid structure,
    // mirroring the logic in lib/render.ts.
    await page.evaluate(() => {
      document.querySelectorAll(".team-score").forEach((el) => {
        const text = (el.textContent ?? "").trim();
        const parts = text.split(/\s+—\s+/);
        if (parts.length < 2) return;
        const inningsPart = parts[0];
        const rhePart = parts.slice(1).join(" — ");

        const innTokens = (inningsPart.match(/\d+|x/g) ?? []);
        const rheTokens = (rhePart.match(/\d+|—/g) ?? []).slice(0, 3);

        const bigInning = innTokens.some((t) => t.length >= 2);
        const hasExtras = innTokens.length > 9;

        const padTo = Math.max(9, Math.ceil(innTokens.length / 3) * 3);
        while (innTokens.length < padTo) innTokens.push("");

        let html = "";
        for (let i = 0; i < innTokens.length; i += 3) {
          html += '<span class="inn-grp">';
          for (let j = 0; j < 3; j++) {
            html += `<span class="inn">${innTokens[i + j] ?? ""}</span>`;
          }
          html += "</span>";
        }
        html += '<span class="sep">—</span>';
        html += '<span class="rhe-grp">';
        for (const t of rheTokens) {
          html += `<span class="rhe">${t}</span>`;
        }
        html += "</span>";

        el.innerHTML = html;
        if (bigInning) el.classList.add("bigInning");
        if (hasExtras) el.classList.add("has-extras");
      });
    });

    // Override the live site's .team-score CSS with the new grid layout.
    // !important is needed because production's stylesheet is already loaded
    // with the old rules; we need to override in-place rather than replace.
    await page.addStyleTag({
      content: `
        .team-line .team-score {
          flex: 0 0 auto !important;
          display: grid !important;
          grid-auto-flow: column !important;
          align-items: baseline !important;
          column-gap: 1ch !important;
          white-space: normal !important;
          letter-spacing: 0 !important;
        }
        .team-line .team-score .inn-grp {
          display: grid;
          grid-template-columns: repeat(3, 1ch);
          column-gap: 0.35ch;
        }
        .team-line .team-score.bigInning .inn-grp {
          grid-template-columns: repeat(3, 2ch);
        }
        .team-line .team-score .inn { text-align: right; }
        .team-line .team-score .sep { padding: 0; }
        .team-line .team-score .rhe-grp {
          display: grid;
          grid-auto-flow: column;
          column-gap: 0.4ch;
        }
        .team-line .team-score .rhe {
          min-width: 2ch;
          text-align: right;
        }
      `,
    });

    // Re-acquire handles since DOM mutations may have invalidated the old ones.
    const gridAfter = await page.$(".boxscores-container");
    if (gridAfter) {
      await gridAfter.screenshot({ path: resolve(outDir, "grid-after.png") as `${string}.png` });
      console.log("  grid-after.png");
    }
    const gamesAfter = await page.$$(".game-container");
    for (let i = 0; i < gamesAfter.length; i++) {
      const name = `${String(i + 1).padStart(2, "0")}-${slug(labels[i] ?? "game")}`;
      await gamesAfter[i].screenshot({ path: resolve(outDir, `${name}-after.png`) as `${string}.png` });
      console.log(`  ${name}-after.png`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
