// ESPN team-schedule fetch, used by team pages to locate a team's most
// recent completed game (its date + event id) without scanning day-by-day
// through daily_raw. One call returns the whole season's schedule with
// per-game completion state; the team-page loader then leans on the daily
// bundle (loadFootballData) for standings/leaders/box, keyed to that date.

import type { FootballLeagueConfig } from "../leagues";

const FOOTBALL_BASE = "https://site.api.espn.com/apis/site/v2/sports/football";

export type TeamScheduleEvent = {
  eventId: string;
  isoDate: string;    // UTC kickoff, e.g. "2026-01-04T21:25Z"
  week: number | null;
  completed: boolean;
};

type ScheduleJson = {
  events?: Array<{
    id?: unknown;
    date?: unknown;
    week?: { number?: unknown };
    competitions?: Array<{ status?: { type?: { completed?: unknown } } }>;
  }>;
};

async function getJson(url: string): Promise<unknown | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if (attempt === 2 || res.status < 500) throw new Error(`ESPN ${res.status} for ${url}`);
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error("unreachable");
}

export function teamScheduleUrl(cfg: FootballLeagueConfig, teamAbbr: string, season: number): string {
  return `${FOOTBALL_BASE}/${cfg.espnSlug}/teams/${teamAbbr.toLowerCase()}/schedule?season=${season}`;
}

/** A team's full season schedule as flat events, oldest first. Empty when
 *  the team/season is unknown (offseason before a schedule is published). */
export async function fetchTeamSchedule(
  cfg: FootballLeagueConfig,
  teamAbbr: string,
  season: number,
): Promise<TeamScheduleEvent[]> {
  const json = (await getJson(teamScheduleUrl(cfg, teamAbbr, season))) as ScheduleJson | null;
  const events = json?.events ?? [];
  const out: TeamScheduleEvent[] = [];
  for (const e of events) {
    const eventId = typeof e.id === "string" ? e.id : null;
    const isoDate = typeof e.date === "string" ? e.date : null;
    if (!eventId || !isoDate) continue;
    out.push({
      eventId,
      isoDate,
      week: typeof e.week?.number === "number" ? e.week.number : null,
      completed: e.competitions?.[0]?.status?.type?.completed === true,
    });
  }
  return out;
}
