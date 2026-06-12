"use server";

// Server actions for Linescordle. All puzzle-bearing data — the answer,
// the hint values, the post-game reveal — flows through these.
// Nothing about the puzzle except its subject_id, name length, and
// line stats ever reaches the client.

import { cookies } from "next/headers";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { saveAttempt, getAttempt, type AttemptRow } from "@/lib/games/attempts";
import { getPuzzleBySubjectId } from "@/lib/games/linescordle/content";
import { normalize, scoreGuess, type LetterState } from "@/lib/games/linescordle/feedback";
import { buildRevealData } from "@/lib/games/linescordle/reveal";
import { searchPlayerNames, type SearchConstraints } from "@/lib/games/linescordle/player-search";

// ─── Autocomplete ────────────────────────────────────────────────
// Used by the typing assist in LinescordleGame. Returns up to 30
// display names matching the current row's partial input + the
// constraints derived from prior greens/yellows. Never leaks the
// puzzle's answer — the constraints are passed by the client based on
// what the server has already revealed via submitGuess.
export async function searchPlayers(input: SearchConstraints): Promise<string[]> {
  return searchPlayerNames(input);
}

// ─── Persistence (unchanged) ──────────────────────────────────────

export type ClientAttempt = {
  puzzleDate: string;
  puzzleSubjectId: string;
  guesses: Array<{ letters: string[]; scores: string[] }>;
  hints: string[];
  solved: boolean | null;
};

// Sync a batch of locally-stored attempts (anonymous play) up to
// puzzle_attempts. Used by the client on authenticated mount: the
// LinescordleGame reads localStorage and, if any attempts exist, calls
// this to push them to the server. Conservative: skip dates where a
// server row already exists — the server is the canonical record.
// Returns the count of rows actually pushed so the caller can clear
// local storage once they're all upstream.
export async function syncLocalAttempts(
  attempts: Array<{
    puzzleDate: string;
    puzzleSubjectId: string;
    guesses: Array<{ letters: string[]; scores: string[] }>;
    hints: string[];
    solved: boolean | null;
  }>,
): Promise<{ pushed: number; skipped: number }> {
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  if (!session) return { pushed: 0, skipped: 0 };
  let pushed = 0;
  let skipped = 0;
  for (const a of attempts) {
    // Don't clobber existing server rows.
    const existing: AttemptRow | null = await getAttempt({
      subscriberId: session.subscriber_id,
      game: "linescordle",
      puzzleDate: a.puzzleDate,
    });
    if (existing) { skipped++; continue; }
    await saveAttempt({
      subscriberId:    session.subscriber_id,
      game:            "linescordle",
      puzzleDate:      a.puzzleDate,
      puzzleSubjectId: a.puzzleSubjectId,
      guesses:         a.guesses,
      hints:           a.hints,
      solved:          a.solved,
      guessCount:      a.guesses.length,
      hintCount:       a.hints.length,
    });
    pushed++;
  }
  return { pushed, skipped };
}

export async function persistAttempt(attempt: ClientAttempt): Promise<{ saved: boolean }> {
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  if (!session) return { saved: false };
  await saveAttempt({
    subscriberId:    session.subscriber_id,
    game:            "linescordle",
    puzzleDate:      attempt.puzzleDate,
    puzzleSubjectId: attempt.puzzleSubjectId,
    guesses:         attempt.guesses,
    hints:           attempt.hints,
    solved:          attempt.solved,
    guessCount:      attempt.guesses.length,
    hintCount:       attempt.hints.length,
  });
  return { saved: true };
}


// ─── Guess scoring ────────────────────────────────────────────────
//
// Client sends the typed letters as a string. Server normalizes,
// looks up the answer for the subject_id, scores the guess, and
// returns the per-position color array. Client never sees the answer.
//
// Out-of-band correctness check: solved = (every letter is green).
// Returning `solved` is safe — the client already knows once it sees
// 13 greens in a row.

export type GuessResult = {
  scores: LetterState[];
  solved: boolean;
};

export async function submitGuess(opts: {
  puzzleSubjectId: string;
  letters: string;
}): Promise<GuessResult> {
  const puzzle = await getPuzzleBySubjectId(opts.puzzleSubjectId);
  if (!puzzle) throw new Error("Unknown puzzle");
  const guess = normalize(opts.letters);
  if (guess.length !== puzzle.answer.length) {
    throw new Error("Guess length mismatch");
  }
  const scores = scoreGuess(puzzle.answer, guess);
  const solved = guess === puzzle.answer;
  return { scores, solved };
}

// ─── Hint reveal ──────────────────────────────────────────────────
//
// Two hints: 'date' returns the YYYY-MM-DD string; 'teams' returns
// the matchup abbreviations. Line stats are sent eagerly with the
// initial render (they're the puzzle's primary clue, always visible).

export type HintResult =
  | { hint: "date"; value: string }
  | { hint: "teams"; value: { teamAbbr: string; oppAbbr: string } };

export async function revealHint(opts: {
  puzzleSubjectId: string;
  hint: "date" | "teams";
}): Promise<HintResult> {
  const puzzle = await getPuzzleBySubjectId(opts.puzzleSubjectId);
  if (!puzzle) throw new Error("Unknown puzzle");
  if (opts.hint === "date") return { hint: "date", value: puzzle.line.date };
  return {
    hint: "teams",
    value: { teamAbbr: puzzle.line.teamAbbr, oppAbbr: puzzle.line.oppAbbr },
  };
}

// ─── Post-game reveal ─────────────────────────────────────────────
//
// Returns the player name, role/era/handedness summary, career stat
// line HTML, and full source-game box score HTML. Server-only spoiler
// payload. Client invokes when game ends.
//
// We trust the client to only call this on game end — guarding it
// against premature reveal would require us to track solved state
// server-side per subscriber (or per device cookie for anonymous).
// For v0 the leak surface is "user opens dev tools and fires the
// action," which is essentially the same posture as Wordle. The
// guess-scoring path is the meaningful protection.

export type RevealPayload = {
  displayName: string;
  role: "Pitcher" | "Batter";
  era: string | null;
  handed: string | null;
  careerHtml: string;
  boxScoreHtml: string;
};

export async function getReveal(puzzleSubjectId: string): Promise<RevealPayload> {
  const puzzle = await getPuzzleBySubjectId(puzzleSubjectId);
  if (!puzzle) throw new Error("Unknown puzzle");
  const reveal = await buildRevealData(puzzle);
  const role: "Pitcher" | "Batter" = puzzle.line.kind === "pitching" ? "Pitcher" : "Batter";
  const player = reveal.player;
  const debutYear = player?.debut_date ? player.debut_date.slice(0, 4) : null;
  const lastYear = player?.last_game_date ? player.last_game_date.slice(0, 4) : null;
  const era = debutYear
    ? lastYear && lastYear !== debutYear ? `${debutYear}–${lastYear}` : debutYear
    : null;
  const handed = player
    ? puzzle.line.kind === "pitching"
      ? (player.throws ? `throws ${player.throws}` : null)
      : (player.bats ? `bats ${player.bats}` : null)
    : null;
  return {
    displayName: puzzle.displayName,
    role,
    era,
    handed,
    careerHtml: reveal.careerHtml,
    boxScoreHtml: reveal.boxScoreHtml,
  };
}
