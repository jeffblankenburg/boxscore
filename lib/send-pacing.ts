// Spread email delivery so a big send doesn't hit providers all at once. Every
// landed email triggers provider prefetch of the open pixel + tracked links; a
// concentrated burst hammers Supabase (tracking writes) and trips Vercel's
// edge-request anomaly alert. A small delay between Resend batches flattens the
// curve. Total added delay stays well within the send crons' 300s budget
// (MLB's ~60 batches × 500ms ≈ 30s). Tunable/disable-able via env.
export const SEND_BATCH_PACE_MS = Math.max(0, Number(process.env.SEND_BATCH_PACE_MS ?? 500));

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pause between email batches to pace delivery. No-op when pacing is disabled.
export function paceBatch(): Promise<void> {
  return SEND_BATCH_PACE_MS > 0 ? sleep(SEND_BATCH_PACE_MS) : Promise.resolve();
}
