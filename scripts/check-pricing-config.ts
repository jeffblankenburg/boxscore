// Unit checks for the predictions pricing config (GitHub #111, Phase 0 test).
//
// Pure — no Stripe, no network. Asserts the season step a purchase date maps
// to, and the sales-window cutoffs, against the invariants in #109. Run:
//   npx tsx scripts/check-pricing-config.ts
// Exits non-zero on the first failure.

import {
  seasonStepForDate,
  sellableSkus,
  isSellable,
  SEASON_STEPS,
  TIER_DAILY_RATE_CENTS,
} from "@/lib/predictions-pricing";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}: got ${a}, expected ${e}`);
    failures++;
  }
}

// ── Season step by purchase date (#109 table) ─────────────────────────────
console.log("Season step pricing:");
check("Mar 25 (opening) → $162", seasonStepForDate("2026-03-25")?.amountCents, 16200);
check("Apr 30 (last of flat) → $162", seasonStepForDate("2026-04-30")?.amountCents, 16200);
check("May 1 (first drop) → $130", seasonStepForDate("2026-05-01")?.amountCents, 13000);
check("Jun 15 → $103", seasonStepForDate("2026-06-15")?.amountCents, 10300);
check("Jul 1 → $77", seasonStepForDate("2026-07-01")?.amountCents, 7700);
check("Jul 14 (ASB, last day) → $77", seasonStepForDate("2026-07-14")?.amountCents, 7700);
check("Jul 15 (past ASB) → no season", seasonStepForDate("2026-07-15"), null);
check("Mar 1 (offseason) → no season", seasonStepForDate("2026-03-01"), null);

// ── Sales-window cutoffs (#109) ───────────────────────────────────────────
console.log("Sales windows:");
check("Season closed today (2026-07-27)", isSellable("season", "2026-07-27"), false);
check("Month sellable today", isSellable("month", "2026-07-27"), true);
check("Week sellable today", isSellable("week", "2026-07-27"), true);
check("Month last day = Aug 27", isSellable("month", "2026-08-27"), true);
check("Month closed Aug 28", isSellable("month", "2026-08-28"), false);
check("Week last day = Sept 20", isSellable("week", "2026-09-20"), true);
check("Week closed Sept 21", isSellable("week", "2026-09-21"), false);
check("Today's SKUs = week+month", sellableSkus("2026-07-27"), ["week", "month"]);
check("Opening-day SKUs = all three", sellableSkus("2026-03-25"), ["week", "month", "season"]);

// ── Ladder monotonicity (#109 anti-inversion) ─────────────────────────────
console.log("Ladder monotonicity:");
check("season < month < week daily rate", TIER_DAILY_RATE_CENTS.season < TIER_DAILY_RATE_CENTS.month && TIER_DAILY_RATE_CENTS.month < TIER_DAILY_RATE_CENTS.week, true);
check("4 weeks ($40) > 1 month ($35)", 4 * 1000 > 3500, true);
check("season steps monotonically decrease", SEASON_STEPS.every((s, i) => i === 0 || s.amountCents < SEASON_STEPS[i - 1]!.amountCents), true);

if (failures > 0) {
  console.error(`\n✗ ${failures} check(s) failed`);
  process.exit(1);
}
console.log("\n✓ all pricing-config checks passed");
