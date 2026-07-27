"use server";

// Server action backing the on-site Payment Element (GitHub #111, Phase 2).
// The client calls startCheckout(sku) when a plan is chosen; we authenticate
// via the session cookie, set up the Stripe subscription, and return the
// client_secret the Payment Element needs. Identity comes from the session —
// the client never passes a subscriber id.

import { getSessionSubscriber } from "@/lib/subscriber-session";
import { startSubscriptionCheckout, type RecurringCheckoutSku } from "@/lib/predictions-checkout";

export type StartCheckoutResult =
  | { ok: true; clientSecret: string }
  | { ok: false; error: string };

export async function startCheckout(sku: RecurringCheckoutSku): Promise<StartCheckoutResult> {
  if (sku !== "week" && sku !== "month") return { ok: false, error: "Unknown plan." };

  const subscriber = await getSessionSubscriber();
  if (!subscriber) return { ok: false, error: "Please sign in to subscribe." };

  try {
    const { clientSecret } = await startSubscriptionCheckout({
      subscriberId: subscriber.id,
      email: subscriber.email,
      existingCustomerId: subscriber.stripeCustomerId,
      sku,
    });
    return { ok: true, clientSecret };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
