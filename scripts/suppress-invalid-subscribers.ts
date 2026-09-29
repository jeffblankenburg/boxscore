// One-off: suppress subscriber rows with undeliverable email addresses.
// Diagnosed 2026-09-29: Resend's batch endpoint 422s the ENTIRE 100-email
// batch when one address is syntactically malformed, so ~99 valid subscribers
// per poisoned batch silently got no digest (3k+ unique recipients over
// 2026-09-22..28). Durable fixes: the per-email fallback in lib/email.ts and
// stricter entry validation in lib/email-validate.ts. This clears the dead
// addresses already on the list so they stop re-poisoning batches.
//
// Soft-delete, NOT hard-delete: the DB denies the service role DELETE on
// subscribers (and on audit/billing tables like sends, predictions_entitlements)
// by design — an immutability posture that keeps send/churn/billing history
// honest. The intended removal mechanism is status='unsubscribed'. That already
// prevents these from ever sending, AND from being swept live by the
// reactivate-never-verified job, which only touches status='pending'
// (see scripts/activate-pending-subscribers.ts).
//
// Reason 'bounce' (not 'user'): undeliverable/involuntary, which is how
// churn.ts already classifies bounce/complaint — keeps them out of voluntary-
// churn stats. No one here chose to leave.
//
// Explicit ID list, not a regex: double-dot domains (foo..com) slip past naive
// `local@domain.tld` patterns, and .co is a real TLD, so six plausibly-real
// custom .co domains (amperon.co, thelogic.co, 257.co, moodyboy.co, rinhuff.co,
// desertocean.co) are deliberately NOT included.
//
// Idempotent: re-running finds them already unsubscribed and no-ops.
//
// Run: npx tsx --env-file=.env.local scripts/suppress-invalid-subscribers.ts

import { supabaseAdmin } from "../lib/supabase";

// Syntactically malformed → Resend 422s the whole batch they land in.
const POISON = [
  "3090afcb-d047-417c-9392-e9f49e4636e6", // bolliff@armadaanalytics..com
  "bfcdb79e-b944-4546-9f7a-89c5e540e846", // misitia@northshoreschools..org
  "1e55a9dc-67d8-4180-8eca-a48035aee2c4", // rcolbrook@gmail.,
  "84ae41e1-6c21-4f95-a174-242bfaccf587", // rlc.childs@gmail.,
  "832a55c5-93d0-4a50-9876-b7f4529bd306", // thetallhall101@gmail.com'
  "179f98cd-7f52-4391-bb73-221d8425b5d3", // testing@example.com
];

// Syntactically valid but undeliverable: freemail providers don't run these
// TLDs (.con/.cim/.co are typos of .com).
const FREEMAIL_TYPOS = [
  "a6f5b5af-1149-4eca-8448-6ae62bc4fe75", "e80bb945-ba23-4195-80fe-7279c8740b4e",
  "2f3ac5fc-c427-4fba-90d9-053b90398dc8", "24b48337-98b0-45f5-ad17-ecd5e8c5adae",
  "6ea29b48-9964-438c-9a4d-03dbb13d0e7e", "f0bd0839-5bfd-426a-ab3d-4d2e5c8e04fc",
  "f913d870-40c5-4c05-947c-9b45f08ef3e9", "509dcfef-3ddf-4c53-ae61-2e7e01f739bf",
  "6036550f-f9db-4306-a7d8-3976f793fc66", "43ac34dd-efc1-4ed8-a795-e1624a6a9607",
  "e9c1b9ed-2f5b-4283-bb8b-4dda65e1b26d", "e83c57f4-b3de-4540-87d7-929425298772",
  "3afd611d-b840-4771-b660-da1bb2a8d18d", "f0501826-5861-44da-9756-b8400852bc4d",
  "c4c59301-a662-4652-9468-47743730c62d", "9f6bd9cb-91a2-41ca-968d-d0c9ab368602",
  "3dc8bbc8-c842-465b-86f5-9bfd3ee168e2", "f1d460f9-6cbb-4ff3-9fab-462760452ad3",
  "a81780a2-4728-4963-9786-2473ca409811", "9a2dc401-495b-4247-8780-4f9b6203d536",
  "41ca8a21-332a-4951-8acc-16fafce73704", "57dca36e-7541-484b-9fef-6258eae95c03",
  "2a157b36-7c3b-44b1-af94-63b4e4052375",
  "725d2d7e-7a49-4457-ad93-4d10f29badf7", "01f9eeb0-991e-4b92-a55c-1a9cd11461f1",
  "483e4a0c-e46b-4b72-80e7-3fcaaaab4327", "834ed2d3-2de9-473c-8bd8-01a16ebc81a6",
  "474ea870-1c30-472d-bc17-fa52ce7b15fd", "19f5f5e9-b038-4c7d-92e5-3d969ff15032",
  "5f22dcd4-fac0-4e5a-abda-1b2fb557ca47", "2f5a3497-22d0-4585-842b-23c9f8ce3b0e",
  "b536312d-7ab1-4cb2-81d2-b6fda6bc72c1",
];

// Ephemeral / opt-in tables keyed on subscriber_id that we also clear (best-
// effort — several deny DELETE by design; that's fine, we log and move on).
const CHILD_TABLES = ["email_subscriptions", "magic_tokens", "sessions"];

async function main() {
  const db = supabaseAdmin();
  const ids = [...POISON, ...FREEMAIL_TYPOS];

  console.log("--- suppress-invalid-subscribers ---");

  const { data, error } = await db
    .from("subscribers")
    .update({
      status: "unsubscribed",
      unsubscribed_at: new Date().toISOString(),
      unsubscribe_reason: "bounce",
    })
    .in("id", ids)
    .eq("status", "active") // idempotent: skip rows already suppressed
    .select("email");
  if (error) throw new Error(`suppress: ${error.message}`);
  console.log(`suppressed: ${data?.length ?? 0} (of ${ids.length} targeted; rest already done)`);
  for (const r of data ?? []) console.log(`  - ${r.email}`);

  for (const table of CHILD_TABLES) {
    const { data: d, error: e } = await db.from(table).delete().in("subscriber_id", ids).select("subscriber_id");
    if (e) { console.log(`${table}: skipped (${e.message})`); continue; }
    console.log(`${table}: ${d?.length ?? 0} rows cleared`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
