// Manual test for the Phase 2 basketball pipeline. Fetches one date for
// either NBA or WNBA, caches the raw payload to daily_raw, and prints a
// summary so we can eyeball the result before the renderer (Phase 3) and
// crons (Phase 4) get wired up.
//
// Usage:
//   tsx --env-file=.env.local scripts/basketball.ts nba 2026-05-17
//   tsx --env-file=.env.local scripts/basketball.ts wnba 2026-05-17

import { loadNbaData } from "../lib/nba";
import { loadWnbaData } from "../lib/wnba";
import { isValidIsoDate, yesterdayInET } from "../lib/dates";
import type { BasketballData } from "../lib/basketball-daily";

async function main() {
  const sport = process.argv[2];
  const date = process.argv[3] ?? yesterdayInET();
  if (sport !== "nba" && sport !== "wnba") {
    console.error(`Usage: tsx scripts/basketball.ts (nba|wnba) [YYYY-MM-DD]`);
    process.exit(1);
  }
  if (!isValidIsoDate(date)) {
    console.error(`Bad date: ${date}. Use YYYY-MM-DD.`);
    process.exit(1);
  }

  console.log(`Loading ${sport}/${date}...`);
  const data: BasketballData =
    sport === "nba" ? await loadNbaData(date) : await loadWnbaData(date);

  console.log(`\nSeason: ${data.season}`);
  console.log(`Games: ${data.games.length}`);
  for (const g of data.games) {
    const a = g.event.away;
    const h = g.event.home;
    const lead = g.event.status === "final"
      ? `${a.team.abbreviation} ${a.score} @ ${h.team.abbreviation} ${h.score}`
      : `${a.team.abbreviation} @ ${h.team.abbreviation}`;
    const tag = g.event.status === "final" ? "F" : g.event.status === "in_progress" ? "L" : "S";
    const box = g.box ? ` · box(${g.box.teams[0].players.length}+${g.box.teams[1].players.length})` : "";
    console.log(`  [${tag}] ${lead} (${g.event.statusDetail})${box}`);
  }

  console.log(`\nStandings:`);
  for (const conf of data.standings.conferences) {
    console.log(`  ${conf.name} (${conf.entries.length} teams)`);
    const sorted = [...conf.entries].sort(
      (x, y) => (x.stats.playoffSeed?.value ?? 99) - (y.stats.playoffSeed?.value ?? 99),
    );
    for (const e of sorted.slice(0, 5)) {
      const w = e.stats.wins?.displayValue ?? "?";
      const l = e.stats.losses?.displayValue ?? "?";
      const gb = e.stats.gamesBehind?.displayValue ?? "-";
      console.log(`    ${e.team.abbreviation.padEnd(4)} ${e.team.displayName.padEnd(28)} ${w}-${l}  GB ${gb}`);
    }
    if (conf.entries.length > 5) console.log(`    ...`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
