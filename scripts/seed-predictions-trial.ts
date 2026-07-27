// Snapshot the CURRENT subscriber base as free-trial eligible (Jeff's cutoff:
// "anyone subscribed right now"). Run ONCE at launch. Idempotent — only flags
// subscribers not already flagged, so re-running never re-opens the offer to
// people who've since signed up... it just no-ops on already-flagged rows.
//
//   npx tsx --env-file=.env.local scripts/seed-predictions-trial.ts [--commit]

import { supabaseAdmin } from "@/lib/supabase";

async function main() {
  const commit = process.argv.includes("--commit");
  const db = supabaseAdmin();

  const { count, error: cErr } = await db
    .from("subscribers")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .is("predictions_trial_eligible_at", null);
  if (cErr) throw new Error(`count: ${cErr.message}`);

  console.log(`${count ?? 0} active subscriber(s) not yet flagged trial-eligible.`);
  if (!commit) {
    console.log("Dry run. Re-run with --commit to flag them.");
    return;
  }

  const { error } = await db
    .from("subscribers")
    .update({ predictions_trial_eligible_at: new Date().toISOString() })
    .eq("status", "active")
    .is("predictions_trial_eligible_at", null);
  if (error) throw new Error(`update: ${error.message}`);
  console.log(`✓ flagged ${count ?? 0} subscriber(s) as trial-eligible.`);
}

main().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exit(1); });
