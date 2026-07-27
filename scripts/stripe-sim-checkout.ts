// Exercise the Phase 2 checkout server path end-to-end in TEST mode (#111).
//
// Mirrors what the on-site Payment Element does, minus the browser: calls the
// real startSubscriptionCheckout() to create the default_incomplete
// subscription, then confirms its PaymentIntent with a test card. That drives
// invoice.paid → the Phase-1 webhook → an entitlement. Run `stripe listen`
// (on the Boxscore account) in another terminal first.
//
// Usage: npx tsx --env-file=.env.local scripts/stripe-sim-checkout.ts <email> <week|month>

import { getStripe, stripeMode } from "@/lib/stripe";
import { startSubscriptionCheckout } from "@/lib/predictions-checkout";
import { findByEmail } from "@/lib/subscribers";
import { supabaseAdmin } from "@/lib/supabase";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const [email, sku] = process.argv.slice(2);
  if (!email || (sku !== "week" && sku !== "month")) fail("usage: <email> <week|month>");
  if (stripeMode() !== "test") fail("refusing to run against LIVE Stripe");

  const sub = await findByEmail(email!);
  if (!sub) fail(`no subscriber for ${email}`);

  // Current stripe_customer_id (needs migration 0080).
  const { data: row, error } = await supabaseAdmin()
    .from("subscribers")
    .select("stripe_customer_id")
    .eq("id", sub!.id)
    .single<{ stripe_customer_id: string | null }>();
  if (error) fail(`read subscriber (is migration 0080 applied?): ${error.message}`);

  const start = await startSubscriptionCheckout({
    subscriberId: sub!.id,
    email: email!,
    existingCustomerId: row!.stripe_customer_id,
    sku: sku as "week" | "month",
  });
  console.log(`✓ checkout started: subscription ${start.subscriptionId}, customer ${start.customerId}`);

  // Confirm the PaymentIntent with a test card (browser Payment Element's job).
  const piId = start.clientSecret.split("_secret")[0]!;
  const pi = await getStripe().paymentIntents.confirm(piId, {
    payment_method: "pm_card_visa",
    return_url: "https://boxscore.email/mlb/predictions/subscribe/success",
  });
  console.log(`✓ payment confirmed: ${pi.status}`);

  console.log(`\ninvoice.paid should now grant access via the webhook. Verify:`);
  console.log(`  npx tsx --env-file=.env.local scripts/comp-predictions.ts list ${email}`);
  console.log(`Cancel/cleanup:  stripe subscriptions cancel ${start.subscriptionId} --api-key <dev key>`);
}

main().catch((e) => fail((e as Error).message));
