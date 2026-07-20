// End-to-end orchestrator check: loadFootballData does the full daily_raw
// read-through (fetch ESPN on miss → cache → adapt) exactly as the generate
// cron and admin preview do. Idempotent — reruns hit the cache. Warms the
// preview fixtures too.
//
//   npx tsx --env-file=.env.local scripts/football-load-smoke.ts

import { loadFootballData, hasPlayedGames } from "../lib/sports/football/data";
import { FOOTBALL_PREVIEW_FIXTURES } from "../lib/sports/football/preview-fixtures";

async function main() {
  for (const league of ["nfl", "ncaaf"] as const) {
    const date = FOOTBALL_PREVIEW_FIXTURES[league];
    const t0 = Date.now();
    const data = await loadFootballData(league, date);
    console.log(
      `${league} ${date}: games=${data.games.length} boxes=${data.boxScores.size} ` +
      `rankings=${data.rankings.length} standings=${data.standings.length} ` +
      `hasGames=${hasPlayedGames(data)} (${Date.now() - t0}ms)`,
    );
  }
  console.log("✓ orchestrator round-trip OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
