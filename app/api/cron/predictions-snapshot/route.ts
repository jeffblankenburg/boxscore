import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { todayInET, isValidIsoDate } from "@/lib/dates";
import { rebuildPredictionsRenderCache } from "@/lib/sports/mlb/predictions-cache";
import {
  loadPredictionsForDate,
  PREDICTIONS_MODEL_VERSION,
} from "@/lib/sports/mlb/predictions-data";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Snapshot today's game-level predictions to daily_predictions so we
// can compare model output to actual results tomorrow. Idempotent —
// onConflict reupserts the row, so re-running the cron updates the
// snapshot rather than duplicating it.
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const sport = url.searchParams.get("sport") ?? "mlb";
  const date = url.searchParams.get("date") ?? todayInET();
  if (sport !== "mlb") {
    return NextResponse.json({ error: `no predictions for sport=${sport}` }, { status: 501 });
  }
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const result = await loadPredictionsForDate(date);
  if (result.games.length === 0) {
    return NextResponse.json({ ok: true, date, written: 0, note: "no games on slate" });
  }

  const sb = supabaseAdmin();
  const rows = result.games.map((g) => ({
    sport,
    date,
    game_pk: g.gamePk,
    model_version: PREDICTIONS_MODEL_VERSION,
    away_team_id: g.away.teamId,
    home_team_id: g.home.teamId,
    away_win_pct: Number(g.away.winProbability.toFixed(4)),
    home_win_pct: Number(g.home.winProbability.toFixed(4)),
    nrfi_pct:     Number(g.nrfiProbability.toFixed(4)),
    inputs: {
      away: {
        abbr: g.away.abbr,
        record: g.away.record,
        runsPerGame: g.away.runsPerGame,
        runsAllowedPerGame: g.away.runsAllowedPerGame,
        pythagWinPct: g.away.pythagWinPct,
        probableSp: g.away.probableSp,
      },
      home: {
        abbr: g.home.abbr,
        record: g.home.record,
        runsPerGame: g.home.runsPerGame,
        runsAllowedPerGame: g.home.runsAllowedPerGame,
        pythagWinPct: g.home.pythagWinPct,
        probableSp: g.home.probableSp,
      },
    },
  }));

  const { error } = await sb
    .from("daily_predictions")
    .upsert(rows, { onConflict: "sport,date,game_pk" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Rebuild the /mlb/predictions render cache so the page picks up
  // today's just-written predictions on its next render, then bust
  // the route cache so existing ISR-cached HTML gets regenerated
  // immediately instead of waiting for the revalidate window. A
  // failure here doesn't roll back the snapshot — the page can still
  // recompute live; just slower.
  let cacheError: string | null = null;
  try {
    await rebuildPredictionsRenderCache(date);
    revalidatePath("/mlb/predictions");
  } catch (e) {
    cacheError = (e as Error).message;
    console.error(`[predictions-snapshot] cache rebuild failed: ${cacheError}`);
  }

  return NextResponse.json({
    ok: true,
    date,
    written: rows.length,
    model: PREDICTIONS_MODEL_VERSION,
    ...(cacheError ? { cache_error: cacheError } : {}),
  });
}
