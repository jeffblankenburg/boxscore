// HMAC-signed redirect URLs for first-party click tracking. v1 only covers
// ad clicks via /r/ad/[placement_id]; the broader link tracker from issue
// #51 will reuse this signing/secret infrastructure.
//
// Secret strategy: NO env var. The HMAC key lives in admin_settings under
// `link_tracking_secret`. On first use, generated as a random 64-char hex
// string and persisted. Cached in module memory so subsequent calls don't
// hit the DB. Once generated the secret should never rotate — rotating it
// would break every signed URL already living in subscribers' inboxes.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "./supabase";
import { EMAIL_LINK_BASE } from "./site";

const SECRET_KEY = "link_tracking_secret";

let cachedSecret: string | null = null;

async function getSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const db = supabaseAdmin();

  // Try read first.
  const { data, error } = await db
    .from("admin_settings")
    .select("value")
    .eq("key", SECRET_KEY)
    .maybeSingle();
  if (error) throw new Error(`link-tracking secret read: ${error.message}`);
  if (data?.value) {
    cachedSecret = data.value as string;
    return cachedSecret;
  }

  // Bootstrap: not present yet. Generate and insert. ON CONFLICT DO
  // NOTHING handles the race where two concurrent requests both try to
  // seed; after insert/conflict, re-read to get the canonical value.
  const fresh = randomBytes(32).toString("hex");
  const { error: insertErr } = await db
    .from("admin_settings")
    .upsert(
      { key: SECRET_KEY, value: fresh, updated_at: new Date().toISOString() },
      { onConflict: "key", ignoreDuplicates: true },
    );
  if (insertErr) throw new Error(`link-tracking secret bootstrap: ${insertErr.message}`);

  const { data: data2 } = await db
    .from("admin_settings")
    .select("value")
    .eq("key", SECRET_KEY)
    .maybeSingle();
  cachedSecret = (data2?.value as string | undefined) ?? fresh;
  return cachedSecret;
}

function sign(input: string, secret: string): string {
  // 16 hex chars = 64 bits — plenty for a redirect signature where
  // forgeries get you a tracked click to your own URL (no real value
  // to attack). Saves URL length over a full 64-char SHA256.
  return createHmac("sha256", secret).update(input).digest("hex").slice(0, 16);
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// Build a tracked URL for an ad click. Encodes both placement_id and
// destination in the HMAC so the URL can't be re-used to redirect to a
// different destination, and the placement_id can't be swapped.
export async function trackedAdLink(
  placementId: string,
  destinationUrl: string,
): Promise<string> {
  const secret = await getSecret();
  const payload = `ad|${placementId}|${destinationUrl}`;
  const sig = sign(payload, secret);
  const params = new URLSearchParams({
    to: destinationUrl,
    sig,
  });
  return `${EMAIL_LINK_BASE}/r/ad/${encodeURIComponent(placementId)}?${params.toString()}`;
}

// Verify a click hitting /r/ad/[placement_id]. Returns true only when the
// HMAC matches what we'd produce for this (placement_id, destination)
// pair. Timing-safe comparison so the verification doesn't leak bits via
// response-time analysis.
export async function verifyAdLink(
  placementId: string,
  destinationUrl: string,
  sig: string,
): Promise<boolean> {
  const secret = await getSecret();
  const payload = `ad|${placementId}|${destinationUrl}`;
  const expected = sign(payload, secret);
  return timingSafeEquals(sig, expected);
}

// Generic email-chrome link tracker. Used for digest title, Manage
// Subscriptions, and any other top-of-email link we want click-rate
// data on. Distinct namespace ("email") from ad clicks so an attacker
// can't replay an ad-signed URL through the email route or vice versa.
export async function trackedEmailLink(
  src: string,
  destinationUrl: string,
): Promise<string> {
  const secret = await getSecret();
  const payload = `email|${src}|${destinationUrl}`;
  const sig = sign(payload, secret);
  const params = new URLSearchParams({
    to: destinationUrl,
    sig,
  });
  return `${EMAIL_LINK_BASE}/r/e/${encodeURIComponent(src)}?${params.toString()}`;
}

export async function verifyEmailLink(
  src: string,
  destinationUrl: string,
  sig: string,
): Promise<boolean> {
  const secret = await getSecret();
  const payload = `email|${src}|${destinationUrl}`;
  const expected = sign(payload, secret);
  return timingSafeEquals(sig, expected);
}
