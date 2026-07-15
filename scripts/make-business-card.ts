// One-off: render the FRONT of a boxscore business card to PNG.
// Logo (public/icon.png) + wordmark + tagline + QR to the subscribe page.
// Standard US card is 3.5in x 2in; we render at 600 DPI with a 1/8in bleed
// so it's print-ready. Uses the same system-Chrome + puppeteer-core path the
// share-image renderer uses.
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import puppeteer from "puppeteer-core";

// QR points at the tracked redirect (/r/qr), NOT /subscribe directly, so every
// scan is logged in qr_scans and the resulting signup is tagged utm_source=qr.
// The printed URL under the wordmark stays the clean /subscribe for humans who
// type it. `src` is the campaign label — bump it per print run / event.
const QR_SRC = "sabr-2026";
const SUBSCRIBE_URL = `https://boxscore.email/r/qr?src=${QR_SRC}`;
const DPI = 600;
const BLEED_IN = 0.125;
const CARD_W_IN = 3.5 + BLEED_IN * 2; // 3.75 with bleed
const CARD_H_IN = 2.0 + BLEED_IN * 2; // 2.25 with bleed
const W = Math.round(CARD_W_IN * DPI);
const H = Math.round(CARD_H_IN * DPI);

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean) as string[];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("No Chrome found; set CHROME_PATH");
}

async function main() {
  const logoPath = path.join(process.cwd(), "public", "icon.png");
  const logoB64 = fs.readFileSync(logoPath).toString("base64");
  const logoSrc = `data:image/png;base64,${logoB64}`;

  // Crisp black QR on white with generous quiet zone. High EC so it still
  // scans if the print smudges slightly.
  const qrSvg = await QRCode.toString(SUBSCRIBE_URL, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });

  const html = `<!doctype html><html><head><meta charset="utf-8">
  <!-- Same webfont the site masthead uses (app/globals.css:1). -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap" rel="stylesheet">
  <style>
    @page { margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html,body { width:${W}px; height:${H}px; overflow:hidden; }
    body {
      display:flex; align-items:center; gap:${Math.round(0.28 * DPI)}px;
      background:#ffffff; color:#0a0a0a;
      font-family: 'Source Sans 3', 'Segoe UI', Helvetica, Arial, sans-serif;
      padding: ${Math.round(0.3 * DPI)}px ${Math.round(0.34 * DPI)}px;
    }
    .left { flex:1 1 auto; display:flex; flex-direction:column; justify-content:center; height:100%; min-width:0; }
    .brandrow { display:flex; align-items:center; gap:${Math.round(0.1 * DPI)}px; }
    .logo { width:${Math.round(0.46 * DPI)}px; height:${Math.round(0.46 * DPI)}px; display:block; flex:0 0 auto; }
    /* Matches .site-header .brand: Source Sans 3, weight 800, -0.01em. */
    .wordmark { font-size:${Math.round(0.34 * DPI)}px; font-weight:800; letter-spacing:-0.01em; line-height:1; }
    .tagline { margin-top:${Math.round(0.14 * DPI)}px; font-size:${Math.round(0.12 * DPI)}px; font-weight:500; color:#444; letter-spacing:0.01em; white-space:nowrap; }
    .url { margin-top:${Math.round(0.3 * DPI)}px; font-size:${Math.round(0.15 * DPI)}px; font-weight:700; letter-spacing:0.005em; }
    .right { flex:0 0 auto; display:flex; flex-direction:column; align-items:center; }
    .qr { width:${Math.round(0.92 * DPI)}px; height:${Math.round(0.92 * DPI)}px; }
    .qr svg { width:100%; height:100%; display:block; }
    .scan { margin-top:${Math.round(0.08 * DPI)}px; font-size:${Math.round(0.1 * DPI)}px; font-weight:600; color:#444; letter-spacing:0.04em; text-transform:uppercase; text-align:center; }
  </style></head>
  <body>
    <div class="left">
      <div class="brandrow">
        <img class="logo" src="${logoSrc}" />
        <div class="wordmark">boxscore</div>
      </div>
      <div class="tagline">the sports page for your inbox</div>
      <div class="url">boxscore.email/subscribe</div>
    </div>
    <div class="right">
      <div class="qr">${qrSvg}</div>
      <div class="scan">scan to subscribe</div>
    </div>
  </body></html>`;

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--force-device-scale-factor=1"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  // Ensure the Source Sans 3 webfont is actually painted, not fallback.
  await page.evaluate(() => (document as any).fonts.ready);
  const out = path.join(process.cwd(), "business-card-front.png");
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: H } });
  await browser.close();

  console.log(`Wrote ${out}`);
  console.log(`  ${W}x${H}px @ ${DPI}dpi  (${CARD_W_IN}in x ${CARD_H_IN}in incl. ${BLEED_IN}in bleed)`);
  console.log(`  QR target: ${SUBSCRIBE_URL}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
