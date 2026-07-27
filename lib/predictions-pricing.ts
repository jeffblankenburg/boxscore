// Pricing config for the paid /mlb/predictions tier (GitHub #109, build plan #111).
//
// Single source of truth for what the tiers cost, which Stripe Price a given
// purchase maps to, and what's sellable on a given date. Pure data + pure
// functions — no I/O, no Stripe SDK. The create script (scripts/stripe-create-prices.ts)
// reads the SKU shapes here to provision Stripe objects and writes the
// resulting Price IDs into stripe-prices.generated.json, which stripePriceId()
// reads back at runtime.
//
// Pricing/refund invariants live in #109 and are NOT re-derived here:
//  - Ladder is monotonic: season $0.87/day < month $1.13/day < week $1.43/day,
//    and 4 weeks ($40) > 1 month ($35). More commitment = cheaper per day.
//  - Rolling flat prices, no signup proration.
//  - All subs carry cancel_at = SEASON_END so nothing bills past the season.
//
// SEASON-SPECIFIC: the dates below are the 2026 season. They must be updated
// each March (see #109). 2026 note: the All-Star break already passed
// (2026-07-14), so the season SKU is NOT sellable this year — it's provisioned
// but dormant until March 2027. Launch is weekly + monthly only.

import pricesJson from "./stripe-prices.generated.json";
import { stripeMode, type StripeMode } from "./stripe";
import { daysBetweenISO } from "./dates";

export type PricingSku = "week" | "month" | "season";

// ── Season calendar (2026) ────────────────────────────────────────────────
export const SEASON_END = "2026-09-27"; // last day of covered access; also the cancel_at renewal guard
export const ALL_STAR_BREAK = "2026-07-14"; // season sales close here (#109)

// Global renewal guard (#109): every subscription carries cancel_at = this
// instant so nothing bills into October with no baseball. It's the moment
// after the last covered ET day — 2026-09-28 00:00 ET (EDT, UTC−4). Unix
// seconds, for the Stripe `cancel_at` field. Season-specific; bump each March.
export const SEASON_END_CANCEL_AT = Math.floor(Date.parse("2026-09-28T04:00:00Z") / 1000);

// Launch flag (#111 Phase 6). Phase 2 builds the full checkout, but the mode
// resolver uses LIVE keys in production — so until launch we refuse live-mode
// checkout to guarantee no real charge can happen before the paywall flip.
// Test mode always works (local testing). Flip to true at Phase 6 launch.
export const CHECKOUT_LIVE_ENABLED = false;

// Sales-window cutoffs — last date each SKU may be SOLD so its full period
// still fits inside the season (#109). No refund/proration owed on the tail.
export const SALES_CUTOFF: Record<PricingSku, string> = {
  season: ALL_STAR_BREAK, // 2026-07-14
  month: "2026-08-27", // 31 days before SEASON_END
  week: "2026-09-20", //  7 days before SEASON_END
};

// Season opens for sale on Opening Day; before that it's offseason (no sales).
export const SEASON_SALES_OPEN = "2026-03-25";

// ── Statement descriptor ──────────────────────────────────────────────────
export const STATEMENT_DESCRIPTOR = "BOXSCORE"; // what buyers see on their card statement

// Term length (days) of the rolling recurring tiers — the entitlement window
// is [charge date, charge date + termDays - 1] (#109: "N days, today counts as
// used"). Season isn't here: it's one-time and runs to SEASON_END, not a term.
export const TERM_DAYS: Record<"week" | "month", number> = {
  week: 7,
  month: 31, // 31-day rolling, matches the Stripe interval_count
};

// ── Tier daily rates (cents) ──────────────────────────────────────────────
// Reference rates the flat prices were derived from (#109). Refunds use
// (unused ÷ total × price actually paid), not these — kept here as the
// documented anchor for the monotonic ladder.
export const TIER_DAILY_RATE_CENTS: Record<PricingSku, number> = {
  week: 143, // $10 / 7
  month: 113, // $35 / 31
  season: 87, // $162 / 186
};

// ── SKU definitions (drive Stripe Product/Price creation) ─────────────────
// lookup_key values are stable and unique per Stripe mode; the create script
// is idempotent on them.

export type RecurringSku = {
  kind: "recurring";
  sku: Extract<PricingSku, "week" | "month">;
  lookupKey: string;
  productName: string;
  amountCents: number;
  // Stripe recurring config. Month is 31 ROLLING days (interval=day,
  // interval_count=31), NOT a calendar month — no proration to game (#109).
  interval: "week" | "day";
  intervalCount: number;
};

export type SeasonStep = {
  lookupKey: string;
  amountCents: number;
  daysLeft: number; // days of access to SEASON_END, for the marketing anchor
  // Purchase-date window (ET ISO, inclusive) that maps to this step.
  from: string;
  to: string;
};

export const RECURRING_SKUS: RecurringSku[] = [
  {
    kind: "recurring",
    sku: "week",
    lookupKey: "predictions_week",
    productName: "boxscore MLB Predictions — Weekly",
    amountCents: 1000, // $10
    interval: "week",
    intervalCount: 1,
  },
  {
    kind: "recurring",
    sku: "month",
    lookupKey: "predictions_month",
    productName: "boxscore MLB Predictions — Monthly",
    amountCents: 3500, // $35
    interval: "day",
    intervalCount: 31, // 31-day rolling, not calendar month
  },
];

// Season one-time steps, held flat within a month, re-cut on the 1st (#109).
// No decay Mar–Apr (first drop is May 1). $162 = "$1 per game" (162-game season).
export const SEASON_PRODUCT_NAME = "boxscore MLB Predictions — Season";
export const SEASON_STEPS: SeasonStep[] = [
  { lookupKey: "predictions_season_162", amountCents: 16200, daysLeft: 186, from: SEASON_SALES_OPEN, to: "2026-04-30" },
  { lookupKey: "predictions_season_130", amountCents: 13000, daysLeft: 149, from: "2026-05-01", to: "2026-05-31" },
  { lookupKey: "predictions_season_103", amountCents: 10300, daysLeft: 118, from: "2026-06-01", to: "2026-06-30" },
  { lookupKey: "predictions_season_77", amountCents: 7700, daysLeft: 88, from: "2026-07-01", to: ALL_STAR_BREAK },
];

// ── Pure query functions ──────────────────────────────────────────────────

/** True if `sku` may be sold on ET date `dateIso` (both season-open and the tail cutoff). */
export function isSellable(sku: PricingSku, dateIso: string): boolean {
  if (sku === "season") {
    return dateIso >= SEASON_SALES_OPEN && dateIso <= SALES_CUTOFF.season;
  }
  // Weekly/monthly have no explicit open; they're sellable through their tail cutoff.
  return dateIso <= SALES_CUTOFF[sku];
}

/** The SKUs buyable on `dateIso`, in ladder order. 2026 in-season → ["week","month"]. */
export function sellableSkus(dateIso: string): PricingSku[] {
  return (["week", "month", "season"] as PricingSku[]).filter((s) => isSellable(s, dateIso));
}

/** The season step for a purchase on `dateIso`, or null if season isn't sellable then. */
export function seasonStepForDate(dateIso: string): SeasonStep | null {
  if (!isSellable("season", dateIso)) return null;
  return SEASON_STEPS.find((s) => dateIso >= s.from && dateIso <= s.to) ?? null;
}

// Prorated cancellation refund (#109). Refund the unused days of the CURRENT
// paid period and keep the used days; **today counts as used** (their picks
// already worked today), so the refund covers tomorrow onward. Because the
// refund never exceeds the tier's daily rate, fragmenting a sub can't be gamed
// for profit. Returns whole cents. `todayISO`/`periodStartISO`/`periodEndISO`
// are ET calendar dates; `pricePaidCents` is what they actually paid this period.
export function proratedRefundCents(args: {
  pricePaidCents: number;
  periodStartISO: string;
  periodEndISO: string;
  todayISO: string;
}): number {
  const totalDays = daysBetweenISO(args.periodStartISO, args.periodEndISO) + 1; // inclusive
  if (totalDays <= 0) return 0;
  const usedDays = Math.min(totalDays, Math.max(1, daysBetweenISO(args.periodStartISO, args.todayISO) + 1));
  const unusedDays = Math.max(0, totalDays - usedDays);
  return Math.round((unusedDays / totalDays) * args.pricePaidCents);
}

// ── Stripe Price ID resolution ────────────────────────────────────────────
type PriceMap = Partial<Record<string, string>>;
const PRICES = pricesJson as Record<StripeMode, PriceMap>;

/** Resolve a lookup_key to its Stripe Price ID for the active mode. Throws if unprovisioned. */
export function stripePriceId(lookupKey: string): string {
  const mode = stripeMode();
  const id = PRICES[mode]?.[lookupKey];
  if (!id) {
    throw new Error(
      `No Stripe Price for "${lookupKey}" in ${mode} mode. Run: npx tsx --env-file=.env.local scripts/stripe-create-prices.ts`,
    );
  }
  return id;
}

/** Every lookup_key this app provisions, in a stable order (used by the create script + checks). */
export function allLookupKeys(): string[] {
  return [...RECURRING_SKUS.map((s) => s.lookupKey), ...SEASON_STEPS.map((s) => s.lookupKey)];
}

/** Reverse of stripePriceId: the lookup_key for a Stripe Price ID in the active mode, or null. */
export function lookupKeyForPriceId(priceId: string): string | null {
  const map = PRICES[stripeMode()] ?? {};
  for (const [key, id] of Object.entries(map)) {
    if (id === priceId) return key;
  }
  return null;
}

/** The PricingSku a lookup_key belongs to (all four season steps → "season"), or null if unknown. */
export function productForLookupKey(lookupKey: string): PricingSku | null {
  if (lookupKey === "predictions_week") return "week";
  if (lookupKey === "predictions_month") return "month";
  if (lookupKey.startsWith("predictions_season")) return "season";
  return null;
}
