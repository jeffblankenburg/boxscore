// Admin comp tool for the paid predictions tier (GitHub #109).
//
// Grants / lists / revokes free access windows without a Stripe charge —
// the "admin comp" the monetization plan calls for, usable before any
// Stripe UI exists. Writes predictions_entitlements rows via the same
// helpers the eventual admin page and Stripe webhooks use.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/comp-predictions.ts list <email>
//   npx tsx --env-file=.env.local scripts/comp-predictions.ts grant <email> <start> <end> [note...]
//   npx tsx --env-file=.env.local scripts/comp-predictions.ts revoke <entitlement-id>
//
// Dates are ET calendar dates, ISO YYYY-MM-DD, inclusive on both ends.
// Entitlements are per-sport; this tool operates on the launch sport (MLB).

import { findByEmail } from "@/lib/subscribers";
import {
  listEntitlements,
  grantComp,
  revokeEntitlement,
  hasPredictionsAccess,
} from "@/lib/predictions-entitlements";
import { todayInET, isValidIsoDate } from "@/lib/dates";

const SPORT = "mlb"; // launch sport; add a flag when a 2nd predictions sport ships

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "list") {
    const [email] = rest;
    if (!email) fail("usage: list <email>");
    const sub = await findByEmail(email);
    if (!sub) fail(`no subscriber for ${email}`);
    const rows = await listEntitlements(sub.id, SPORT);
    const today = todayInET();
    const active = await hasPredictionsAccess(sub.id, SPORT, today);
    console.log(`${email} (${sub.id}) — ${SPORT} access today (${today}): ${active ? "YES" : "no"}`);
    if (rows.length === 0) {
      console.log("  (no entitlements)");
      return;
    }
    for (const r of rows) {
      const state = r.revokedAt ? "REVOKED" : "active";
      const covered = !r.revokedAt && r.accessStart <= today && r.accessEnd >= today ? " ← covers today" : "";
      console.log(
        `  ${r.id}  ${r.sport} ${r.product.padEnd(8)} ${r.accessStart}→${r.accessEnd}  ${r.source.padEnd(6)} ${state}${r.note ? `  "${r.note}"` : ""}${covered}`,
      );
    }
    return;
  }

  if (cmd === "grant") {
    const [email, start, end, ...noteParts] = rest;
    if (!email || !start || !end) fail("usage: grant <email> <start> <end> [note...]");
    if (!isValidIsoDate(start) || !isValidIsoDate(end)) fail("start/end must be ISO YYYY-MM-DD");
    if (end < start) fail("end must be >= start");
    const sub = await findByEmail(email);
    if (!sub) fail(`no subscriber for ${email}`);
    const ent = await grantComp({
      subscriberId: sub.id,
      sport: SPORT,
      accessStart: start,
      accessEnd: end,
      grantedBy: "admin-cli",
      note: noteParts.length ? noteParts.join(" ") : null,
    });
    console.log(`✓ comped ${email}: ${ent.accessStart}→${ent.accessEnd} (${ent.id})`);
    return;
  }

  if (cmd === "revoke") {
    const [id] = rest;
    if (!id) fail("usage: revoke <entitlement-id>");
    await revokeEntitlement(id);
    console.log(`✓ revoked ${id}`);
    return;
  }

  fail("commands: list <email> | grant <email> <start> <end> [note] | revoke <id>");
}

main().catch((e) => fail((e as Error).message));
