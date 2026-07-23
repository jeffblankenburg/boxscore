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
  loadPredictionInputsForDate,
  PREDICTIONS_MODEL_VERSION,
} from "@/lib/sports/mlb/predictions-data";
import { predictGames, type PredictionsResult } from "@/lib/sports/mlb/predictions";
import { predictGamesV7, predictGamesV71, V7_MODEL_VERSION, V71_MODEL_VERSION } from "@/lib/sports/mlb/predictions-v7";
import { captureEspnOddsForDate } from "@/lib/sports/mlb/odds-cache";
import { buildDailyCard, CARD_MARKETS, CARD_VERSION, type CardGameOdds } from "@/lib/sports/mlb/market-registry";

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

  // Load inputs once; run v6 (production) AND v7 (graded shadow) off the
  // same as-of-date data so their track records are strictly comparable.
  const inputs = await loadPredictionInputsForDate(date);
  if (!inputs || inputs.slate.length === 0) {
    return NextResponse.json({ ok: true, date, written: 0, note: "no games on slate" });
  }

  const sb = supabaseAdmin();
  const producers: Array<[string, PredictionsResult]> = [
    [PREDICTIONS_MODEL_VERSION, predictGames(inputs)],
    [V7_MODEL_VERSION, predictGamesV7(inputs)],
    [V71_MODEL_VERSION, predictGamesV71(inputs)],
  ];
  const rows = producers.flatMap(([modelVersion, res]) =>
    res.games.map((g) => ({
      sport,
      date,
      game_pk: g.gamePk,
      model_version: modelVersion,
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
    })),
  );

  const { error } = await sb
    .from("daily_predictions")
    .upsert(rows, { onConflict: "sport,date,game_pk,model_version" });
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

  // Freeze today's daily card (per-market registry + edge-aware selector)
  // into daily_picks. Runs AFTER odds capture so the ML band filter sees
  // this morning's DK lines; FanDuel NRFI lines usually arrive later via
  // the odds-poll cron, which is fine — ranking is at market-typical
  // prices, captured lines only gate the ML odds band. Non-fatal so the
  // predictions snapshot never fails on a card problem.
  let cardWritten = 0;
  let cardError: string | null = null;
  try {
    const [, v6Res] = producers[0]!;
    const [, v7Res] = producers[1]!;
    const { data: oddsRows } = await sb
      .from("daily_odds_first")
      .select("game_pk, book, home_ml_odds, nrfi_odds, yrfi_odds")
      .eq("sport", sport)
      .eq("date", date)
      .in("book", ["DraftKings", "FanDuel"]);
    const oddsByGamePk = new Map<number, CardGameOdds>();
    for (const o of (oddsRows ?? []) as Array<{ game_pk: number; book: string; home_ml_odds: number | null; nrfi_odds: number | null; yrfi_odds: number | null }>) {
      const entry = oddsByGamePk.get(o.game_pk) ?? { homeMlOdds: null, nrfiOdds: null, yrfiOdds: null };
      if (o.book === "DraftKings" && o.home_ml_odds != null) entry.homeMlOdds = o.home_ml_odds;
      if (o.book === "FanDuel") {
        if (o.nrfi_odds != null) entry.nrfiOdds = o.nrfi_odds;
        if (o.yrfi_odds != null) entry.yrfiOdds = o.yrfi_odds;
      }
      oddsByGamePk.set(o.game_pk, entry);
    }
    const card = buildDailyCard(v6Res, v7Res, oddsByGamePk);
    const cardRows = card.map((p, i) => ({
      sport,
      date,
      game_pk: p.gamePk,
      market: p.market,
      subject: "game",
      card_version: CARD_VERSION,
      side: p.side,
      probability: Number(p.probability.toFixed(4)),
      ev: Number(p.ev.toFixed(4)),
      guaranteed: p.guaranteed,
      rank: i + 1,
      model_version: CARD_MARKETS[p.market].modelVersion,
    }));
    const { error: cardErr } = await sb
      .from("daily_picks")
      .upsert(cardRows, { onConflict: "sport,date,game_pk,market,subject,card_version" });
    if (cardErr) throw new Error(cardErr.message);
    cardWritten = cardRows.length;
  } catch (e) {
    cardError = (e as Error).message;
    console.error(`[predictions-snapshot] card write failed: ${cardError}`);
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
    models: [PREDICTIONS_MODEL_VERSION, V7_MODEL_VERSION, V71_MODEL_VERSION],
    card_written: cardWritten,
    ...(cardError ? { card_error: cardError } : {}),
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
