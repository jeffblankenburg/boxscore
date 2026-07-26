// Render a single pre-2026 game's full box score from the historical store.
//
// Same recipe as the Time Machine game (app/games/time-machine/actions.ts):
// historical raw payloads → GameDetail → renderGame(). Pulled into a plain
// lib helper (not that "use server" actions file) so server components can
// import it. Unlike Time Machine, this keeps the real venue/date — nothing
// here is a puzzle to be kept year-safe.

import { getHistoricalGameWithRaw, type HistoricalGameSummary } from "./queries";
import {
  parseBoxscore,
  fetchPlayByPlayRaw,
  parseScoringPlays,
  type Boxscore,
  type ScheduleGame,
} from "@/lib/mlb";
import { renderGame, type GameDetail } from "@/lib/render";

type LinescoreEnvelope = {
  innings?: Array<{ num: number; home?: { runs?: number }; away?: { runs?: number } }>;
  currentInning?: number;
  scheduledInnings?: number;
  teams?: {
    home?: { runs?: number; hits?: number; errors?: number };
    away?: { runs?: number; hits?: number; errors?: number };
  };
};

/** Build the renderGame-shaped ScheduleGame from a historical row + parsed box. */
function synthesize(summary: HistoricalGameSummary, box: Boxscore, linescoreRaw: unknown): ScheduleGame {
  const ls = (linescoreRaw ?? {}) as LinescoreEnvelope;
  return {
    gamePk: summary.game_pk,
    gameDate: `${summary.game_date}T00:00:00Z`,
    gameType: summary.game_type ?? undefined,
    status: { abstractGameState: "Final", detailedState: "Final", codedGameState: "F" },
    teams: {
      away: {
        team: {
          id: box.teams.away.team.id,
          name: box.teams.away.team.name,
          abbreviation: box.teams.away.team.abbreviation,
        },
        score: summary.away_score ?? 0,
      },
      home: {
        team: {
          id: box.teams.home.team.id,
          name: box.teams.home.team.name,
          abbreviation: box.teams.home.team.abbreviation,
        },
        score: summary.home_score ?? 0,
      },
    },
    linescore: {
      currentInning: ls.currentInning,
      scheduledInnings: ls.scheduledInnings,
      innings: (ls.innings ?? []).map((i) => ({
        num: i.num,
        home: { runs: i.home?.runs },
        away: { runs: i.away?.runs },
      })),
      teams: {
        home: {
          runs: ls.teams?.home?.runs ?? summary.home_score ?? 0,
          hits: ls.teams?.home?.hits,
          errors: ls.teams?.home?.errors,
        },
        away: {
          runs: ls.teams?.away?.runs ?? summary.away_score ?? 0,
          hits: ls.teams?.away?.hits,
          errors: ls.teams?.away?.errors,
        },
      },
    },
  };
}

export type HistoricalBox = {
  html: string;           // renderGame() output (.game-container)
  awayName: string;
  homeName: string;
  gameDate: string;       // YYYY-MM-DD
};

/** Load one historical game and render its full box score HTML. */
export async function loadHistoricalBoxHtml(gamePk: number): Promise<HistoricalBox | null> {
  const summary = await getHistoricalGameWithRaw(gamePk);
  if (!summary || !summary.boxscore_raw) return null;

  const box = parseBoxscore(summary.boxscore_raw);
  let scoring: Awaited<ReturnType<typeof parseScoringPlays>> = [];
  try {
    scoring = parseScoringPlays(await fetchPlayByPlayRaw(gamePk));
  } catch {
    /* PBP unavailable → renderer just omits the scoring block */
  }

  const game = synthesize(summary, box, summary.linescore_raw);
  const detail: Required<GameDetail> = { game, box, scoring };
  const liveAbbrev: Record<string, string> = {};
  if (game.teams.away.team.abbreviation) liveAbbrev[game.teams.away.team.name] = game.teams.away.team.abbreviation;
  if (game.teams.home.team.abbreviation) liveAbbrev[game.teams.home.team.name] = game.teams.home.team.abbreviation;

  return {
    html: renderGame(detail, liveAbbrev),
    awayName: game.teams.away.team.name,
    homeName: game.teams.home.team.name,
    gameDate: summary.game_date,
  };
}
