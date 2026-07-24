// Access model for the paid /mlb/predictions tier (GitHub #109).
//
// An entitlement is a dated window [accessStart, accessEnd] (inclusive, ET
// calendar dates) granted to a subscriber from either a Stripe purchase or
// an admin comp. The premium page and the picks-email gate answer one
// question — "does this subscriber hold an active entitlement covering date
// D" — and that check reads only this table, never Stripe, so access works
// even if Stripe is unreachable. Stripe webhooks (spec step 3) and the
// admin-comp tool are the only writers.
//
// I/O lives here; callers pass plain data. No Stripe SDK imports — this
// layer is deliberately Stripe-agnostic.

import { supabaseAdmin } from "./supabase";

export type PredictionsProduct = "week" | "month" | "season" | "playoffs";
export type EntitlementSource = "stripe" | "comp";

export type Entitlement = {
  id: string;
  subscriberId: string;
  sport: string;
  product: PredictionsProduct;
  accessStart: string; // ISO YYYY-MM-DD, inclusive
  accessEnd: string;   // ISO YYYY-MM-DD, inclusive
  source: EntitlementSource;
  stripeSubscriptionId: string | null;
  stripeCheckoutId: string | null;
  grantedBy: string | null;
  note: string | null;
  createdAt: string;
  revokedAt: string | null;
};

const COLS =
  "id, subscriber_id, sport, product, access_start, access_end, source, stripe_subscription_id, stripe_checkout_id, granted_by, note, created_at, revoked_at";

type Row = {
  id: string;
  subscriber_id: string;
  sport: string;
  product: PredictionsProduct;
  access_start: string;
  access_end: string;
  source: EntitlementSource;
  stripe_subscription_id: string | null;
  stripe_checkout_id: string | null;
  granted_by: string | null;
  note: string | null;
  created_at: string;
  revoked_at: string | null;
};

function toEntitlement(r: Row): Entitlement {
  return {
    id: r.id,
    subscriberId: r.subscriber_id,
    sport: r.sport,
    product: r.product,
    accessStart: r.access_start,
    accessEnd: r.access_end,
    source: r.source,
    stripeSubscriptionId: r.stripe_subscription_id,
    stripeCheckoutId: r.stripe_checkout_id,
    grantedBy: r.granted_by,
    note: r.note,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
  };
}

/**
 * True if the subscriber holds an active (non-revoked) entitlement for
 * `sport` whose window covers `date` (ET ISO YYYY-MM-DD). This is the single
 * access check the premium page and the picks-email gate call.
 */
export async function hasPredictionsAccess(subscriberId: string, sport: string, date: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("predictions_entitlements")
    .select("id")
    .eq("subscriber_id", subscriberId)
    .eq("sport", sport)
    .is("revoked_at", null)
    .lte("access_start", date)
    .gte("access_end", date)
    .limit(1);
  if (error) throw new Error(`hasPredictionsAccess: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * The set of subscriber_ids with active access to `sport` on `date`. Bulk
 * form of hasPredictionsAccess for the picks-email send cron, so it doesn't
 * do one round-trip per subscriber. Paginated past Supabase's 1000-row cap.
 */
export async function getEntitledSubscriberIds(sport: string, date: string): Promise<Set<string>> {
  const out = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin()
      .from("predictions_entitlements")
      .select("subscriber_id")
      .eq("sport", sport)
      .is("revoked_at", null)
      .lte("access_start", date)
      .gte("access_end", date)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`getEntitledSubscriberIds: ${error.message}`);
    const page = (data ?? []) as Array<{ subscriber_id: string }>;
    for (const r of page) out.add(r.subscriber_id);
    if (page.length < pageSize) break;
  }
  return out;
}

/**
 * All entitlements for a subscriber, newest first (includes revoked, for
 * admin display). Optionally scoped to one sport.
 */
export async function listEntitlements(subscriberId: string, sport?: string): Promise<Entitlement[]> {
  let q = supabaseAdmin()
    .from("predictions_entitlements")
    .select(COLS)
    .eq("subscriber_id", subscriberId);
  if (sport) q = q.eq("sport", sport);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error(`listEntitlements: ${error.message}`);
  return ((data ?? []) as Row[]).map(toEntitlement);
}

/**
 * Grant a free access window (admin comp). Defaults `sport` to 'mlb' (v1) and
 * `product` to 'season' since a comp is usually all-access; pass either to
 * scope it. `grantedBy` identifies who issued it (admin email or 'admin-cli').
 */
export async function grantComp(args: {
  subscriberId: string;
  accessStart: string;
  accessEnd: string;
  sport?: string;
  product?: PredictionsProduct;
  grantedBy: string;
  note?: string | null;
}): Promise<Entitlement> {
  const { data, error } = await supabaseAdmin()
    .from("predictions_entitlements")
    .insert({
      subscriber_id: args.subscriberId,
      sport: args.sport ?? "mlb",
      product: args.product ?? "season",
      access_start: args.accessStart,
      access_end: args.accessEnd,
      source: "comp",
      granted_by: args.grantedBy,
      note: args.note ?? null,
    })
    .select(COLS)
    .single<Row>();
  if (error) throw new Error(`grantComp: ${error.message}`);
  return toEntitlement(data);
}

/** Soft-revoke an entitlement (admin revoke, refund, or Stripe cancel). Idempotent. */
export async function revokeEntitlement(id: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("predictions_entitlements")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);
  if (error) throw new Error(`revokeEntitlement: ${error.message}`);
}
