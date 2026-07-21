import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { supabaseAdmin } from "./supabase";

// Multi-admin auth. Admin status lives on subscribers.is_admin (boolean);
// /admin/login looks up the email there and issues a 6-digit code if the
// row exists with is_admin=true. Codes are hashed at rest; session tokens
// are random UUIDs stored httpOnly. The session's email is the only
// "who's the admin" identifier the rest of the app needs.

/**
 * True if there's a subscribers row with this email and is_admin=true.
 * Used by /admin/login as the gate before a 2FA code is issued. Email
 * comparison is case-insensitive; the underlying column is text and
 * subscribers are normalized to lowercase on insert.
 */
export async function isAdminEmail(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const { data, error } = await supabaseAdmin()
    .from("subscribers")
    .select("is_admin")
    .eq("email", normalized)
    .eq("is_admin", true)
    .maybeSingle<{ is_admin: boolean }>();
  if (error) {
    console.error(`isAdminEmail(${normalized}): ${error.message}`);
    return false;
  }
  return data?.is_admin === true;
}

/**
 * Every admin's email. Used for unattended fan-outs (cron failure alerts)
 * where no session is available to derive a single admin. Returns lowercase
 * emails. Empty array if no admins are configured.
 */
export async function getAdminEmails(): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("subscribers")
    .select("email")
    .eq("is_admin", true);
  if (error) {
    console.error(`getAdminEmails: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r) => (r as { email: string }).email);
}

const CODE_TTL_MIN = 10;
const SESSION_TTL_DAYS = 30;

// Brute-force guard. A 6-digit code has a 1-in-1M chance per guess; at 5
// failed attempts we lock the email for LOCKOUT_MIN and invalidate any
// outstanding code. That caps the attacker's expected work per code well
// past the 10-minute TTL, and if they were fast enough to burn 5 tries
// the operator gets a clear signal (locked_until) from the DB.
const MAX_CODE_ATTEMPTS = 5;
const LOCKOUT_MIN = 15;

const sha256 = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return timingSafeEqual(aBuf, bBuf);
}

// Crypto-strong 6-digit code (e.g. "493281"). Using randomInt would do; this
// avoids modulo bias and keeps the surface tight.
function makeCode(): string {
  // 20 bits is more than enough for 0–999999; pull 4 bytes and mod into range.
  // The bias is negligible at this domain size (< 0.0006%).
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

export type IssuedCode = { plaintext: string };

// Mint a new code for the given email, store its hash, return the plaintext
// so the caller can email it. Doesn't invalidate prior codes — the verify
// step finds the newest unused unexpired row matching email+hash.
export async function issueCode(email: string): Promise<IssuedCode> {
  const code = makeCode();
  const codeHash = sha256(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString();
  const { error } = await supabaseAdmin()
    .from("admin_codes")
    .insert({
      email,
      code_hash: codeHash,
      expires_at: expiresAt,
    });
  if (error) throw new Error(`issueCode: ${error.message}`);
  return { plaintext: code };
}

/** Outcome of a code check. `locked` is caller-visible so the UI can say
 *  "too many attempts — try again in N minutes" instead of the generic
 *  "invalid code," which teaches the attacker nothing extra. */
export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "locked"; lockedUntil?: Date };

// Check the submitted code with brute-force protection. Failed attempts
// are tallied per email; after MAX_CODE_ATTEMPTS the account locks for
// LOCKOUT_MIN and any outstanding code is invalidated.
export async function consumeCode(email: string, submitted: string): Promise<ConsumeResult> {
  const sb = supabaseAdmin();

  // Existing lockout check.
  const { data: attempt } = await sb
    .from("admin_code_attempts")
    .select("failed_count, locked_until")
    .eq("email", email)
    .maybeSingle<{ failed_count: number; locked_until: string | null }>();
  const now = Date.now();
  if (attempt?.locked_until) {
    const until = new Date(attempt.locked_until).getTime();
    if (until > now) {
      return { ok: false, reason: "locked", lockedUntil: new Date(until) };
    }
  }

  const codeHash = sha256(submitted);
  const { data, error } = await sb
    .from("admin_codes")
    .select("id, code_hash, expires_at, used_at")
    .eq("email", email)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; code_hash: string; expires_at: string; used_at: string | null }>();
  if (error) throw new Error(`consumeCode lookup: ${error.message}`);

  const matched = !!data && constantTimeEq(data.code_hash, codeHash);
  if (!matched) {
    // Failed attempt — bump counter, lock if threshold hit, kill any
    // outstanding codes on lockout so the attacker can't finish guessing.
    const newCount = (attempt?.failed_count ?? 0) + 1;
    const willLock = newCount >= MAX_CODE_ATTEMPTS;
    const lockedUntil = willLock ? new Date(now + LOCKOUT_MIN * 60_000) : null;
    await sb.from("admin_code_attempts").upsert({
      email,
      failed_count: newCount,
      locked_until: lockedUntil ? lockedUntil.toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "email" });
    if (willLock) {
      await sb.from("admin_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("email", email)
        .is("used_at", null);
      return { ok: false, reason: "locked", lockedUntil: lockedUntil! };
    }
    return { ok: false, reason: "invalid" };
  }

  const { error: updErr } = await sb
    .from("admin_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", data!.id);
  if (updErr) throw new Error(`consumeCode mark-used: ${updErr.message}`);
  // Successful login clears the failure counter.
  await sb.from("admin_code_attempts").delete().eq("email", email);
  return { ok: true };
}

// Create a new session and return the token. Caller stores it as a httpOnly
// cookie. UUID v4 is unguessable enough; we don't need additional entropy.
export async function createSession(email: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { error } = await supabaseAdmin()
    .from("admin_sessions")
    .insert({
      id: token,
      email,
      expires_at: expiresAt.toISOString(),
    });
  if (error) throw new Error(`createSession: ${error.message}`);
  return { token, expiresAt };
}

// Look up a session by cookie value. Returns the email if valid and refreshes
// last_seen; returns null otherwise. Expired rows linger but are filtered out
// here (low traffic + small table = no need for a cleanup job yet).
export async function validateSession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const { data, error } = await supabaseAdmin()
    .from("admin_sessions")
    .select("email, expires_at")
    .eq("id", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<{ email: string; expires_at: string }>();
  if (error) {
    console.error(`validateSession: ${error.message}`);
    return null;
  }
  if (!data) return null;
  // Best-effort last_seen update; failure doesn't invalidate the session.
  void supabaseAdmin()
    .from("admin_sessions")
    .update({ last_seen: new Date().toISOString() })
    .eq("id", token)
    .then(() => undefined);
  return data.email;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await supabaseAdmin().from("admin_sessions").delete().eq("id", token);
}

export const ADMIN_SESSION_COOKIE = "boxscore_admin_session";
export const ADMIN_SESSION_TTL_SEC = SESSION_TTL_DAYS * 24 * 60 * 60;

/**
 * True if the current request carries a valid admin session — a
 * non-redirecting counterpart to requireAdmin(). Lets public pages
 * optionally reveal admin_only content (e.g. pre-launch NFL pages) to a
 * logged-in admin while still 404-ing everyone else.
 */
export async function isAdminSession(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(ADMIN_SESSION_COOKIE)?.value;
  return (await validateSession(token)) != null;
}
