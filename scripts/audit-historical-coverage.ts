// Audit: how many regular-season + postseason games are we missing?
//
// Walks the MLB schedule API season-by-season for 1950-2025, filters to
// RS (R) + WC/DS/LCS/WS (F/D/L/W), and diffs the canonical gamePk list
// against historical_boxscores. Outputs a per-season gap report and
// writes the full missing-pk list to /tmp/missing-pks.json so the retry
// step (#45 part 2) can read it without re-hitting the schedule API.
//
// Read-only. Does not write to historical_games / boxscores / lines /
// backfill_progress. Run with `npx tsx scripts/audit-historical-coverage.ts`.

import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { fetchScheduleSeasonRaw } from "../lib/mlb";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});

const FIRST_SEASON = 1950;
const LAST_SEASON  = 2025;

// gameType filter — keep this in lockstep with what the picker considers
// eligible. Regular = R, postseason = F (WC), D (DS), L (LCS), W (WS).
const KEEP_TYPES = new Set(["R", "F", "D", "L", "W"]);

type SchedGame = { gamePk: number; gameType?: string; officialDate?: string; gameDate: string };
type SchedEnvelope = { dates: Array<{ games: SchedGame[] }> };

async function canonicalPksForSeason(season: number): Promise<Set<number>> {
  const env = (await fetchScheduleSeasonRaw(season)) as SchedEnvelope;
  const out = new Set<number>();
  for (const d of env.dates ?? []) {
    for (const g of d.games ?? []) {
      if (!g.gameType || !KEEP_TYPES.has(g.gameType)) continue;
      out.add(g.gamePk);
    }
  }
  return out;
}

async function loadAllExistingPks(): Promise<Set<number>> {
  // historical_boxscores has no season column (season lives on
  // historical_games, FK'd by game_pk). Cheaper to pull every box-score
  // pk once than to join per season — 162k rows, ~163 paginated reads.
  const PAGE = 1000;
  const out = new Set<number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("historical_boxscores")
      .select("game_pk")
      .order("game_pk", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`loadAllExistingPks: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) out.add(r.game_pk);
    if (data.length < PAGE) break;
  }
  return out;
}

async function main() {
  console.log("loading existing boxscore pks…");
  const existing = await loadAllExistingPks();
  console.log(`  loaded ${existing.size} existing boxscore pks\n`);

  const missingBySeason: Record<number, number[]> = {};
  let totalCanonical = 0;
  let totalMissing   = 0;

  console.log("season  canonical  existing  missing");
  console.log("------  ---------  --------  -------");

  for (let season = FIRST_SEASON; season <= LAST_SEASON; season++) {
    let canonical: Set<number>;
    try {
      canonical = await canonicalPksForSeason(season);
    } catch (e) {
      console.log(`${season}  schedule fetch failed: ${(e as Error).message}`);
      continue;
    }
    const haveCount = [...canonical].filter((pk) => existing.has(pk)).length;
    const missing   = [...canonical].filter((pk) => !existing.has(pk));
    missingBySeason[season] = missing;
    totalCanonical += canonical.size;
    totalMissing   += missing.length;
    console.log(
      `${season}    ${String(canonical.size).padStart(6)}    ${String(haveCount).padStart(6)}    ${String(missing.length).padStart(5)}`,
    );
  }

  console.log("------  ---------  --------  -------");
  console.log(`TOTAL   ${String(totalCanonical).padStart(6)}    ${String(totalCanonical - totalMissing).padStart(6)}    ${String(totalMissing).padStart(5)}`);

  const outPath = "/tmp/missing-pks.json";
  writeFileSync(outPath, JSON.stringify(missingBySeason, null, 2));
  console.log(`\nmissing pks written to ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
