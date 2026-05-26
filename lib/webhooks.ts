import { supabaseAdmin } from "./supabase";

// Lightweight idempotency log for webhook deliveries. Resend (via Svix) retries
// on failure, so we MUST dedupe by event id or we'll double-process bounces and
// repeatedly stamp the same unsubscribe reason on the same subscriber.
//
// Lifecycle: callers check hasWebhookEvent() up front and short-circuit
// duplicates. After processing succeeds, they call recordWebhookEvent() so
// future retries see it. If the handler crashes, the record is never written
// and Svix's retry can try again — safe because our side effects are idempotent.

export async function hasWebhookEvent(id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("webhook_events")
    .select("id")
    .eq("id", id)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`hasWebhookEvent: ${error.message}`);
  return data !== null;
}

export async function recordWebhookEvent(args: {
  id: string;
  eventType: string;
  source?: string;
  payload?: unknown;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("webhook_events")
    .insert({
      id: args.id,
      source: args.source ?? "resend",
      event_type: args.eventType,
      payload: args.payload ?? null,
    });
  if (!error) return;
  // A duplicate at write time can happen if two retries race past the
  // hasWebhookEvent() check. Treat as success — the side effect was idempotent.
  const code = (error as { code?: string }).code;
  if (code === "23505" || /duplicate key/i.test(error.message)) return;
  throw new Error(`recordWebhookEvent: ${error.message}`);
}

// Engagement log: one row per Resend open/click event. Allows duplicates
// (a subscriber can open a message many times) — that's intentional and
// drives the trend visualizations.
export async function recordEmailEvent(args: {
  resendId: string;
  eventType: string;
  eventAt?: string;
  userAgent?: string | null;
  ip?: string | null;
  payload?: unknown;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("email_events")
    .insert({
      resend_id: args.resendId,
      event_type: args.eventType,
      event_at: args.eventAt ?? new Date().toISOString(),
      user_agent: args.userAgent ?? null,
      ip: args.ip ?? null,
      payload: args.payload ?? null,
    });
  if (error) throw new Error(`recordEmailEvent: ${error.message}`);
}

// Count prior bounce events of a specific subType for a recipient, within a
// time window. Used to detect repeated soft bounces that should be treated as
// effectively permanent — Apple's `554 5.7.1 [CS01]` reputation rejection
// arrives as `bounce.type="Transient"` `subType="ContentRejected"`, so Resend
// classifies it as soft. In practice the same recipient bounces every day with
// the same code, and continuing to send to them only further damages our
// domain reputation with Apple.
//
// Counts on email_events.payload (set to `event.data` at record time), which
// already contains both the `to` array and the bounce envelope. We don't keep
// a recipient column on email_events — payload containment is sufficient.
export async function countRecentBouncesOfSubType(
  email: string,
  subType: string,
  withinDays: number,
): Promise<number> {
  const since = new Date(Date.now() - withinDays * 24 * 3600 * 1000).toISOString();
  const normalized = email.trim().toLowerCase();
  const { count, error } = await supabaseAdmin()
    .from("email_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "email.bounced")
    .gte("event_at", since)
    .contains("payload", { to: [normalized] })
    .eq("payload->bounce->>subType", subType);
  if (error) throw new Error(`countRecentBouncesOfSubType: ${error.message}`);
  return count ?? 0;
}

// Truncate an IP address for privacy. IPv4 → keep first three octets and zero
// the fourth (/24). IPv6 → keep first three 16-bit groups (/48). Best-effort:
// returns null if the input isn't a parseable address.
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;
  if (trimmed.includes(":")) {
    const parts = trimmed.split(":");
    if (parts.length < 3) return null;
    return `${parts.slice(0, 3).join(":")}::`;
  }
  const parts = trimmed.split(".");
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}
