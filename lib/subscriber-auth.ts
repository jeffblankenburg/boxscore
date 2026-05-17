import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabase";

// Subscriber-facing auth. Companion to admin-auth.ts; same hash-at-rest pattern
// but issues clickable magic links (256-bit random tokens) instead of 6-digit
// codes. The plaintext token only ever lives in the email URL and the session
// cookie — DB rows store sha256(token).

const MAGIC_TTL_MIN = 15;
const SESSION_TTL_DAYS = 365;
const TOKEN_BYTES = 32;             // 256 bits of entropy

const sha256 = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

function makeToken(): string {
  // base64url is URL-safe (no '+', '/', '='); 32 bytes → 43 chars
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

// ---- Magic tokens -----------------------------------------------------

export type IssuedToken = { plaintext: string; expiresAt: Date };

export async function issueMagicToken(args: {
  subscriberId: string;
  ip?: string | null;
  purpose?: string;
}): Promise<IssuedToken> {
  const token = makeToken();
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + MAGIC_TTL_MIN * 60_000);
  const { error } = await supabaseAdmin()
    .from("magic_tokens")
    .insert({
      subscriber_id: args.subscriberId,
      token_hash: tokenHash,
      purpose: args.purpose ?? "login",
      expires_at: expiresAt.toISOString(),
      ip: args.ip ?? null,
    });
  if (error) throw new Error(`issueMagicToken: ${error.message}`);
  return { plaintext: token, expiresAt };
}

// Atomic single-use claim. Two concurrent POSTs of the same token race here;
// the `.is("used_at", null)` filter on the UPDATE makes exactly one win, and
// the loser's update returns no row.
export async function consumeMagicToken(
  plaintext: string,
): Promise<{ subscriberId: string } | null> {
  const tokenHash = sha256(plaintext);
  const db = supabaseAdmin();
  const { data: row, error } = await db
    .from("magic_tokens")
    .select("id, subscriber_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle<{ id: string; subscriber_id: string; expires_at: string; used_at: string | null }>();
  if (error) throw new Error(`consumeMagicToken lookup: ${error.message}`);
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at) <= new Date()) return null;
  const { data: claimed, error: updErr } = await db
    .from("magic_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (updErr) throw new Error(`consumeMagicToken claim: ${updErr.message}`);
  if (!claimed) return null;
  return { subscriberId: row.subscriber_id };
}

// ---- Sessions ---------------------------------------------------------

export type SubscriberSession = {
  id: string;
  subscriber_id: string;
  expires_at: string;
};

export async function createSession(args: {
  subscriberId: string;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = makeToken();
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { error } = await supabaseAdmin()
    .from("sessions")
    .insert({
      subscriber_id: args.subscriberId,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    });
  if (error) throw new Error(`createSession: ${error.message}`);
  return { token, expiresAt };
}

// Validate a session cookie value. Returns the row if active, null otherwise.
// Sliding window: a valid hit refreshes expires_at + last_seen_at (best-effort,
// failure doesn't invalidate the session for this request).
export async function validateSession(
  plaintext: string | undefined,
): Promise<SubscriberSession | null> {
  if (!plaintext) return null;
  const tokenHash = sha256(plaintext);
  const { data, error } = await supabaseAdmin()
    .from("sessions")
    .select("id, subscriber_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<{ id: string; subscriber_id: string; expires_at: string; revoked_at: string | null }>();
  if (error) {
    console.error(`validateSession: ${error.message}`);
    return null;
  }
  if (!data) return null;
  const newExpiry = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  void supabaseAdmin()
    .from("sessions")
    .update({
      last_seen_at: new Date().toISOString(),
      expires_at: newExpiry.toISOString(),
    })
    .eq("id", data.id)
    .then(() => undefined);
  return { id: data.id, subscriber_id: data.subscriber_id, expires_at: data.expires_at };
}

export async function revokeSession(plaintext: string | undefined): Promise<void> {
  if (!plaintext) return;
  const tokenHash = sha256(plaintext);
  await supabaseAdmin()
    .from("sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", tokenHash);
}

// ---- Rate limiting (counts recent magic_tokens rows) ------------------
//
// "Per email" is keyed on subscriber_id so two different addresses can't share
// a quota. "Per IP" is global across all subscribers — a single requester
// can't email-bomb arbitrary addresses.

export async function countMagicTokensForSubscriber(
  subscriberId: string,
  windowMin: number,
): Promise<number> {
  const since = new Date(Date.now() - windowMin * 60_000).toISOString();
  const { count, error } = await supabaseAdmin()
    .from("magic_tokens")
    .select("id", { count: "exact", head: true })
    .eq("subscriber_id", subscriberId)
    .gte("created_at", since);
  if (error) throw new Error(`countMagicTokensForSubscriber: ${error.message}`);
  return count ?? 0;
}

export async function countMagicTokensForIp(
  ip: string,
  windowMin: number,
): Promise<number> {
  const since = new Date(Date.now() - windowMin * 60_000).toISOString();
  const { count, error } = await supabaseAdmin()
    .from("magic_tokens")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", since);
  if (error) throw new Error(`countMagicTokensForIp: ${error.message}`);
  return count ?? 0;
}

// ---- Constants for cookie + TTL ---------------------------------------

export const SUBSCRIBER_SESSION_COOKIE = "boxscore_session";
export const SUBSCRIBER_SESSION_TTL_SEC = SESSION_TTL_DAYS * 24 * 60 * 60;

// Rate limit thresholds (issue #19 calls for 5/hr per email, 20/hr per IP).
export const RATE_LIMITS = {
  PER_SUBSCRIBER_PER_HOUR: 5,
  PER_IP_PER_HOUR: 20,
};

// ---- High-level orchestration -----------------------------------------
//
// Used by /api/auth/request AND the /settings server action so they share
// one rate-limit / lookup / email-send path. Returns void so callers can
// emit their own "if you have an account…" acknowledgement without leaking
// outcome (existence, rate-limit state, send failures).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailFormat = "valid" | "invalid";

export function validateEmail(email: string): EmailFormat {
  return EMAIL_RE.test(email.trim().toLowerCase()) ? "valid" : "invalid";
}

export async function requestMagicLink(args: {
  email: string;
  ip: string | null;
  buildUrl: (token: string) => string;
}): Promise<void> {
  const email = args.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return;

  const { data: sub } = await supabaseAdmin()
    .from("subscribers")
    .select("id")
    .eq("email", email)
    .maybeSingle<{ id: string }>();
  if (!sub) return; // No account — silently no-op. Future: route to /subscribe.

  // Rate limits. Fail-open on DB hiccups: better to send a legitimate link
  // than block a user. Hash-at-rest + atomic single-use bound the damage.
  try {
    const perSub = await countMagicTokensForSubscriber(sub.id, 60);
    if (perSub >= RATE_LIMITS.PER_SUBSCRIBER_PER_HOUR) {
      console.warn(`auth rate-limit hit for subscriber ${sub.id} (count=${perSub})`);
      return;
    }
    if (args.ip) {
      const perIp = await countMagicTokensForIp(args.ip, 60);
      if (perIp >= RATE_LIMITS.PER_IP_PER_HOUR) {
        console.warn(`auth rate-limit hit for ip ${args.ip} (count=${perIp})`);
        return;
      }
    }
  } catch (e) {
    console.error(`auth rate-limit lookup failed: ${(e as Error).message}`);
  }

  let signInUrl: string;
  try {
    const issued = await issueMagicToken({ subscriberId: sub.id, ip: args.ip });
    signInUrl = args.buildUrl(issued.plaintext);
  } catch (e) {
    console.error(`issueMagicToken failed: ${(e as Error).message}`);
    return;
  }

  try {
    const { sendEmail } = await import("./email");
    const { magicLinkEmail } = await import("./emails/templates");
    const { subject, html, text } = magicLinkEmail({ signInUrl });
    await sendEmail({ to: email, subject, html, text });
  } catch (e) {
    // The token is in the DB; user can request another. Log only.
    console.error(`magic-link send failed for ${email}: ${(e as Error).message}`);
  }
}
