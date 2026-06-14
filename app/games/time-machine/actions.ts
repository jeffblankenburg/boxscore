"use server";

// Server actions for Time Machine. The client owns guess state (mirrors
// Stat Sharks / Linescordle). The server:
//   • Picks today's historical game once and freezes it in puzzle_picks.
//   • Scores each guess against the canonical answer.
//   • Renders the boxscore HTML with venue stripped (per-product spec).
//   • Persists/loads attempt rows for authed subscribers.
//
// The answer year is never sent to the client until the run ends — either
// because the user guessed right or used all six attempts.

import { cookies } from "next/headers";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { saveAttempt, getAttempt } from "@/lib/games/attempts";
import { supabaseAdmin } from "@/lib/supabase";
import { getHistoricalGameWithRaw } from "@/lib/historical/queries";
import {
  parseBoxscore,
  fetchPlayByPlayRaw,
  parseScoringPlays,
  type Boxscore,
  type ScheduleGame,
} from "@/lib/mlb";
import { renderGame, type GameDetail } from "@/lib/render";
import { pickDailyGame } from "@/lib/games/time-machine/picker";
import {
  MAX_GUESSES,
  type PersistedAttempt,
  type PublicGame,
  type ScoreResult,
  type Guess,
} from "./types";

// ─── Daily game resolution ───────────────────────────────────────

/** Read-or-create today's picked game in puzzle_picks. Once the first
 * subscriber loads the page the gamePk is frozen for the day. */
async function getOrPickGamePk(playedOn: string): Promise<number> {
  const db = supabaseAdmin();
  const { data: existing, error } = await db
    .from("puzzle_picks")
    .select("subject_ref")
    .eq("game", "time-machine")
    .eq("puzzle_date", playedOn)
    .maybeSingle<{ subject_ref: string }>();
  if (error) throw new Error(`getOrPickGamePk read: ${error.message}`);
  if (existing?.subject_ref) {
    const n = Number(existing.subject_ref);
    if (Number.isFinite(n)) return n;
  }
  const gamePk = await pickDailyGame(playedOn);
  const { error: upErr } = await db
    .from("puzzle_picks")
    .upsert(
      {
        game:        "time-machine",
        puzzle_date: playedOn,
        subject_ref: String(gamePk),
      },
      { onConflict: "game,puzzle_date", ignoreDuplicates: true },
    );
  if (upErr) console.error(`getOrPickGamePk write: ${upErr.message}`);
  // Re-read in case of race so we honour whichever insert won.
  const { data: confirmed } = await db
    .from("puzzle_picks")
    .select("subject_ref")
    .eq("game", "time-machine")
    .eq("puzzle_date", playedOn)
    .maybeSingle<{ subject_ref: string }>();
  if (confirmed?.subject_ref) {
    const n = Number(confirmed.subject_ref);
    if (Number.isFinite(n)) return n;
  }
  return gamePk;
}

/** Build a renderGame-shaped ScheduleGame from a historical row. Copies
 * the admin/historical detail-page logic but strips venue so the
 * stadium name (Polo Grounds, Jarry Park, etc.) doesn't give away the
 * era. The date also never reaches renderGame, so its output stays
 * year-safe. */
function synthesizeForGame(
  summary: { away_team_id: number | null; away_score: number | null;
             home_team_id: number | null; home_score: number | null;
             game_type: string | null },
  box: Boxscore,
  linescoreRaw: unknown,
): ScheduleGame {
  type LinescoreEnvelope = {
    innings?: Array<{ num: number; home?: { runs?: number }; away?: { runs?: number } }>;
    currentInning?: number;
    scheduledInnings?: number;
    teams?: {
      home?: { runs?: number; hits?: number; errors?: number };
      away?: { runs?: number; hits?: number; errors?: number };
    };
  };
  const ls = (linescoreRaw ?? {}) as LinescoreEnvelope;
  return {
    gamePk:   0,
    gameDate: "",           // year-safe — renderGame doesn't surface it anyway
    gameType: summary.game_type ?? undefined,
    status:   { abstractGameState: "Final", detailedState: "Final", codedGameState: "F" },
    teams: {
      away: {
        team:  {
          id:           box.teams.away.team.id,
          name:         box.teams.away.team.name,
          abbreviation: box.teams.away.team.abbreviation,
        },
        score: summary.away_score ?? 0,
      },
      home: {
        team:  {
          id:           box.teams.home.team.id,
          name:         box.teams.home.team.name,
          abbreviation: box.teams.home.team.abbreviation,
        },
        score: summary.home_score ?? 0,
      },
    },
    linescore: {
      currentInning:    ls.currentInning,
      scheduledInnings: ls.scheduledInnings,
      innings: (ls.innings ?? []).map((i) => ({
        num:  i.num,
        home: { runs: i.home?.runs },
        away: { runs: i.away?.runs },
      })),
      teams: {
        home: {
          runs:   ls.teams?.home?.runs   ?? summary.home_score ?? 0,
          hits:   ls.teams?.home?.hits,
          errors: ls.teams?.home?.errors,
        },
        away: {
          runs:   ls.teams?.away?.runs   ?? summary.away_score ?? 0,
          hits:   ls.teams?.away?.hits,
          errors: ls.teams?.away?.errors,
        },
      },
    },
    // venue intentionally omitted — that's the difficulty knob.
  };
}

/** Resolve today's puzzle into a year-safe public payload. */
export async function getDailyGame(playedOn: string): Promise<PublicGame> {
  const gamePk = await getOrPickGamePk(playedOn);
  const summary = await getHistoricalGameWithRaw(gamePk);
  if (!summary || !summary.boxscore_raw) {
    throw new Error(`getDailyGame: no boxscore for gamePk ${gamePk}`);
  }
  const box = parseBoxscore(summary.boxscore_raw);
  let scoring: Awaited<ReturnType<typeof parseScoringPlays>> = [];
  try {
    scoring = parseScoringPlays(await fetchPlayByPlayRaw(gamePk));
  } catch {
    /* PBP unavailable for some older games — renderer omits the block */
  }
  const game = synthesizeForGame(
    {
      away_team_id: summary.away_team_id,
      away_score:   summary.away_score,
      home_team_id: summary.home_team_id,
      home_score:   summary.home_score,
      game_type:    summary.game_type,
    },
    box,
    summary.linescore_raw,
  );
  const detail: Required<GameDetail> = { game, box, scoring };
  const liveAbbrev: Record<string, string> = {};
  if (game.teams.away.team.abbreviation) liveAbbrev[game.teams.away.team.name] = game.teams.away.team.abbreviation;
  if (game.teams.home.team.abbreviation) liveAbbrev[game.teams.home.team.name] = game.teams.home.team.abbreviation;
  const boxHtml = renderGame(detail, liveAbbrev);
  return {
    boxHtml,
    awayName:  game.teams.away.team.name,
    homeName:  game.teams.home.team.name,
    awayScore: game.teams.away.score ?? 0,
    homeScore: game.teams.home.score ?? 0,
    gameType:  summary.game_type,
  };
}

// ─── Scoring ─────────────────────────────────────────────────────

/** Score one guess. Returns higher/lower/correct. Only reveals the
 * answer year when the run is about to end — either the guess is right
 * or it was the user's last allowed attempt. The client passes the
 * number of guesses they've already made; abuse (faking guessNumber to
 * pull the answer early) gains nothing the user can't get by burning
 * six wrong guesses anyway. */
export async function scoreGuess(opts: {
  playedOn:    string;
  year:        number;
  guessNumber: number;     // 1-based count INCLUDING this guess
}): Promise<ScoreResult> {
  const gamePk = await getOrPickGamePk(opts.playedOn);
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("historical_games")
    .select("season")
    .eq("game_pk", gamePk)
    .maybeSingle<{ season: number }>();
  if (error)  throw new Error(`scoreGuess: ${error.message}`);
  if (!data)  throw new Error(`scoreGuess: no game for pk ${gamePk}`);
  const answer = data.season;
  let hint: ScoreResult["hint"];
  if      (opts.year === answer) hint = "correct";
  else if (opts.year <  answer)  hint = "higher";
  else                           hint = "lower";
  const reveal = hint === "correct" || opts.guessNumber >= MAX_GUESSES;
  return reveal ? { hint, answerYear: answer } : { hint };
}

// ─── Persistence (authed only) ───────────────────────────────────

export async function persistAttempt(opts: {
  playedOn: string;
  guesses:  Guess[];
  ended:    boolean;
}): Promise<void> {
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  if (!session) return;
  const lastHint = opts.guesses.at(-1)?.hint;
  const solved = opts.ended ? lastHint === "correct" : null;
  const gamePk = await getOrPickGamePk(opts.playedOn);
  // Look up the canonical answer year only when the run ends so a
  // cross-device resume can show the year on the end screen. Mid-run
  // persists skip this query.
  let answerYear: number | undefined;
  if (opts.ended) {
    const { data } = await supabaseAdmin()
      .from("historical_games")
      .select("season")
      .eq("game_pk", gamePk)
      .maybeSingle<{ season: number }>();
    if (data) answerYear = data.season;
  }
  const persisted: PersistedAttempt = {
    guesses: opts.guesses,
    ended:   opts.ended,
    ...(answerYear != null ? { answerYear } : {}),
  };
  await saveAttempt({
    subscriberId:    session.subscriber_id,
    game:            "time-machine",
    puzzleDate:      opts.playedOn,
    puzzleSubjectId: String(gamePk),
    guesses:         persisted as unknown,
    hints:           [],
    solved,
    guessCount:      opts.guesses.length,
    hintCount:       0,
  });
}

export async function loadAttempt(playedOn: string): Promise<PersistedAttempt | null> {
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  if (!session) return null;
  const row = await getAttempt({
    subscriberId: session.subscriber_id,
    game:         "time-machine",
    puzzleDate:   playedOn,
  });
  return (row?.guesses as PersistedAttempt | undefined) ?? null;
}
