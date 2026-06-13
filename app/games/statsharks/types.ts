// Shared Stat Sharks types + constants. Lives outside actions.ts
// because Next.js "use server" files may only export async functions
// — types and consts move here so the client + server both import
// from a regular module.

import type { StatKey } from "@/lib/games/statsharks/stats";

export const DAILY_ROUND_COUNT = 10;

// ─── Pair shapes ─────────────────────────────────────────────────

/** Public card — what the client sees BEFORE a round is scored. No
 * stat value; the value is only revealed by scorePair() after the
 * user picks. */
export type PublicCard = {
  id:          number;
  player_name: string;
  season:      number;
  team_abbr:   string | null;
};

export type PublicPair = {
  left:  PublicCard;
  right: PublicCard;
};

/** Public card list for the daily 10-round sequence. Stat values stay
 * hidden — they're only revealed when the user scores a round. */
export type DailyPublicPair = {
  left:  PublicCard;
  right: PublicCard;
};

export type ScoreResult = {
  leftValue:   number;
  rightValue:  number;
  correctSide: "left" | "right";
  wasCorrect:  boolean;
};

// ─── Persisted attempt shape ─────────────────────────────────────

// Persisted history per attempt — stored in puzzle_attempts (for
// authed Daily) + localStorage (for anonymous Daily + all Endless).
export type PersistedRound = {
  leftId:      number;
  rightId:     number;
  pickedSide:  "left" | "right" | "timeout";
  wasCorrect:  boolean;
};
export type PersistedAttempt = {
  stat:    StatKey;
  rounds:  PersistedRound[];
  ended:   boolean;
};
