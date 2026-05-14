import {
  getSchedule, getBoxscore, getScoringPlays, getStandings, getWildCardStandings, getLeaders,
} from "./mlb";
import type { GameDetail, DailyData } from "./render";
import { prettyDate } from "./dates";

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

export async function loadDailyData(date: string): Promise<DailyData> {
  const season = Number(date.slice(0, 4));

  const [schedule, standings, wildCard, ...leaderRows] = await Promise.all([
    getSchedule(date),
    getStandings(season, date),
    getWildCardStandings(season, date),
    ...LEADER_CATEGORIES.flatMap((c) => [
      getLeaders(c.category, season, 103, 5),
      getLeaders(c.category, season, 104, 5),
    ]),
  ]);

  const games: GameDetail[] = await Promise.all(
    schedule.map(async (game): Promise<GameDetail> => {
      if (game.status.codedGameState !== "F") return { game };
      const [box, scoring] = await Promise.all([
        getBoxscore(game.gamePk),
        getScoringPlays(game.gamePk),
      ]);
      return { game, box, scoring };
    })
  );

  return {
    date,
    prettyDate: prettyDate(date),
    games,
    standings,
    wildCard,
    leaders: {
      AL: LEADER_CATEGORIES.map((c, i) => ({
        label: c.label, valueLabel: c.valueLabel, rows: leaderRows[i * 2] ?? [],
      })),
      NL: LEADER_CATEGORIES.map((c, i) => ({
        label: c.label, valueLabel: c.valueLabel, rows: leaderRows[i * 2 + 1] ?? [],
      })),
    },
  };
}
