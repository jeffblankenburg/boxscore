// Server-side reveal data builder. Called from app/games/linescordle/page.tsx
// to pre-render the post-game content so the client only needs to flip
// state to "revealed" — no client-side fetches.
//
// Two pieces:
//   1. Career stat line — one row of career totals. Pitcher columns
//      for kind='pitching' lines, batter columns for kind='batting'.
//   2. Full source-game box score — same renderGame() the historical
//      viewer and daily digest use. Passed as an HTML string.
//
// Career stats are fetched directly from MLB API (one cheap call). Box
// score fetched from historical_boxscores if we've ingested it; falls
// back to the MLB API for games still uningested (everything past W2/W3's
// current position). Once those workers complete we'll always have the
// box already in the cache.

import { getPlayerByMlbId, type Player } from "../../players";
import { supabaseAdmin } from "../../supabase";
import {
  fetchBoxscoreRaw,
  fetchLinescoreRaw,
  fetchPlayByPlayRaw,
  parseBoxscore,
  parseScoringPlays,
  type Boxscore,
  type ScheduleGame,
} from "../../mlb";
import { renderGame, type GameDetail } from "../../render";
import type { LinescordlePuzzle } from "./content";

export type RevealData = {
  player: Player | null;
  careerHtml: string;
  boxScoreHtml: string;
};

const MLB_API = "https://statsapi.mlb.com/api";

// ─── Career stat line ──────────────────────────────────────────────

type CareerPitching = {
  wins?: number; losses?: number; era?: string;
  inningsPitched?: string; strikeOuts?: number;
  baseOnBalls?: number; whip?: string;
  gamesPlayed?: number; gamesStarted?: number;
  saves?: number; completeGames?: number; shutouts?: number;
};

type CareerHitting = {
  gamesPlayed?: number;
  atBats?: number; runs?: number; hits?: number;
  doubles?: number; triples?: number; homeRuns?: number;
  rbi?: number; baseOnBalls?: number; strikeOuts?: number;
  stolenBases?: number;
  avg?: string; obp?: string; slg?: string; ops?: string;
};

async function fetchCareerStats(
  mlbId: number,
  group: "hitting" | "pitching",
): Promise<CareerPitching | CareerHitting | null> {
  const res = await fetch(`${MLB_API}/v1/people/${mlbId}/stats?stats=career&group=${group}`);
  if (!res.ok) return null;
  const data = await res.json() as {
    stats?: Array<{ splits?: Array<{ stat?: CareerPitching | CareerHitting }> }>;
  };
  return data.stats?.[0]?.splits?.[0]?.stat ?? null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderCareerLine(kind: "batting" | "pitching", stats: CareerPitching | CareerHitting | null): string {
  if (!stats) return `<p class="linescordle-reveal-career-missing">Career stats unavailable.</p>`;
  // Prose-style stat line — flows + wraps naturally instead of trying
  // to fit 8 tabular columns into ~300px of mobile width. Each `<span>`
  // is a single value-label pair so a wrap break never splits one
  // mid-stat. Value before label matches how baseball stats are spoken
  // ("219-100 W-L," not "W-L 219-100").
  const part = (val: string | number | null | undefined, label: string) =>
    `<span class="linescordle-career-stat"><b>${escapeHtml(String(val ?? "—"))}</b> ${escapeHtml(label)}</span>`;

  if (kind === "pitching") {
    const s = stats as CareerPitching;
    return `<p class="linescordle-career-line">
      ${part(`${s.wins ?? 0}-${s.losses ?? 0}`, "W-L")}
      ${part(s.era ?? "—", "ERA")}
      ${part(s.gamesPlayed ?? 0, "G")}
      ${part(s.gamesStarted ?? 0, "GS")}
      ${part(s.inningsPitched ?? "—", "IP")}
      ${part(s.strikeOuts ?? 0, "K")}
      ${part(s.baseOnBalls ?? 0, "BB")}
      ${part(s.whip ?? "—", "WHIP")}
    </p>`;
  }

  const s = stats as CareerHitting;
  return `<p class="linescordle-career-line">
    ${part(s.gamesPlayed ?? 0, "G")}
    ${part(s.atBats ?? 0, "AB")}
    ${part(s.runs ?? 0, "R")}
    ${part(s.hits ?? 0, "H")}
    ${part(s.homeRuns ?? 0, "HR")}
    ${part(s.rbi ?? 0, "RBI")}
    ${part(s.stolenBases ?? 0, "SB")}
    ${part(s.avg ?? "—", "AVG")}
    ${part(s.ops ?? "—", "OPS")}
  </p>`;
}

// ─── Source-game box score ─────────────────────────────────────────
//
// Two sources: prefer historical_boxscores (cached, instant), fall back
// to MLB API (one round trip). Once the historical-game backfill
// finishes its W2/W3 workers, we'll always hit the cache.

type LinescoreEnv = {
  innings?: Array<{ num: number; home?: { runs?: number }; away?: { runs?: number } }>;
  currentInning?: number;
  scheduledInnings?: number;
  teams?: {
    home?: { runs?: number; hits?: number; errors?: number };
    away?: { runs?: number; hits?: number; errors?: number };
  };
};

function synthesizeScheduleGame(
  gamePk: number,
  box: Boxscore,
  linescoreRaw: unknown,
): ScheduleGame {
  const ls = (linescoreRaw ?? {}) as LinescoreEnv;
  return {
    gamePk,
    gameDate: new Date().toISOString(),    // not read by renderGame
    status: { abstractGameState: "Final", detailedState: "Final", codedGameState: "F" },
    teams: {
      away: {
        team: { id: box.teams.away.team.id, name: box.teams.away.team.name, abbreviation: box.teams.away.team.abbreviation },
        score: ls.teams?.away?.runs ?? 0,
      },
      home: {
        team: { id: box.teams.home.team.id, name: box.teams.home.team.name, abbreviation: box.teams.home.team.abbreviation },
        score: ls.teams?.home?.runs ?? 0,
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
          runs:   ls.teams?.home?.runs   ?? 0,
          hits:   ls.teams?.home?.hits,
          errors: ls.teams?.home?.errors,
        },
        away: {
          runs:   ls.teams?.away?.runs   ?? 0,
          hits:   ls.teams?.away?.hits,
          errors: ls.teams?.away?.errors,
        },
      },
    },
  };
}

async function fetchSourceGame(gamePk: number): Promise<{ boxRaw: unknown; lineRaw: unknown } | null> {
  // Try cache first.
  const { data, error } = await supabaseAdmin()
    .from("historical_boxscores")
    .select("boxscore_raw, linescore_raw")
    .eq("game_pk", gamePk)
    .maybeSingle();
  if (!error && data) {
    return { boxRaw: data.boxscore_raw, lineRaw: data.linescore_raw };
  }
  // Fall back to MLB API.
  try {
    const [boxRaw, lineRaw] = await Promise.all([
      fetchBoxscoreRaw(gamePk),
      fetchLinescoreRaw(gamePk),
    ]);
    return { boxRaw, lineRaw };
  } catch (e) {
    console.error(`fetchSourceGame(${gamePk}):`, (e as Error).message);
    return null;
  }
}

async function fetchScoring(gamePk: number) {
  try {
    return parseScoringPlays(await fetchPlayByPlayRaw(gamePk));
  } catch {
    return [];
  }
}

// ─── Public entry ──────────────────────────────────────────────────

export async function buildRevealData(puzzle: LinescordlePuzzle): Promise<RevealData> {
  // MLB API uses "hitting" (not "batting") as the stats group name;
  // our puzzle line type uses "batting" for naming clarity.
  const apiGroup: "hitting" | "pitching" = puzzle.line.kind === "batting" ? "hitting" : "pitching";

  const [player, careerStats, source] = await Promise.all([
    getPlayerByMlbId(puzzle.mlbId),
    fetchCareerStats(puzzle.mlbId, apiGroup),
    puzzle.sourceGamePk > 0 ? fetchSourceGame(puzzle.sourceGamePk) : Promise.resolve(null),
  ]);

  const careerHtml = renderCareerLine(puzzle.line.kind, careerStats);

  let boxScoreHtml = "";
  if (source) {
    const box = parseBoxscore(source.boxRaw);
    const scoring = await fetchScoring(puzzle.sourceGamePk);
    const game = synthesizeScheduleGame(puzzle.sourceGamePk, box, source.lineRaw);
    const detail: Required<GameDetail> = { game, box, scoring };
    const liveAbbrev: Record<string, string> = {};
    if (game.teams.away.team.abbreviation) liveAbbrev[game.teams.away.team.name] = game.teams.away.team.abbreviation;
    if (game.teams.home.team.abbreviation) liveAbbrev[game.teams.home.team.name] = game.teams.home.team.abbreviation;
    boxScoreHtml = renderGame(detail, liveAbbrev);
  }

  return { player, careerHtml, boxScoreHtml };
}
