// ESPN team-schedule fetch, used by team pages to locate a team's most
// recent completed game (its date + event id) without scanning day-by-day
// through daily_raw. One call returns the whole season's schedule with
// per-game completion state; the team-page loader then leans on the daily
// bundle (loadFootballData) for standings/leaders/box, keyed to that date.

import type { FootballLeagueConfig } from "../leagues";
import { summaryUrl } from "./espn";

const FOOTBALL_BASE = "https://site.api.espn.com/apis/site/v2/sports/football";

export type TeamScheduleEvent = {
  eventId: string;
  isoDate: string;    // UTC kickoff, e.g. "2026-01-04T21:25Z"
  week: number | null;
  completed: boolean;
  isHome: boolean;
  opponent: { abbr: string; name: string; location: string | null } | null;
  teamScore: number | null;   // this team's points (completed games)
  oppScore: number | null;
  won: boolean | null;        // null for ties / not-yet-played
  statusDetail: string;       // "Final" / "Sat 3:30 PM" / "Postponed"
};

type Competitor = {
  homeAway?: unknown;
  winner?: unknown;
  score?: unknown | { displayValue?: unknown; value?: unknown };
  team?: { abbreviation?: unknown; displayName?: unknown; location?: unknown };
};
type ScheduleJson = {
  events?: Array<{
    id?: unknown;
    date?: unknown;
    week?: { number?: unknown };
    competitions?: Array<{
      status?: { type?: { completed?: unknown; shortDetail?: unknown } };
      competitors?: Competitor[];
    }>;
  }>;
};

function scoreNum(score: unknown): number | null {
  if (typeof score === "number") return score;
  if (score && typeof score === "object") {
    const s = score as { value?: unknown; displayValue?: unknown };
    if (typeof s.value === "number") return s.value;
    const n = Number(s.displayValue);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(score);
  return Number.isFinite(n) ? n : null;
}

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

// One game's box summary, for roster aggregation. Concurrency is the caller's
// job (a full season is ~12–14 games); null on 404/parse failure so one bad
// game doesn't sink the roster.
export async function fetchGameSummary(cfg: FootballLeagueConfig, eventId: string): Promise<unknown | null> {
  return getJson(summaryUrl(cfg, eventId));
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
  const want = teamAbbr.toUpperCase();
  const out: TeamScheduleEvent[] = [];
  for (const e of events) {
    const eventId = typeof e.id === "string" ? e.id : null;
    const isoDate = typeof e.date === "string" ? e.date : null;
    if (!eventId || !isoDate) continue;
    const comp = e.competitions?.[0];
    const competitors = comp?.competitors ?? [];
    const mine = competitors.find(
      (c) => String(c.team?.abbreviation ?? "").toUpperCase() === want,
    );
    const opp = competitors.find((c) => c !== mine);
    const completed = comp?.status?.type?.completed === true;
    const teamScore = mine ? scoreNum(mine.score) : null;
    const oppScore = opp ? scoreNum(opp.score) : null;
    out.push({
      eventId,
      isoDate,
      week: typeof e.week?.number === "number" ? e.week.number : null,
      completed,
      isHome: String(mine?.homeAway ?? "") === "home",
      opponent: opp
        ? {
            abbr: String(opp.team?.abbreviation ?? ""),
            name: String(opp.team?.displayName ?? ""),
            location: opp.team?.location != null ? String(opp.team.location) : null,
          }
        : null,
      teamScore: completed ? teamScore : null,
      oppScore: completed ? oppScore : null,
      won:
        completed && teamScore != null && oppScore != null
          ? teamScore === oppScore
            ? null
            : teamScore > oppScore
          : null,
      statusDetail: String(comp?.status?.type?.shortDetail ?? ""),
    });
  }
  return out;
}
