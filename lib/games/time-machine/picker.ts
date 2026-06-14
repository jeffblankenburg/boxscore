// Time Machine daily puzzle picker. Given a calendar date, deterministically
// pick one historical regular-season MLB game. Two paths:
//
//   1. MM-DD match — every regular-season game played on this calendar day
//      across 1950+ is eligible; pick one by hashing playedOn.
//   2. Off-season fallback — if no real game was played on this MM-DD (Dec/
//      Jan/Feb), pick a deterministically-random regular-season game from
//      any historical date so the daily puzzle never goes dark.
//
// Stays pure (no caching). actions.ts wraps this with a puzzle_picks
// read-or-create so the chosen gamePk is frozen once the first subscriber
// of the day loads the page.

import { listHistoricalGames } from "@/lib/historical/queries";

const MIN_SEASON = 1950;

// djb2 — small, deterministic, dependency-free.
function hashSeed(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** Pick today's gamePk. Throws only if even the fallback finds nothing,
 * which would mean the historical_games table is empty. */
export async function pickDailyGame(playedOn: string): Promise<number> {
  const [, mm, dd] = playedOn.split("-");
  const mmdd = `${mm}-${dd}`;

  const { rows: sameDay } = await listHistoricalGames({
    calendarDay: mmdd,
    gameType:    "R",
    sort:        "date_desc",
    limit:       200,
  });
  if (sameDay.length > 0) {
    const row = sameDay[hashSeed(playedOn) % sameDay.length];
    if (row) return row.game_pk;
  }

  // Off-season fallback. Probe random regular-season dates until we
  // find one with games. 50 attempts is overkill — any seeded April–Oct
  // date from 1950+ almost certainly has games.
  const currentYear = new Date().getUTCFullYear();
  const yearsAvailable = currentYear - MIN_SEASON + 1;
  const regularMonths = [4, 5, 6, 7, 8, 9, 10];

  for (let attempt = 0; attempt < 50; attempt++) {
    const s = hashSeed(`${playedOn}|${attempt}`);
    const year  = MIN_SEASON + (s % yearsAvailable);
    const month = regularMonths[(s >>> 16) % regularMonths.length];
    const day   = 1 + ((s >>> 8) % 28);
    const date  = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const { rows } = await listHistoricalGames({
      fromDate: date, toDate: date, gameType: "R", limit: 50,
    });
    if (rows.length > 0) {
      const row = rows[s % rows.length];
      if (row) return row.game_pk;
    }
  }

  // Last resort — grab any regular-season game.
  const { rows } = await listHistoricalGames({ gameType: "R", limit: 50, sort: "date_desc" });
  if (rows.length === 0) throw new Error("pickDailyGame: no historical games available");
  const row = rows[hashSeed(playedOn) % rows.length];
  if (!row) throw new Error("pickDailyGame: index out of bounds");
  return row.game_pk;
}
