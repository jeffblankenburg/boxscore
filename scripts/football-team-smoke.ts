// Render smoke for a football team page: load a real team, render the web
// content, write a standalone HTML doc to /tmp for screenshotting.
//
//   npx tsx --env-file=.env.local scripts/football-team-smoke.ts nfl buf

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadFootballTeamData } from "../lib/sports/football/team-data";
import { renderFootballTeamContent } from "../lib/sports/football/render/team";
import type { FootballLeague } from "../lib/sports/football/types";

async function main() {
  const league = (process.argv[2] as FootballLeague) || "nfl";
  const slug = process.argv[3] || "buf";

  const data = await loadFootballTeamData(league, slug);
  if (!data) throw new Error("no data (unknown team slug?)");
  const body = renderFootballTeamContent(data);

  const globalsCss = await readFile(join(process.cwd(), "app", "globals.css"), "utf-8");
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap">
<style>${globalsCss}</style>
<style>body{margin:0;background:#f3efe5;} .newspaper{max-width:${process.argv[4] ?? "760"}px;margin:0 auto;padding:24px;background:#fbf9f3;}</style>
</head><body><div class="newspaper">${body}</div></body></html>`;

  const out = `/tmp/football-team-${league}-${slug}.html`;
  await writeFile(out, html, "utf-8");
  console.log(
    `${data.name}: rank=${data.divisionRank} div=${data.divisionGroup?.group ?? "?"} ` +
    `lastGame=${data.lastGame?.id ?? "none"} box=${data.lastBox ? "yes" : "no"} ` +
    `upcoming=${data.upcoming.length} leaderCats=${data.teamLeaders.length} → ${out}`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
