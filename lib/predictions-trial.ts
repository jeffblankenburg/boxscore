// One-time free-trial logic for the paid predictions tier (Jeff's note).
//
// Eligible subscribers (flagged by the launch snapshot) can self-activate a
// 3-day trial from the /mlb/predictions storefront. A trial is just a comp
// entitlement — no Stripe, no card. It's one-shot: activated_at is stamped so
// it can't be re-triggered, and new signups (never flagged) don't see the offer.

import { supabaseAdmin } from "./supabase";
import { grantComp } from "./predictions-entitlements";
import { todayInET, addDaysToISO } from "./dates";

const TRIAL_DAYS = 3;
const SPORT = "mlb";

/**
 * True if this subscriber may activate the trial right now — flagged eligible,
 * not yet used. Fails SAFE (returns false) on any read error so a hiccup — or
 * the columns not existing yet pre-migration — never breaks the predictions page;
 * worst case we just don't show the trial. The activation itself is guarded
 * separately (activateTrial's atomic claim), so this being lenient is fine.
 */
export async function canActivateTrial(subscriberId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("subscribers")
      .select("predictions_trial_eligible_at, predictions_trial_activated_at")
      .eq("id", subscriberId)
      .maybeSingle<{ predictions_trial_eligible_at: string | null; predictions_trial_activated_at: string | null }>();
    if (error) throw error;
    return !!data?.predictions_trial_eligible_at && !data.predictions_trial_activated_at;
  } catch (e) {
    console.warn(`canActivateTrial: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Activate the one-time 3-day trial: grant a comp entitlement (today → today+2,
 * 3 days inclusive) and stamp activated_at. The activated_at update is guarded
 * on `is null` so a double-click can't grant twice. Throws if not eligible.
 */
export async function activateTrial(subscriberId: string): Promise<{ accessEnd: string }> {
  const today = todayInET();
  const accessEnd = addDaysToISO(today, TRIAL_DAYS - 1);

  // Claim the activation first (atomic guard) — only proceed if this flips a
  // null activated_at, so concurrent clicks can't both grant.
  const { data: claimed, error: claimErr } = await supabaseAdmin()
    .from("subscribers")
    .update({ predictions_trial_activated_at: new Date().toISOString() })
    .eq("id", subscriberId)
    .not("predictions_trial_eligible_at", "is", null)
    .is("predictions_trial_activated_at", null)
    .select("id");
  if (claimErr) throw new Error(`activateTrial(claim): ${claimErr.message}`);
  if (!claimed || claimed.length === 0) throw new Error("You're not eligible for the free trial (or already used it).");

  await grantComp({
    subscriberId,
    sport: SPORT,
    accessStart: today,
    accessEnd,
    grantedBy: "trial",
    note: "3-day free trial",
  });
  return { accessEnd };
}
