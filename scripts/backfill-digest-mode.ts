// Backfill `daily_digests.mode` for basketball + football rows written before
// the generator tagged them (app/api/cron/generate/route.ts). Those rows landed
// with mode=null, which getLatestDigest excludes (.in("mode", IN_SEASON_MODES)),
// so /nba, /wnba, /nfl, /ncaaf landing pages 404'd despite having digests.
//
// Derivation (matches the generator going forward):
//   - football (nfl, ncaaf): every persisted digest is a game day -> "regular".
//   - basketball (nba, wnba): game_count > 0 -> "regular", else "offseason".
//
// Only touches rows where mode IS NULL, so it's idempotent and safe to re-run.
//   npx tsx --env-file=.env.local scripts/backfill-digest-mode.ts

import { supabaseAdmin } from "@/lib/supabase";

const BASKETBALL = ["nba", "wnba"];
const FOOTBALL = ["nfl", "ncaaf"];

async function countNull(sport: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("daily_digests")
    .select("date", { count: "exact", head: true })
    .eq("sport", sport)
    .is("mode", null);
  if (error) throw new Error(`count ${sport}: ${error.message}`);
  return count ?? 0;
}

async function setMode(
  sport: string,
  mode: "regular" | "offseason",
  gameCount: "positive" | "zero" | "any",
): Promise<number> {
  let q = supabaseAdmin()
    .from("daily_digests")
    .update({ mode })
    .eq("sport", sport)
    .is("mode", null);
  if (gameCount === "positive") q = q.gt("game_count", 0);
  if (gameCount === "zero") q = q.eq("game_count", 0);
  const { data, error } = await q.select("date");
  if (error) throw new Error(`update ${sport}->${mode}: ${error.message}`);
  return data?.length ?? 0;
}

async function main() {
  const summary: Record<string, unknown> = {};
  for (const sport of [...BASKETBALL, ...FOOTBALL]) {
    const before = await countNull(sport);
    if (before === 0) {
      summary[sport] = "no null-mode rows";
      continue;
    }
    if (FOOTBALL.includes(sport)) {
      const n = await setMode(sport, "regular", "any");
      summary[sport] = { regular: n };
    } else {
      const reg = await setMode(sport, "regular", "positive");
      const off = await setMode(sport, "offseason", "zero");
      summary[sport] = { regular: reg, offseason: off };
    }
    const after = await countNull(sport);
    (summary[sport] as Record<string, unknown>).remaining_null = after;
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().then(() => process.exit(0));
