// Companion to test-open-pixel.ts. Given the open_token printed by the
// send script, checks whether the pixel actually fired and writes a
// boxscore.opened row to email_events.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/verify-open-pixel.ts <open-token>

import { supabaseAdmin } from "../lib/supabase";

async function main(): Promise<void> {
  const token = process.argv[2];
  if (!token) {
    console.error("Usage: verify-open-pixel.ts <open-token>");
    process.exit(1);
  }

  const db = supabaseAdmin();

  // 1. Confirm the sends row exists and has resend_id.
  const { data: send, error: sendErr } = await db
    .from("sends")
    .select("id, subscriber_id, digest_sport, digest_date, resend_id, sent_at, error")
    .eq("open_token", token)
    .maybeSingle<{
      id: string;
      subscriber_id: string;
      digest_sport: string;
      digest_date: string;
      resend_id: string | null;
      sent_at: string;
      error: string | null;
    }>();
  if (sendErr) throw new Error(`send lookup: ${sendErr.message}`);
  if (!send) {
    console.error(`✗ No sends row with open_token=${token}.`);
    console.error(`  Was test-open-pixel.ts actually run with this token?`);
    process.exit(1);
  }

  console.log("Send row:");
  console.log(`  id:            ${send.id}`);
  console.log(`  subscriber_id: ${send.subscriber_id}`);
  console.log(`  digest:        ${send.digest_sport}/${send.digest_date}`);
  console.log(`  sent_at:       ${send.sent_at}`);
  console.log(`  resend_id:     ${send.resend_id ?? "(none — sends row exists but Resend never returned an id)"}`);
  if (send.error) console.log(`  error:         ${send.error}`);
  console.log();

  if (!send.resend_id) {
    console.error("Cannot look up open events without a resend_id.");
    process.exit(1);
  }

  // 2. Pull every event keyed on this resend_id, in order.
  const { data: events, error: evErr } = await db
    .from("email_events")
    .select("id, event_type, event_at, user_agent, ip, payload")
    .eq("resend_id", send.resend_id)
    .order("event_at", { ascending: true });
  if (evErr) throw new Error(`events lookup: ${evErr.message}`);

  if (!events || events.length === 0) {
    console.log("No email_events recorded yet.");
    console.log();
    console.log("Possible reasons:");
    console.log("  - Email hasn't been opened yet → open it on Gmail iPhone, wait a few seconds, re-run.");
    console.log("  - Pixel endpoint isn't deployed → check that /api/o/[token] exists on production.");
    console.log("  - Migration 0058 hasn't been applied → sends.open_token doesn't resolve → events skipped.");
    console.log("  - Gmail's image proxy hasn't fetched the pixel yet → typically fires within seconds of open;");
    console.log("    sometimes pre-fetches on delivery if Gmail puts the email in Primary.");
    return;
  }

  console.log(`Events for resend_id=${send.resend_id}:`);
  let boxscoreOpened = 0;
  let resendOpened = 0;
  for (const e of events as Array<{
    id: string; event_type: string; event_at: string; user_agent: string | null;
    ip: string | null; payload: unknown;
  }>) {
    const tag = e.event_type === "boxscore.opened" ? "← OURS"
              : e.event_type === "email.opened"    ? "← Resend"
              : "";
    console.log(`  ${e.event_at}  ${e.event_type.padEnd(20)} ${tag}`);
    if (e.user_agent) console.log(`    UA: ${e.user_agent.slice(0, 100)}`);
    if (e.ip) console.log(`    IP: ${e.ip}`);
    if (e.event_type === "boxscore.opened") boxscoreOpened++;
    if (e.event_type === "email.opened")    resendOpened++;
  }
  console.log();
  console.log(`Summary:`);
  console.log(`  boxscore.opened (ours):   ${boxscoreOpened}`);
  console.log(`  email.opened (Resend):    ${resendOpened}`);
  console.log();
  if (boxscoreOpened > 0) {
    console.log(`✓ Self-hosted pixel is working. Gmail clip is no longer killing open tracking.`);
  } else if (resendOpened > 0) {
    console.log(`⚠ Resend pixel fired but ours didn't.`);
    console.log(`  This is the original problem on a smaller scale. Check:`);
    console.log(`  - Is /api/o/[token] deployed?`);
    console.log(`  - Did sendmail actually inject the pixel? (script confirms above before sending)`);
    console.log(`  - Did Gmail strip the pixel for some reason (CSP, content filter)?`);
  } else {
    console.log(`⚠ Neither pixel fired. Email might not have been opened yet, or images blocked.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
