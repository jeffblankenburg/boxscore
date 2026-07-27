// Account/self-service server logic for the paid predictions tier (#111, Phase 4).
//
// Under invisible Stripe there's no Customer Portal — /settings IS the whole
// self-service surface. This module reads the account state the settings card
// renders, and performs the two mutations: cancel (immediate + prorated refund
// + trim entitlement + email) and update-payment-method (SetupIntent).
//
// Split of truth (#109): the entitlement window is the source of truth for
// "what access you have" (renders even if Stripe is down); Stripe is queried
// only for billing details (next charge, card, refund amount).

import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { supabaseAdmin } from "./supabase";
import { todayInET, etDateFromUnixSeconds, addDaysToISO } from "./dates";
import {
  TERM_DAYS,
  proratedRefundCents,
  lookupKeyForPriceId,
  productForLookupKey,
} from "./predictions-pricing";
import {
  listEntitlements,
  trimBySubscriptionToToday,
  type PredictionsProduct,
} from "./predictions-entitlements";
import { sendPredictionsCancellationEmail } from "./predictions-emails";

export type CardInfo = { brand: string; last4: string };

export type PredictionsAccountState =
  | { state: "none" }
  | { state: "comped"; accessEnd: string }
  | {
      state: "active" | "past_due";
      product: PredictionsProduct;
      accessEnd: string;
      autoRenew: boolean;
      nextChargeISO: string | null;
      nextChargeCents: number | null;
      card: CardInfo | null;
      refundIfCancelledNowCents: number;
      subscriptionId: string;
    };

function pmIdOf(v: string | Stripe.PaymentMethod | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

async function cardInfo(pmId: string): Promise<CardInfo | null> {
  try {
    const pm = await getStripe().paymentMethods.retrieve(pmId);
    return pm.card ? { brand: pm.card.brand, last4: pm.card.last4 } : null;
  } catch {
    return null;
  }
}

// The current-period end (last covered ET day) under our term-day model — the
// same window we grant, independent of Stripe's sub-day period timestamps.
function currentPeriodEndISO(product: PredictionsProduct, periodStartISO: string, fallbackAccessEnd: string): string {
  if (product === "week" || product === "month") return addDaysToISO(periodStartISO, TERM_DAYS[product] - 1);
  return fallbackAccessEnd; // season (one-time) runs to SEASON_END
}

/** The account state the /settings predictions card renders for (subscriber, sport). */
export async function getPredictionsAccountState(subscriberId: string, sport: string): Promise<PredictionsAccountState> {
  const today = todayInET();
  const rows = await listEntitlements(subscriberId, sport);
  const covering = rows.filter((r) => !r.revokedAt && r.accessStart <= today && r.accessEnd >= today);
  if (covering.length === 0) return { state: "none" };

  const stripeRow = covering.find((r) => r.source === "stripe" && r.stripeSubscriptionId);
  if (!stripeRow) {
    const comp = covering.find((r) => r.source === "comp");
    return comp ? { state: "comped", accessEnd: comp.accessEnd } : { state: "none" };
  }

  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(stripeRow.stripeSubscriptionId!, { expand: ["latest_invoice"] });
  const item = sub.items.data[0];
  const priceId = item?.price?.id;
  const lookupKey = priceId ? lookupKeyForPriceId(priceId) : null;
  const product = (lookupKey && productForLookupKey(lookupKey)) || stripeRow.product;

  const status = sub.status;
  const state: "active" | "past_due" = status === "past_due" || status === "unpaid" ? "past_due" : "active";

  const pmId = pmIdOf(sub.default_payment_method) ?? pmIdOf((sub.customer as Stripe.Customer)?.invoice_settings?.default_payment_method ?? null);
  const card = pmId ? await cardInfo(pmId) : null;

  // Renewal: current_period_end, unless the season-end cancel_at guard falls first.
  const periodStartUnix = item?.current_period_start ?? sub.created;
  const periodEndUnix = item?.current_period_end ?? null;
  const willRenew =
    !sub.cancel_at_period_end &&
    status === "active" &&
    periodEndUnix != null &&
    (!sub.cancel_at || sub.cancel_at > periodEndUnix);
  const nextChargeISO = willRenew && periodEndUnix != null ? etDateFromUnixSeconds(periodEndUnix) : null;
  const nextChargeCents = willRenew ? item?.price?.unit_amount ?? null : null;

  // Refund-if-cancelled-now: unused days of the current period × price actually paid.
  const periodStartISO = etDateFromUnixSeconds(periodStartUnix);
  const periodEndISO = currentPeriodEndISO(product, periodStartISO, stripeRow.accessEnd);
  const inv = sub.latest_invoice as Stripe.Invoice | null;
  const pricePaidCents = inv?.amount_paid ?? item?.price?.unit_amount ?? 0;
  const refundIfCancelledNowCents = proratedRefundCents({ pricePaidCents, periodStartISO, periodEndISO, todayISO: today });

  return {
    state,
    product,
    accessEnd: stripeRow.accessEnd,
    autoRenew: willRenew,
    nextChargeISO,
    nextChargeCents,
    card,
    refundIfCancelledNowCents,
    subscriptionId: sub.id,
  };
}

/**
 * Cancel immediately + refund the unused portion (#109). Order: compute the
 * refund from current state, issue the partial refund, cancel the sub, trim
 * the entitlement to today, email the receipt. Returns what was refunded and
 * the (now trimmed) access-end. Throws if there's nothing active to cancel.
 */
export async function cancelPredictionsSubscription(subscriberId: string, sport: string): Promise<{ refundCents: number; accessEndISO: string }> {
  const acct = await getPredictionsAccountState(subscriberId, sport);
  if (acct.state !== "active" && acct.state !== "past_due") {
    throw new Error("No active subscription to cancel.");
  }
  const stripe = getStripe();
  const refundCents = acct.refundIfCancelledNowCents;

  // Refund the current period's PaymentIntent (dahlia: invoice.payments[].payment.payment_intent).
  if (refundCents > 0) {
    const sub = await stripe.subscriptions.retrieve(acct.subscriptionId, { expand: ["latest_invoice.payments"] });
    const inv = sub.latest_invoice as Stripe.Invoice | null;
    const pi = (inv as unknown as { payments?: { data?: Array<{ payment?: { payment_intent?: string } }> } } | null)
      ?.payments?.data?.[0]?.payment?.payment_intent;
    if (pi) await stripe.refunds.create({ payment_intent: pi, amount: refundCents });
  }

  await stripe.subscriptions.cancel(acct.subscriptionId);

  const today = todayInET();
  await trimBySubscriptionToToday(acct.subscriptionId, today);

  try {
    await sendPredictionsCancellationEmail({ subscriberId, product: acct.product, accessEnd: today, refundCents });
  } catch (e) {
    console.error(`cancellation email failed: ${(e as Error).message}`);
  }

  return { refundCents, accessEndISO: today };
}

/** SetupIntent client_secret for the inline "update payment method" Payment Element. */
export async function createUpdatePaymentSetupIntent(subscriberId: string): Promise<{ clientSecret: string }> {
  const { data, error } = await supabaseAdmin()
    .from("subscribers")
    .select("stripe_customer_id")
    .eq("id", subscriberId)
    .maybeSingle<{ stripe_customer_id: string | null }>();
  if (error) throw new Error(`createUpdatePaymentSetupIntent: ${error.message}`);
  if (!data?.stripe_customer_id) throw new Error("No Stripe customer on file.");

  const si = await getStripe().setupIntents.create({
    customer: data.stripe_customer_id,
    usage: "off_session", // saved for future renewals
  });
  if (!si.client_secret) throw new Error("Stripe returned no SetupIntent client secret.");
  return { clientSecret: si.client_secret };
}

/**
 * After the customer confirms the SetupIntent (client-side), set the new
 * payment method as the default on both the customer and their active
 * subscription so renewals use it.
 */
export async function finalizeUpdatePayment(subscriberId: string, sport: string, setupIntentId: string): Promise<void> {
  const stripe = getStripe();
  const si = await stripe.setupIntents.retrieve(setupIntentId);
  const pmId = pmIdOf(si.payment_method);
  if (!pmId) throw new Error("SetupIntent has no payment method.");
  const customerId = typeof si.customer === "string" ? si.customer : si.customer?.id;
  if (customerId) {
    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pmId } });
  }
  const acct = await getPredictionsAccountState(subscriberId, sport);
  if (acct.state === "active" || acct.state === "past_due") {
    await stripe.subscriptions.update(acct.subscriptionId, { default_payment_method: pmId });
  }
}
