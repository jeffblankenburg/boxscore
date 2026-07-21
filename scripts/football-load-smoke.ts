// End-to-end orchestrator check: loadFootballData does the full daily_raw
// read-through (fetch ESPN on miss → cache → adapt) exactly as the generate
// cron and admin preview do. Idempotent — reruns hit the cache. Warms the
// preview fixtures too.
//
//   npx tsx --env-file=.env.local scripts/football-load-smoke.ts

import { loadFootballData, hasPlayedGames } from "../lib/sports/football/data";
import { FOOTBALL_PREVIEW_FIXTURES } from "../lib/sports/football/preview-fixtures";

async function main() {
  // Optional args: <league> <date> to refetch one specific row; otherwise
  // both fixture dates.
  const argLeague = process.argv[2] as "nfl" | "ncaaf" | undefined;
  const argDate = process.argv[3];
  const targets: Array<readonly ["nfl" | "ncaaf", string]> =
    argLeague && argDate ? [[argLeague, argDate]] :
    [["nfl", FOOTBALL_PREVIEW_FIXTURES.nfl], ["ncaaf", FOOTBALL_PREVIEW_FIXTURES.ncaaf]];
  for (const [league, date] of targets) {
    const t0 = Date.now();
    // refetch so the cached daily_raw picks up feed/URL changes (e.g. the NFL
    // standings level=3 division grouping) rather than serving a stale row.
    const data = await loadFootballData(league, date, { refetch: true });
    console.log(
      `${league} ${date}: games=${data.games.length} boxes=${data.boxScores.size} ` +
      `rankings=${data.rankings.length} standings=${data.standings.length} ` +
      `hasGames=${hasPlayedGames(data)} (${Date.now() - t0}ms)`,
    );
  }
  console.log("✓ orchestrator round-trip OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
