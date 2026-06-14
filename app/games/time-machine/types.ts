// Time Machine — guess the year of a real MLB box score.

export const MAX_GUESSES = 6;
export const MIN_YEAR    = 1950;

export type Hint = "higher" | "lower" | "correct";

export type Guess = {
  year: number;
  hint: Hint;
};

/** Per-subscriber state persisted to puzzle_attempts.guesses and
 * mirrored in localStorage. answerYear is filled in only once the run
 * ends — keeping it inside the persisted blob means a resumed end-
 * screen can still display the correct year without another server
 * call. (Pre-end resumes never see it because the server only releases
 * the year on the final scoreGuess.) */
export type PersistedAttempt = {
  guesses:      Guess[];
  ended:        boolean;
  answerYear?:  number;
};

/** Public payload the server hands to the client. Notably excludes the
 * answer year — that only travels back when the game ends (in the
 * scoreGuess response). */
export type PublicGame = {
  boxHtml:    string;
  awayName:   string;
  homeName:   string;
  awayScore:  number;
  homeScore:  number;
  gameType:   string | null;
};

export type ScoreResult = {
  hint:        Hint;
  /** Only present when hint === "correct" or guesses exhausted. */
  answerYear?: number;
};
