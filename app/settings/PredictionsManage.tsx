"use client";

// Client actions for the /settings Predictions card (#111, Phase 4): the
// painless Cancel (shows the prorated refund before confirming) and the inline
// Update-payment-method (SetupIntent + Payment Element, no redirect). Both call
// server actions and reload settings on success so the card re-renders.

import { useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { cancelPredictions, startUpdatePayment, finishUpdatePayment } from "./predictions-actions";

const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeFor(pk: string): Promise<Stripe | null> {
  let p = stripeCache.get(pk);
  if (!p) { p = loadStripe(pk); stripeCache.set(pk, p); }
  return p;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function PredictionsManage({
  publishableKey,
  refundLabel,
}: {
  publishableKey: string;
  refundLabel: string; // prorated refund if cancelled now, pre-formatted
}) {
  return (
    <div className="ps-actions">
      <UpdateCard publishableKey={publishableKey} />
      <CancelFlow refundLabel={refundLabel} />
    </div>
  );
}

function CancelFlow({ refundLabel }: { refundLabel: string }) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function doCancel() {
    setPhase("working");
    setError(null);
    const res = await cancelPredictions();
    if (res.ok) {
      setResult(res.refundCents > 0 ? `Canceled. ${money(res.refundCents)} refunded to your card.` : "Canceled.");
      setPhase("done");
      setTimeout(() => window.location.reload(), 1400);
    } else {
      setError(res.error);
      setPhase("confirm");
    }
  }

  if (phase === "done") return <p className="ps-ok">{result}</p>;

  if (phase === "idle") {
    return (
      <button type="button" className="ps-link-btn ps-danger" onClick={() => setPhase("confirm")}>
        Cancel subscription
      </button>
    );
  }

  return (
    <div className="ps-confirm">
      <p className="ps-note">
        Cancel now and we&apos;ll refund <strong>{refundLabel}</strong> for the unused days. Your
        access ends at the end of today.
      </p>
      <div className="ps-confirm-row">
        <button type="button" className="ps-btn ps-danger-btn" disabled={phase === "working"} onClick={doCancel}>
          {phase === "working" ? "Canceling…" : "Confirm cancel"}
        </button>
        <button type="button" className="ps-link-btn" disabled={phase === "working"} onClick={() => setPhase("idle")}>
          Keep subscription
        </button>
      </div>
      {error && <p className="ps-error">{error}</p>}
    </div>
  );
}

function UpdateCard({ publishableKey }: { publishableKey: string }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stripePromise = useMemo(() => stripeFor(publishableKey), [publishableKey]);

  async function begin() {
    setStarting(true);
    setError(null);
    const res = await startUpdatePayment();
    setStarting(false);
    if (res.ok) setClientSecret(res.clientSecret);
    else setError(res.error);
  }

  if (clientSecret) {
    return (
      <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "flat" } }}>
        <UpdateCardForm onCancel={() => setClientSecret(null)} />
      </Elements>
    );
  }

  return (
    <div>
      <button type="button" className="ps-link-btn" disabled={starting} onClick={begin}>
        {starting ? "Loading…" : "Update payment method"}
      </button>
      {error && <p className="ps-error">{error}</p>}
    </div>
  );
}

function UpdateCardForm({ onCancel }: { onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    setError(null);
    const { error, setupIntent } = await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (error) {
      setError(error.message ?? "Couldn't save the card.");
      setSaving(false);
      return;
    }
    const res = await finishUpdatePayment(setupIntent!.id);
    if (!res.ok) {
      setError(res.error);
      setSaving(false);
      return;
    }
    setDone(true);
    setTimeout(() => window.location.reload(), 1200);
  }

  if (done) return <p className="ps-ok">Card updated.</p>;

  return (
    <form className="ps-card-form" onSubmit={save}>
      <PaymentElement />
      <div className="ps-confirm-row">
        <button type="submit" className="ps-btn" disabled={!stripe || saving}>
          {saving ? "Saving…" : "Save card"}
        </button>
        <button type="button" className="ps-link-btn" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="ps-error">{error}</p>}
    </form>
  );
}
