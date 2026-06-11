// Stats aggregator for Linescordle. Pure function over a normalized
// attempt shape so it works for both authenticated subscribers
// (puzzle_attempts rows) and anonymous players (localStorage rows).
//
// Wordle-style headline numbers:
//   - Games played    (rows that had at least one guess)
//   - Wins            (rows with solved=true)
//   - Win %           (wins / games played)
//   - Current streak  (consecutive solved days ending today/yesterday)
//   - Max streak      (longest run of solved days)
//   - Guess distribution (count of wins by guess-count, 1..MAX_GUESSES)

const MAX_GUESSES = 6;

export type NormalizedAttempt = {
  puzzleDate: string;             // YYYY-MM-DD
  guessCount: number;             // number of guesses submitted
  solved: boolean | null;         // null = in-progress, true = won, false = lost
};

export type Stats = {
  gamesPlayed: number;
  wins: number;
  winPct: number;                 // 0..100
  currentStreak: number;
  maxStreak: number;
  guessDistribution: number[];    // length MAX_GUESSES, index 0 = 1-guess wins
};

export function computeStats(attempts: NormalizedAttempt[]): Stats {
  if (attempts.length === 0) {
    return {
      gamesPlayed: 0, wins: 0, winPct: 0,
      currentStreak: 0, maxStreak: 0,
      guessDistribution: new Array(MAX_GUESSES).fill(0),
    };
  }

  let wins = 0;
  let played = 0;
  const dist = new Array(MAX_GUESSES).fill(0);
  for (const a of attempts) {
    if (a.guessCount > 0 || a.solved !== null) played++;
    if (a.solved === true) {
      wins++;
      const slot = Math.max(0, Math.min(MAX_GUESSES - 1, a.guessCount - 1));
      dist[slot] += 1;
    }
  }

  // Streaks — walk by date ascending. Treat any LOST or IN-PROGRESS
  // (solved !== true) day as a streak-breaker. Missing days (no
  // attempt at all for a date the user might have played) also break
  // the streak, but in practice we don't know which days the user
  // saw without joining against puzzle_picks history. For v1 we
  // collapse: consecutive wins count as a streak even across "didn't
  // play" days. That's looser than Wordle but defensible for an
  // early-stage game.
  const sorted = [...attempts].sort((a, b) => a.puzzleDate.localeCompare(b.puzzleDate));
  let cur = 0;
  let maxStreak = 0;
  for (const a of sorted) {
    if (a.solved === true) {
      cur += 1;
      if (cur > maxStreak) maxStreak = cur;
    } else {
      cur = 0;
    }
  }
  // currentStreak: trailing run of solved attempts when we walk the
  // sorted attempts and stop at the most recent.
  let currentStreak = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]!.solved === true) currentStreak += 1;
    else break;
  }

  const winPct = played === 0 ? 0 : Math.round((wins / played) * 100);

  return { gamesPlayed: played, wins, winPct, currentStreak, maxStreak, guessDistribution: dist };
}
