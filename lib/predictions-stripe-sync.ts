// Stripe event → entitlement mapping for the paid predictions tier (#111, Phase 1).
//
// The money→access translation layer. The webhook route (app/api/stripe/webhook)
// stays thin — verify, dedupe, dispatch — and hands each event here. This is
// where Stripe's billing objects become predictions_entitlements windows.
//
// Identity (which subscriber, which sport) ALWAYS comes from metadata we set
// server-side at checkout (subscriber_id, sport) — never trusted from the
// client. What they PAID FOR (product/term) is derived from the Stripe Price
// on the object, not from metadata, so access can't drift from the charge.
//
// Window model (#109): access_start = ET date of the charge ("today counts as
// used"), access_end = start + termDays - 1 for rolling subs, or SEASON_END
// for the one-time season pass. Anchoring on the charge timestamp (not Stripe's
// current_period_* fields) keeps this stable across Stripe API-version changes.

import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { addDaysToISO, etDateFromUnixSeconds, todayInET } from "./dates";
import {
  SEASON_END,
  TERM_DAYS,
  lookupKeyForPriceId,
  productForLookupKey,
} from "./predictions-pricing";
import {
  upsertStripeSubscriptionWindow,
  grantStripeOneTime,
  trimBySubscriptionToToday,
  listEntitlements,
  type PredictionsProduct,
} from "./predictions-entitlements";
import {
  sendPredictionsPurchaseEmail,
  sendPredictionsRenewalEmail,
  sendPredictionsPaymentFailedEmail,
} from "./predictions-emails";

export type SyncResult =
  | { status: "granted" | "extended"; product: PredictionsProduct; subscriberId: string; accessStart: string; accessEnd: string }
  | { status: "revoked"; stripeSubscriptionId: string }
  | { status: "notified"; subscriberId: string; kind: string }
  | { status: "skipped"; reason: string };

function identityFrom(metadata: Stripe.Metadata | null | undefined): { subscriberId: string; sport: string } | null {
  const subscriberId = metadata?.subscriber_id;
  if (!subscriberId) return null;
  return { subscriberId, sport: metadata?.sport ?? "mlb" };
}

/**
 * Sync a subscription's access window from its current state. Called for both
 * checkout.session.completed (subscription mode) and every invoice.paid.
 * `anchorUnix` is the charge time — the event/invoice timestamp — which sets
 * the ET access_start. Upsert merges, so the two creation events converge and
 * renewals extend.
 */
async function syncSubscription(subscriptionId: string, anchorUnix: number): Promise<SyncResult> {
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  const identity = identityFrom(sub.metadata);
  if (!identity) return { status: "skipped", reason: `subscription ${subscriptionId} has no subscriber_id metadata` };

  const priceId = sub.items.data[0]?.price?.id;
  const lookupKey = priceId ? lookupKeyForPriceId(priceId) : null;
  const product = lookupKey ? productForLookupKey(lookupKey) : null;
  if (product !== "week" && product !== "month") {
    return { status: "skipped", reason: `subscription ${subscriptionId} price ${priceId ?? "?"} is not a known recurring SKU` };
  }

  const accessStart = etDateFromUnixSeconds(anchorUnix);
  const accessEnd = addDaysToISO(accessStart, TERM_DAYS[product] - 1);
  const row = await upsertStripeSubscriptionWindow({
    subscriberId: identity.subscriberId,
    sport: identity.sport,
    product,
    accessStart,
    accessEnd,
    stripeSubscriptionId: subscriptionId,
  });
  // "extended" vs "granted" is cosmetic (for logs); the write is the same upsert.
  const status = row.accessStart < accessStart ? "extended" : "granted";
  return { status, product, subscriberId: identity.subscriberId, accessStart: row.accessStart, accessEnd: row.accessEnd };
}

/** Handle checkout.session.completed — dispatch subscription (weekly/monthly) vs one-time (season). */
export async function grantFromCheckoutSession(session: Stripe.Checkout.Session): Promise<SyncResult> {
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    return { status: "skipped", reason: `checkout ${session.id} not paid (${session.payment_status})` };
  }

  if (session.mode === "subscription") {
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (!subId) return { status: "skipped", reason: `checkout ${session.id} has no subscription` };
    return syncSubscription(subId, session.created);
  }

  if (session.mode === "payment") {
    // One-time season pass. Identity from session metadata; access runs to SEASON_END.
    const identity = identityFrom(session.metadata);
    if (!identity) return { status: "skipped", reason: `checkout ${session.id} has no subscriber_id metadata` };
    const accessStart = etDateFromUnixSeconds(session.created);
    const row = await grantStripeOneTime({
      subscriberId: identity.subscriberId,
      sport: identity.sport,
      product: "season",
      accessStart,
      accessEnd: SEASON_END,
      stripeCheckoutId: session.id,
    });
    return { status: "granted", product: "season", subscriberId: identity.subscriberId, accessStart: row.accessStart, accessEnd: row.accessEnd };
  }

  return { status: "skipped", reason: `checkout ${session.id} mode ${session.mode} not handled` };
}

// The invoice→subscription link has moved across Stripe API versions:
//   ≤2025:  invoice.subscription (string id)
//   dahlia: invoice.parent.subscription_details.subscription, mirrored per
//           line at line.parent.subscription_item_details.subscription
// Resolve from whichever is present so the webhook survives version bumps.
type SubRef = string | { id: string } | null | undefined;
type InvoiceSubRefs = {
  subscription?: SubRef;
  parent?: { subscription_details?: { subscription?: SubRef } | null } | null;
  lines?: { data?: Array<{ parent?: { subscription_item_details?: { subscription?: SubRef } | null } | null }> } | null;
};

function idOf(ref: SubRef): string | null {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object") return ref.id;
  return null;
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const inv = invoice as unknown as InvoiceSubRefs;
  return (
    idOf(inv.subscription) ??
    idOf(inv.parent?.subscription_details?.subscription) ??
    idOf(inv.lines?.data?.[0]?.parent?.subscription_item_details?.subscription)
  );
}

/** Handle invoice.paid — first invoice or renewal. Extends the window + emails a receipt. */
export async function syncFromInvoice(invoice: Stripe.Invoice): Promise<SyncResult> {
  const subId = subscriptionIdFromInvoice(invoice);
  if (!subId) return { status: "skipped", reason: `invoice ${invoice.id} has no subscription` };
  const result = await syncSubscription(subId, invoice.created);

  if (result.status === "granted" || result.status === "extended") {
    // billing_reason distinguishes the first charge from a renewal (authoritative,
    // unlike the granted/extended label). Email is best-effort — a failure must
    // not 500 the webhook and trigger a Stripe retry (which would double-send).
    const reason = (invoice as { billing_reason?: string | null }).billing_reason;
    const isRenewal = reason === "subscription_cycle" || reason === "subscription_update";
    try {
      if (isRenewal) {
        await sendPredictionsRenewalEmail({ subscriberId: result.subscriberId, product: result.product, accessEnd: result.accessEnd });
      } else {
        await sendPredictionsPurchaseEmail({ subscriberId: result.subscriberId, product: result.product, accessEnd: result.accessEnd });
      }
    } catch (e) {
      console.error(`predictions receipt email failed (${invoice.id}): ${(e as Error).message}`);
    }
  }
  return result;
}

/** Handle invoice.payment_failed — email the customer to update their card (access holds during Smart Retries). */
export async function notifyPaymentFailed(invoice: Stripe.Invoice): Promise<SyncResult> {
  const subId = subscriptionIdFromInvoice(invoice);
  if (!subId) return { status: "skipped", reason: `invoice ${invoice.id} has no subscription` };
  const sub = await getStripe().subscriptions.retrieve(subId);
  const identity = identityFrom(sub.metadata);
  if (!identity) return { status: "skipped", reason: `subscription ${subId} has no subscriber_id metadata` };

  // Access continues through the current entitlement window while Stripe retries.
  const rows = await listEntitlements(identity.subscriberId, identity.sport);
  const active = rows.find((r) => !r.revokedAt && r.stripeSubscriptionId === subId);
  const accessEnd = active?.accessEnd ?? todayInET();

  try {
    await sendPredictionsPaymentFailedEmail({ subscriberId: identity.subscriberId, accessEnd });
  } catch (e) {
    console.error(`payment-failed email failed (${invoice.id}): ${(e as Error).message}`);
  }
  return { status: "notified", subscriberId: identity.subscriberId, kind: "payment_failed" };
}

/** Handle customer.subscription.deleted — end access today (keep today, per #109). */
export async function revokeSubscription(subscription: Stripe.Subscription): Promise<SyncResult> {
  await trimBySubscriptionToToday(subscription.id, todayInET());
  return { status: "revoked", stripeSubscriptionId: subscription.id };
}
