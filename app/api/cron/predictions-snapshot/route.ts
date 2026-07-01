import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { todayInET, isValidIsoDate } from "@/lib/dates";
import {
  rebuildPredictionsRenderCache,
  warmPredictionsPage,
} from "@/lib/sports/mlb/predictions-cache";
import { siteOrigin } from "@/lib/site";
import {
  loadPredictionsForDate,
  PREDICTIONS_MODEL_VERSION,
} from "@/lib/sports/mlb/predictions-data";
import { captureEspnOddsForDate } from "@/lib/sports/mlb/odds-cache";

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

  // Capture today's DraftKings ML odds from ESPN alongside the
  // predictions so the ROI table on /mlb/predictions can show $10/play
  // P/L. Non-fatal — if ESPN is down or a game can't be matched, the
  // daily_odds row just doesn't get written and the ROI math skips it.
  let oddsReport: Awaited<ReturnType<typeof captureEspnOddsForDate>> | null = null;
  let oddsError: string | null = null;
  try {
    oddsReport = await captureEspnOddsForDate(date);
  } catch (e) {
    oddsError = (e as Error).message;
    console.error(`[predictions-snapshot] odds capture failed: ${oddsError}`);
  }

  // Rebuild the /mlb/predictions render cache so the page picks up
  // today's just-written predictions, bust the route cache, and then
  // warm it by issuing a real request against the page so the cron
  // itself is the first-hit render. Result: real visitors only ever
  // see fully cached HTML.
  let cacheError: string | null = null;
  let warm: Awaited<ReturnType<typeof warmPredictionsPage>> | null = null;
  try {
    await rebuildPredictionsRenderCache(date);
    revalidatePath("/mlb/predictions");
    const origin = await siteOrigin();
    warm = await warmPredictionsPage(origin);
    if (!warm.ok) {
      console.error(`[predictions-snapshot] warm-fetch ${warm.status ?? "—"} after ${warm.durationMs}ms: ${warm.error ?? "non-2xx"}`);
    }
  } catch (e) {
    cacheError = (e as Error).message;
    console.error(`[predictions-snapshot] cache rebuild failed: ${cacheError}`);
  }

  return NextResponse.json({
    ok: true,
    date,
    written: rows.length,
    model: PREDICTIONS_MODEL_VERSION,
    ...(oddsReport ? {
      odds_matched: oddsReport.matched,
      odds_upserted: oddsReport.upserted,
      odds_unmatched: oddsReport.unmatched.length,
    } : {}),
    ...(oddsError ? { odds_error: oddsError } : {}),
    ...(cacheError ? { cache_error: cacheError } : {}),
    ...(warm ? { warm_status: warm.status, warm_ms: warm.durationMs } : {}),
  });
}
