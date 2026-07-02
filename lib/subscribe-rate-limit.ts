import { supabaseAdmin } from "./supabase";

// Per-IP + per-email caps for /subscribe. The main risk vector is list
// bombing: an attacker fires POSTs with arbitrary emails and rides our
// Resend account to blast confirmation emails at addresses of their
// choosing. Blocking at ~10/IP/hour and ~3/email/hour absorbs the
// obvious cases without hurting a family of five signing up together.
export const SUBSCRIBE_RATE_LIMITS = {
  PER_IP_PER_HOUR: 10,
  PER_EMAIL_PER_HOUR: 3,
};

async function countSince(column: "ip" | "email", value: string, minutes: number): Promise<number> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { count, error } = await supabaseAdmin()
    .from("subscribe_attempts")
    .select("id", { head: true, count: "exact" })
    .eq(column, value)
    .gt("created_at", since);
  if (error) {
    // Fail-open on DB hiccup — better to accept a legit signup than 500
    // out. The email side of the flow still has the confirmation gate.
    console.warn(`subscribe rate-limit lookup (${column}) failed: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}

export type RateLimitOutcome = { ok: true } | { ok: false; reason: "ip" | "email" };

/** Check the current rate before the subscribe action does its work. On
 *  ok, callers should call `recordSubscribeAttempt` post-validation so
 *  malformed POSTs (bad email, no picks) don't inflate the counter. */
export async function checkSubscribeRate(args: { ip: string | null; email: string }): Promise<RateLimitOutcome> {
  const email = args.email.trim().toLowerCase();
  if (args.ip) {
    const perIp = await countSince("ip", args.ip, 60);
    if (perIp >= SUBSCRIBE_RATE_LIMITS.PER_IP_PER_HOUR) {
      console.warn(`subscribe rate-limit hit for ip ${args.ip} (count=${perIp})`);
      return { ok: false, reason: "ip" };
    }
  }
  const perEmail = await countSince("email", email, 60);
  if (perEmail >= SUBSCRIBE_RATE_LIMITS.PER_EMAIL_PER_HOUR) {
    console.warn(`subscribe rate-limit hit for email ${email} (count=${perEmail})`);
    return { ok: false, reason: "email" };
  }
  return { ok: true };
}

export async function recordSubscribeAttempt(args: { ip: string | null; email: string }): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("subscribe_attempts")
    .insert({ ip: args.ip, email: args.email.trim().toLowerCase() });
  if (error) console.warn(`recordSubscribeAttempt failed: ${error.message}`);
}
