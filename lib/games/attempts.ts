// Per-subscriber attempt persistence for the boxscore.games surface.
// Used by every game in the slate (Linescordle today, the rest later).
//
// Authenticated path only — anonymous device-streaks land with #57.
// If subscriberId is null at the call site, callers must skip
// persistence rather than threading anonymous identity through here.

import { supabaseAdmin } from "../supabase";

export type GameKey = "linescordle" | "year" | "player" | "hilo" | "statsharks" | "time-machine";

export type AttemptRow = {
  id: number;
  subscriber_id: string;
  game: GameKey;
  puzzle_date: string;             // YYYY-MM-DD
  puzzle_subject_id: string;
  guesses: unknown;                // per-game shape
  hints: unknown;                  // per-game shape
  solved: boolean | null;
  guess_count: number;
  hint_count: number;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

export async function getAttempt(opts: {
  subscriberId: string;
  game: GameKey;
  puzzleDate: string;
}): Promise<AttemptRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("puzzle_attempts")
    .select("*")
    .eq("subscriber_id", opts.subscriberId)
    .eq("game", opts.game)
    .eq("puzzle_date", opts.puzzleDate)
    .maybeSingle<AttemptRow>();
  if (error) throw new Error(`getAttempt: ${error.message}`);
  return data;
}

// Upsert. Either creates the in-progress row or updates an existing one
// with the latest guesses/hints/status. completed_at is set on the
// transition to solved=true/false, never re-cleared.
export async function saveAttempt(opts: {
  subscriberId: string;
  game: GameKey;
  puzzleDate: string;
  puzzleSubjectId: string;
  guesses: unknown;
  hints: unknown;
  solved: boolean | null;
  guessCount: number;
  hintCount: number;
}): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin()
    .from("puzzle_attempts")
    .upsert({
      subscriber_id:     opts.subscriberId,
      game:              opts.game,
      puzzle_date:       opts.puzzleDate,
      puzzle_subject_id: opts.puzzleSubjectId,
      guesses:           opts.guesses,
      hints:             opts.hints,
      solved:            opts.solved,
      guess_count:       opts.guessCount,
      hint_count:        opts.hintCount,
      updated_at:        now,
      ...(opts.solved !== null ? { completed_at: now } : {}),
    }, { onConflict: "subscriber_id,game,puzzle_date" });
  if (error) throw new Error(`saveAttempt: ${error.message}`);
}
