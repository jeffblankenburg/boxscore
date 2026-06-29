// Quarterly advertising sales report — single-page PDF.
// Stats are STATIC (frozen at quarter print) so the PDF can be shared
// repeatedly without changing under prospects. Refresh once per quarter:
// run scripts/_compute-static-stats.ts, copy the new numbers into the
// QUARTERLY_STATS object below, bump the title to the next quarter.
//
// Run: npx tsx --env-file=.env.local scripts/render-ad-onepager.ts
// Output: docs/boxscore-ad-onepager.pdf

import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { QUARTERLY_STATS } from "../lib/quarterly-stats";

const CHROME_PATH = process.env.CHROME_PATH
  ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const TEAM_NAMES: Record<string, string> = {
  nyy: "Yankees", min: "Twins", bos: "Red Sox", chc: "Cubs", cin: "Reds",
  lad: "Dodgers", stl: "Cardinals", atl: "Braves", phi: "Phillies", nym: "Mets",
  cle: "Guardians", mil: "Brewers", sea: "Mariners", bal: "Orioles",
  tor: "Blue Jays", pit: "Pirates", was: "Nationals", wsh: "Nationals",
  det: "Tigers", tex: "Rangers", hou: "Astros", sfg: "Giants", sf: "Giants",
  sd: "Padres", oak: "Athletics", ath: "Athletics", col: "Rockies",
  ari: "D-backs", mia: "Marlins", tb: "Rays", kc: "Royals", laa: "Angels",
  cws: "White Sox", chw: "White Sox",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

async function buildHtml(): Promise<string> {
  const Q = QUARTERLY_STATS;

  const iconPath = join(process.cwd(), "public", "icon.png");
  const iconBuf = await readFile(iconPath);
  const iconDataUri = `data:image/png;base64,${iconBuf.toString("base64")}`;

  const teamRows = Q.topTeams.map(([slug, count]) => {
    const name = TEAM_NAMES[slug.toLowerCase()] ?? slug.toUpperCase();
    return `<div class="team-row"><span class="team-name">${name}</span><span class="team-n">${count}</span></div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>boxscore — Advertising One-Sheet</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap" rel="stylesheet">
<style>
  /* Letter-size, print-tight, newspaper aesthetic. */
  @page { size: 8.5in 11in; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: 8.5in; height: 11in;
    background: #fdfaf2;
    color: #1c1a14;
    font-family: 'Source Sans 3', 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.4;
    padding: 0.5in 0.55in;
  }
  .sheet { width: 100%; height: 100%; display: flex; flex-direction: column; }

  /* ── Masthead ── matches the boxscore.email site header anatomy: */
  /*    icon.png 28x28 + "boxscore" wordmark in Source Sans 3 weight 800. */
  .masthead {
    border-top: 3px solid #1c1a14;
    border-bottom: 1px solid #1c1a14;
    padding: 10px 0 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  /* Site header anatomy: 28px icon + 18px wordmark — icon is ~1.56×
     the wordmark font-size. Mirror that ratio at print scale. */
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 12px;
  }
  .brand img {
    width: 56px;
    height: 56px;
    border-radius: 6px;
    display: block;
  }
  .brand .wordmark {
    font-family: 'Source Sans 3', 'Segoe UI', Helvetica, Arial, sans-serif;
    font-weight: 800;
    font-size: 32pt;
    line-height: 1;
    letter-spacing: -0.025em;
  }
  .dateline {
    font-family: 'Source Sans 3', -apple-system, sans-serif;
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    text-align: right;
    color: #4a4438;
  }
  .dateline .pub { font-weight: 800; color: #1c1a14; }
  .submast {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #c8bea6;
    font-family: 'Source Sans 3', sans-serif;
    font-size: 10pt;
    line-height: 1;
  }
  .tagline { font-style: italic; color: #4a4438; }
  .vol { font-size: 8.5pt; color: #7a7160; letter-spacing: 0.06em; text-transform: uppercase; }

  /* ── Lead ── */
  .lead {
    padding: 14px 0 12px;
    border-bottom: 1px solid #c8bea6;
  }
  .lead-head {
    font-family: 'Source Sans 3', sans-serif;
    font-size: 9pt;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #1c1a14;
    margin-bottom: 4px;
  }
  .lead-body { font-size: 11.5pt; line-height: 1.45; }
  .lead-body em { font-style: italic; }
  .lead-body strong { font-weight: 700; }

  /* ── Stat grid ── */
  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    padding: 14px 0;
    border-bottom: 1px solid #c8bea6;
  }
  .stat {
    border-left: 2px solid #1c1a14;
    padding: 2px 0 2px 10px;
  }
  .stat-value {
    font-family: 'JetBrains Mono', 'Menlo', ui-monospace, monospace;
    font-weight: 800;
    font-size: 22pt;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .stat-label {
    font-family: 'Source Sans 3', sans-serif;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #4a4438;
    margin-top: 4px;
  }
  .stat-sub {
    font-family: 'Source Sans 3', sans-serif;
    font-size: 8pt;
    color: #7a7160;
    margin-top: 2px;
    line-height: 1.3;
  }

  /* ── Two columns ── */
  .row { display: grid; grid-template-columns: 1.15fr 1fr; gap: 18px; padding: 14px 0; border-bottom: 1px solid #c8bea6; }
  .col h3 {
    font-family: 'Source Sans 3', sans-serif;
    font-size: 9pt;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin: 0 0 8px 0;
    padding-bottom: 4px;
    border-bottom: 1px solid #1c1a14;
  }
  .col p { margin: 0 0 6px 0; font-size: 10.5pt; line-height: 1.45; }
  .col .muted { color: #7a7160; }
  .caveat {
    font-family: 'Source Sans 3', sans-serif;
    font-size: 8pt;
    color: #7a7160;
    font-style: italic;
    margin-top: 4px;
  }

  /* ── Team list ── */
  .team-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 14px;
    row-gap: 1px;
  }
  .team-row {
    display: flex;
    justify-content: space-between;
    font-family: 'Source Sans 3', sans-serif;
    font-size: 9.5pt;
    padding: 1px 0;
    border-bottom: 1px dotted #c8bea6;
  }
  .team-name { font-weight: 600; }
  .team-n { font-family: 'JetBrains Mono', monospace; color: #4a4438; }

  /* ── What you get + Expected results ── */
  .formats {
    padding: 14px 0;
    border-bottom: 1px solid #c8bea6;
  }
  .formats h3 {
    font-family: 'Source Sans 3', sans-serif;
    font-size: 9pt;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin: 0 0 8px 0;
    padding-bottom: 4px;
    border-bottom: 1px solid #1c1a14;
  }
  .formats-row {
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    gap: 18px;
  }
  .get-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .get-list li {
    font-size: 10.5pt;
    line-height: 1.45;
    padding: 4px 0 4px 14px;
    border-bottom: 1px dotted #c8bea6;
    position: relative;
  }
  .get-list li::before {
    content: "▸";
    position: absolute;
    left: 0;
    color: #4a4438;
    font-size: 9pt;
    top: 5px;
  }
  .get-list li:last-child { border-bottom: none; }
  .results-card {
    border: 1px solid #1c1a14;
    background: #fffef9;
    padding: 10px 12px;
  }
  .results-headline {
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #4a4438;
    margin-bottom: 8px;
  }
  .results-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 8px;
  }
  .result-stat {
    border-left: 2px solid #1c1a14;
    padding-left: 8px;
  }
  .result-val {
    font-family: 'JetBrains Mono', 'Menlo', ui-monospace, monospace;
    font-weight: 800;
    font-size: 18pt;
    line-height: 1;
    letter-spacing: -0.015em;
  }
  .result-lab {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #4a4438;
    margin-top: 3px;
  }
  .results-note {
    font-size: 8.5pt;
    color: #4a4438;
    line-height: 1.4;
    font-style: italic;
    border-top: 1px dotted #c8bea6;
    padding-top: 6px;
  }

  /* ── Footer — single column, centered ── */
  .footer {
    margin-top: auto;
    padding-top: 14px;
    border-top: 3px solid #1c1a14;
    text-align: center;
    font-family: 'Source Sans 3', sans-serif;
    font-size: 10pt;
  }
  .footer .url {
    font-weight: 800;
    color: #1c1a14;
    text-decoration: none;
    display: block;
    font-size: 12pt;
    letter-spacing: -0.005em;
    margin-bottom: 6px;
  }
  .footer .contact {
    color: #2a2620;
    font-size: 10pt;
    line-height: 1.4;
  }
  .footer .contact a { color: inherit; text-decoration: none; }
</style>
</head>
<body>
<div class="sheet">

  <div class="masthead">
    <div class="brand">
      <img src="${iconDataUri}" alt="">
      <span class="wordmark">boxscore</span>
    </div>
    <div class="dateline">
      <div class="pub">${Q.reportTitle}</div>
    </div>
  </div>
  <div class="submast">
    <div class="tagline">"the sports page for your inbox"</div>
    <div class="vol">Free, by email · ad-supported</div>
  </div>

  <div class="lead">
    <div class="lead-head">What it is</div>
    <div class="lead-body">
      A daily email of MLB box scores, standings, and league leaders. The sports page of a newspaper,
      delivered to your inbox before coffee. <strong>Free, ad-supported,</strong> read every morning
      by self-selected sports fans who opted in. The look is <em>quiet, text-only, no banners</em>. Tasteful classifieds and sponsor lines that fit the page instead of fighting it.
    </div>
  </div>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">${fmt(Q.totalSubscribers)}</div>
      <div class="stat-label">Subscribers</div>
      <div class="stat-sub">opted-in, every morning</div>
    </div>
    <div class="stat">
      <div class="stat-value">${Q.openRate.toFixed(1)}%</div>
      <div class="stat-label">Open Rate</div>
      <div class="stat-sub">industry avg 15–25%</div>
    </div>
    <div class="stat">
      <div class="stat-value">${fmt(Q.sendsLast30d)}</div>
      <div class="stat-label">Sends · Last 30d</div>
      <div class="stat-sub">99%+ delivery</div>
    </div>
    <div class="stat">
      <div class="stat-value">+${fmt(Q.netGrowthLast30d)}</div>
      <div class="stat-label">Net Growth · Last 30d</div>
      <div class="stat-sub">new readers every week</div>
    </div>
  </div>

  <div class="row">
    <div class="col">
      <h3>Who reads it</h3>
      <p>Self-selected sports fans. The kind who used to flip straight to the sports page in the newspaper. They
      opted in. They open it daily. Nobody is here by accident.</p>
      <p><strong>Geography:</strong> ~90% U.S., spread across 24+ states.</p>
      <p><strong>Demographics:</strong><br>
      ${Q.demographicsAgeOver35}% of readers are over age 35.<br>
      ${Q.demographicsIncomeOver100k}% earn $100k+ per year.<br>
      ${Q.demographicsMen}% are men.</p>
    </div>
    <div class="col">
      <h3>Team digests · top opt-ins</h3>
      <p style="margin-bottom:10px;">In addition to the MLB digest, subscribers can opt into individual team digests: a focused
      list of that team's fans <em>wherever they live</em>. ${fmt(Q.teamOptinTotal)} total opt-ins across all 30 MLB teams.</p>
      <div class="team-grid">${teamRows}</div>
    </div>
  </div>

  <div class="formats">
    <div class="formats-row">
      <div class="formats-left">
        <h3>What you get</h3>
        <ul class="get-list">
          <li><strong>Daily exposure</strong> to ${fmt(Q.totalSubscribers)}+ opted-in MLB fans, every morning of the season.</li>
          <li><strong>A custom-designed ad</strong> in the newspaper aesthetic: text-first, never a flashing banner. Fits the page.</li>
          <li><strong>Clickable link</strong> to your site, embedded in the email and the web edition.</li>
          <li><strong>A live mockup</strong> of your ad slotted into a real boxscore edition. You can review before you commit a dollar.</li>
          <li><strong>No long contract</strong>. Start with a one-week or one-month trial.</li>
        </ul>
      </div>
      <div class="formats-right">
        <h3>Expected results</h3>
        <div class="results-card">
          <div class="results-headline">From a recent 5-day sponsor-line trial</div>
          <div class="results-grid">
            <div class="result-stat">
              <div class="result-val">5,000+</div>
              <div class="result-lab">impressions / day</div>
            </div>
            <div class="result-stat">
              <div class="result-val">100+</div>
              <div class="result-lab">clicks / day</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="footer">
    <a class="url" href="https://boxscore.email/advertise">boxscore.email/advertise</a>
    <div class="contact">
      <a href="https://linkedin.com/in/jeffblankenburg" target="_blank" rel="noopener">Jeff Blankenburg</a>
      &nbsp;·&nbsp;
      <a href="mailto:jeff@boxscore.email">jeff@boxscore.email</a>
      &nbsp;·&nbsp;
      614-327-5066
    </div>
  </div>

</div>
</body>
</html>`;
}

async function main() {
  console.log(`Rendering ${QUARTERLY_STATS.reportTitle}…`);
  console.log(`  ${fmt(QUARTERLY_STATS.totalSubscribers)} subscribers · ${QUARTERLY_STATS.openRate.toFixed(1)}% open · ${fmt(QUARTERLY_STATS.sendsLast30d)} sends/30d`);

  // Write into the project's docs/ folder next to the playbook — easy
  // to find, easy to email. Build artifact (PDF) is gitignored; the
  // intermediate HTML stays in /tmp.
  const html = await buildHtml();
  const htmlPath = "/tmp/boxscore-ad-onepager.html";
  const pdfPath  = join(process.cwd(), "docs", "boxscore-ad-onepager.pdf");
  await writeFile(htmlPath, html);
  console.log(`Wrote ${htmlPath}`);

  console.log("Launching Chrome…");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });
  await page.pdf({
    path: pdfPath,
    format: "Letter",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    preferCSSPageSize: true,
  });
  await browser.close();
  console.log(`Wrote ${pdfPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
