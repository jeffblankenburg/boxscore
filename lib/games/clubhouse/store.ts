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
