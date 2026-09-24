// One-off: flip every `pending` subscriber to `active` so they start receiving
// digests. Requested 2026-09-24 — the double-opt-in confirmation step was
// dropped for this cohort; worst case they bounce/unsubscribe back to inactive.
//
// Only touches subscribers.status. Leaves confirmed_at NULL on purpose: it's an
// honest record (they never confirmed) AND a clean marker to identify/revert
// this exact cohort later (status='active' AND confirmed_at IS NULL). Opt-in
// rows (email_subscriptions) are untouched — a flipped subscriber only receives
// a digest if they already have an active league/team opt-in.
//
// Idempotent: re-running finds zero pending and no-ops.
//
// Run: npx tsx --env-file=.env.local scripts/activate-pending-subscribers.ts

import { supabaseAdmin } from "../lib/supabase";

async function main() {
  const db = supabaseAdmin();

  const { count: pendingBefore, error: cErr } = await db
    .from("subscribers")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (cErr) throw new Error(`count pending: ${cErr.message}`);

  if (!pendingBefore) {
    console.log("No pending subscribers — nothing to do.");
    return;
  }

  // Flip them. .select() returns the affected rows so we get an exact count.
  const { data, error } = await db
    .from("subscribers")
    .update({ status: "active" })
    .eq("status", "pending")
    .select("id");
  if (error) throw new Error(`activate: ${error.message}`);

  const flipped = data?.length ?? 0;

  console.log("--- activate-pending-subscribers ---");
  console.log(`pending before:    ${pendingBefore}`);
  console.log(`flipped to active: ${flipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
