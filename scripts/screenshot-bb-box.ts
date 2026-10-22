// Render an NBA/WNBA email digest and screenshot just the first box-score
// table at phone width (400px) to eyeball starters/bench ordering, the
// FG/TO columns, and overall fit. Usage:
//   npx tsx --env-file=.env.local scripts/screenshot-bb-box.ts nba 2026-10-21
import puppeteer from "puppeteer-core";
import { loadNbaData } from "@/lib/nba";
import { loadWnbaData } from "@/lib/wnba";
import { renderBasketballEmailContent, BASKETBALL_EMAIL_STYLES } from "@/lib/render-basketball";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  const sport = process.argv[2] === "wnba" ? "wnba" : "nba";
  const date = process.argv[3]!;
  const data = sport === "nba" ? await loadNbaData(date) : await loadWnbaData(date);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#f7f4ec;font-family:'Source Sans 3',Arial,sans-serif;color:#161410;}
    .wrap{max-width:400px;margin:0 auto;padding:12px;}
    ${BASKETBALL_EMAIL_STYLES}
  </style></head><body><div class="wrap">${renderBasketballEmailContent(data)}</div></body></html>`;

  const b = await puppeteer.launch({ executablePath: CHROME, headless: true,
    defaultViewport: { width: 400, height: 1200, deviceScaleFactor: 2 } });
  const p = await b.newPage();
  await p.setContent(html, { waitUntil: "load" });
  const el = await p.$(".bb-box");
  if (!el) { console.error("no .bb-box found"); await b.close(); process.exit(1); }
  const out = `/tmp/digest-qa/bb-box-${sport}-${date}.png`;
  await el.screenshot({ path: out });
  console.log("wrote", out);
  await b.close();
}
main();
