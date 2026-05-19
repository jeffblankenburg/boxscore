// NBA league config + entry point. Pure config — the data fetching lives
// in lib/basketball-daily.ts and lib/basketball.ts; this file only knows
// what's NBA-specific (the ESPN slug + how to compute the season year for
// a given date).

import { loadBasketballDataFor, type BasketballData } from "./basketball-daily";

export const NBA = {
  sportId: "nba" as const,
  espnSlug: "nba" as const,
  name: "NBA",
};

/**
 * ESPN labels NBA seasons by the END year — the 2025–26 season is "2026".
 * Regular season runs late October → mid-April; playoffs and Finals run
 * April → June. Anything from October onward in calendar-year N belongs to
 * season N+1. Off-season months (July–September) keep last season's number
 * so a lookup during summer still resolves to a real standings table.
 */
export function seasonForDate(date: string): number {
  const [yearStr, monthStr] = date.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  return month >= 10 ? year + 1 : year;
}

export async function loadNbaData(
  date: string,
  opts?: { refetch?: boolean },
): Promise<BasketballData> {
  return loadBasketballDataFor(NBA.sportId, date, seasonForDate(date), opts);
}
