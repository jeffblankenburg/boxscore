// Standalone scoreline-alignment fixture renderer.
// Builds a synthetic 4-game DailyData (mix of 9-inning, 10-inning extras, and
// a big-inning game with 10+ runs) and writes out/verify-scoreline.html so we
// can inspect grid alignment in Mac/Chrome without needing real MLB data or
// Supabase credentials.
//
// Run: node_modules/.bin/tsx scripts/verify-scoreline.ts
// Open: out/verify-scoreline.html

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderContent, type DailyData, type GameDetail } from "../lib/render";

type LinescoreInning = { away?: { runs?: number }; home?: { runs?: number } };

function game(
  away: string, home: string,
  awayInnings: Array<number | null>,
  homeInnings: Array<number | null>,
): GameDetail {
  const innings: LinescoreInning[] = awayInnings.map((a, i) => ({
    away: { runs: a ?? undefined },
    home: { runs: homeInnings[i] ?? undefined },
  }));
  const aR = awayInnings.reduce<number>((s, v) => s + (v ?? 0), 0);
  const hR = homeInnings.reduce<number>((s, v) => s + (v ?? 0), 0);
  return {
    game: {
      gamePk: 0,
      gameDate: "",
      status: { codedGameState: "F", detailedState: "Final" },
      teams: {
        away: { team: { id: 0, name: away }, score: aR, leagueRecord: { wins: 0, losses: 0 } },
        home: { team: { id: 0, name: home }, score: hR, leagueRecord: { wins: 0, losses: 0 } },
      },
      linescore: {
        innings,
        teams: {
          away: { runs: aR, hits: aR + 4, errors: 1 },
          home: { runs: hR, hits: hR + 3, errors: 0 },
        },
      },
      decisions: {
        winner: { id: 0, fullName: "Smith" },
        loser: { id: 0, fullName: "Jones" },
      },
    },
    box: {
      teams: {
        away: { team: { id: 0, name: away }, teamStats: { batting: {}, pitching: {}, fielding: {} }, players: {}, batters: [], pitchers: [], battingOrder: [] },
        home: { team: { id: 0, name: home }, teamStats: { batting: {}, pitching: {}, fielding: {} }, players: {}, batters: [], pitchers: [], battingOrder: [] },
      },
      info: [],
      pitchingNotes: [],
    },
    scoring: [],
  } as unknown as GameDetail;
}

const games: GameDetail[] = [
  // Standard 9-inning, home wins (bot 9 not played).
  game("Miami Marlins", "Tampa Bay Rays",
    [0, 0, 2, 0, 0, 0, 0, 1, 0],
    [1, 0, 0, 3, 1, 1, 0, 0, null]),
  // Standard 9-inning, home wins.
  game("Cincinnati Reds", "Cleveland Guardians",
    [0, 0, 1, 1, 0, 0, 0, 0, 1],
    [2, 0, 2, 1, 1, 0, 2, 2, null]),
  // EXTRAS: 11-inning game, home walkoff in the 11th.
  game("Chicago Cubs", "Chicago White Sox",
    [3, 0, 0, 1, 0, 0, 0, 0, 3, 0, 1],
    [0, 1, 0, 1, 2, 0, 0, 3, 0, 0, 2]),
  // EXTRAS: 12-inning game, away wins in the top of the 12th.
  game("New York Mets", "Atlanta Braves",
    [1, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 3],
    [0, 0, 0, 3, 0, 0, 0, 0, 0, 1, 0, null]),
  // BIG INNING: 12 runs in the 7th — exercises the .bigInning width path
  // (every inn cell widens from 1ch to 2ch across BOTH team rows so columns
  // still line up vertically).
  game("San Francisco Giants", "Athletics",
    [0, 0, 1, 1, 0, 0, 12, 0, 0],
    [0, 0, 0, 0, 1, 0, 0, 0, 0]),
  // BIG INNING + EXTRAS: 11 runs in the 5th, then game goes to 10. Triggers
  // both .bigInning and .has-extras simultaneously.
  game("Houston Astros", "Texas Rangers",
    [0, 0, 0, 0, 11, 0, 0, 0, 1, 1],
    [2, 0, 0, 0, 0, 3, 0, 0, 7, 0]),
];

const data: DailyData = {
  date: "2026-05-17",
  prettyDate: "Sunday, May 17, 2026",
  mode: "regular",
  games,
  standings: [],
  wildCard: [],
  leaders: { AL: [], NL: [] },
  todaysGames: [],
  teamAbbrev: {},
  transactions: [],
};

async function main() {
  const content = renderContent(data);
  const css = await readFile(resolve("app/globals.css"), "utf8");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>scoreline alignment fixture</title>
<style>${css}</style>
</head>
<body>
<div class="newspaper">
${content}
</div>
</body>
</html>`;
  const outDir = resolve("out");
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, "verify-scoreline.html");
  await writeFile(outFile, html);
  console.log(`Wrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
