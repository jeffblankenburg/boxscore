"use client";

// On-site Payment Element checkout (GitHub #111, Phase 2). Invisible Stripe:
// the customer picks a plan, we create the subscription server-side (via the
// startCheckout action) and mount the Payment Element with the returned
// client_secret. Confirming redirects to the success page, where the entitlement
// the webhook wrote is shown. Card data goes straight to Stripe (PCI SAQ A).

import { useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { startCheckout } from "./actions";
import type { RecurringCheckoutSku } from "@/lib/predictions-checkout";

export type PlanOption = { sku: RecurringCheckoutSku; label: string; priceLabel: string; sub: string };

// Cache the Stripe.js load per publishable key (module scope, survives re-renders).
const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeFor(pk: string): Promise<Stripe | null> {
  let p = stripeCache.get(pk);
  if (!p) { p = loadStripe(pk); stripeCache.set(pk, p); }
  return p;
}

export function SubscribeClient({
  publishableKey,
  plans,
  successUrl,
}: {
  publishableKey: string;
  plans: PlanOption[];
  successUrl: string;
}) {
  const [selected, setSelected] = useState<RecurringCheckoutSku | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stripePromise = useMemo(() => stripeFor(publishableKey), [publishableKey]);

  async function choose(sku: RecurringCheckoutSku) {
    setSelected(sku);
    setError(null);
    setStarting(true);
    const res = await startCheckout(sku);
    setStarting(false);
    if (res.ok) setClientSecret(res.clientSecret);
    else { setError(res.error); setSelected(null); }
  }

  // Once we have a client secret, mount the Payment Element.
  if (clientSecret) {
    return (
      <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "flat" } }}>
        <PaymentForm successUrl={successUrl} planLabel={plans.find((p) => p.sku === selected)?.label ?? ""} />
      </Elements>
    );
  }

  return (
    <div className="sub-checkout">
      <div className="sub-plans">
        {plans.map((p) => (
          <button
            key={p.sku}
            type="button"
            className="sub-plan"
            disabled={starting}
            onClick={() => choose(p.sku)}
          >
            <span className="sub-plan-label">{p.label}</span>
            <span className="sub-plan-price">{p.priceLabel}</span>
            <span className="sub-plan-sub">{p.sub}</span>
          </button>
        ))}
      </div>
      {starting && <p className="sub-note">Setting up checkout…</p>}
      {error && <p className="sub-error">{error}</p>}
    </div>
  );
}

function PaymentForm({ successUrl, planLabel }: { successUrl: string; planLabel: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: successUrl },
    });
    // If confirmPayment succeeds it redirects to return_url; we only get here
    // on an immediate error (declined card, validation).
    if (error) {
      setError(error.message ?? "Payment could not be completed.");
      setSubmitting(false);
    }
  }

  return (
    <form className="sub-checkout" onSubmit={onSubmit}>
      {planLabel && <p className="sub-note">You&apos;re subscribing to the <strong>{planLabel}</strong> plan.</p>}
      <PaymentElement />
      <button type="submit" className="sub-submit" disabled={!stripe || submitting}>
        {submitting ? "Processing…" : "Subscribe"}
      </button>
      {error && <p className="sub-error">{error}</p>}
      <p className="sub-fineprint">
        Auto-renews until you cancel; no billing past the end of the season. Cancel anytime in Settings for a prorated refund.
      </p>
    </form>
  );
}
