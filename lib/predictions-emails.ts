// Transactional email senders for the paid predictions tier (GitHub #111, Phase 3).
//
// Fired best-effort from the Stripe webhook after the entitlement write. These
// are CAN-SPAM transactional — sendEmail() goes straight to the subscriber's
// address with no newsletter-unsubscribe check (that gate is a digest concern).
// Callers wrap these in try/catch so a mail hiccup never fails the webhook /
// triggers a Stripe retry (which would double-send).

import { sendEmail } from "./email";
import { supabaseAdmin } from "./supabase";
import { EMAIL_LINK_BASE } from "./site";
import { prettyDate } from "./dates";
import { RECURRING_SKUS } from "./predictions-pricing";
import type { PredictionsProduct } from "./predictions-entitlements";
import {
  predictionsPurchaseEmail,
  predictionsRenewalEmail,
  predictionsPaymentFailedEmail,
  predictionsCancellationEmail,
} from "./emails/templates";

// Manage / update-card / cancel all live in /settings (invisible Stripe).
const MANAGE_URL = `${EMAIL_LINK_BASE}/settings`;

function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function planMeta(product: PredictionsProduct): { label: string; priceLabel: string; recurring: boolean } {
  const r = RECURRING_SKUS.find((s) => s.sku === product);
  if (r) return { label: r.sku === "week" ? "Weekly" : "Monthly", priceLabel: money(r.amountCents), recurring: true };
  return { label: product === "season" ? "Season" : "Playoffs", priceLabel: "", recurring: false };
}

async function subscriberEmail(subscriberId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("subscribers")
    .select("email")
    .eq("id", subscriberId)
    .maybeSingle<{ email: string }>();
  if (error) throw new Error(`subscriberEmail: ${error.message}`);
  return data?.email ?? null;
}

/** Purchase confirmation — first successful payment. */
export async function sendPredictionsPurchaseEmail(args: {
  subscriberId: string;
  product: PredictionsProduct;
  accessEnd: string;
}): Promise<void> {
  const to = await subscriberEmail(args.subscriberId);
  if (!to) return;
  const m = planMeta(args.product);
  const { subject, html, text } = predictionsPurchaseEmail({
    planLabel: m.label,
    priceLabel: m.priceLabel,
    accessEndPretty: prettyDate(args.accessEnd),
    recurring: m.recurring,
    manageUrl: MANAGE_URL,
  });
  await sendEmail({ to, subject, html, text });
}

/** Renewal receipt — a recurring charge went through. */
export async function sendPredictionsRenewalEmail(args: {
  subscriberId: string;
  product: PredictionsProduct;
  accessEnd: string;
}): Promise<void> {
  const to = await subscriberEmail(args.subscriberId);
  if (!to) return;
  const m = planMeta(args.product);
  const { subject, html, text } = predictionsRenewalEmail({
    planLabel: m.label,
    priceLabel: m.priceLabel,
    accessEndPretty: prettyDate(args.accessEnd),
    manageUrl: MANAGE_URL,
  });
  await sendEmail({ to, subject, html, text });
}

/** Cancellation + refund receipt. `refundCents` of 0 renders the "no refund due" copy. */
export async function sendPredictionsCancellationEmail(args: {
  subscriberId: string;
  product: PredictionsProduct;
  accessEnd: string;
  refundCents: number;
}): Promise<void> {
  const to = await subscriberEmail(args.subscriberId);
  if (!to) return;
  const { subject, html, text } = predictionsCancellationEmail({
    accessEndPretty: prettyDate(args.accessEnd),
    refundLabel: args.refundCents > 0 ? money(args.refundCents) : null,
    resubscribeUrl: `${EMAIL_LINK_BASE}/mlb/predictions/subscribe`,
  });
  await sendEmail({ to, subject, html, text });
}

/** Payment failed — a renewal charge was declined; access holds during Smart Retries. */
export async function sendPredictionsPaymentFailedEmail(args: {
  subscriberId: string;
  accessEnd: string;
}): Promise<void> {
  const to = await subscriberEmail(args.subscriberId);
  if (!to) return;
  const { subject, html, text } = predictionsPaymentFailedEmail({
    accessEndPretty: prettyDate(args.accessEnd),
    updateUrl: MANAGE_URL,
  });
  await sendEmail({ to, subject, html, text });
}
