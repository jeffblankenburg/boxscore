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
// Skips undeliverable addresses: validated through the same validateEmail as
// the subscribe form, so this job can't flip a typo/malformed address live.
// Before this guard (added after the 2026-09-29 Resend batch incident) a
// blanket pending→active would resurrect exactly the bad addresses that poison
// send batches. Invalid rows are left pending, not activated.
//
// Idempotent: re-running finds zero activatable pending and no-ops.
//
// Run: npx tsx --env-file=.env.local scripts/activate-pending-subscribers.ts

import { supabaseAdmin } from "../lib/supabase";
import { validateEmail } from "../lib/email-validate";

async function main() {
  const db = supabaseAdmin();

  const { data: pending, error: pErr } = await db
    .from("subscribers")
    .select("id, email")
    .eq("status", "pending");
  if (pErr) throw new Error(`fetch pending: ${pErr.message}`);

  if (!pending || pending.length === 0) {
    console.log("No pending subscribers — nothing to do.");
    return;
  }

  const activatable = pending.filter((s) => validateEmail(s.email).ok);
  const skipped = pending.filter((s) => !validateEmail(s.email).ok);

  const { data, error } = await db
    .from("subscribers")
    .update({ status: "active" })
    .in("id", activatable.map((s) => s.id))
    .select("id");
  if (error) throw new Error(`activate: ${error.message}`);

  console.log("--- activate-pending-subscribers ---");
  console.log(`pending before:    ${pending.length}`);
  console.log(`flipped to active: ${data?.length ?? 0}`);
  console.log(`skipped (invalid): ${skipped.length}`);
  for (const s of skipped) console.log(`  - ${s.email}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
