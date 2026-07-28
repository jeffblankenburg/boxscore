// Current-subscriber resolution from the session cookie. Server-only.
//
// Wraps the cookie → validateSession → subscriber-row dance that pages like
// /settings do inline, so the predictions checkout (GitHub #111, Phase 2) and
// its success page share one code path. Returns null when nobody is signed in.

import { cookies } from "next/headers";
import { validateSession, SUBSCRIBER_SESSION_COOKIE } from "./subscriber-auth";
import { supabaseAdmin } from "./supabase";

export type SessionSubscriber = {
  id: string;
  email: string;
  stripeCustomerId: string | null;
  isAdmin: boolean;
};

export async function getSessionSubscriber(): Promise<SessionSubscriber | null> {
  const jar = await cookies();
  const token = jar.get(SUBSCRIBER_SESSION_COOKIE)?.value;
  const session = await validateSession(token);
  if (!session) return null;

  const { data, error } = await supabaseAdmin()
    .from("subscribers")
    .select("id, email, stripe_customer_id, is_admin")
    .eq("id", session.subscriber_id)
    .maybeSingle<{ id: string; email: string; stripe_customer_id: string | null; is_admin: boolean | null }>();
  if (error) throw new Error(`getSessionSubscriber: ${error.message}`);
  if (!data) return null;
  return { id: data.id, email: data.email, stripeCustomerId: data.stripe_customer_id, isAdmin: data.is_admin === true };
}
