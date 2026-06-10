// MLBdle letter-feedback. Same green/yellow/gray semantics as Wordle:
//   green  = right letter, right position
//   yellow = right letter, wrong position
//   gray   = letter not in the answer (or already used up by earlier
//            green/yellow placements)
//
// Variable-length puzzle: the answer is the player's full name with
// spaces stripped. The guess must be the same length. Accents are
// normalized (Pedro Martínez and PEDRO MARTINEZ both match the same
// canonical form).
//
// Two-pass algorithm to handle repeats correctly. Example: answer
// "AARON", guess "AABBB". Naive matching marks both A's green (wrong —
// the second A in the guess should be gray because there's only one A
// in the answer). Pass 1 fills greens and tallies leftover letters from
// the answer; pass 2 awards yellow only against that residual tally.

export type LetterState = "green" | "yellow" | "gray";

// Strip accents, drop spaces, uppercase.
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function scoreGuess(answer: string, guess: string): LetterState[] {
  const a = answer;     // assumed already normalized — callers normalize once
  const g = guess;
  if (g.length !== a.length) {
    throw new Error(`scoreGuess length mismatch: answer=${a.length} guess=${g.length}`);
  }
  const result: LetterState[] = new Array(a.length).fill("gray");

  // Pass 1: greens. Track how many of each letter remain UNCLAIMED in
  // the answer after greens are awarded — pass 2 distributes yellows
  // only from this pool.
  const remaining = new Map<string, number>();
  for (let i = 0; i < a.length; i++) {
    if (g[i] === a[i]) {
      result[i] = "green";
    } else {
      const letter = a[i]!;
      remaining.set(letter, (remaining.get(letter) ?? 0) + 1);
    }
  }

  // Pass 2: yellows. Walk non-green positions; award yellow if the
  // letter is still in the residual pool, decrement.
  for (let i = 0; i < a.length; i++) {
    if (result[i] === "green") continue;
    const letter = g[i]!;
    const left = remaining.get(letter) ?? 0;
    if (left > 0) {
      result[i] = "yellow";
      remaining.set(letter, left - 1);
    }
  }
  return result;
}

// Combine letter states across all guesses for the on-screen keyboard.
// Each key shows its best (highest-priority) state across history.
// Priority: green > yellow > gray > unused.
export function keyboardState(
  guesses: Array<{ letters: string[]; scores: LetterState[] }>,
): Map<string, LetterState> {
  const out = new Map<string, LetterState>();
  const rank: Record<LetterState, number> = { gray: 1, yellow: 2, green: 3 };
  for (const { letters, scores } of guesses) {
    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i]!;
      const score = scores[i]!;
      const prev = out.get(letter);
      if (!prev || rank[score] > rank[prev]) out.set(letter, score);
    }
  }
  return out;
}
