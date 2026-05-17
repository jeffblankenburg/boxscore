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
