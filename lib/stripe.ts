// Stripe client for the paid /mlb/predictions tier (GitHub #109 / #111).
//
// Two key pairs coexist in the environment on purpose: STRIPE_DEV_* are
// test-mode keys, STRIPE_* are live. Per the #111 build plan, everything —
// Phase 0 price creation, webhooks, checkout, /settings — is exercised in
// TEST mode; the live keys go active only at the Phase 6 launch flip.
//
// Resolution rule: an explicit STRIPE_MODE env wins (so a preview deploy can
// be forced to test); otherwise live only in the production runtime, test
// everywhere else (local dev, scripts, `stripe listen`). Test and live are
// separate Stripe accounts, so price IDs differ — see stripe-prices.generated.json.

import Stripe from "stripe";

export type StripeMode = "test" | "live";

export function stripeMode(): StripeMode {
  const override = process.env.STRIPE_MODE;
  if (override === "test" || override === "live") return override;
  return process.env.NODE_ENV === "production" ? "live" : "test";
}

function secretKey(mode: StripeMode): string {
  const key = mode === "live" ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_DEV_SECRET_KEY;
  if (!key) {
    const varName = mode === "live" ? "STRIPE_SECRET_KEY" : "STRIPE_DEV_SECRET_KEY";
    throw new Error(`Missing ${varName} (Stripe ${mode}-mode secret key)`);
  }
  return key;
}

/** The publishable key for the active mode — safe to expose to the browser (Payment Element, Phase 2). */
export function stripePublishableKey(): string {
  const mode = stripeMode();
  const key = mode === "live" ? process.env.STRIPE_PUBLISHABLE_KEY : process.env.STRIPE_DEV_PUBLISHABLE_KEY;
  if (!key) {
    const varName = mode === "live" ? "STRIPE_PUBLISHABLE_KEY" : "STRIPE_DEV_PUBLISHABLE_KEY";
    throw new Error(`Missing ${varName} (Stripe ${mode}-mode publishable key)`);
  }
  return key;
}

let cached: { mode: StripeMode; client: Stripe } | null = null;

/** Singleton Stripe client for the active mode. Server-only — never import from client code. */
export function getStripe(): Stripe {
  const mode = stripeMode();
  if (cached && cached.mode === mode) return cached.client;
  const client = new Stripe(secretKey(mode));
  cached = { mode, client };
  return client;
}
