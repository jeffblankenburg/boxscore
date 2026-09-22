// NHL league config + entry point. Pure config — data fetching lives in
// lib/hockey-daily.ts and lib/hockey.ts; this file only knows what's NHL-
// specific (the ESPN slug + how to compute the season year for a date).

import { loadHockeyData, type HockeyData } from "./hockey-daily";

export const NHL = {
  sportId: "nhl" as const,
  espnSlug: "nhl" as const,
  name: "NHL",
};

/**
 * ESPN labels NHL seasons by the END year — the 2025–26 season is "2026".
 * Regular season runs early October → mid-April; playoffs run April → June.
 * Anything from October onward in calendar-year N belongs to season N+1;
 * off-season months keep last season's number so a summer lookup still
 * resolves to a real standings table. (Same rule as the NBA.)
 */
export function seasonForDate(date: string): number {
  const [yearStr, monthStr] = date.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  return month >= 10 ? year + 1 : year;
}

export async function loadNhlData(
  date: string,
  opts?: { refetch?: boolean },
): Promise<HockeyData> {
  return loadHockeyData(date, seasonForDate(date), opts);
}
