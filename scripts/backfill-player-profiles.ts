// Player profile backfill for the players table (#63 + #37 migration).
//
// Step 1: extract distinct MLB player ids via the
//   distinct_historical_player_ids() RPC. Server-side jsonb extraction;
//   returns ~15-20k rows in one query without dragging boxscore_raw to
//   the client (the previous client-side scan timed out on Supabase's
//   statement timeout against 92k+ 50KB jsonb rows).
//
// Step 2: for each mlb_id not already in players, hit
//   /api/v1/people/{mlbId} and upsert via lib/players.ts. Internal `id`
//   is assigned by bigserial on insert.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-player-profiles.ts
//   npx tsx --env-file=.env.local scripts/backfill-player-profiles.ts --refresh
//   npx tsx --env-file=.env.local scripts/backfill-player-profiles.ts --limit=100

import { supabaseAdmin } from "../lib/supabase";
import { fetchPlayerFromApi, upsertPlayerByMlbId } from "../lib/players";

const JOB = "player-profiles";
const PROGRESS_SENTINEL_SEASON = 0;
const REQUEST_DELAY_MS = Number(process.env.PROFILE_DELAY_MS ?? "200");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Args = {
  refresh: boolean;
  limit: number | null;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (k: string) => {
    const a = args.find((x) => x.startsWith(`--${k}=`));
    return a?.split("=")[1];
  };
  const limit = get("limit");
  return {
    refresh: args.includes("--refresh"),
    limit: limit ? Number(limit) : null,
  };
}

// Cursor-paginated RPC. Caller passes the last game_pk seen and the page
// size; the function processes exactly page_size rows of jsonb work per
// call regardless of game_pk density. Range-based chunking timed out on
// dense early-era ranges (7,500+ 50KB jsonb rows in 10k game_pks).
async function distinctMlbIds(): Promise<number[]> {
  const db = supabaseAdmin();
  const PAGE_SIZE = 500;       // tuned to fit under the ~8s statement timeout
  const seen = new Set<number>();
  let cursor = 0;
  let pagesProcessed = 0;
  let pagesEmpty = 0;
  for (;;) {
    const { data, error } = await db.rpc("distinct_player_ids_page", {
      after_game_pk: cursor,
      page_size: PAGE_SIZE,
    });
    if (error) throw new Error(`distinctMlbIds rpc after=${cursor}: ${error.message}`);
    const rows = (data ?? []) as Array<{ game_pk: number; mlb_id: number }>;
    if (rows.length === 0) break;

    let maxGamePk = cursor;
    for (const r of rows) {
      seen.add(r.mlb_id);
      if (r.game_pk > maxGamePk) maxGamePk = r.game_pk;
    }
    // If the RPC returned no rows for the page (every game in the page
    // had no player records — shouldn't happen but defensible), bump the
    // cursor by page_size to avoid infinite loop.
    if (maxGamePk === cursor) {
      pagesEmpty++;
      cursor += PAGE_SIZE;
      if (pagesEmpty > 100) break;
      continue;
    }
    cursor = maxGamePk;
    pagesProcessed++;
    if (pagesProcessed % 20 === 0) {
      console.log(`  paged through game_pk ${cursor}; distinct ids so far: ${seen.size.toLocaleString()}`);
    }
  }
  return Array.from(seen).sort((a, b) => a - b);
}

// Skip mlb_ids already in players (unless --refresh). One bulk query.
async function filterNew(mlbIds: number[], refresh: boolean): Promise<number[]> {
  if (refresh) return mlbIds;
  const db = supabaseAdmin();
  const existing = new Set<number>();
  const pageSize = 1000;
  for (let i = 0; i < mlbIds.length; i += pageSize) {
    const chunk = mlbIds.slice(i, i + pageSize);
    const { data, error } = await db
      .from("players")
      .select("mlb_id")
      .in("mlb_id", chunk);
    if (error) throw new Error(`filterNew page: ${error.message}`);
    for (const row of data ?? []) existing.add((row as { mlb_id: number }).mlb_id);
  }
  return mlbIds.filter((id) => !existing.has(id));
}

async function main() {
  const args = parseArgs();

  console.log("Calling distinct_player_ids_page() RPC (cursor pagination)...");
  const allIds = await distinctMlbIds();
  console.log(`Found ${allIds.length.toLocaleString()} distinct MLB ids across ingested games.`);

  const todo = await filterNew(allIds, args.refresh);
  console.log(
    args.refresh
      ? `--refresh: will re-fetch all ${todo.length.toLocaleString()} players.`
      : `${todo.length.toLocaleString()} mlb_ids not yet in players table.`,
  );

  const slice = args.limit ? todo.slice(0, args.limit) : todo;
  if (slice.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log(`\nFetching profiles at ${REQUEST_DELAY_MS}ms/request...`);
  const startedAt = Date.now();
  let ok = 0, missing = 0, failed = 0;

  for (let i = 0; i < slice.length; i++) {
    const mlbId = slice[i]!;
    try {
      const profile = await fetchPlayerFromApi(mlbId);
      if (!profile) {
        missing++;
      } else {
        await upsertPlayerByMlbId(profile);
        ok++;
      }
    } catch (e) {
      console.error(`  mlb_id ${mlbId}: ${(e as Error).message}`);
      failed++;
    }
    if ((i + 1) % 100 === 0 || i === slice.length - 1) {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      const rate = (i + 1) / elapsedSec;
      const remaining = (slice.length - i - 1) / rate;
      console.log(
        `  [${(i + 1).toString().padStart(6)}/${slice.length}]  ` +
        `ok=${ok} missing=${missing} failed=${failed}  ` +
        `~${rate.toFixed(1)}/s, eta ${Math.round(remaining / 60)}m`,
      );

      await supabaseAdmin().from("backfill_progress").upsert({
        job: JOB,
        season: PROGRESS_SENTINEL_SEASON,
        last_date_done: null,
        games_seen: i + 1,
        games_ingested: ok,
        failed_game_pks: [],
        finished_at: new Date().toISOString(),
      }, { onConflict: "job,season" });
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`\nDone. ok=${ok} missing=${missing} failed=${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
