// Next scheduled game per sport, for the offseason landing page (/[sport]).
// When a league is between seasons the landing page shows a countdown to its
// return; this resolves the anchor date from the published schedule feed, or
// null when the next season isn't on the schedule yet (deep offseason) — the
// caller then falls back to a month-level "returns in <Month>" from
// seasonStartMonth().
//
// The anchor MUST match the date the landing page flips back to showing a
// digest, which depends on how each generator classifies mode
// (app/api/cron/generate/route.ts):
//   - basketball/football tag any game day in-season, so they flip at the first
//     scheduled game (preseason included) → earliest game in range.
//   - MLB tags spring training as "preseason" (excluded from getLatestDigest),
//     so it flips only at Opening Day → earliest REGULAR-season game in range.
// Get this wrong and the countdown hits zero while the page is still offseason.

import { fetchScoreboardRangeRaw } from "@/lib/basketball";
import { fetchScheduleRangeRaw } from "@/lib/mlb";
import { footballLeagueConfig } from "@/lib/sports/football/leagues";
import { nextScoreboardUrl } from "@/lib/sports/football/sources/espn";
import type { FootballLeague } from "@/lib/sports/football/types";
import { addDaysToISO, nextDay, yesterdayInET } from "@/lib/dates";

// Far enough to catch the next opener from deep in an offseason (MLB's is the
// longest gap: a ~4.5-month winter). We take the earliest match, so a big
// window never over-reaches.
const LOOKAHEAD_DAYS = 240;

// Season-start month per sport, for the fallback when the next schedule isn't
// published yet. Stable, well-known openers (see the seasonForDate conventions
// in lib/nba.ts, lib/wnba.ts, lib/sports/football/leagues.ts, and MLB's
// Nov–Feb offseason in lib/mlb-digest-mode.ts).
const SEASON_START_MONTH: Record<string, string> = {
  mlb: "March",
  nba: "October",
  wnba: "May",
  nfl: "September",
  ncaaf: "August",
  nhl: "October",
};

export function seasonStartMonth(sport: string): string | null {
  return SEASON_START_MONTH[sport] ?? null;
}

// 6h in-process cache: the next-game date barely moves, and the offseason page
// shouldn't hit ESPN/statsapi on every render. Mirrors the visibility-override
// cache in lib/sports.ts — per-instance, best-effort, no cross-instance sync.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: string | null }>();

function earliestEspnEventDate(raw: unknown): string | null {
  const events = (raw as { events?: Array<{ date?: string }> }).events ?? [];
  let min: string | null = null;
  for (const e of events) {
    const d = typeof e.date === "string" ? e.date.slice(0, 10) : null;
    if (d && (min === null || d < min)) min = d;
  }
  return min;
}

function earliestMlbRegularDate(raw: unknown): string | null {
  const dates = (raw as {
    dates?: Array<{ date?: string; games?: Array<{ gameDate?: string; gameType?: string }> }>;
  }).dates ?? [];
  let min: string | null = null;
  for (const d of dates) {
    for (const g of d.games ?? []) {
      if (g.gameType !== "R") continue; // regular season only — skip spring training
      const iso = typeof g.gameDate === "string" ? g.gameDate.slice(0, 10) : d.date;
      if (iso && (min === null || iso < min)) min = iso;
    }
  }
  return min;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "user-agent": "boxscore.email" } });
  if (!res.ok) throw new Error(`espn ${res.status}`);
  return res.json();
}

async function lookup(sport: string): Promise<string | null> {
  const today = nextDay(yesterdayInET());
  const start = addDaysToISO(today, 1);
  const end = addDaysToISO(today, LOOKAHEAD_DAYS);
  if (sport === "nba" || sport === "wnba") {
    return earliestEspnEventDate(await fetchScoreboardRangeRaw(sport, start, end));
  }
  if (sport === "nfl" || sport === "ncaaf") {
    const cfg = footballLeagueConfig(sport as FootballLeague);
    return earliestEspnEventDate(await getJson(nextScoreboardUrl(cfg, today, LOOKAHEAD_DAYS)));
  }
  if (sport === "mlb") {
    return earliestMlbRegularDate(await fetchScheduleRangeRaw(start, end));
  }
  return null;
}

/**
 * Earliest scheduled game date (ISO YYYY-MM-DD) for the sport, or null when the
 * schedule doesn't reach that far yet. Cached ~6h; a fetch failure returns null
 * so the caller shows the month-level fallback rather than erroring the page.
 */
export async function nextScheduledGameDate(sport: string): Promise<string | null> {
  const hit = cache.get(sport);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  let value: string | null = null;
  try {
    value = await lookup(sport);
  } catch {
    value = null;
  }
  cache.set(sport, { at: Date.now(), value });
  return value;
}
