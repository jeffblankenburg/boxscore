// Simulate a real weekly/monthly purchase in Stripe TEST mode (GitHub #111, Phase 1 test).
//
// Creates a test Customer with a test card and a Subscription carrying the
// SAME metadata (subscriber_id, sport) + Price the real checkout will use, so
// the resulting invoice.paid / subscription events flow through the live
// webhook (run `stripe listen --forward-to localhost:3000/api/stripe/webhook`
// in another terminal) and exercise the full money→access grant path — no
// front-end required.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/stripe-sim-purchase.ts <email> <week|month>
//
// Then verify the grant:
//   npx tsx --env-file=.env.local scripts/comp-predictions.ts list <email>

import { getStripe, stripeMode } from "@/lib/stripe";
import { stripePriceId } from "@/lib/predictions-pricing";
import { findByEmail } from "@/lib/subscribers";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const [email, sku] = process.argv.slice(2);
  if (!email || (sku !== "week" && sku !== "month")) fail("usage: <email> <week|month>");

  if (stripeMode() !== "test") fail("refusing to run against LIVE Stripe — this creates a real subscription");

  const sub = await findByEmail(email!);
  if (!sub) fail(`no subscriber for ${email}`);

  const stripe = getStripe();
  const priceId = stripePriceId(sku === "week" ? "predictions_week" : "predictions_month");

  // Fresh test customer with the linking metadata the webhook reads for identity.
  const customer = await stripe.customers.create({
    email: email!,
    metadata: { subscriber_id: sub!.id },
    description: "boxscore predictions sim purchase (test)",
  });

  // pm_card_visa is Stripe's shared test PaymentMethod — attaching it mints a
  // persistent PM with its own id, which we then set as the default.
  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceId }],
    default_payment_method: pm.id,
    // Identity metadata mirrors what checkout (Phase 2) will set — the webhook
    // reads subscriber_id/sport from here.
    metadata: { subscriber_id: sub!.id, sport: "mlb" },
  });

  console.log(`✓ created ${sku} subscription ${subscription.id} (status ${subscription.status})`);
  console.log(`  customer ${customer.id} (${email})`);
  console.log(`  price    ${priceId}`);
  console.log(`\nInvoice.paid + subscription events are firing now. If \`stripe listen\` is running,`);
  console.log(`the webhook should have granted access. Verify:`);
  console.log(`  npx tsx --env-file=.env.local scripts/comp-predictions.ts list ${email}`);
  console.log(`\nCancel (revoke) test:`);
  console.log(`  stripe subscriptions cancel ${subscription.id}`);
}

main().catch((e) => fail((e as Error).message));
