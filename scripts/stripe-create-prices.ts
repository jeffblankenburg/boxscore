// Provision Stripe Products + Prices for the paid predictions tier (GitHub #111, Phase 0).
//
// Idempotent: reuses Products (matched by metadata.boxscore_key) and Prices
// (matched by lookup_key), creating only what's missing. Safe to re-run. On
// success it writes the resulting Price IDs into lib/stripe-prices.generated.json
// under the active Stripe mode, which lib/predictions-pricing.ts reads back.
//
// Runs against the TEST account by default (see lib/stripe.ts mode resolution).
// Refuses live unless CONFIRM_LIVE=1 is set — a guard against provisioning real
// chargeable objects before the Phase 6 launch flip.
//
// Usage: npx tsx --env-file=.env.local scripts/stripe-create-prices.ts

import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Stripe from "stripe";
import { getStripe, stripeMode } from "@/lib/stripe";
import {
  RECURRING_SKUS,
  SEASON_STEPS,
  SEASON_PRODUCT_NAME,
} from "@/lib/predictions-pricing";

const GENERATED_JSON = join(process.cwd(), "lib", "stripe-prices.generated.json");

type ProductSpec = { key: string; name: string };

// One Product per recurring tier; one shared Product for all season steps.
const PRODUCTS: ProductSpec[] = [
  ...RECURRING_SKUS.map((s) => ({ key: s.lookupKey, name: s.productName })),
  { key: "predictions_season", name: SEASON_PRODUCT_NAME },
];

async function ensureProduct(stripe: Stripe, spec: ProductSpec): Promise<string> {
  // List + filter by metadata (strongly consistent, unlike the Search API's index lag).
  for await (const p of stripe.products.list({ active: true, limit: 100 })) {
    if (p.metadata?.boxscore_key === spec.key) return p.id;
  }
  const created = await stripe.products.create({
    name: spec.name,
    metadata: { boxscore_key: spec.key },
  });
  console.log(`  + product ${spec.key} → ${created.id}`);
  return created.id;
}

async function ensurePrice(
  stripe: Stripe,
  args: { lookupKey: string; productId: string; amountCents: number; recurring?: Stripe.PriceCreateParams.Recurring },
): Promise<{ id: string; reused: boolean }> {
  const existing = await stripe.prices.list({ lookup_keys: [args.lookupKey], active: true, limit: 1 });
  const hit = existing.data[0];
  if (hit) {
    if (hit.unit_amount !== args.amountCents) {
      // Prices are immutable — an amount change means a new Price. Surface loudly.
      throw new Error(
        `Price ${args.lookupKey} exists at ${hit.unit_amount}¢ but config wants ${args.amountCents}¢. ` +
          `Bump the lookup_key (or archive the old Price) to change amounts.`,
      );
    }
    return { id: hit.id, reused: true };
  }
  const created = await stripe.prices.create({
    product: args.productId,
    currency: "usd",
    unit_amount: args.amountCents,
    lookup_key: args.lookupKey,
    ...(args.recurring ? { recurring: args.recurring } : {}),
  });
  console.log(`  + price ${args.lookupKey} → ${created.id} (${args.amountCents}¢)`);
  return { id: created.id, reused: false };
}

async function main() {
  const mode = stripeMode();
  if (mode === "live" && process.env.CONFIRM_LIVE !== "1") {
    console.error("✗ Refusing to provision LIVE Stripe objects. Set CONFIRM_LIVE=1 to override.");
    process.exit(1);
  }
  console.log(`Provisioning Stripe Products/Prices in ${mode.toUpperCase()} mode…`);
  const stripe = getStripe();

  // Products first (need their IDs for prices).
  const productIds = new Map<string, string>();
  for (const spec of PRODUCTS) {
    productIds.set(spec.key, await ensureProduct(stripe, spec));
  }

  const priceMap: Record<string, string> = {};

  for (const s of RECURRING_SKUS) {
    const { id, reused } = await ensurePrice(stripe, {
      lookupKey: s.lookupKey,
      productId: productIds.get(s.lookupKey)!,
      amountCents: s.amountCents,
      recurring: { interval: s.interval, interval_count: s.intervalCount },
    });
    priceMap[s.lookupKey] = id;
    if (reused) console.log(`  = price ${s.lookupKey} → ${id} (reused)`);
  }

  const seasonProductId = productIds.get("predictions_season")!;
  for (const step of SEASON_STEPS) {
    const { id, reused } = await ensurePrice(stripe, {
      lookupKey: step.lookupKey,
      productId: seasonProductId,
      amountCents: step.amountCents,
      // one-time: no recurring block
    });
    priceMap[step.lookupKey] = id;
    if (reused) console.log(`  = price ${step.lookupKey} → ${id} (reused)`);
  }

  // Merge into the generated JSON without clobbering the other mode.
  const current = JSON.parse(readFileSync(GENERATED_JSON, "utf8")) as Record<string, Record<string, string>>;
  current[mode] = priceMap;
  writeFileSync(GENERATED_JSON, JSON.stringify(current, null, 2) + "\n");

  console.log(`\n✓ ${Object.keys(priceMap).length} prices provisioned in ${mode} mode → lib/stripe-prices.generated.json`);
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
