// Render smoke for a football player page: load a real athlete, render the
// web content, and write a standalone HTML doc to /tmp for screenshotting.
//
//   npx tsx scripts/football-player-smoke.ts nfl 3918298        # Josh Allen
//   npx tsx scripts/football-player-smoke.ts nfl 4430807 2025   # Bijan, pinned season

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadFootballPlayerData } from "../lib/sports/football/player-data";
import { renderFootballPlayerContent } from "../lib/sports/football/render/player";
import type { FootballLeague } from "../lib/sports/football/types";

async function main() {
  const league = (process.argv[2] as FootballLeague) || "nfl";
  const athleteId = process.argv[3] || "3918298";
  const season = process.argv[4] ? Number(process.argv[4]) : undefined;

  const data = await loadFootballPlayerData(league, athleteId, season);
  if (!data) throw new Error("no data (unknown athlete id?)");
  const body = renderFootballPlayerContent(data);

  const globalsCss = await readFile(join(process.cwd(), "app", "globals.css"), "utf-8");
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap">
<style>${globalsCss}</style>
<style>body{margin:0;background:#f3efe5;} .newspaper{max-width:${process.argv[5] ?? "900"}px;margin:0 auto;padding:24px;background:#fbf9f3;}</style>
</head><body><div class="newspaper">${body}</div></body></html>`;

  const out = `/tmp/football-player-${league}-${athleteId}.html`;
  await writeFile(out, html, "utf-8");
  console.log(
    `${data.bio.fullName} (${data.bio.position ?? "?"}, ${data.bio.teamAbbr ?? "?"}) ` +
    `season=${data.season} sections=${data.sections.map((s) => s.key).join(",")} → ${out}`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
