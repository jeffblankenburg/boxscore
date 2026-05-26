// One-time backfill for issue #37.
//
// Before the soft-bounce-suppression fix landed, recipients hitting Apple's
// CS01 (Transient / ContentRejected) reputation reject would bounce every day
// without ever being unsubscribed. This script finds every recipient with N+
// ContentRejected bounces in the last WINDOW_DAYS and unsubscribes them with
// reason='bounce'. After this runs once, the webhook handler keeps the list
// clean going forward.
//
// Usage: npx tsx scripts/backfill-content-rejected-suppressions.ts
//        (add --dry to preview without writing)

import { supabaseAdmin } from "../lib/supabase";
import { unsubscribeByEmail } from "../lib/subscribers";

const SUBTYPE = "ContentRejected";
const WINDOW_DAYS = 30;
const MIN_BOUNCES = 2;
const DRY_RUN = process.argv.includes("--dry");

async function main() {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const db = supabaseAdmin();

  // Pull every ContentRejected bounce in the window. Volume is small (a few
  // hundred rows over 30 days), so a paginated scan + JS aggregation is fine.
  const counts = new Map<string, number>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await db
      .from("email_events")
      .select("payload")
      .eq("event_type", "email.bounced")
      .gte("event_at", since)
      .eq("payload->bounce->>subType", SUBTYPE)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`scan: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const payload = row.payload as { to?: string[] | string } | null;
      if (!payload) continue;
      const to = Array.isArray(payload.to) ? payload.to[0] : payload.to;
      if (!to) continue;
      const email = to.trim().toLowerCase();
      counts.set(email, (counts.get(email) ?? 0) + 1);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const candidates = [...counts.entries()]
    .filter(([, n]) => n >= MIN_BOUNCES)
    .sort((a, b) => b[1] - a[1]);

  console.log(`Scanned ${WINDOW_DAYS}d, ${counts.size} distinct recipients with ${SUBTYPE} bounces.`);
  console.log(`${candidates.length} recipients hit ${MIN_BOUNCES}+ bounces.\n`);

  let unsubscribed = 0;
  let skipped = 0;
  for (const [email, n] of candidates) {
    if (DRY_RUN) {
      console.log(`[dry] would unsubscribe ${email} (${n} bounces)`);
      continue;
    }
    const sub = await unsubscribeByEmail(email, "bounce");
    if (sub) {
      unsubscribed++;
      console.log(`unsubscribed ${email} (${n} bounces)`);
    } else {
      skipped++;
    }
  }

  console.log(`\nDone. unsubscribed=${unsubscribed} already_off=${skipped}${DRY_RUN ? " (dry run)" : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
