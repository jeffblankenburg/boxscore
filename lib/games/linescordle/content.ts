// Linescordle puzzle content. For v0 this is hardcoded — one puzzle, every
// visit. Once #56 (player-line feat scorer + backfill) and #57 (daily
// picker) ship, this swaps to a real daily pick from feat-scored lines.
//
// IMPORTANT: this module is server-only. The `LinescordlePuzzle` type
// carries the answer, the displayName, and the source-game gamePk —
// none of which can ship to the client without leaking the puzzle.
// Clients receive `LinescordlePuzzlePublic` instead, which strips those
// fields and is what page.tsx hands to <LinescordleGame />. Guess scoring,
// hint reveal, and the post-game reveal all run as server actions in
// app/games/linescordle/actions.ts.

import "server-only";

import { normalize } from "./feedback";

export type LinescordlePuzzle = {
  // The answer the player is guessing. Stored as the canonical
  // normalized form (no spaces, no accents, uppercase) — matches what
  // the guess scorer expects.
  answer: string;
  // What the reveal shows. Preserves spaces and accents.
  displayName: string;
  // Vendor id for the player; the reveal server-fetches career stats
  // from /api/v1/people/{mlbId}/stats and the profile from our players
  // cache via mlb_id.
  mlbId: number;
  // gamePk of the source game. The reveal shows the full box score for
  // this game via the standard renderGame() helper.
  sourceGamePk: number;
  // The clue: a single-game performance line.
  line: {
    kind: "batting" | "pitching";
    date: string;            // YYYY-MM-DD
    teamAbbr: string;        // pitcher's / batter's team
    oppAbbr: string;         // opponent — shown without "vs" / "at" to keep it neutral
    // Pitching line columns. Populated only when kind === "pitching".
    pitching?: {
      ip: string;            // "9.0"
      h: number;
      r: number;
      er: number;
      bb: number;
      so: number;
      hr: number;
    };
    // Batting line columns. Populated only when kind === "batting".
    batting?: {
      ab: number;
      r: number;
      h: number;
      rbi: number;
      bb: number;
      so: number;
      hr: number;
      doubles: number;
      triples: number;
      sb: number;
    };
  };
};

// v0 hardcoded puzzle: Pedro Martínez, Sep 10 1999. 9 IP, 1 H, 0 R,
// 0 BB, 17 K vs Yankees — one of the most-cited single-game pitching
// performances in modern MLB.
const PEDRO_1999_09_10: LinescordlePuzzle = {
  answer: normalize("Pedro Martinez"),
  displayName: "Pedro Martínez",
  mlbId: 118377,
  sourceGamePk: 2866,
  line: {
    kind: "pitching",
    date: "1999-09-10",
    teamAbbr: "BOS",
    oppAbbr: "NYY",
    pitching: {
      ip: "9.0",
      h: 1,
      r: 1,            // Chili Davis solo HR
      er: 1,
      bb: 0,
      so: 17,
      hr: 1,
    },
  },
};

// Test puzzles for screenshot-driven verification that the tile grid
// adapts to different name lengths. Not surfaced in production — only
// the page can opt in via a ?test= query param while NODE_ENV !==
// production. Real player lines so the rendered clue still parses.
const BABERUTH_1928: LinescordlePuzzle = {
  answer: normalize("Babe Ruth"),
  displayName: "Babe Ruth",
  mlbId: 121578,         // Babe Ruth's MLB Stats API person id
  sourceGamePk: 0,        // placeholder — test puzzle only, no box score wiring
  line: {
    kind: "batting",
    date: "1928-05-21",
    teamAbbr: "NYY",
    oppAbbr: "STL",
    batting: { ab: 5, r: 3, h: 3, rbi: 4, bb: 0, so: 1, hr: 3, doubles: 0, triples: 0, sb: 0 },
  },
};
const YAZ_1967: LinescordlePuzzle = {
  answer: normalize("YAZ"),
  displayName: "Yaz",
  mlbId: 122941,          // Carl Yastrzemski's MLB Stats API person id
  sourceGamePk: 0,        // placeholder — test puzzle only
  line: {
    kind: "batting",
    date: "1967-10-01",
    teamAbbr: "BOS",
    oppAbbr: "MIN",
    batting: { ab: 4, r: 1, h: 4, rbi: 2, bb: 0, so: 0, hr: 1, doubles: 0, triples: 0, sb: 0 },
  },
};

const TEST_PUZZLES: Record<string, LinescordlePuzzle> = {
  pedro: PEDRO_1999_09_10,
  babe:  BABERUTH_1928,
  yaz:   YAZ_1967,
};

// Stable subject ids for v0. Each puzzle has its own; the picker (#57)
// will assign these by puzzle_picks.id later. The id is the only
// identifier the client receives — the server resolves it back to the
// full puzzle inside actions.
const PUZZLE_BY_SUBJECT_ID: Record<string, LinescordlePuzzle> = {
  "v0-pedro-1999-09-10": PEDRO_1999_09_10,
  "v0-baberuth-1928":    BABERUTH_1928,
  "v0-yaz-1967":         YAZ_1967,
};

// "Today's puzzle" — for v0, the same one regardless of date. Replace
// with a real picker query once #57 lands. Returns both the subject_id
// (which the client receives) and the full puzzle (server-side only).
//
// Test key (NODE_ENV !== 'production' only) lets us render any of the
// `TEST_PUZZLES` map values for screenshot verification of tile-grid
// adaptation across different name lengths.
export function getTodaysPuzzle(testKey?: string): { subjectId: string; puzzle: LinescordlePuzzle } {
  if (testKey && process.env.NODE_ENV !== "production") {
    if (testKey === "babe") return { subjectId: "v0-baberuth-1928",    puzzle: BABERUTH_1928 };
    if (testKey === "yaz")  return { subjectId: "v0-yaz-1967",         puzzle: YAZ_1967 };
  }
  return { subjectId: "v0-pedro-1999-09-10", puzzle: PEDRO_1999_09_10 };
}

// Server-side resolver: subject_id → puzzle. Used by every action
// (submitGuess, revealHint, getReveal) to look the puzzle back up
// when the client sends the subject_id it received.
//
// Two sources:
//   - Hardcoded test puzzles (the v0 fallbacks + dev test keys), keyed
//     by their literal subject_id ('v0-pedro-1999-09-10' etc).
//   - Live picker puzzles, where subject_id is `line-NNNNN` referring
//     to a historical_player_lines row. Resolution there hits the DB.
//
// Importing the picker dynamically because picker.ts depends on
// players + the DB; pulling it eagerly would force every consumer of
// the puzzle type to also depend on the DB stack.
export async function getPuzzleBySubjectId(subjectId: string): Promise<LinescordlePuzzle | null> {
  if (PUZZLE_BY_SUBJECT_ID[subjectId]) return PUZZLE_BY_SUBJECT_ID[subjectId];
  const { resolveLineSubject } = await import("./picker-resolve");
  return resolveLineSubject(subjectId);
}

// The shape we hand to the client. Strips the answer, displayName,
// mlbId, and sourceGamePk so none of those appear in page source.
// Line stats are visible-by-default in the clue card, so they stay.
export type LinescordlePuzzlePublic = {
  subjectId: string;
  nameLength: number;
  line: LinescordlePuzzle["line"];
};

export function toPublicPuzzle(subjectId: string, puzzle: LinescordlePuzzle): LinescordlePuzzlePublic {
  return {
    subjectId,
    nameLength: puzzle.answer.length,
    line: puzzle.line,
  };
}
