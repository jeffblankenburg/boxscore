// End-to-end test of the self-hosted open-tracking pixel. Sends a real
// digest email through Resend, with the full open_token plumbing, to a
// specified address. The recipient opening the email should produce a
// `boxscore.opened` row in email_events keyed on the sends row's
// resend_id.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/test-open-pixel.ts <to-email> [sport] [date]
//
// Examples:
//   npx tsx --env-file=.env.local scripts/test-open-pixel.ts me@gmail.com
//   npx tsx --env-file=.env.local scripts/test-open-pixel.ts me@gmail.com mlb
//   npx tsx --env-file=.env.local scripts/test-open-pixel.ts me@gmail.com mlb 2026-06-22
//
// IMPORTANT: requires migration 0058 to be applied AND the new pixel route
// (app/api/o/[token]) to be DEPLOYED to production. The pixel URL embedded
// in the email points at EMAIL_LINK_BASE — Gmail's image proxy fetches it
// from there, not from your localhost.

import { supabaseAdmin } from "../lib/supabase";
import { sendEmail } from "../lib/email";
import { dailyEmail } from "../lib/emails/templates";
import { recordSend } from "../lib/sends";
import { getDigest } from "../lib/digests";
import { EMAIL_LINK_BASE } from "../lib/site";
import { BRAND } from "../lib/brand";
import { prettyDate, nextDay, yesterdayInET } from "../lib/dates";

async function main(): Promise<void> {
  const to = process.argv[2];
  const sport = process.argv[3] ?? "mlb";
  const date = process.argv[4] ?? yesterdayInET();

  if (!to) {
    console.error("Usage: test-open-pixel.ts <to-email> [sport=mlb] [date=yesterday]");
    process.exit(1);
  }

  console.log(`Target:   ${to}`);
  console.log(`Sport:    ${sport}`);
  console.log(`Date:     ${date}`);
  console.log();

  const db = supabaseAdmin();

  // The sends table requires subscriber_id (FK + NOT NULL). The pixel
  // endpoint resolves open_token → sends row → resend_id, so we need a
  // real sends row to test against. Use the active subscriber matching
  // this email.
  const { data: sub, error: subErr } = await db
    .from("subscribers")
    .select("id, email, status")
    .eq("email", to.toLowerCase().trim())
    .maybeSingle<{ id: string; email: string; status: string }>();
  if (subErr) throw new Error(`subscriber lookup: ${subErr.message}`);
  if (!sub) {
    console.error(`No subscriber row found for ${to}. Subscribe yourself first at /subscribe.`);
    process.exit(1);
  }
  console.log(`Subscriber: ${sub.id} (status=${sub.status})`);

  const digest = await getDigest(sport, date);
  if (!digest || !digest.email_html) {
    console.error(`No cached digest for ${sport}/${date} — generate one first.`);
    process.exit(1);
  }
  console.log(`Digest:   ${digest.email_html.length.toLocaleString()} bytes`);

  // The actual test — generate a fresh open_token, render with it, send.
  const openToken = crypto.randomUUID();
  console.log(`Token:    ${openToken}`);
  console.log(`Pixel:    ${EMAIL_LINK_BASE}/api/o/${openToken}`);
  console.log();

  const { subject, html, text } = dailyEmail({
    sport,
    digestDate: date,
    digestPrettyDate: prettyDate(date),
    digestUrl: `${EMAIL_LINK_BASE}/${sport}/${nextDay(date)}`,
    unsubscribeUrl: `${EMAIL_LINK_BASE}/u/pixel-test`,
    manageUrl: `${EMAIL_LINK_BASE}/settings`,
    gamesUrl: `${EMAIL_LINK_BASE}/games`,
    tipJarUrl: BRAND.tipJarUrl,
    digestEmailHtml: digest.email_html,
    openToken,
  });

  // Confirm the pixel is in the rendered HTML BEFORE we send. Fail loudly
  // if injection didn't happen — sending a broken test wastes time.
  if (!html.includes(`/api/o/${openToken}`)) {
    console.error(`✗ Pixel URL not found in rendered HTML. Template injection is broken.`);
    process.exit(1);
  }
  // Where is the pixel relative to the 102 KB Gmail clip line?
  const pixelOffset = html.indexOf(`/api/o/${openToken}`);
  console.log(`✓ Pixel injected at byte offset ${pixelOffset.toLocaleString()} ` +
    `(${pixelOffset < 102_400 ? "ABOVE" : "BELOW"} Gmail's 102 KB clip line)`);
  console.log();

  console.log(`Sending [TEST] subject="${subject}" to ${to}...`);
  const { id: resendId } = await sendEmail({
    to: sub.email,
    subject: `[PIXEL TEST] ${subject}`,
    html,
    text,
  });
  console.log(`✓ Resend accepted: ${resendId}`);

  // Write the sends row so /api/o/[token] can resolve token → resend_id.
  await recordSend({
    subscriberId: sub.id,
    sport,
    date,
    resendId,
    error: null,
    openToken,
  });
  console.log(`✓ sends row recorded with open_token + resend_id`);
  console.log();

  console.log("──────────────────────────────────────────────────────────");
  console.log("Next steps:");
  console.log(`  1. Wait ~30 seconds for delivery, open the email in Gmail`);
  console.log(`     on your iPhone (the actual test condition).`);
  console.log(`  2. Verify the pixel fired:`);
  console.log();
  console.log(`     npx tsx --env-file=.env.local scripts/verify-open-pixel.ts \\`);
  console.log(`       ${openToken}`);
  console.log("──────────────────────────────────────────────────────────");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
