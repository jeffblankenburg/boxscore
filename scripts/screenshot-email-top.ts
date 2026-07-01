import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 640, height: 900, deviceScaleFactor: 2 }});
  const p = await b.newPage();
  await p.goto("file:///tmp/email-sample.html", { waitUntil: "networkidle0", timeout: 30000 });
  await p.evaluate(() => document.fonts.ready);
  // Only capture the top region — the utility row + logo row + a bit of body
  await p.screenshot({ path: "/tmp/email-top.png", clip: { x: 0, y: 0, width: 640, height: 220 } });
  await b.close();
  console.log("wrote /tmp/email-top.png");
})();
