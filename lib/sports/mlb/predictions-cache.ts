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
  type AccuracySummary,
  type GamePredictionOutcome,
  type PlayAccuracySummary,
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
  version: 1;
  date: string;               // ISO — the slate date (today, from the cron's perspective)
  yesterday: string;          // ISO — date we read outcomes/accuracy for
  generatedAt: string;        // ISO timestamp at build time
  modelVersion: string;
  slate: PredictionsResult;
  outcomes: GamePredictionOutcome[];
  rolling7:  AccuracySummary & PlayAccuracySummary;
  rolling30: AccuracySummary & PlayAccuracySummary;
  rollingSeason: AccuracySummary & PlayAccuracySummary;
  seasonDays: number;         // how many days the season-rolling window covered
};

export async function buildPredictionsRenderBlob(date: string): Promise<PredictionsRenderBlob> {
  const yesterday = prevDay(date);
  const seasonDays = daysSinceSeasonStart(date);

  // Wait on all four loaders in parallel. The slate load is the
  // expensive one — runs the model live, which is what this cache
  // exists to skip on the page. The other three are cheap reads of
  // prediction_results.
  const [slate, outcomes, rolling7, rolling30, rollingSeason] = await Promise.all([
    loadPredictionsForDate(date),
    loadPredictionOutcomesForDate(yesterday),
    loadPredictionAccuracy(7,           yesterday),
    loadPredictionAccuracy(30,          yesterday),
    loadPredictionAccuracy(seasonDays,  yesterday),
  ]);

  return {
    version: 1,
    date,
    yesterday,
    generatedAt:  new Date().toISOString(),
    modelVersion: PREDICTIONS_MODEL_VERSION,
    slate,
    outcomes,
    rolling7,
    rolling30,
    rollingSeason,
    seasonDays,
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
  return row.payload;
}
