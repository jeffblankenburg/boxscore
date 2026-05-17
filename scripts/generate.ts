import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadDailyData } from "../lib/daily";
import { renderContent } from "../lib/render";
import { yesterdayInET, ISO_DATE_RE } from "../lib/dates";
import { BRAND } from "../lib/brand";

async function main() {
  const date = process.argv[2] ?? yesterdayInET();
  if (!ISO_DATE_RE.test(date)) {
    console.error(`Bad date: ${date}. Use YYYY-MM-DD.`);
    process.exit(1);
  }
  console.log(`Generating boxscore for ${date}...`);

  const data = await loadDailyData(date);
  console.log(`  ${data.games.length} games`);

  const content = renderContent(data);
  const css = await readFile(resolve("app/globals.css"), "utf8");

  const social = BRAND.social
    .map((s) => `<a href="${s.href}">${s.label}</a>`)
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>boxscore — ${data.prettyDate}</title>
<style>${css}</style>
</head>
<body>
<div class="newspaper">
<header class="site-header">
  <div class="brand"><a href="/">boxscore</a></div>
  <nav class="social">${social}</nav>
  <a class="subscribe" href="${BRAND.subscribeUrl}">Subscribe →</a>
</header>
${content}
<footer class="site-footer">
  <a href="/">${BRAND.name}</a> · ${BRAND.tagline}
</footer>
</div>
</body>
</html>`;

  const outDir = resolve("out");
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, `${date}.html`);
  await writeFile(outFile, html);
  console.log(`Wrote ${outFile} (${(html.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
