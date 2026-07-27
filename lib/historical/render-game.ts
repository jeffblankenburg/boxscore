// Render any MLB game's full box score, plus list a date's games — for the
// /mlb/art box-score image maker. Covers 1950–2026:
//   - pre-2026: the historical store (getHistoricalGameWithRaw), our own DB.
//   - 2026 (or anything not in the store): statsapi live by game_pk.
// Both paths feed the same renderGame(), so the output is identical.
//
// Same GameDetail-synthesis recipe as the Time Machine game
// (app/games/time-machine/actions.ts), pulled into a plain lib so server
// components and route handlers can import it.

import { getHistoricalGameWithRaw } from "./queries";
import {
  parseBoxscore,
  fetchBoxscoreRaw,
  fetchLinescoreRaw,
  fetchPlayByPlayRaw,
  parseScoringPlays,
  fetchScheduleRaw,
  parseSchedule,
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

/** Build the renderGame-shaped ScheduleGame from a parsed box + linescore. */
function synthesize(
  meta: { gameType?: string | null; awayScore: number; homeScore: number },
  box: Boxscore,
  linescoreRaw: unknown,
): ScheduleGame {
  const ls = (linescoreRaw ?? {}) as LinescoreEnvelope;
  return {
    gamePk: 0,
    gameDate: "",
    gameType: meta.gameType ?? undefined,
    status: { abstractGameState: "Final", detailedState: "Final", codedGameState: "F" },
    teams: {
      away: {
        team: { id: box.teams.away.team.id, name: box.teams.away.team.name, abbreviation: box.teams.away.team.abbreviation },
        score: meta.awayScore,
      },
      home: {
        team: { id: box.teams.home.team.id, name: box.teams.home.team.name, abbreviation: box.teams.home.team.abbreviation },
        score: meta.homeScore,
      },
    },
    linescore: {
      currentInning: ls.currentInning,
      scheduledInnings: ls.scheduledInnings,
      innings: (ls.innings ?? []).map((i) => ({ num: i.num, home: { runs: i.home?.runs }, away: { runs: i.away?.runs } })),
      teams: {
        home: { runs: ls.teams?.home?.runs ?? meta.homeScore, hits: ls.teams?.home?.hits, errors: ls.teams?.home?.errors },
        away: { runs: ls.teams?.away?.runs ?? meta.awayScore, hits: ls.teams?.away?.hits, errors: ls.teams?.away?.errors },
      },
    },
  };
}

export type HistoricalBox = {
  html: string; // renderGame() output (.game-container)
  awayName: string;
  homeName: string;
  gameDate: string; // YYYY-MM-DD
};

function toBox(game: ScheduleGame, box: Boxscore, scoring: Awaited<ReturnType<typeof parseScoringPlays>>, gameDate: string): HistoricalBox {
  const detail: Required<GameDetail> = { game, box, scoring };
  const liveAbbrev: Record<string, string> = {};
  if (game.teams.away.team.abbreviation) liveAbbrev[game.teams.away.team.name] = game.teams.away.team.abbreviation;
  if (game.teams.home.team.abbreviation) liveAbbrev[game.teams.home.team.name] = game.teams.home.team.abbreviation;
  return { html: renderGame(detail, liveAbbrev), awayName: game.teams.away.team.name, homeName: game.teams.home.team.name, gameDate };
}

/**
 * Load one game's full box score HTML by game_pk. Prefers the historical
 * store (our DB); falls back to statsapi live for 2026 / anything not stored.
 * `date` (YYYY-MM-DD) is used for the card's dateline on the statsapi path,
 * where the boxscore/linescore payloads don't carry the game date.
 */
export async function loadGameBoxHtml(gamePk: number, date?: string): Promise<HistoricalBox | null> {
  // 1) Historical store (pre-2026).
  const summary = await getHistoricalGameWithRaw(gamePk);
  if (summary && summary.boxscore_raw) {
    const box = parseBoxscore(summary.boxscore_raw);
    let scoring: Awaited<ReturnType<typeof parseScoringPlays>> = [];
    try {
      scoring = parseScoringPlays(await fetchPlayByPlayRaw(gamePk));
    } catch {
      /* PBP unavailable → renderer omits the scoring block */
    }
    const game = synthesize(
      { gameType: summary.game_type, awayScore: summary.away_score ?? 0, homeScore: summary.home_score ?? 0 },
      box,
      summary.linescore_raw,
    );
    return toBox(game, box, scoring, summary.game_date);
  }

  // 2) statsapi live (2026 / not stored).
  let box: Boxscore;
  let lineRaw: unknown;
  try {
    [box, lineRaw] = await Promise.all([
      fetchBoxscoreRaw(gamePk).then(parseBoxscore),
      fetchLinescoreRaw(gamePk),
    ]);
  } catch {
    return null;
  }
  const ls = (lineRaw ?? {}) as LinescoreEnvelope;
  const awayScore = ls.teams?.away?.runs ?? 0;
  const homeScore = ls.teams?.home?.runs ?? 0;
  let scoring: Awaited<ReturnType<typeof parseScoringPlays>> = [];
  try {
    scoring = parseScoringPlays(await fetchPlayByPlayRaw(gamePk));
  } catch {
    /* omit */
  }
  const game = synthesize({ awayScore, homeScore }, box, lineRaw);
  return toBox(game, box, scoring, date ?? "");
}

export type BoxGameListItem = {
  gamePk: number;
  awayAbbr: string;
  homeAbbr: string;
  awayScore: number;
  homeScore: number;
};

function abbr(team: { name: string; abbreviation?: string }): string {
  if (team.abbreviation) return team.abbreviation.toUpperCase();
  return team.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
}

/** All completed games on `date` (statsapi schedule — covers every season). */
export async function listBoxGamesForDate(date: string): Promise<BoxGameListItem[]> {
  let games: ScheduleGame[];
  try {
    games = parseSchedule(await fetchScheduleRaw(date));
  } catch {
    return [];
  }
  return games
    .filter(
      (g) =>
        g.status.abstractGameState === "Final" &&
        typeof g.teams.away.score === "number" &&
        typeof g.teams.home.score === "number",
    )
    .map((g) => ({
      gamePk: g.gamePk,
      awayAbbr: abbr(g.teams.away.team),
      homeAbbr: abbr(g.teams.home.team),
      awayScore: g.teams.away.score!,
      homeScore: g.teams.home.score!,
    }));
}
