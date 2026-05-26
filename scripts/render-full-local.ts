import puppeteer from "puppeteer-core";
import { writeFile } from "node:fs/promises";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    defaultViewport: { width: 1280, height: 1024, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  await page.goto("https://boxscore.email/mlb/2026-05-26", { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForFunction(() => (document as any).fonts?.ready ?? Promise.resolve());
  await new Promise((r) => setTimeout(r, 300));

  await page.addStyleTag({
    content: `.site-header, .site-footer { display: none !important; }`,
  });

  // Dedup pass mirroring lib/render-images.ts
  const diag = await page.evaluate(`
    (function() {
      var nps = document.querySelectorAll(".newspaper");
      var dls = document.querySelectorAll(".dateline");
      var bcs = document.querySelectorAll(".boxscores-container");
      var nnd = document.querySelectorAll(".no-next-day");
      return { newspapers: nps.length, datelines: dls.length, boxscoresContainers: bcs.length, noNextDays: nnd.length };
    })()
  `);
  console.log("DOM landmarks:", JSON.stringify(diag));

  const newspaper = await page.$(".newspaper");
  if (!newspaper) { console.error("no newspaper"); process.exit(1); }
  const box = await newspaper.boundingBox();
  console.log("newspaper box:", box);

  const png = (await newspaper.screenshot({ type: "png" })) as Uint8Array;
  await writeFile("/tmp/local-full.png", Buffer.from(png));
  console.log(`wrote /tmp/local-full.png, ${png.length} bytes`);
  console.log(`dimensions from PNG header: ${Buffer.from(png).readUInt32BE(16)} x ${Buffer.from(png).readUInt32BE(20)}`);
  await browser.close();
}
main();
