// Canonical model for a football player page — source-agnostic, mirroring
// the daily model in ./types.ts. The renderer (./render/player.ts) and the
// route consume only these types; the ESPN athlete shapes stay behind the
// adapter (./adapters/athlete-from-espn.ts).
//
// A player page is: a bio header, a season stats summary line, and one
// game-log table per stat category the player accumulated (a QB gets
// Passing + Rushing; a receiver gets Receiving; a defender gets Defense).
// ESPN's gamelog already groups the flat stat columns into these categories,
// so the model keeps that grouping rather than inventing position logic.

import type { FootballLeague } from "./types";

export type FootballAthleteBio = {
  id: string;                 // ESPN athlete id
  league: FootballLeague;
  fullName: string;
  slug: string;               // name slug WITHOUT the id suffix ("josh-allen")
  jersey: string | null;
  position: string | null;    // "QB", "RB", "WR", "LB", …
  teamAbbr: string | null;
  teamSlug: string | null;    // canonical slug for linking to the team page
  teamName: string | null;
  height: string | null;      // display "6' 5\""
  weight: string | null;      // display "237 lbs"
  college: string | null;
  headshot: string | null;    // image URL, null if none
  experience: number | null;  // years in league
};

/** One row of a category's game log. `cells` is parallel to the section's
 *  `columns`; values are ESPN's already-formatted display strings ("3,668",
 *  "68.5") so the renderer never re-formats. */
export type FootballGameLogRow = {
  eventId: string;
  week: number | null;
  date: string;               // ISO datetime
  oppAbbr: string;
  atVs: "@" | "vs";
  result: "W" | "L" | "T" | null;
  score: string | null;       // "33-30 OT" as ESPN presents it
  cells: string[];
};

export type FootballStatColumn = {
  name: string;               // schema key ("passingYards")
  label: string;              // header ("YDS")
};

/** One stat category's game log + season totals. */
export type FootballStatSection = {
  key: string;                // "passing" | "rushing" | "receiving" | "defensive" | …
  label: string;              // "Passing"
  columns: FootballStatColumn[];
  rows: FootballGameLogRow[]; // newest game first
  totals: string[] | null;    // parallel to columns; null when the feed omits them
};

/** A single stat from the season summary line, with its league rank. */
export type FootballSeasonSummaryStat = {
  label: string;              // "Passing Yards"
  value: string;              // "3,668"
  rank: string | null;        // "11th", null when unranked
};

export type FootballPlayerPageData = {
  bio: FootballAthleteBio;
  season: number;             // the season actually shown (may be prior year in the offseason)
  summary: FootballSeasonSummaryStat[];
  sections: FootballStatSection[];
};
