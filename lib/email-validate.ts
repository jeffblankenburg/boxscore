// Email validation shared by the subscribe server action (the authoritative
// gate) and the subscribe form field (live UX). Deliberately stricter than a
// permissive local@domain.tld regex: the 2026-09-29 Resend batch incident
// traced to addresses like `foo@armadaanalytics..com` and `x@gmail.,` that
// passed the old EMAIL_RE but made Resend 422 the ENTIRE 100-email batch,
// silently dropping ~99 valid subscribers each. See memory
// resend-batch-whole-batch-422.
//
// We accept ANY valid email address — no typo guessing. Rejection is limited to
// what's provably not deliverable: a malformed shape, a reserved/documentation
// domain, or a TLD that doesn't exist (foo@bar.con — `.con` is not a TLD),
// checked against IANA's authoritative list (lib/tlds.ts). Pure and dependency-
// free so the "use client" field imports it too.

import { VALID_TLDS } from "./tlds";

// Structural check: dot-separated domain labels + a 2+ letter TLD, each label
// alphanumeric with internal hyphens only. Rejects empty labels (the `..`
// case), trailing punctuation, and a missing TLD. Local part stays permissive.
const STRICT_EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

// Reserved / documentation domains (RFC 2606) that Resend rejects outright.
const RESERVED_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "test.com", "test.org", "email.com",
]);

export type EmailCheck = { email: string; ok: boolean };

export function validateEmail(raw: string): EmailCheck {
  const email = raw.trim();
  if (email.includes("..") || !STRICT_EMAIL_RE.test(email)) return { email, ok: false };

  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  if (RESERVED_DOMAINS.has(domain)) return { email, ok: false };

  // TLD is the last label; check it exists. co.uk → "uk", gmail.con → "con".
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (!VALID_TLDS.has(tld)) return { email, ok: false };

  return { email, ok: true };
}
