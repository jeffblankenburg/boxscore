// Render smoke: fetch a real day, adapt, render the web digest body, and
// write a full standalone HTML doc to /tmp so it can be screenshotted. No
// DB, no email shell — just the football renderer + globals.css so we can
// eyeball the layout before wiring it into the site.
//
//   npx tsx scripts/football-render-smoke.ts nfl 2025-09-07
//   npx tsx scripts/football-render-smoke.ts ncaaf 2025-09-06

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { footballLeagueConfig, seasonForDate } from "../lib/sports/football/leagues";
import { fetchFootballRaw } from "../lib/sports/football/sources/espn";
import { adaptEspnFootball } from "../lib/sports/football/adapters/from-espn";
import { renderFootballContent } from "../lib/sports/football/render/digest";
import type { FootballLeague } from "../lib/sports/football/types";

async function main() {
  const league = (process.argv[2] as FootballLeague) || "nfl";
  const date = process.argv[3] || "2025-09-07";
  const cfg = footballLeagueConfig(league);

  const raw = await fetchFootballRaw(cfg, date, seasonForDate(date));
  const bundle = adaptEspnFootball(cfg, raw);
  const body = renderFootballContent(bundle);

  const globalsCss = await readFile(join(process.cwd(), "app", "globals.css"), "utf-8");
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap">
<style>${globalsCss}</style>
<style>body{margin:0;background:#f3efe5;} .newspaper{max-width:${process.argv[4] ?? "680"}px;margin:0 auto;padding:24px;background:#fbf9f3;}</style>
</head><body><div class="newspaper">${body}</div></body></html>`;

  const out = `/tmp/football-${league}-${date}.html`;
  await writeFile(out, html, "utf-8");
  console.log(`games=${bundle.games.length} boxes=${bundle.boxScores.size} → ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
