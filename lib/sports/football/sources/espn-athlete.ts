// ESPN athlete fetch layer — the only I/O for football player pages. Two
// endpoints per player: the athlete "overview" (bio, current team, a season
// stats summary line) and the "gamelog" (per-game stat lines + season totals).
// Both are pure fetches; the adapter (../adapters/athlete-from-espn.ts) turns
// the raw envelope into canonical player-page data.
//
// Unlike the daily bundle, player pages are NOT cached in daily_raw — the
// public route renders them live under ISR (revalidate), the same way MLB's
// player page fetches statsapi on each cache window. So this file just returns
// the two raw JSON blobs; there's no slimming for storage.

import type { FootballLeagueConfig } from "../leagues";
import { espnJson } from "@/lib/espn-fetch";

const ATHLETE_BASE = "https://site.web.api.espn.com/apis/common/v3/sports/football";

/** Raw envelope for one athlete: the overview + a season's gamelog. Either
 *  half can be null if ESPN 404s (retired id, wrong league). */
export type FootballAthleteRaw = {
  league: FootballLeagueConfig["league"];
  athleteId: string;
  season: number;
  overview: unknown | null;
  gamelog: unknown | null;
};

async function getJson(url: string): Promise<unknown | null> {
  // Shared ESPN fetch (retries transient 403/429/5xx + browser UA) — see
  // lib/espn-fetch. 404 = unknown athlete id → null, not an error.
  return espnJson(url, { nullOn404: true });
}

export function athleteOverviewUrl(cfg: FootballLeagueConfig, athleteId: string): string {
  return `${ATHLETE_BASE}/${cfg.espnSlug}/athletes/${athleteId}`;
}

export function athleteGamelogUrl(
  cfg: FootballLeagueConfig,
  athleteId: string,
  season: number,
): string {
  return `${ATHLETE_BASE}/${cfg.espnSlug}/athletes/${athleteId}/gamelog?season=${season}`;
}

/** Fetch both halves of an athlete's page in parallel. Returns null overview
 *  when the id is unknown; the loader treats that as notFound. */
export async function fetchAthleteRaw(
  cfg: FootballLeagueConfig,
  athleteId: string,
  season: number,
): Promise<FootballAthleteRaw> {
  const [overview, gamelog] = await Promise.all([
    getJson(athleteOverviewUrl(cfg, athleteId)),
    getJson(athleteGamelogUrl(cfg, athleteId, season)),
  ]);
  return { league: cfg.league, athleteId, season, overview, gamelog };
}
