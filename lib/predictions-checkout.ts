// Checkout (buy-path) server logic for the paid predictions tier (#111, Phase 2).
//
// Invisible Stripe: the customer never leaves boxscore. We create a Stripe
// Subscription with payment_behavior=default_incomplete and hand its invoice's
// client_secret to the on-site Payment Element (SubscribeClient). When the
// customer confirms, the PaymentIntent succeeds → invoice.paid → the Phase-1
// webhook writes the entitlement. This module does NOT touch entitlements — it
// only sets up the Stripe objects; access is granted by the webhook.
//
// Every subscription carries cancel_at = SEASON_END_CANCEL_AT (the #109 renewal
// guard) and metadata (subscriber_id, sport) so the webhook can attribute it.

import type Stripe from "stripe";
import { getStripe, stripeMode } from "./stripe";
import { supabaseAdmin } from "./supabase";
import { todayInET } from "./dates";
import {
  stripePriceId,
  isSellable,
  SEASON_END_CANCEL_AT,
  CHECKOUT_LIVE_ENABLED,
} from "./predictions-pricing";

export type RecurringCheckoutSku = "week" | "month";
export type CheckoutStart = { clientSecret: string; subscriptionId: string; customerId: string };

// True unless we're in live mode before the Phase 6 launch flip. The page uses
// this to hide the buy UI; the action enforces it (assertCheckoutAllowed).
export function checkoutOpen(): boolean {
  return !(stripeMode() === "live" && !CHECKOUT_LIVE_ENABLED);
}

// Refuse live-mode checkout until the Phase 6 launch flip — the mode resolver
// uses live keys in production, and no real charge may happen before launch.
function assertCheckoutAllowed(): void {
  if (!checkoutOpen()) throw new Error("Predictions checkout isn't open yet.");
}

// Reuse the subscriber's Stripe Customer if we have one; otherwise create it
// and persist the id (one customer per subscriber, migration 0080).
async function getOrCreateStripeCustomer(args: {
  subscriberId: string;
  email: string;
  existingCustomerId: string | null;
}): Promise<string> {
  if (args.existingCustomerId) return args.existingCustomerId;
  const customer = await getStripe().customers.create({
    email: args.email,
    metadata: { subscriber_id: args.subscriberId },
  });
  const { error } = await supabaseAdmin()
    .from("subscribers")
    .update({ stripe_customer_id: customer.id })
    .eq("id", args.subscriberId);
  if (error) throw new Error(`persist stripe_customer_id: ${error.message}`);
  return customer.id;
}

const LOOKUP_BY_SKU: Record<RecurringCheckoutSku, string> = {
  week: "predictions_week",
  month: "predictions_month",
};

/**
 * Start a weekly/monthly subscription purchase. Returns the client_secret for
 * the Payment Element. Throws if not sellable today or checkout isn't open.
 */
export async function startSubscriptionCheckout(args: {
  subscriberId: string;
  email: string;
  existingCustomerId: string | null;
  sku: RecurringCheckoutSku;
}): Promise<CheckoutStart> {
  assertCheckoutAllowed();
  if (!isSellable(args.sku, todayInET())) {
    throw new Error(`The ${args.sku === "week" ? "weekly" : "monthly"} plan isn't available right now.`);
  }

  const customerId = await getOrCreateStripeCustomer(args);
  const sub = await getStripe().subscriptions.create({
    customer: customerId,
    items: [{ price: stripePriceId(LOOKUP_BY_SKU[args.sku]) }],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    cancel_at: SEASON_END_CANCEL_AT, // #109 renewal guard — no billing past season end
    expand: ["latest_invoice.confirmation_secret"],
    metadata: { subscriber_id: args.subscriberId, sport: "mlb" },
  });

  // dahlia exposes the Payment Element client_secret at
  // latest_invoice.confirmation_secret.client_secret (older APIs used
  // latest_invoice.payment_intent.client_secret).
  const inv = sub.latest_invoice as Stripe.Invoice | null;
  const clientSecret =
    (inv as unknown as { confirmation_secret?: { client_secret?: string } } | null)?.confirmation_secret?.client_secret ??
    (inv as unknown as { payment_intent?: { client_secret?: string } } | null)?.payment_intent?.client_secret;
  if (!clientSecret) throw new Error("Stripe returned no client secret for the subscription invoice.");

  return { clientSecret, subscriptionId: sub.id, customerId };
}
