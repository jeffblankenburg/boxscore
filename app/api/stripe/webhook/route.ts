// Stripe webhook receiver — the money→access backbone for the paid
// /mlb/predictions tier (GitHub #111, Phase 1).
//
// Setup (local test): `stripe listen --forward-to localhost:3000/api/stripe/webhook`
// prints a whsec_… → set STRIPE_WEBHOOK_SECRET in .env.local. Drive events with
// scripts/stripe-sim-purchase.ts (a real test-mode purchase) or `stripe trigger`.
// Prod: add the endpoint in the Stripe dashboard and set the endpoint secret.
//
// Events handled (all writes go to predictions_entitlements via
// lib/predictions-stripe-sync):
//   checkout.session.completed      → grant (subscription window or season pass)
//   invoice.paid                    → grant/extend the window + email a receipt (renewals)
//   invoice.payment_failed          → email the customer to update their card
//   customer.subscription.deleted   → revoke access
//
// Idempotency: every event id is logged in webhook_events (source='stripe').
// A duplicate delivery short-circuits with 200 before any side effect. The
// record is written AFTER successful processing, so a handler crash returns
// 500 and Stripe's retry re-runs — safe because every writer is idempotent.

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { hasWebhookEvent, recordWebhookEvent } from "@/lib/webhooks";
import {
  grantFromCheckoutSession,
  syncFromInvoice,
  notifyPaymentFailed,
  revokeSubscription,
  type SyncResult,
} from "@/lib/predictions-stripe-sync";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET not set; refusing webhook.");
    return new NextResponse("Webhook secret not configured", { status: 500 });
  }

  // Raw body is required for signature verification — read it once.
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new NextResponse("Missing stripe-signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, secret);
  } catch (e) {
    console.warn(`Stripe webhook signature verification failed: ${(e as Error).message}`);
    return new NextResponse("Signature verification failed", { status: 401 });
  }

  // Idempotency up front — short-circuit retries before doing work.
  if (await hasWebhookEvent(event.id)) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  let result: SyncResult = { status: "skipped", reason: `unhandled ${event.type}` };
  try {
    switch (event.type) {
      case "checkout.session.completed":
        result = await grantFromCheckoutSession(event.data.object as Stripe.Checkout.Session);
        break;
      case "invoice.paid":
        result = await syncFromInvoice(event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_failed":
        result = await notifyPaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case "customer.subscription.deleted":
        result = await revokeSubscription(event.data.object as Stripe.Subscription);
        break;
    }
  } catch (e) {
    console.error(`Stripe webhook handler error for ${event.type} (${event.id}): ${(e as Error).message}`);
    // 500 → Stripe retries. Event isn't recorded yet, so the retry re-runs the
    // handler; every writer is idempotent, so re-running is safe.
    return new NextResponse("Handler error", { status: 500 });
  }

  if (result.status === "skipped") {
    console.log(`Stripe ${event.type} (${event.id}) skipped: ${result.reason}`);
  } else {
    console.log(`Stripe ${event.type} (${event.id}) → ${JSON.stringify(result)}`);
  }

  // Record AFTER successful processing so a failure actually replays on retry.
  try {
    await recordWebhookEvent({ id: event.id, eventType: event.type, source: "stripe", payload: event });
  } catch (e) {
    // Side effect already happened; we just couldn't write the audit row. Log
    // and ack — a Stripe retry re-runs idempotent writers with no harm.
    console.error(`recordWebhookEvent failed (event ${event.id}): ${(e as Error).message}`);
  }

  return NextResponse.json({ ok: true, ...result });
}
