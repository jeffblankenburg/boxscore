// NCAA men's basketball league config + entry point. Same architecture as
// lib/nba.ts; the NCAAM-specific bits are the ESPN slug and the season-year
// convention (END year, like the NBA — the 2025-26 season is "2026").

import { loadBasketballDataFor, type BasketballData } from "./basketball-daily";

export const NCAAM = {
  sportId: "ncaam" as const,
  espnSlug: "mens-college-basketball" as const,
  name: "NCAA Men's Basketball",
};

/**
 * College basketball seasons are named by the END year (the 2025-26 season is
 * "2026"). The season runs roughly November → April, so any date from October
 * on (exhibitions start late October) belongs to the season ending the
 * following year.
 */
export function seasonForDate(date: string): number {
  const [yearStr, monthStr] = date.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  return month >= 10 ? year + 1 : year;
}

export async function loadNcaamData(
  date: string,
  opts?: { refetch?: boolean },
): Promise<BasketballData> {
  return loadBasketballDataFor(NCAAM.sportId, date, seasonForDate(date), opts);
}
