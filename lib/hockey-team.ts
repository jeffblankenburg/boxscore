// Per-team NHL digest data. Single-league port of lib/basketball-team.ts: one
// read of the cached daily payload, then filter every section to the team. No
// per-team ESPN calls beyond the roster endpoint — games, box scores,
// standings, the upcoming window, transactions all come from the daily_raw row.

import type { Team } from "./teams";
import { findTeam } from "./teams";
import {
  loadHockeyRaw,
  rawToHockeyData,
  transactionsSinceLastTeamGame,
  type HockeyData,
  type HockeyGameDetail,
} from "./hockey-daily";
import {
  fetchTeamRosterRaw,
  parseRoster,
  athleteStatsById,
  teamAthletes,
  type HockeyScoreboardEvent,
  type HockeyConferenceStandings,
  type HockeyStandingsEntry,
  type HockeyTransaction,
} from "./hockey";
import { seasonForDate } from "./nhl";
import { prettyDate } from "./dates";

export type HockeyTeamMode = "game" | "no-game" | "offseason";

export type HockeyTeamPlayer = {
  id: string;
  name: string;
  jersey?: string;
  position?: string;   // "C" | "LW" | "RW" | "D" | "G"
  injured: boolean;
  stats: Record<string, number>;
};

export type HockeyTeamData = {
  team: Team;
  espnId: string;
  date: string;
  prettyDate: string;
  mode: HockeyTeamMode;
  games: HockeyGameDetail[];
  conference: HockeyConferenceStandings | null;
  teamRank: number | null;
  record: { wins: number; losses: number; otLosses: number } | null;
  roster: HockeyTeamPlayer[];
  upcoming: HockeyScoreboardEvent[];
  transactions: HockeyTransaction[];
};

function extractTeamAthletes(rawAthleteStats: unknown, abbr: string): HockeyTeamPlayer[] {
  return teamAthletes(rawAthleteStats, abbr).map((a) => ({
    id: a.id,
    name: a.name,
    position: a.position || undefined,
    injured: false,
    stats: a.stats,
  }));
}

function resolveEspnTeam(data: HockeyData, team: Team): { id: string; abbr: string } | null {
  const matches = (t: { name: string; displayName: string }) =>
    t.displayName === team.name || t.name === team.nickname;
  for (const c of data.standings.conferences) {
    for (const e of c.entries) {
      if (matches(e.team)) return { id: e.team.id, abbr: e.team.abbreviation };
    }
  }
  for (const ev of [...data.games.map((g) => g.event), ...data.upcomingEvents]) {
    for (const side of [ev.away, ev.home]) {
      if (matches(side.team)) return { id: side.team.id, abbr: side.team.abbreviation };
    }
  }
  return null;
}

export async function loadHockeyTeamData(
  slug: string,
  date: string,
  opts?: { refetch?: boolean },
): Promise<HockeyTeamData> {
  const team = findTeam("nhl", slug);
  if (!team) throw new Error(`unknown nhl team: ${slug}`);

  const raw = await loadHockeyRaw(date, seasonForDate(date), opts);
  const data = rawToHockeyData(raw, date);
  const espn = resolveEspnTeam(data, team) ?? { id: "", abbr: team.abbreviation };

  const isTeamEvent = (e: HockeyScoreboardEvent) =>
    e.away.team.id === espn.id || e.home.team.id === espn.id;

  const games = data.games.filter((g) => isTeamEvent(g.event));
  const upcoming = data.upcomingEvents.filter(isTeamEvent).sort((a, b) => a.date.localeCompare(b.date));

  const conference =
    data.standings.conferences.find((c) => c.entries.some((en) => en.team.id === espn.id)) ?? null;
  const teamIdx = conference ? conference.entries.findIndex((en) => en.team.id === espn.id) : -1;
  const entry: HockeyStandingsEntry | null =
    conference && teamIdx >= 0 ? conference.entries[teamIdx]! : null;
  const record = entry
    ? {
        wins: entry.stats.wins?.value ?? 0,
        losses: entry.stats.losses?.value ?? 0,
        otLosses: entry.stats.otLosses?.value ?? 0,
      }
    : null;

  const statsById = athleteStatsById(raw.athleteStats);
  let roster: HockeyTeamPlayer[];
  try {
    if (!espn.id) throw new Error("no ESPN team id");
    const rosterRaw = await fetchTeamRosterRaw(espn.id);
    roster = parseRoster(rosterRaw).map((r) => ({ ...r, stats: statsById.get(r.id) ?? {} }));
  } catch (err) {
    console.error(`[hockey-team] roster fetch failed for ${slug}: ${(err as Error).message}`);
    roster = extractTeamAthletes(raw.athleteStats, espn.abbr);
  }
  // Skaters ranked by points; goalies (no points) sink but the renderer splits
  // them into their own table anyway.
  roster.sort((a, b) => (b.stats.points ?? -1) - (a.stats.points ?? -1));

  const transactions = await transactionsSinceLastTeamGame(slug, espn.abbr, date);
  const mode: HockeyTeamMode =
    games.length > 0 ? "game" : upcoming.length > 0 ? "no-game" : "offseason";

  return {
    team,
    espnId: espn.id,
    date,
    prettyDate: prettyDate(date),
    mode,
    games,
    conference,
    teamRank: teamIdx >= 0 ? teamIdx + 1 : null,
    record,
    roster,
    upcoming,
    transactions,
  };
}
