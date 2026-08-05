// Orchestrator for football team pages. Live (ISR-cached at the route), like
// the player page. Strategy: one schedule call finds the team's most recent
// completed game and its date; loadFootballData for that date supplies
// standings, leaders, and the box — all from the read-through daily_raw cache
// the daily digest already populates. Everything is filtered to this team.

import { footballLeagueConfig, seasonForDate, type FootballLeagueConfig } from "./leagues";
import { loadFootballData } from "./data";
import { fetchTeamSchedule, fetchGameSummary, type TeamScheduleEvent } from "./sources/espn-team";
import { adaptBoxScore } from "./adapters/from-espn";
import { aggregateRosterTables } from "./roster";
import { findTeam, type Sport } from "../../teams";
import { yesterdayInET, nextDay } from "../../dates";
import type { FootballLeague, FootballTeamRef, FootballGame, FootballBoxScore } from "./types";
import type { CanonicalFootballDailyData } from "./canonical";
import type {
  FootballTeamPageData,
  FootballTeamLeaderGroup,
  FootballScheduleEntry,
  FootballRosterTable,
} from "./team-canonical";

const UPCOMING_LIMIT = 5;
// Cap concurrent box-summary fetches for the roster — a season is ~12–14 games;
// firing them all at once invites ESPN rate-limiting.
const ROSTER_FETCH_CONCURRENCY = 6;

type AsOfRecord = { wins: number; losses: number; ties: number; streak: string };

// Win/loss/tie + trailing streak from the games a team has PLAYED through the
// as-of date — the point-in-time record for the heading, independent of the
// (current-only) standings feed.
function recordThrough(played: TeamScheduleEvent[]): AsOfRecord {
  let wins = 0, losses = 0, ties = 0;
  const results: string[] = [];
  for (const g of played) {
    if (g.teamScore == null || g.oppScore == null) continue;
    if (g.teamScore > g.oppScore) { wins++; results.push("W"); }
    else if (g.teamScore < g.oppScore) { losses++; results.push("L"); }
    else { ties++; results.push("T"); }
  }
  let streak = "";
  const lastR = results[results.length - 1];
  if (lastR) {
    let n = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === lastR; i--) n++;
    streak = `${lastR}${n}`;
  }
  return { wins, losses, ties, streak };
}

// Season-to-date roster tables from the played games' box scores. Fetches each
// game's summary (capped concurrency), parses the box, and aggregates. Any
// game that fails to fetch/parse is simply skipped.
async function fetchRosterTables(
  cfg: FootballLeagueConfig,
  eventIds: string[],
  teamAbbr: string,
): Promise<FootballRosterTable[]> {
  const boxes: FootballBoxScore[] = [];
  for (let i = 0; i < eventIds.length; i += ROSTER_FETCH_CONCURRENCY) {
    const batch = eventIds.slice(i, i + ROSTER_FETCH_CONCURRENCY);
    const summaries = await Promise.all(
      batch.map((id) => fetchGameSummary(cfg, id).then((s) => [id, s] as const).catch(() => [id, null] as const)),
    );
    for (const [id, summary] of summaries) {
      if (summary == null) continue;
      const box = adaptBoxScore(cfg, id, summary);
      if (box) boxes.push(box);
    }
  }
  return aggregateRosterTables(boxes, teamAbbr);
}

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
 * Load a team page, point-in-time as of `asOfGamesDate` (the games date the
 * page represents; defaults to the latest completed day). The page reflects the
 * season as it stood that day: only games played on/before the date count,
 * later games show as upcoming, and the record/roster are through the date.
 * Standings come from the daily bundle and are the one exception — ESPN serves
 * them only as "current," which self-corrects once the sport is live and the
 * daily cron captures snapshots.
 *
 * Returns null when the slug isn't a known team. In the offseason (before the
 * season's first game) it falls back a year so the page shows the most recent
 * real season rather than an empty shell.
 */
export async function loadFootballTeamData(
  league: FootballLeague,
  slug: string,
  asOfGamesDate?: string,
): Promise<FootballTeamPageData | null> {
  const team = findTeam(league as Sport, slug);
  if (!team) return null;
  const cfg = footballLeagueConfig(league);
  const asOf = asOfGamesDate ?? yesterdayInET();

  // Season with games for this team. If the season hasn't started (no completed
  // games at all), fall back a year — a preseason team page shows last season.
  let season = seasonForDate(asOf);
  let schedule = await fetchTeamSchedule(cfg, team.abbreviation, season);
  if (!schedule.some((e) => e.completed)) {
    season -= 1;
    schedule = await fetchTeamSchedule(cfg, team.abbreviation, season);
  }

  // Point-in-time: a game counts as played only if it finished on/before the
  // as-of date. Later games render as upcoming (results stripped) below.
  const playedThrough = (e: TeamScheduleEvent) => e.completed && etDateOf(e.isoDate) <= asOf;
  const played = schedule.filter(playedThrough);
  const last = played.length > 0 ? played[played.length - 1]! : null;
  const gamesDate = last ? etDateOf(last.isoDate) : asOf;

  const displaySchedule: FootballScheduleEntry[] = schedule.map((e) =>
    playedThrough(e) ? e : { ...e, completed: false, teamScore: null, oppScore: null, won: null },
  );

  const [bundle, roster] = await Promise.all([
    loadFootballData(league, gamesDate),
    fetchRosterTables(cfg, played.map((e) => e.eventId), team.abbreviation).catch(() => undefined),
  ]);

  return assembleFootballTeamPage(league, team, bundle, last?.eventId ?? null, {
    schedule: displaySchedule,
    roster,
    record: recordThrough(played),
  });
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
  extras?: {
    schedule?: FootballScheduleEntry[];
    roster?: FootballRosterTable[];
    record?: AsOfRecord;
  },
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
    schedule: extras?.schedule,
    roster: extras?.roster,
    asOfRecord: extras?.record,
  };
}

// The edition date a team page's dateline should carry (day after the last
// game). Exposed for the route's canonical URL, mirroring MLB.
export function teamEditionDate(data: FootballTeamPageData): string | null {
  return data.lastGame ? nextDay(etDateOf(data.lastGame.startTime)) : null;
}
