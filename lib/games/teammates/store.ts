// Read/write side for stored daily Teammates puzzles. Deliberately does NOT
// import ./generate (and therefore not the multi-MB player pool) — the page
// path stays lightweight and only reads pre-generated rows. Generation lives in
// the cron (/api/cron/teammates-generate), which imports the pool.

import { supabaseAdmin } from "@/lib/supabase";
import type { TeammatesPuzzle } from "./generate"; // type-only: erased at build, no pool bundling

export async function getStoredPuzzle(date: string): Promise<TeammatesPuzzle | null> {
  const { data, error } = await supabaseAdmin()
    .from("teammates_puzzles")
    .select("data")
    .eq("puzzle_date", date)
    .maybeSingle<{ data: TeammatesPuzzle }>();
  if (error || !data) return null;
  return data.data;
}

export async function savePuzzle(date: string, puzzle: TeammatesPuzzle): Promise<void> {
  await supabaseAdmin()
    .from("teammates_puzzles")
    .upsert({ puzzle_date: date, data: puzzle }, { onConflict: "puzzle_date" });
}
