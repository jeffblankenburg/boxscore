import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { yesterdayInET, todayInET, isValidIsoDate } from "@/lib/dates";
import {
  rebuildPredictionsRenderCache,
  warmPredictionsPage,
} from "@/lib/sports/mlb/predictions-cache";
import { siteOrigin } from "@/lib/site";

export const runtime = "nodejs";
export const maxDuration = 120;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Bits of daily_raw.payload we read for scoring.
type DailyRawLineInning = { num?: number; home?: { runs?: number }; away?: { runs?: number } };
type DailyRawScheduleGame = {
  gamePk?: number;
  status?: { abstractGameState?: string; detailedState?: string };
  teams?: {
    away?: { score?: number; team?: { id?: number } };
    home?: { score?: number; team?: { id?: number } };
  };
  linescore?: {
    innings?: DailyRawLineInning[];
    teams?: {
      away?: { runs?: number };
      home?: { runs?: number };
    };
  };
};
type DailyRawSchedule = {
  dates?: Array<{ games?: DailyRawScheduleGame[] }>;
};

type DailyRawBoxLinescore = {
  innings?: Array<{ num: number; home?: { runs?: number }; away?: { runs?: number } }>;
};
type DailyRawBoxGame = {
  boxscore?: {
    teams?: {
      away?: { teamStats?: { batting?: { runs?: number } } };
      home?: { teamStats?: { batting?: { runs?: number } } };
    };
  };
  scoringPlays?: unknown;
  linescore?: DailyRawBoxLinescore;
};

type GameOutcome = {
  status: string;
  awayScore: number | null;
  homeScore: number | null;
  awayFirstInning: number | null;
  homeFirstInning: number | null;
};

function gameOutcomeFromRaw(
  gamePk: number,
  schedule: DailyRawSchedule | undefined,
  games: Record<string, DailyRawBoxGame> | undefined,
): GameOutcome | null {
  const scheduleGame = (schedule?.dates ?? [])
    .flatMap((d) => d.games ?? [])
    .find((g) => g.gamePk === gamePk);
  if (!scheduleGame) return null;
  const status = scheduleGame.status?.detailedState
    ?? scheduleGame.status?.abstractGameState
    ?? "unknown";
  const awayScore = scheduleGame.teams?.away?.score ?? null;
  const homeScore = scheduleGame.teams?.home?.score ?? null;

  // First inning runs — prefer schedule linescore.innings (always present
  // on final games), fall back to per-game box payload.
  let inning1Away: number | null = null;
  let inning1Home: number | null = null;
  const innings = scheduleGame.linescore?.innings
    ?? games?.[String(gamePk)]?.linescore?.innings;
  if (Array.isArray(innings)) {
    const first = innings.find((i) => i.num === 1);
    if (first) {
      inning1Away = typeof first.away?.runs === "number" ? first.away.runs : null;
      inning1Home = typeof first.home?.runs === "number" ? first.home.runs : null;
    }
  }
  return {
    status, awayScore, homeScore,
    awayFirstInning: inning1Away,
    homeFirstInning: inning1Home,
  };
}

type PredictionRow = {
  sport: string;
  date: string;
  game_pk: number;
  model_version: string;
  away_win_pct: number;
  home_win_pct: number;
  nrfi_pct: number;
};

type DailyRawPayload = {
  schedule?: DailyRawSchedule;
  games?: Record<string, DailyRawBoxGame>;
};

function scoreOne(pred: PredictionRow, outcome: GameOutcome) {
  const isFinal = outcome.status.toLowerCase().includes("final");
  let actual_winner: "away" | "home" | null = null;
  let win_correct: boolean | null = null;
  let win_brier: number | null = null;
  let actual_nrfi: boolean | null = null;
  let nrfi_correct: boolean | null = null;
  let nrfi_brier: number | null = null;

  if (isFinal && outcome.awayScore !== null && outcome.homeScore !== null && outcome.awayScore !== outcome.homeScore) {
    actual_winner = outcome.homeScore > outcome.awayScore ? "home" : "away";
    const predictedFavorite = pred.home_win_pct > pred.away_win_pct ? "home" : "away";
    win_correct = actual_winner === predictedFavorite;
    const homeWon = actual_winner === "home" ? 1 : 0;
    win_brier = Math.pow(pred.home_win_pct - homeWon, 2);
  }
  if (
    isFinal
    && outcome.awayFirstInning !== null
    && outcome.homeFirstInning !== null
  ) {
    actual_nrfi = (outcome.awayFirstInning + outcome.homeFirstInning) === 0;
    const predictedNrfi = pred.nrfi_pct >= 0.5;
    nrfi_correct = predictedNrfi === actual_nrfi;
    const nrfiHappened = actual_nrfi ? 1 : 0;
    nrfi_brier = Math.pow(pred.nrfi_pct - nrfiHappened, 2);
  }
  return { actual_winner, win_correct, win_brier, actual_nrfi, nrfi_correct, nrfi_brier };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const sport = url.searchParams.get("sport") ?? "mlb";
  const date = url.searchParams.get("date") ?? yesterdayInET();
  if (sport !== "mlb") {
    return NextResponse.json({ error: `no comparator for sport=${sport}` }, { status: 501 });
  }
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // 1. Pull predictions for the target date.
  const { data: preds } = await sb
    .from("daily_predictions")
    .select("sport, date, game_pk, model_version, away_win_pct, home_win_pct, nrfi_pct")
    .eq("sport", sport)
    .eq("date", date);
  if (!preds || preds.length === 0) {
    return NextResponse.json({ ok: true, date, scored: 0, note: "no predictions for date" });
  }

  // 2. Pull that date's daily_raw — has the schedule (with linescore) and
  //    boxscores we need to compute outcomes.
  const { data: rawRows } = await sb
    .from("daily_raw")
    .select("payload")
    .eq("sport", sport)
    .eq("date", date)
    .limit(1);
  const payload = (rawRows?.[0]?.payload as DailyRawPayload | undefined) ?? {};

  // 3. Score each prediction and upsert.
  const rows = preds.map((p) => {
    const outcome = gameOutcomeFromRaw(p.game_pk, payload.schedule, payload.games);
    if (!outcome) {
      return {
        ...p,
        status: "missing",
        away_score: null, home_score: null,
        away_first_inning: null, home_first_inning: null,
        actual_winner: null, actual_nrfi: null,
        win_correct: null, nrfi_correct: null,
        win_brier: null, nrfi_brier: null,
      };
    }
    const derived = scoreOne(p, outcome);
    return {
      ...p,
      status: outcome.status,
      away_score: outcome.awayScore,
      home_score: outcome.homeScore,
      away_first_inning: outcome.awayFirstInning,
      home_first_inning: outcome.homeFirstInning,
      ...derived,
    };
  });

  const { error } = await sb
    .from("prediction_results")
    .upsert(rows, { onConflict: "sport,date,game_pk,model_version" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Quick rollup so the cron logs convey what happened.
  const final = rows.filter((r) => r.win_correct !== null);
  const winHits = final.filter((r) => r.win_correct).length;
  const nrfiFinal = rows.filter((r) => r.nrfi_correct !== null);
  const nrfiHits = nrfiFinal.filter((r) => r.nrfi_correct).length;

  // Refresh the /mlb/predictions render cache for TODAY, bust the
  // route cache, and warm it with a real request so the cron itself
  // performs the first-hit render. Real visitors only see fully
  // cached HTML.
  let cacheError: string | null = null;
  let warm: Awaited<ReturnType<typeof warmPredictionsPage>> | null = null;
  try {
    await rebuildPredictionsRenderCache(todayInET());
    revalidatePath("/mlb/predictions");
    const origin = await siteOrigin();
    warm = await warmPredictionsPage(origin);
    if (!warm.ok) {
      console.error(`[predictions-comparator] warm-fetch ${warm.status ?? "—"} after ${warm.durationMs}ms: ${warm.error ?? "non-2xx"}`);
    }
  } catch (e) {
    cacheError = (e as Error).message;
    console.error(`[predictions-comparator] cache rebuild failed: ${cacheError}`);
  }

  return NextResponse.json({
    ok: true,
    date,
    scored: rows.length,
    finals: final.length,
    win_accuracy: final.length > 0 ? winHits / final.length : null,
    nrfi_accuracy: nrfiFinal.length > 0 ? nrfiHits / nrfiFinal.length : null,
    ...(cacheError ? { cache_error: cacheError } : {}),
    ...(warm ? { warm_status: warm.status, warm_ms: warm.durationMs } : {}),
  });
}
