"use server";

// Server-side persistence for Clubhouse. Authenticated subscribers only —
// anonymous players keep their localStorage state (and device-local streak).
// Called fire-and-forget from the client after each submit, so puzzle_attempts
// carries in-progress rows plus the final win/loss for admin analytics + streaks.

import { cookies } from "next/headers";
import { validateSession, SUBSCRIBER_SESSION_COOKIE } from "@/lib/subscriber-auth";
import { saveAttempt } from "@/lib/games/attempts";
import { supabaseAdmin } from "@/lib/supabase";
import type { DayResult } from "@/lib/games/clubhouse/stats";

export async function persistClubhouseAttempt(opts: {
  puzzleDate: string;
  guesses: number[][]; // each guess = the 4 tiles' true group indices
  mistakes: number;    // 0-4
  solved: boolean | null; // true = won, false = out of guesses, null = in progress
}): Promise<void> {
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  if (!session) return; // anonymous — nothing to persist server-side

  await saveAttempt({
    subscriberId:    session.subscriber_id,
    game:            "clubhouse",
    puzzleDate:      opts.puzzleDate,
    puzzleSubjectId: "",
    guesses:         { guesses: opts.guesses, mistakes: opts.mistakes } as unknown,
    hints:           [],
    solved:          opts.solved,
    guessCount:      opts.mistakes, // stored as the mistakes count → mistakes distribution
    hintCount:       0,
  });
}

// Cross-device streak sync for logged-in players: push any local-only completed
// days (e.g. played logged-out) that aren't on the server yet, then return the
// full server history so the client can compute the streak from every device.
// Returns null for anonymous sessions (client falls back to localStorage-only).
export async function syncClubhouseStreak(
  localDays: Array<{ date: string; solved: boolean; mistakes: number }>,
): Promise<DayResult[] | null> {
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  if (!session) return null;

  // One read of the whole (small) per-player history, then push only the days
  // that aren't already on the server.
  const { data } = await supabaseAdmin()
    .from("puzzle_attempts")
    .select("puzzle_date, solved")
    .eq("subscriber_id", session.subscriber_id)
    .eq("game", "clubhouse");
  const rows = (data ?? []) as Array<{ puzzle_date: string; solved: boolean | null }>;
  const onServer = new Set(rows.map((r) => r.puzzle_date));

  for (const d of localDays) {
    if (onServer.has(d.date)) continue; // don't clobber a server row
    await saveAttempt({
      subscriberId: session.subscriber_id, game: "clubhouse", puzzleDate: d.date,
      puzzleSubjectId: "", guesses: { mistakes: d.mistakes } as unknown, hints: [],
      solved: d.solved, guessCount: d.mistakes, hintCount: 0,
    });
    rows.push({ puzzle_date: d.date, solved: d.solved });
  }

  return rows
    .filter((r) => r.solved !== null)
    .map((r) => ({ date: r.puzzle_date, solved: r.solved === true }));
}
