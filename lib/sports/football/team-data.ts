// Orchestrator for football team pages. Live (ISR-cached at the route), like
// the player page. Strategy: one schedule call finds the team's most recent
// completed game and its date; loadFootballData for that date supplies
// standings, leaders, and the box — all from the read-through daily_raw cache
// the daily digest already populates. Everything is filtered to this team.

import { footballLeagueConfig, seasonForDate } from "./leagues";
import { loadFootballData } from "./data";
import { fetchTeamSchedule } from "./sources/espn-team";
import { findTeam, type Sport } from "../../teams";
import { yesterdayInET, nextDay } from "../../dates";
import type { FootballLeague, FootballTeamRef, FootballGame } from "./types";
import type { CanonicalFootballDailyData } from "./canonical";
import type { FootballTeamPageData, FootballTeamLeaderGroup } from "./team-canonical";

const UPCOMING_LIMIT = 5;

// ESPN kickoff timestamps are UTC; the daily bundle is keyed by the game's ET
// date. Convert so an 8pm ET game (which is next-day UTC) resolves to the
// night it was actually played.
function etDateOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * Load a team page. Returns null when the slug isn't a known team of the
 * league. In the offseason (or before Week 1) the current season has no
 * completed games, so we fall back a year — the page then shows the team's
 * most recent real game and final standings rather than an empty shell.
 */
export async function loadFootballTeamData(
  league: FootballLeague,
  slug: string,
): Promise<FootballTeamPageData | null> {
  const team = findTeam(league as Sport, slug);
  if (!team) return null;
  const cfg = footballLeagueConfig(league);

  // Find the season that actually has games for this team.
  let season = seasonForDate(yesterdayInET());
  let schedule = await fetchTeamSchedule(cfg, team.abbreviation, season);
  let completed = schedule.filter((e) => e.completed);
  if (completed.length === 0) {
    season -= 1;
    schedule = await fetchTeamSchedule(cfg, team.abbreviation, season);
    completed = schedule.filter((e) => e.completed);
  }

  const last = completed.length > 0 ? completed[completed.length - 1]! : null;
  const gamesDate = last ? etDateOf(last.isoDate) : yesterdayInET();
  const bundle = await loadFootballData(league, gamesDate);
  return assembleFootballTeamPage(league, team, bundle, last?.eventId ?? null);
}

/**
 * Assemble a team page from a daily bundle plus the team's game id for that
 * date. Pure — no I/O — so the generate cron (which already holds the day's
 * bundle) can build per-team digests without a second fetch, and the live
 * loader above shares the exact same shaping.
 */
export function assembleFootballTeamPage(
  league: FootballLeague,
  team: { slug: string; name: string; abbreviation: string },
  bundle: CanonicalFootballDailyData,
  gameId: string | null,
): FootballTeamPageData {
  // Match this team inside the bundle by canonical slug or abbreviation, then
  // use the bundle's own ESPN abbreviation for all downstream filtering so
  // slug↔abbr edge cases (WSH vs was, etc.) can't split the data.
  const matches = (ref: FootballTeamRef): boolean =>
    ref.id === team.slug || ref.abbr.toUpperCase() === team.abbreviation.toUpperCase();

  let divisionGroup = null as FootballTeamPageData["divisionGroup"];
  let record = null as FootballTeamPageData["record"];
  let divisionRank: number | null = null;
  for (const grp of bundle.standings) {
    const idx = grp.rows.findIndex((r) => matches(r.team));
    if (idx >= 0) {
      divisionGroup = grp;
      record = grp.rows[idx]!;
      divisionRank = idx + 1;
      break;
    }
  }
  const espnAbbr = record?.team.abbr ?? team.abbreviation;

  const involvesTeam = (g: FootballGame): boolean =>
    g.awayTeam.abbr.toUpperCase() === espnAbbr.toUpperCase() ||
    g.homeTeam.abbr.toUpperCase() === espnAbbr.toUpperCase();

  const lastGame = gameId ? bundle.games.find((g) => g.id === gameId) ?? null : null;
  const lastBox = gameId ? bundle.boxScores.get(gameId) : undefined;

  const upcoming = bundle.nextGames.filter(involvesTeam).slice(0, UPCOMING_LIMIT);

  const teamLeaders: FootballTeamLeaderGroup[] = [];
  for (const board of bundle.leaders) {
    const entries = board.entries.filter(
      (e) => e.teamAbbr.toUpperCase() === espnAbbr.toUpperCase(),
    );
    if (entries.length > 0) teamLeaders.push({ label: board.label, entries });
  }

  return {
    league,
    slug: team.slug,
    name: team.name,
    abbr: team.abbreviation,
    bundle,
    divisionGroup,
    record,
    divisionRank,
    lastGame,
    lastBox,
    upcoming,
    teamLeaders,
  };
}

// The edition date a team page's dateline should carry (day after the last
// game). Exposed for the route's canonical URL, mirroring MLB.
export function teamEditionDate(data: FootballTeamPageData): string | null {
  return data.lastGame ? nextDay(etDateOf(data.lastGame.startTime)) : null;
}
