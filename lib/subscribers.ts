import { supabaseAdmin } from "./supabase";

export type SubscriberStatus = "pending" | "active" | "unsubscribed";

// What ended the subscription. "user" = clicked our unsubscribe URL.
// "bounce"/"complaint" = Resend webhook auto-unsubscribe. "manual" = admin.
export type UnsubscribeReason = "user" | "bounce" | "complaint" | "manual";

export type Subscriber = {
  id: string;
  email: string;
  status: SubscriberStatus;
  created_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  unsubscribe_reason: UnsubscribeReason | null;
  confirm_token: string;
  unsubscribe_token: string;
};

const COLS =
  "id, email, status, created_at, confirmed_at, unsubscribed_at, unsubscribe_reason, confirm_token, unsubscribe_token";

/**
 * Idempotent: starting a subscription for an email that already exists in any
 * state resets it to pending and rotates the tokens. The caller decides what to
 * tell the user (e.g., "if you were already subscribed, you'll get a fresh
 * confirmation email").
 */
export async function startSubscription(email: string): Promise<Subscriber> {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabaseAdmin()
    .from("subscribers")
    .upsert(
      {
        email: normalized,
        status: "pending" as const,
        confirmed_at: null,
        unsubscribed_at: null,
        confirm_token: crypto.randomUUID(),
        unsubscribe_token: crypto.randomUUID(),
      },
      { onConflict: "email" },
    )
    .select(COLS)
    .single<Subscriber>();
  if (error) throw new Error(`startSubscription: ${error.message}`);
  return data;
}

export async function findByConfirmToken(token: string): Promise<Subscriber | null> {
  const { data, error } = await supabaseAdmin()
    .from("subscribers")
    .select(COLS)
    .eq("confirm_token", token)
    .maybeSingle<Subscriber>();
  if (error) throw new Error(`findByConfirmToken: ${error.message}`);
  return data ?? null;
}

export async function findByUnsubscribeToken(token: string): Promise<Subscriber | null> {
  const { data, error } = await supabaseAdmin()
    .from("subscribers")
    .select(COLS)
    .eq("unsubscribe_token", token)
    .maybeSingle<Subscriber>();
  if (error) throw new Error(`findByUnsubscribeToken: ${error.message}`);
  return data ?? null;
}

/**
 * Atomically flip pending → active. Returns the updated row only if THIS call
 * caused the transition (i.e., previous status was "pending"); returns null
 * if the subscriber was already active or unsubscribed.
 *
 * This is what lets us send the welcome email *exactly once* even when the
 * confirm URL gets clicked multiple times — by Gmail's link safety scanner,
 * link previews, the user themselves, etc.
 */
export async function confirmSubscriberIfPending(id: string): Promise<Subscriber | null> {
  const { data, error } = await supabaseAdmin()
    .from("subscribers")
    .update({ status: "active" as const, confirmed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select(COLS)
    .maybeSingle<Subscriber>();
  if (error) throw new Error(`confirmSubscriberIfPending: ${error.message}`);
  return data ?? null;
}

export async function getActiveSubscribers(): Promise<Subscriber[]> {
  // Supabase silently caps SELECT at 1000 rows; paginate so we get everyone.
  const out: Subscriber[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin()
      .from("subscribers")
      .select(COLS)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`getActiveSubscribers: ${error.message}`);
    const page = (data ?? []) as Subscriber[];
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

/**
 * Flips active → unsubscribed. Idempotent — works regardless of current state
 * so the unsubscribe URL works forever. Default reason is "user" for the
 * customer-facing unsubscribe URL; webhooks pass "bounce"/"complaint".
 */
export async function unsubscribeSubscriber(
  id: string,
  reason: UnsubscribeReason = "user",
): Promise<Subscriber> {
  const { data, error } = await supabaseAdmin()
    .from("subscribers")
    .update({
      status: "unsubscribed" as const,
      unsubscribed_at: new Date().toISOString(),
      unsubscribe_reason: reason,
    })
    .eq("id", id)
    .select(COLS)
    .single<Subscriber>();
  if (error) throw new Error(`unsubscribeSubscriber: ${error.message}`);
  return data;
}

/**
 * By-email lookup variant used by the Resend webhook. Email is the only
 * identifier we get in a bounce/complaint payload. Returns null if no
 * subscriber matches OR if the subscriber is already unsubscribed (so we
 * don't repeatedly stamp a new reason on top of an old one).
 */
export async function unsubscribeByEmail(
  email: string,
  reason: UnsubscribeReason,
): Promise<Subscriber | null> {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabaseAdmin()
    .from("subscribers")
    .update({
      status: "unsubscribed" as const,
      unsubscribed_at: new Date().toISOString(),
      unsubscribe_reason: reason,
    })
    .eq("email", normalized)
    .neq("status", "unsubscribed")
    .select(COLS)
    .maybeSingle<Subscriber>();
  if (error) throw new Error(`unsubscribeByEmail: ${error.message}`);
  return data ?? null;
}
