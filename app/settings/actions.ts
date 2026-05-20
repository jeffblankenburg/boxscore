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
import {
  setLeagueSubscription,
  setTeamSubscription as upsertTeamSubscription,
} from "@/lib/email-subscriptions";
import { getSportById } from "@/lib/sports";
import { findTeam, type Sport } from "@/lib/teams";

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
 * Refuses to toggle on an admin_only sport unless the caller's subscribers
 * row has is_admin=true — keeps a non-admin user from sneaking into the
 * dogfood list by crafting a POST.
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
    // Confirm the caller is an admin (DB-backed) before allowing the
    // admin-only opt-in.
    const { data: sub } = await supabaseAdmin()
      .from("subscribers")
      .select("is_admin")
      .eq("id", session.subscriber_id)
      .maybeSingle<{ is_admin: boolean }>();
    if (sub?.is_admin !== true) redirect("/settings?error=forbidden");
  }

  await setLeagueSubscription(session.subscriber_id, sport.id, next === "on");
  redirect("/settings");
}

/**
 * Toggle a subscriber's opt-in for a single team's digest. Hidden form values:
 *   sport: the sport id (e.g. "mlb")
 *   team:  the team slug (e.g. "cle")
 *   next:  "on" | "off"
 *
 * Same admin-only guard as setSportSubscription for sports with
 * visibility='admin_only'. Validates the team exists for the sport via the
 * static team registry — a crafted POST with an unknown team can't write
 * garbage rows.
 *
 * Team subscriptions are intentionally independent of the league digest: a
 * subscriber can opt into one team without the league digest, or vice versa.
 */
export async function setTeamSubscription(formData: FormData) {
  const sportId = formData.get("sport");
  const teamSlug = formData.get("team");
  const next = formData.get("next");
  if (
    typeof sportId !== "string" ||
    typeof teamSlug !== "string" ||
    (next !== "on" && next !== "off")
  ) {
    redirect("/settings?error=invalid_toggle");
  }

  const jar = await cookies();
  const sessionToken = jar.get(SUBSCRIBER_SESSION_COOKIE)?.value;
  const session = await validateSession(sessionToken);
  if (!session) redirect("/settings");

  const sport = await getSportById(sportId as string);
  if (!sport) redirect("/settings?error=unknown_sport");

  const team = findTeam(sport.id as Sport, teamSlug as string);
  if (!team) redirect("/settings?error=unknown_team");

  if (sport.visibility === "admin_only") {
    const { data: sub } = await supabaseAdmin()
      .from("subscribers")
      .select("is_admin")
      .eq("id", session.subscriber_id)
      .maybeSingle<{ is_admin: boolean }>();
    if (sub?.is_admin !== true) redirect("/settings?error=forbidden");
  }

  await upsertTeamSubscription(session.subscriber_id, sport.id, team.slug, next === "on");
  redirect("/settings");
}
