import {
  fetchScheduleRaw, parseSchedule,
  fetchStandingsRaw, parseStandings,
  fetchWildCardRaw, parseWildCard,
  fetchLeadersRaw, parseLeaders,
  fetchBoxscoreRaw, parseBoxscore,
  fetchPlayByPlayRaw, parseScoringPlays,
} from "./mlb";
import type { GameDetail, DailyData } from "./render";
import { prettyDate } from "./dates";
import { getDailyRaw, upsertDailyRaw, type DailyRaw } from "./daily-raw";

const LEADER_CATEGORIES = [
  { category: "battingAverage", label: "Batting Average", valueLabel: "AVG" },
  { category: "homeRuns", label: "Home Runs", valueLabel: "HR" },
  { category: "runsBattedIn", label: "RBI", valueLabel: "RBI" },
  { category: "stolenBases", label: "Stolen Bases", valueLabel: "SB" },
  { category: "wins", label: "Wins", valueLabel: "W" },
  { category: "earnedRunAverage", label: "ERA", valueLabel: "ERA" },
  { category: "strikeouts", label: "Strikeouts (Pitching)", valueLabel: "SO" },
  { category: "saves", label: "Saves", valueLabel: "SV" },
] as const;

// Fetch every MLB endpoint needed for a single date, returning the unmodified
// envelopes. This is the only function that hits MLB; everything else parses
// what we already have.
async function fetchDailyRaw(date: string): Promise<DailyRaw> {
  const season = Number(date.slice(0, 4));

  // First wave: schedule + standings + wildCard + all leaders, in parallel.
  const leaderCalls = LEADER_CATEGORIES.flatMap((c) => [
    fetchLeadersRaw(c.category, season, 103, 5),
    fetchLeadersRaw(c.category, season, 104, 5),
  ]);
  const [scheduleRaw, standingsRaw, wildCardRaw, ...leaderResults] = await Promise.all([
    fetchScheduleRaw(date),
    fetchStandingsRaw(season, date),
    fetchWildCardRaw(season, date),
    ...leaderCalls,
  ]);

  const leaders: DailyRaw["leaders"] = {};
  for (let i = 0; i < LEADER_CATEGORIES.length; i++) {
    const c = LEADER_CATEGORIES[i]!;
    leaders[`103/${c.category}`] = leaderResults[i * 2];
    leaders[`104/${c.category}`] = leaderResults[i * 2 + 1];
  }

  // Second wave: per-game boxscore + playByPlay for completed games only.
  const schedule = parseSchedule(scheduleRaw);
  const finalGamePks = schedule
    .filter((g) => g.status.codedGameState === "F")
    .map((g) => g.gamePk);

  const gameRaw = await Promise.all(
    finalGamePks.map(async (pk) => {
      const [boxscore, playByPlay] = await Promise.all([
        fetchBoxscoreRaw(pk),
        fetchPlayByPlayRaw(pk),
      ]);
      return [pk, { boxscore, playByPlay }] as const;
    }),
  );

  const games: DailyRaw["games"] = {};
  for (const [pk, g] of gameRaw) games[String(pk)] = g;

  return { schedule: scheduleRaw, standings: standingsRaw, wildCard: wildCardRaw, leaders, games };
}

// Pure transform: raw payloads → DailyData. No network.
function rawToDailyData(raw: DailyRaw, date: string): DailyData {
  const schedule = parseSchedule(raw.schedule);
  const games: GameDetail[] = schedule.map((game): GameDetail => {
    if (game.status.codedGameState !== "F") return { game };
    const stored = raw.games[String(game.gamePk)];
    if (!stored) return { game };
    return {
      game,
      box: parseBoxscore(stored.boxscore),
      scoring: parseScoringPlays(stored.playByPlay),
    };
  });

  return {
    date,
    prettyDate: prettyDate(date),
    games,
    standings: parseStandings(raw.standings),
    wildCard: parseWildCard(raw.wildCard),
    leaders: {
      AL: LEADER_CATEGORIES.map((c) => ({
        label: c.label, valueLabel: c.valueLabel,
        rows: parseLeaders(raw.leaders[`103/${c.category}`]),
      })),
      NL: LEADER_CATEGORIES.map((c) => ({
        label: c.label, valueLabel: c.valueLabel,
        rows: parseLeaders(raw.leaders[`104/${c.category}`]),
      })),
    },
  };
}

// Read-through: stored raw → DailyData. If raw is missing, fetch from MLB
// and write through so the next caller gets the cached version.
export async function loadDailyData(date: string, opts?: { refetch?: boolean }): Promise<DailyData> {
  let raw = opts?.refetch ? null : await getDailyRaw("mlb", date);
  if (!raw) {
    raw = await fetchDailyRaw(date);
    await upsertDailyRaw("mlb", date, raw);
  }
  return rawToDailyData(raw, date);
}
