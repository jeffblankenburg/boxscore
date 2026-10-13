// NCAA women's basketball league config + entry point. Identical to lib/ncaam.ts
// apart from the ESPN slug; college basketball season-year convention is the
// END year (the 2025-26 season is "2026").

import { loadBasketballDataFor, type BasketballData } from "./basketball-daily";

export const NCAAW = {
  sportId: "ncaaw" as const,
  espnSlug: "womens-college-basketball" as const,
  name: "NCAA Women's Basketball",
};

export function seasonForDate(date: string): number {
  const [yearStr, monthStr] = date.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  return month >= 10 ? year + 1 : year;
}

export async function loadNcaawData(
  date: string,
  opts?: { refetch?: boolean },
): Promise<BasketballData> {
  return loadBasketballDataFor(NCAAW.sportId, date, seasonForDate(date), opts);
}
