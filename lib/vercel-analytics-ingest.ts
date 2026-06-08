import crypto from "node:crypto";

// Vercel Web Analytics Drain ingest helpers. Used by
// app/api/ingest/vercel-analytics/route.ts to verify Drain signatures and
// parse the event payloads Vercel sends.
//
// Drain protocol reference (verified against
// https://vercel.com/docs/drains/security and
// https://vercel.com/docs/drains/reference/analytics on 2026-06-08):
//
//   - Vercel POSTs payloads to the configured URL with header
//     `x-vercel-signature` = HMAC-SHA1(rawBody, signatureSecret), hex-encoded.
//   - Body is either a JSON array of event objects or NDJSON (newline-
//     delimited JSON), one event per line. We handle both.
//   - Each pageview event has eventType="pageview", a `timestamp` (epoch ms),
//     and assorted dimensional fields. The full v2 schema is in the docs.

/** Event shape Vercel sends. All fields are optional in practice — the v2
 *  schema's "possible fields" table doesn't mark required vs optional, so
 *  the receiver treats everything as optional and defaults at insert time. */
export type VercelAnalyticsEvent = {
  schema?: string;            // 'vercel.analytics.v2'
  eventType?: "pageview" | "event";
  eventName?: string;
  eventData?: string;
  timestamp?: number;          // epoch ms
  projectId?: string;
  ownerId?: string;
  sessionId?: number;
  deviceId?: number;
  origin?: string;
  path?: string;
  route?: string;
  country?: string;
  deviceType?: string;
  vercelEnvironment?: string;  // 'production' | 'preview' | 'development'
  // The schema has many more fields (clientName, osName, deployment, etc.);
  // we don't read them but preserve the full payload in page_views.raw.
};

/** HMAC-SHA1(rawBody, secret) → hex. Matches the Vercel reference impl. */
export function computeSignature(rawBody: Buffer | string, secret: string): string {
  return crypto.createHmac("sha1", secret).update(rawBody).digest("hex");
}

/** Constant-time signature comparison. Use this instead of `===` to avoid
 *  leaking a timing oracle. Both inputs are hex strings of the same SHA-1
 *  length (40 chars); a length mismatch returns false without hashing. */
export function verifySignature(rawBody: Buffer | string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = computeSignature(rawBody, secret);
  if (expected.length !== header.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(header, "hex"));
  } catch {
    // timingSafeEqual throws on length mismatch after the Buffer.from; the
    // outer length check above usually catches that, but a malformed
    // header (non-hex chars) can also land here. Treat as invalid.
    return false;
  }
}

/** Parse a Drain body. Vercel sends EITHER a JSON array of events OR NDJSON
 *  (one JSON object per line). Detection: if the first non-whitespace
 *  character is `[`, parse as JSON array; otherwise split by newlines and
 *  parse each non-empty line. */
export function parseEvents(rawBody: string): VercelAnalyticsEvent[] {
  const trimmed = rawBody.trimStart();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("expected JSON array");
    }
    return parsed as VercelAnalyticsEvent[];
  }
  // NDJSON path. Tolerant of CRLF + blank lines (some routers may add them).
  return rawBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as VercelAnalyticsEvent);
}

/** Convert one Vercel event into the row shape page_views expects. Drops
 *  events without a timestamp (can't position them on a timeline) — those
 *  return null and the caller skips them. */
export type PageViewRow = {
  schema_version: string;
  event_type: string;
  event_name: string | null;
  occurred_at: string;        // ISO timestamptz
  path: string | null;
  route: string | null;
  origin: string | null;
  country: string | null;
  device_type: string | null;
  vercel_environment: string | null;
  session_id: number | null;
  device_id: number | null;
  raw: VercelAnalyticsEvent;
};

export function eventToRow(e: VercelAnalyticsEvent): PageViewRow | null {
  if (typeof e.timestamp !== "number" || !Number.isFinite(e.timestamp)) return null;
  return {
    schema_version: e.schema ?? "vercel.analytics.v2",
    event_type: e.eventType ?? "pageview",
    event_name: e.eventName ?? null,
    occurred_at: new Date(e.timestamp).toISOString(),
    path: e.path ?? null,
    route: e.route ?? null,
    origin: e.origin ?? null,
    country: e.country ?? null,
    device_type: e.deviceType ?? null,
    vercel_environment: e.vercelEnvironment ?? null,
    session_id: typeof e.sessionId === "number" ? e.sessionId : null,
    device_id: typeof e.deviceId === "number" ? e.deviceId : null,
    raw: e,
  };
}
