"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { siteOrigin } from "@/lib/site";
import { supabaseAdmin } from "@/lib/supabase";
import {
  requestMagicLink,
  validateEmail,
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { setLeagueSubscription } from "@/lib/email-subscriptions";
import { getSportById } from "@/lib/sports";

export async function requestSignInLink(formData: FormData) {
  const rawEmail = formData.get("email");
  if (typeof rawEmail !== "string" || validateEmail(rawEmail) !== "valid") {
    redirect("/settings?error=invalid_email");
  }
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const ip = fwd ? (fwd.split(",")[0]?.trim() ?? null) : (h.get("x-real-ip") ?? null);
  const origin = await siteOrigin();
  await requestMagicLink({
    email: rawEmail,
    ip,
    buildUrl: (token) => `${origin}/auth/${token}`,
  });
  redirect("/settings?sent=1");
}

/**
 * Toggle a subscriber's league opt-in for a sport. Hidden-form values:
 *   sport: the sport id (e.g. "mlb", "nba")
 *   next:  "on" | "off"
 *
 * Refuses to toggle on an admin_only sport unless the caller's email matches
 * ADMIN_EMAIL — keeps a non-admin user from sneaking into the dogfood list
 * by manually crafting a POST.
 */
export async function setSportSubscription(formData: FormData) {
  const sportId = formData.get("sport");
  const next = formData.get("next");
  if (typeof sportId !== "string" || (next !== "on" && next !== "off")) {
    redirect("/settings?error=invalid_toggle");
  }

  const jar = await cookies();
  const sessionToken = jar.get(SUBSCRIBER_SESSION_COOKIE)?.value;
  const session = await validateSession(sessionToken);
  if (!session) redirect("/settings");

  const sport = await getSportById(sportId as string);
  if (!sport) redirect("/settings?error=unknown_sport");

  if (sport.visibility === "admin_only") {
    // Confirm the caller is the admin before allowing dogfood opt-in.
    const { data: sub } = await supabaseAdmin()
      .from("subscribers")
      .select("email")
      .eq("id", session.subscriber_id)
      .maybeSingle<{ email: string }>();
    const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
    const isAdmin = !!sub && !!adminEmail && sub.email.toLowerCase() === adminEmail;
    if (!isAdmin) redirect("/settings?error=forbidden");
  }

  await setLeagueSubscription(session.subscriber_id, sport.id, next === "on");
  redirect("/settings");
}
