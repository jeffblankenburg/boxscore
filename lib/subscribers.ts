import { supabaseAdmin } from "./supabase";
import { ensureLeagueSubscription } from "./email-subscriptions";

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
  is_admin: boolean;
};

const COLS =
  "id, email, status, created_at, confirmed_at, unsubscribed_at, unsubscribe_reason, confirm_token, unsubscribe_token, is_admin";

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

/**
 * Lookup by email (normalized). Used by /subscribe to dispatch between the
 * confirmation flow (new/pending/unsubscribed addresses) and a magic-link
 * sign-in flow (already-active addresses) without re-pendinging the row.
 */
export async function findByEmail(email: string): Promise<Subscriber | null> {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabaseAdmin()
    .from("subscribers")
    .select(COLS)
    .eq("email", normalized)
    .maybeSingle<Subscriber>();
  if (error) throw new Error(`findByEmail: ${error.message}`);
  return data ?? null;
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
  if (!data) return null;
  // Opt the newly-active subscriber into the default league newsletter (MLB).
  // Idempotent — safe if a row already exists from a prior subscription cycle.
  // Errors are logged but don't fail confirmation; missing the opt-in row is
  // fixable later (the backfill migration is the same shape), losing the
  // confirmed_at flip would not be.
  try {
    await ensureLeagueSubscription(data.id);
  } catch (e) {
    console.error(`ensureLeagueSubscription(${data.id}) failed: ${(e as Error).message}`);
  }
  return data;
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
 * Active subscribers opted in to a specific team's digest. Same shape as
 * getActiveSubscribersForSport, but keyed on (sport, scope='team', team_id).
 * Used by the team-send cron to fan out a single team's digest only to its
 * own opted-in subscribers.
 */
export async function getActiveSubscribersForTeam(
  sport: string,
  teamId: string,
): Promise<Subscriber[]> {
  const optedIn = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin()
      .from("email_subscriptions")
      .select("subscriber_id")
      .eq("sport", sport)
      .eq("scope", "team")
      .eq("team_id", teamId)
      .eq("active", true)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`getActiveSubscribersForTeam ids: ${error.message}`);
    const page = (data ?? []) as Array<{ subscriber_id: string }>;
    for (const row of page) optedIn.add(row.subscriber_id);
    if (page.length < pageSize) break;
  }
  if (optedIn.size === 0) return [];
  const all = await getActiveSubscribers();
  return all.filter((s) => optedIn.has(s.id));
}

/**
 * Active subscribers who have opted in to a sport's league digest. Used by
 * the per-sport send cron — replaces the old "everyone status='active'" fan-
 * out so adding a new sport doesn't immediately mail every subscriber.
 *
 * Filters on both sides: subscribers.status='active' AND the league row in
 * email_subscriptions exists with active=true. The 0013 backfill ensured
 * every MLB-era subscriber has the row, so MLB behavior is unchanged.
 */
export async function getActiveSubscribersForSport(sport: string): Promise<Subscriber[]> {
  // Two-step rather than a Supabase nested select: pull the opted-in IDs
  // for this sport, then filter the active subscriber list. Matches the
  // pattern used by getSentSubscriberIds + the send-cron filter loop.
  const optedIn = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin()
      .from("email_subscriptions")
      .select("subscriber_id")
      .eq("sport", sport)
      .eq("scope", "league")
      .eq("active", true)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`getActiveSubscribersForSport ids: ${error.message}`);
    const page = (data ?? []) as Array<{ subscriber_id: string }>;
    for (const row of page) optedIn.add(row.subscriber_id);
    if (page.length < pageSize) break;
  }
  if (optedIn.size === 0) return [];
  const all = await getActiveSubscribers();
  return all.filter((s) => optedIn.has(s.id));
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
