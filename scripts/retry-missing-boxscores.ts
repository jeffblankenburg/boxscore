// Retries ingest for the gamePks the audit (#45 part 1) flagged as
// missing from historical_boxscores. Reads /tmp/missing-pks.json (a
// season → pk[] map produced by audit-historical-coverage.ts), groups
// by season so we hit each season's schedule API exactly once, then
// finds each missing pk's SchedGame row and calls the canonical
// ingestGame() — same path the season walker uses, so the new rows
// look identical.
//
// Idempotent: ingestGame skips pks that already exist. Re-running after
// success is harmless.

import { readFileSync } from "node:fs";
import { fetchScheduleSeasonRaw } from "../lib/mlb";
import { ingestGame, type SchedGame } from "./backfill-historical-boxscores";

const MISSING_PATH = "/tmp/missing-pks.json";
const REQUEST_DELAY_MS = 100;

type SchedEnvelope = { dates: Array<{ games: SchedGame[] }> };

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const raw = JSON.parse(readFileSync(MISSING_PATH, "utf-8")) as Record<string, number[]>;
  const seasons = Object.keys(raw)
    .map(Number)
    .filter((s) => (raw[s] ?? []).length > 0)
    .sort();

  if (seasons.length === 0) {
    console.log("Nothing to retry — every canonical pk is present.");
    return;
  }

  let totalIngested = 0;
  let totalSkipped  = 0;
  let totalFailed   = 0;
  let totalNotFound = 0;             // schedule entry missing for the pk

  for (const season of seasons) {
    const wantedPks = new Set(raw[season]);
    console.log(`\n=== ${season} — ${wantedPks.size} missing ===`);

    let env: SchedEnvelope;
    try {
      env = (await fetchScheduleSeasonRaw(season)) as SchedEnvelope;
    } catch (e) {
      console.error(`  schedule fetch failed: ${(e as Error).message}`);
      totalFailed += wantedPks.size;
      continue;
    }

    // Flatten the schedule and pull out the games we want.
    const wantedGames: SchedGame[] = [];
    for (const d of env.dates ?? []) {
      for (const g of d.games ?? []) {
        if (wantedPks.has(g.gamePk)) wantedGames.push(g);
      }
    }
    const found = new Set(wantedGames.map((g) => g.gamePk));
    for (const pk of wantedPks) {
      if (!found.has(pk)) {
        console.error(`  ${pk}: not found in schedule envelope (skipping)`);
        totalNotFound++;
      }
    }

    for (const g of wantedGames) {
      try {
        const r = await ingestGame(g);
        console.log(`  ${g.gamePk}: ${r}`);
        if      (r === "ingested") totalIngested++;
        else if (r === "skipped")  totalSkipped++;
        else                       totalFailed++;
      } catch (e) {
        console.error(`  ${g.gamePk}: threw ${(e as Error).message}`);
        totalFailed++;
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log(`\nDone. ingested=${totalIngested} skipped=${totalSkipped} failed=${totalFailed} not_in_schedule=${totalNotFound}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
