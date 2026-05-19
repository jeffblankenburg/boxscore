// WNBA league config + entry point. Same architecture as lib/nba.ts; the
// only WNBA-specific bits are the slug and the season-year convention
// (single calendar year, unlike the NBA's two-year span).

import { loadBasketballDataFor, type BasketballData } from "./basketball-daily";

export const WNBA = {
  sportId: "wnba" as const,
  espnSlug: "wnba" as const,
  name: "WNBA",
};

/**
 * WNBA seasons are named by the single calendar year they're played in
 * (the 2026 season runs May–October 2026). For any date, the season is
 * just the year component.
 */
export function seasonForDate(date: string): number {
  return Number(date.slice(0, 4));
}

export async function loadWnbaData(
  date: string,
  opts?: { refetch?: boolean },
): Promise<BasketballData> {
  return loadBasketballDataFor(WNBA.sportId, date, seasonForDate(date), opts);
}
