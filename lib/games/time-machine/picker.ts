// Time Machine daily puzzle picker. Given a calendar date, deterministically
// pick one historical regular-season MLB game. Two paths:
//
//   1. MM-DD match — every regular-season game played on this calendar day
//      across 1950+ is eligible; pick one uniformly by hashing playedOn.
//   2. Off-season fallback — if no real game was played on this MM-DD (Dec/
//      Jan/Feb), pick uniformly from every regular-season game in the table
//      so the daily puzzle never goes dark.
//
// Stays pure (no caching). actions.ts wraps this with a puzzle_picks
// read-or-create so the chosen gamePk is frozen once the first subscriber
// of the day loads the page.

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";

const MIN_SEASON = 1950;

// SHA-256 has strong avalanche, so consecutive puzzle dates land in
// completely different parts of the eligible set. djb2 + mod N produced
// near-sequential indexes for consecutive days, clustering picks within a
// few seasons of each other.
function seedToInt(seed: string): number {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 12);
  return Number.parseInt(hex, 16);
}

/** Pick today's gamePk. Throws only if even the fallback finds nothing,
 * which would mean the historical_games table is empty. */
export async function pickDailyGame(playedOn: string): Promise<number> {
  const [, mm, dd] = playedOn.split("-");
  const db = supabaseAdmin();
  const currentYear = new Date().getUTCFullYear();

  const dates: string[] = [];
  for (let y = MIN_SEASON; y <= currentYear; y++) {
    dates.push(`${y}-${mm}-${dd}`);
  }
  const { count, error: cErr } = await db
    .from("historical_games")
    .select("game_pk", { count: "exact", head: true })
    .eq("game_type", "R")
    .in("game_date", dates);
  if (cErr) throw new Error(`pickDailyGame count: ${cErr.message}`);
  if (count && count > 0) {
    const idx = seedToInt(playedOn) % count;
    const { data, error } = await db
      .from("historical_games")
      .select("game_pk")
      .eq("game_type", "R")
      .in("game_date", dates)
      .order("game_pk", { ascending: true })
      .range(idx, idx)
      .maybeSingle<{ game_pk: number }>();
    if (error) throw new Error(`pickDailyGame fetch: ${error.message}`);
    if (data?.game_pk) return data.game_pk;
  }

  // Off-season fallback — uniform pick across every regular-season
  // game in the table, seeded with a different domain to avoid colliding
  // with MM-DD picks.
  const { count: total, error: tErr } = await db
    .from("historical_games")
    .select("game_pk", { count: "exact", head: true })
    .eq("game_type", "R");
  if (tErr) throw new Error(`pickDailyGame fallback count: ${tErr.message}`);
  if (!total || total === 0) {
    throw new Error("pickDailyGame: no historical games available");
  }
  const idx = seedToInt(`${playedOn}|fallback`) % total;
  const { data, error } = await db
    .from("historical_games")
    .select("game_pk")
    .eq("game_type", "R")
    .order("game_pk", { ascending: true })
    .range(idx, idx)
    .maybeSingle<{ game_pk: number }>();
  if (error) throw new Error(`pickDailyGame fallback fetch: ${error.message}`);
  if (!data?.game_pk) {
    throw new Error("pickDailyGame: fallback fetch returned no row");
  }
  return data.game_pk;
}
