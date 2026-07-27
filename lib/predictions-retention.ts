// Retention + season-end reads for the paid predictions tier (#111, Phase 5).
// Drives the predictions-retention cron: who gets an access-ending heads-up
// (a non-renewing window lapsing in a few days) and who gets the season
// wind-down (access ending for the year at the season-end guard).
//
// Split of truth holds: access windows come from predictions_entitlements;
// Stripe is consulted only to tell whether a subscription will renew (so we
// don't nag an auto-renewing subscriber that their access is "ending").

import { getStripe } from "./stripe";
import { supabaseAdmin } from "./supabase";
import { addDaysToISO, etDateFromUnixSeconds } from "./dates";
import { SEASON_END } from "./predictions-pricing";

export const RETENTION_LEAD_DAYS = 3;

type Row = {
  subscriber_id: string;
  access_end: string;
  stripe_subscription_id: string | null;
};

// Non-revoked MLB entitlements whose access ends exactly on `dateISO` (so each
// fires once). Paginated past the 1000-row cap.
async function entitlementsEndingOn(dateISO: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin()
      .from("predictions_entitlements")
      .select("subscriber_id, access_end, stripe_subscription_id")
      .eq("sport", "mlb")
      .is("revoked_at", null)
      .eq("access_end", dateISO)
      .range(from, from + 999);
    if (error) throw new Error(`entitlementsEndingOn: ${error.message}`);
    const page = (data ?? []) as Row[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

// True if this subscription will bill again past its current window — active,
// not set to cancel at period end, and the season cancel_at guard falls after
// the window. On any uncertainty we assume it renews, so we never nag an
// auto-renewing subscriber. Non-renewing (canceled / one-time / comp) → false.
async function willRenew(subscriptionId: string, accessEndISO: string): Promise<boolean> {
  try {
    const sub = await getStripe().subscriptions.retrieve(subscriptionId);
    if (sub.status !== "active" && sub.status !== "trialing") return false;
    if (sub.cancel_at_period_end) return false;
    if (sub.cancel_at && etDateFromUnixSeconds(sub.cancel_at) <= accessEndISO) return false;
    return true;
  } catch {
    return true;
  }
}

/**
 * Subscribers whose access ends in RETENTION_LEAD_DAYS and won't auto-renew —
 * the heads-up audience. Windows ending exactly at SEASON_END are excluded;
 * those get the season wind-down instead (no "resubscribe" nag at season end).
 */
export async function findAccessEndingSoon(todayISO: string): Promise<{ subscriberId: string; accessEnd: string }[]> {
  const target = addDaysToISO(todayISO, RETENTION_LEAD_DAYS);
  if (target === SEASON_END) return []; // handled by the wind-down
  const rows = await entitlementsEndingOn(target);
  const out: { subscriberId: string; accessEnd: string }[] = [];
  for (const r of rows) {
    if (r.stripe_subscription_id && (await willRenew(r.stripe_subscription_id, r.access_end))) continue;
    out.push({ subscriberId: r.subscriber_id, accessEnd: r.access_end });
  }
  return out;
}

/** On SEASON_END, everyone whose access ends that day — the wind-down audience. */
export async function findSeasonWindDownRecipients(todayISO: string): Promise<{ subscriberId: string }[]> {
  if (todayISO !== SEASON_END) return [];
  const rows = await entitlementsEndingOn(SEASON_END);
  return rows.map((r) => ({ subscriberId: r.subscriber_id }));
}
