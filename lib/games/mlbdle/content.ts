// MLBdle puzzle content. For v0 this is hardcoded — one puzzle, every
// visit. Once #56 (player-line feat scorer + backfill) and #57 (daily
// picker) ship, this swaps to a real daily pick from feat-scored lines.
//
// The shape here is what the daily picker will eventually return, so
// the client-side code can stay stable across the swap.

import { normalize } from "./feedback";

export type MlbdlePuzzle = {
  // The answer the player is guessing. Stored as the canonical
  // normalized form (no spaces, no accents, uppercase) — matches what
  // the guess scorer expects.
  answer: string;
  // What the reveal shows. Preserves spaces and accents.
  displayName: string;
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
// performances in modern MLB. Used in the original MLBdle pitch as
// the 13-tile reference case.
const PEDRO_1999_09_10: MlbdlePuzzle = {
  answer: normalize("Pedro Martinez"),
  displayName: "Pedro Martínez",
  line: {
    kind: "pitching",
    date: "1999-09-10",
    teamAbbr: "BOS",
    oppAbbr: "NYY",
    pitching: {
      ip: "9.0",
      h: 1,
      r: 0,
      er: 0,
      bb: 0,
      so: 17,
      hr: 1,           // the lone hit was a Chili Davis solo HR
    },
  },
};

// "Today's puzzle" — for v0, the same one regardless of date. Replace
// with a real picker query once #57 lands.
export function getTodaysPuzzle(): MlbdlePuzzle {
  return PEDRO_1999_09_10;
}
