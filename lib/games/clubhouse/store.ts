// Read/write side for stored daily Clubhouse puzzles. Deliberately does NOT
// import ./generate (and therefore not the multi-MB player pool) — the page
// path stays lightweight and only reads pre-generated rows. Generation lives in
// the cron (/api/cron/clubhouse-generate), which imports the pool.

import { supabaseAdmin } from "@/lib/supabase";
import type { ClubhousePuzzle } from "./generate"; // type-only: erased at build, no pool bundling

export async function getStoredPuzzle(date: string): Promise<ClubhousePuzzle | null> {
  const { data, error } = await supabaseAdmin()
    .from("clubhouse_puzzles")
    .select("data")
    .eq("puzzle_date", date)
    .maybeSingle<{ data: ClubhousePuzzle }>();
  if (error || !data) return null;
  return data.data;
}

export async function savePuzzle(date: string, puzzle: ClubhousePuzzle): Promise<void> {
  await supabaseAdmin()
    .from("clubhouse_puzzles")
    .upsert({ puzzle_date: date, data: puzzle }, { onConflict: "puzzle_date" });
}

// Player ids + team labels per stored puzzle from `sinceDate` onward — used to
// build the rolling no-repeat exclusion sets (players + teams) for generation.
export async function getRecentPuzzleTiles(sinceDate: string): Promise<Array<{ date: string; ids: number[]; teams: string[] }>> {
  const { data } = await supabaseAdmin()
    .from("clubhouse_puzzles")
    .select("puzzle_date, data")
    .gte("puzzle_date", sinceDate)
    .order("puzzle_date", { ascending: true });
  return ((data ?? []) as Array<{ puzzle_date: string; data: ClubhousePuzzle }>)
    .map((r) => ({ date: r.puzzle_date, ids: r.data.tiles.map((t) => t.id), teams: r.data.groups.map((g) => g.team) }));
}

// Anchor player ids already used by any stored puzzle — so anchor days never
// reuse a keystone journeyman.
export async function getUsedAnchorIds(): Promise<Set<number>> {
  const { data } = await supabaseAdmin().from("clubhouse_puzzles").select("data");
  const ids = new Set<number>();
  for (const r of (data ?? []) as Array<{ data: ClubhousePuzzle }>) {
    if (typeof r.data.anchor === "number") ids.add(r.data.anchor);
  }
  return ids;
}
