import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "./supabase";

// Advertiser portal auth. Identity is ad_advertisers.email (case-insensitive).
// Same 6-digit-code → session-cookie pattern as admin auth in lib/admin-auth.ts;
// kept as a parallel implementation rather than a shared generic so the two
// surfaces can diverge (e.g. portal may add per-advertiser rate limiting or
// tighter session TTLs) without touching admin login.

/**
 * True if there's an ad_advertisers row with this email. Used by /advertise/login
 * as the gate before a 6-digit code is issued. Email comparison is case-
 * insensitive; the underlying ad_advertisers table has a unique index on
 * lower(email).
 */
export async function isAdvertiserEmail(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const { data, error } = await supabaseAdmin()
    .from("ad_advertisers")
    .select("id")
    .ilike("email", normalized)
    .maybeSingle<{ id: string }>();
  if (error) {
    console.error(`isAdvertiserEmail(${normalized}): ${error.message}`);
    return false;
  }
  return data !== null;
}

const CODE_TTL_MIN = 10;
const SESSION_TTL_DAYS = 30;

const sha256 = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function makeCode(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

export type IssuedCode = { plaintext: string };

export async function issueCode(email: string): Promise<IssuedCode> {
  const code = makeCode();
  const codeHash = sha256(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString();
  const { error } = await supabaseAdmin()
    .from("advertiser_codes")
    .insert({
      email,
      code_hash: codeHash,
      expires_at: expiresAt,
    });
  if (error) throw new Error(`issueCode: ${error.message}`);
  return { plaintext: code };
}

export async function consumeCode(email: string, submitted: string): Promise<boolean> {
  const codeHash = sha256(submitted);
  const { data, error } = await supabaseAdmin()
    .from("advertiser_codes")
    .select("id, code_hash, expires_at, used_at")
    .eq("email", email)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; code_hash: string; expires_at: string; used_at: string | null }>();
  if (error) throw new Error(`consumeCode lookup: ${error.message}`);
  if (!data) return false;
  if (!constantTimeEq(data.code_hash, codeHash)) return false;

  const { error: updErr } = await supabaseAdmin()
    .from("advertiser_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", data.id);
  if (updErr) throw new Error(`consumeCode mark-used: ${updErr.message}`);
  return true;
}

export async function createSession(email: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { error } = await supabaseAdmin()
    .from("advertiser_sessions")
    .insert({
      id: token,
      email,
      expires_at: expiresAt.toISOString(),
    });
  if (error) throw new Error(`createSession: ${error.message}`);
  return { token, expiresAt };
}

export async function validateSession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const { data, error } = await supabaseAdmin()
    .from("advertiser_sessions")
    .select("email, expires_at")
    .eq("id", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<{ email: string; expires_at: string }>();
  if (error) {
    console.error(`validateSession: ${error.message}`);
    return null;
  }
  if (!data) return null;
  void supabaseAdmin()
    .from("advertiser_sessions")
    .update({ last_seen: new Date().toISOString() })
    .eq("id", token)
    .then(() => undefined);
  return data.email;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await supabaseAdmin().from("advertiser_sessions").delete().eq("id", token);
}

export const ADVERTISER_SESSION_COOKIE = "boxscore_advertiser_session";
export const ADVERTISER_SESSION_TTL_SEC = SESSION_TTL_DAYS * 24 * 60 * 60;
