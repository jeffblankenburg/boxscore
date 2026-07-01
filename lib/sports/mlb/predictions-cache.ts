// Build + read the pre-rendered payload for /mlb/predictions.
//
// Without this, the page recomputed the model on every render
// (loadSeasonAggregates scans ~120 days of daily_raw payloads = 20s
// cold start) for data that genuinely only changes when one of two
// crons fires:
//   - predictions-snapshot writes today's predictions (~14:30 UTC)
//   - predictions-comparator grades yesterday's outcomes (~09:30 UTC)
//
// Strategy: both crons call rebuildPredictionsRenderCache() after they
// finish, packaging today's slate, yesterday's outcomes, and rolling
// 7d/30d/season-to-date accuracy into one JSONB row. Page renders
// from that row directly. Stale rows are harmless — falling back to
// live compute when no row exists keeps the page resilient.

import { supabaseAdmin } from "@/lib/supabase";
import { prevDay } from "@/lib/dates";
import {
  loadPredictionsForDate,
  PREDICTIONS_MODEL_VERSION,
} from "./predictions-data";
import {
  loadPredictionAccuracy,
  loadPredictionOutcomesForDate,
  loadPlayRoi,
  loadSeasonHistory,
  type AccuracySummary,
  type GamePredictionOutcome,
  type PlayAccuracySummary,
  type PlayRoiSummary,
  type SeasonHistoryDay,
} from "./predictions-history";
import type { PredictionsResult } from "./predictions";

// Earliest plausible season start — used as the lower bound for the
// season-to-date rolling window. Anchored to March 1 since that's the
// same buffer we use when loading daily_raw aggregates.
function daysSinceSeasonStart(todayIso: string): number {
  const today  = new Date(`${todayIso}T00:00:00Z`).getTime();
  const start  = new Date(`${todayIso.slice(0, 4)}-03-01T00:00:00Z`).getTime();
  return Math.max(1, Math.round((today - start) / 86_400_000));
}

export type PredictionsRenderBlob = {
  version: 3;
  date: string;               // ISO — the slate date (today, from the cron's perspective)
  yesterday: string;          // ISO — date we read outcomes/accuracy for
  generatedAt: string;        // ISO timestamp at build time
  modelVersion: string;
  slate: PredictionsResult;
  outcomes: GamePredictionOutcome[];
  rolling7:  AccuracySummary & PlayAccuracySummary;
  rolling30: AccuracySummary & PlayAccuracySummary;
  rollingSeason: AccuracySummary & PlayAccuracySummary;
  roi7:      PlayRoiSummary;
  roi30:     PlayRoiSummary;
  roiSeason: PlayRoiSummary;
  seasonDays: number;         // how many days the season-rolling window covered
  seasonHistory: SeasonHistoryDay[]; // newest-first, one row per graded day
};

export async function buildPredictionsRenderBlob(date: string): Promise<PredictionsRenderBlob> {
  const yesterday = prevDay(date);
  const seasonDays = daysSinceSeasonStart(date);

  // Season window for the history table: from March 1 through yesterday.
  const seasonStart = `${date.slice(0, 4)}-03-01`;

  // Wait on all loaders in parallel. The slate load is the expensive
  // one — runs the model live, which is what this cache exists to
  // skip on the page. The other five are cheap reads.
  const [slate, outcomes, rolling7, rolling30, rollingSeason, seasonHistory, roi7, roi30, roiSeason] = await Promise.all([
    loadPredictionsForDate(date),
    loadPredictionOutcomesForDate(yesterday),
    loadPredictionAccuracy(7,           yesterday),
    loadPredictionAccuracy(30,          yesterday),
    loadPredictionAccuracy(seasonDays,  yesterday),
    loadSeasonHistory(seasonStart, yesterday),
    loadPlayRoi(7,           yesterday),
    loadPlayRoi(30,          yesterday),
    loadPlayRoi(seasonDays,  yesterday),
  ]);

  return {
    version: 3,
    date,
    yesterday,
    generatedAt:  new Date().toISOString(),
    modelVersion: PREDICTIONS_MODEL_VERSION,
    slate,
    outcomes,
    rolling7,
    rolling30,
    rollingSeason,
    roi7,
    roi30,
    roiSeason,
    seasonDays,
    seasonHistory,
  };
}

export async function rebuildPredictionsRenderCache(date: string): Promise<void> {
  const blob = await buildPredictionsRenderBlob(date);
  const { error } = await supabaseAdmin()
    .from("predictions_render_cache")
    .upsert({
      sport:         "mlb",
      date,
      model_version: PREDICTIONS_MODEL_VERSION,
      payload:       blob,
      generated_at:  blob.generatedAt,
    }, { onConflict: "sport,date" });
  if (error) {
    throw new Error(`rebuildPredictionsRenderCache(${date}): ${error.message}`);
  }
}

/** Returns the cached blob if present AND fresh for the current
 *  model version; otherwise null so the caller can fall back to live
 *  compute. Stale-model rows are treated as missing so a refit doesn't
 *  show old probabilities until the cron repopulates. */
const CURRENT_BLOB_VERSION = 3;

export async function readPredictionsRenderBlob(date: string): Promise<PredictionsRenderBlob | null> {
  const { data, error } = await supabaseAdmin()
    .from("predictions_render_cache")
    .select("payload, model_version")
    .eq("sport", "mlb")
    .eq("date", date)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { payload: PredictionsRenderBlob; model_version: string };
  if (row.model_version !== PREDICTIONS_MODEL_VERSION) return null;
  // Bump CURRENT_BLOB_VERSION above when adding fields so old rows
  // get rebuilt by the next cron instead of crashing the page on
  // missing data.
  if ((row.payload as { version?: number }).version !== CURRENT_BLOB_VERSION) return null;
  return row.payload;
}

/** Pre-renders /mlb/predictions on the server by issuing a real GET
 *  against the live URL. revalidatePath only INVALIDATES the route
 *  cache — the next inbound request triggers the regeneration. By
 *  fetching the page here, the cron itself becomes that request,
 *  populating Next.js's ISR cache so the first real visitor lands on
 *  fully cached HTML.
 *
 *  Both crons call this AFTER revalidatePath + the blob rebuild, so
 *  the rendered HTML reflects the freshest data. A non-2xx response
 *  or a network failure is logged but never throws — the page can
 *  still recover via ISR on the next visitor.
 */
export async function warmPredictionsPage(origin: string): Promise<{ ok: boolean; status?: number; durationMs: number; error?: string }> {
  const url = `${origin}/mlb/predictions`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      // Bust any Next data-cache layer in front of the route handler.
      cache: "no-store",
      headers: { "x-predictions-warmer": "1" },
    });
    // Drain the body so the server-side render fully completes before
    // we return — fetch resolves on headers, but the ISR cache is only
    // populated after the response stream finishes.
    await res.arrayBuffer();
    return { ok: res.ok, status: res.status, durationMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, durationMs: Date.now() - t0, error: (e as Error).message };
  }
}
