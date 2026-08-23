// Spread email delivery so a big send doesn't hit providers all at once. Every
// landed email triggers provider prefetch of the open pixel + tracked links; a
// concentrated burst hammers Supabase (tracking writes) and trips Vercel's
// edge-request anomaly alert. A small delay between Resend batches flattens the
// curve. 250ms still caps landings at ~400 emails/sec (a 100-email batch every
// 250ms) — enough to flatten the burst — while halving the pacing overhead the
// team send accumulates across its per-team batches (~90 batches: was ~45s at
// 500ms, now ~22s). Round-trip cost was the real budget hog, not pacing, and
// bulk sends-inserts (recordSends) removed that. Tunable/disable-able via env.
export const SEND_BATCH_PACE_MS = Math.max(0, Number(process.env.SEND_BATCH_PACE_MS ?? 250));

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pause between email batches to pace delivery. No-op when pacing is disabled.
export function paceBatch(): Promise<void> {
  return SEND_BATCH_PACE_MS > 0 ? sleep(SEND_BATCH_PACE_MS) : Promise.resolve();
}
