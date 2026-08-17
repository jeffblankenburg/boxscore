// Per-team NBA/WNBA digest data. Modeled on the MLB team digest
// (lib/render-team-email.ts) but built on the football "bundle + filter"
// pattern: one read of the cached daily payload, then filter every section to
// the subscribed team. No per-team ESPN calls — games, box scores, standings,
// the 14-day upcoming window, transactions, and full per-team rosters all come
// from the same daily_raw row the league digest uses.

import type { Team } from "./teams";
import { findTeam } from "./teams";
import {
  loadBasketballRawFor,
  rawToBasketballData,
  transactionsSinceLastTeamGame,
  type BasketballData,
  type BasketballGameDetail,
} from "./basketball-daily";
import {
  fetchTeamRosterRaw,
  parseRoster,
  athleteStatsById,
  teamAthletes,
  type BasketballScoreboardEvent,
  type BasketballConferenceStandings,
  type BasketballStandingsEntry,
  type BasketballTransaction,
  type BasketballLeagueSlug,
} from "./basketball";
import { seasonForDate as nbaSeasonForDate } from "./nba";
import { seasonForDate as wnbaSeasonForDate } from "./wnba";
import { prettyDate } from "./dates";

// Same three-way split as the MLB team digest: the team played on the digest
// date; the season's live but they were off; or the season's over.
export type BasketballTeamMode = "game" | "no-game" | "offseason";

// One full-roster player: identity from ESPN's roster endpoint, season averages
// joined from the byathlete feed (empty for players who haven't logged a game).
export type BasketballTeamPlayer = {
  id: string;
  name: string;
  jersey?: string;
  position?: string;
  injured: boolean;
  stats: Record<string, number>;
};

export type BasketballTeamData = {
  sport: BasketballLeagueSlug;
  team: Team;
  // ESPN's own team id, resolved from the payload (teams.ts abbreviations
  // disagree with ESPN's). The renderer uses it to highlight the team's row.
  espnId: string;
  date: string;
  prettyDate: string;
  mode: BasketballTeamMode;
  // The team's game(s) on the digest date — usually 0 or 1 (basketball has no
  // doubleheaders, but keep it a list to mirror the box-score section shape).
  games: BasketballGameDetail[];
  // The team's conference standings table + their 1-based position in it, so
  // the renderer can show the full table with the team highlighted.
  conference: BasketballConferenceStandings | null;
  teamRank: number | null;
  record: { wins: number; losses: number } | null;
  // Full roster (from ESPN's roster endpoint) with season averages joined in,
  // sorted by scoring; players yet to appear sink to the bottom.
  roster: BasketballTeamPlayer[];
  // The team's scheduled games in the 14-day upcoming window.
  upcoming: BasketballScoreboardEvent[];
  transactions: BasketballTransaction[];
};

function seasonFor(sport: BasketballLeagueSlug, date: string): number {
  return sport === "nba" ? nbaSeasonForDate(date) : wnbaSeasonForDate(date);
}

// Roster fallback when ESPN's roster endpoint is down: the byathlete feed
// filtered to the team (stats-only players, no jersey/position/injury).
function extractTeamAthletes(rawAthleteStats: unknown, abbr: string): BasketballTeamPlayer[] {
  return teamAthletes(rawAthleteStats, abbr).map((a) => ({
    id: a.id,
    name: a.name,
    injured: false,
    stats: a.stats,
  }));
}

// Recover ESPN's team id + abbreviation for a teams.ts team by matching the
// full name / nickname (which agree across both), since the abbreviations
// don't. Scans standings first (always present in-season), then the day's
// games and the upcoming window as fallbacks.
function resolveEspnTeam(data: BasketballData, team: Team): { id: string; abbr: string } | null {
  const matches = (t: { name: string; displayName: string }) =>
    t.displayName === team.name || t.name === team.nickname;
  for (const c of data.standings.conferences) {
    for (const e of c.entries) {
      if (matches(e.team)) return { id: e.team.id, abbr: e.team.abbreviation };
    }
  }
  const events = [...data.games.map((g) => g.event), ...data.upcomingEvents];
  for (const ev of events) {
    for (const side of [ev.away, ev.home]) {
      if (matches(side.team)) return { id: side.team.id, abbr: side.team.abbreviation };
    }
  }
  return null;
}

export async function loadBasketballTeamData(
  sport: BasketballLeagueSlug,
  slug: string,
  date: string,
  opts?: { refetch?: boolean },
): Promise<BasketballTeamData> {
  const team = findTeam(sport, slug);
  if (!team) throw new Error(`unknown ${sport} team: ${slug}`);

  const raw = await loadBasketballRawFor(sport, date, seasonFor(sport, date), opts);
  const data = rawToBasketballData(raw, sport, date);

  // ESPN's abbreviation ("NY", "SA") disagrees with teams.ts ("NYK", "SAS"),
  // so we can't join on it directly. Match on displayName/nickname (which DO
  // agree) to recover ESPN's own id + abbreviation, then filter every section
  // with those — the id for games/standings, the abbreviation for the roster
  // (the athlete feed exposes only teamShortName).
  const espn = resolveEspnTeam(data, team) ?? { id: "", abbr: team.abbreviation };

  const isTeamEvent = (e: BasketballScoreboardEvent) =>
    e.away.team.id === espn.id || e.home.team.id === espn.id;

  const games = data.games.filter((g) => isTeamEvent(g.event));

  // Don't filter by status: the window is strictly after the digest date, so
  // in live operation these are all scheduled. On a historical regen they read
  // as final, but the section still shows the matchup + scheduled tipoff — a
  // status filter would blank it out (and mis-flag mid-season as offseason).
  const upcoming = data.upcomingEvents
    .filter(isTeamEvent)
    .sort((a, b) => a.date.localeCompare(b.date));

  const conference =
    data.standings.conferences.find((c) =>
      c.entries.some((en) => en.team.id === espn.id),
    ) ?? null;
  const teamIdx = conference
    ? conference.entries.findIndex((en) => en.team.id === espn.id)
    : -1;
  const entry: BasketballStandingsEntry | null =
    conference && teamIdx >= 0 ? conference.entries[teamIdx]! : null;
  const record = entry
    ? {
        wins: entry.stats.wins?.value ?? 0,
        losses: entry.stats.losses?.value ?? 0,
      }
    : null;

  // Full roster from ESPN's roster endpoint, joined to season stats by id.
  // Best-effort — an ESPN hiccup shouldn't sink the whole digest, so on failure
  // (or an unresolved team id) we fall back to a stats-only roster built from
  // the athlete feed. Players with no stats yet sink to the bottom.
  const statsById = athleteStatsById(raw.athleteStats);
  let roster: BasketballTeamPlayer[];
  try {
    if (!espn.id) throw new Error("no ESPN team id");
    const rosterRaw = await fetchTeamRosterRaw(sport, espn.id);
    roster = parseRoster(rosterRaw).map((r) => ({
      ...r,
      stats: statsById.get(r.id) ?? {},
    }));
  } catch (err) {
    console.error(`[basketball-team] roster fetch failed for ${sport}/${slug}: ${(err as Error).message}`);
    // Fallback: the athlete feed filtered by team abbreviation — players with
    // stats only, no jersey/position/injury, but the digest still renders.
    roster = extractTeamAthletes(raw.athleteStats, espn.abbr);
  }
  roster.sort((a, b) => (b.stats.avgPoints ?? -1) - (a.stats.avgPoints ?? -1));

  // Team edition: this team's moves since ITS previous game (not the league's),
  // so an off-day signing during the team's multi-day gap still surfaces the
  // next time the team plays. teamAbbr matches ESPN's abbreviation, as the raw
  // transaction feed carries it.
  const transactions = await transactionsSinceLastTeamGame(sport, slug, espn.abbr, date);

  const mode: BasketballTeamMode =
    games.length > 0 ? "game" : upcoming.length > 0 ? "no-game" : "offseason";

  return {
    sport,
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
