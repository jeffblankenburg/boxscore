"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { findByEmail, startSubscription } from "@/lib/subscribers";
import { applyInitialSubscriptions } from "@/lib/email-subscriptions";
import { sendEmail } from "@/lib/email";
import { confirmationEmail } from "@/lib/emails/templates";
import { siteOrigin } from "@/lib/site";
import { requestMagicLink } from "@/lib/subscriber-auth";
import { isSportVisible } from "@/lib/sports";
import { findTeam, type Sport } from "@/lib/teams";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// /subscribe POST. The page form carries:
//   email         — the address to subscribe
//   leagues[]     — sport ids checked (e.g. ["mlb"])
//   teams[]       — "{sport}:{slug}" pairs (e.g. ["mlb:cle"])
//
// Dispatch by the address's current status:
//   active        → silent sign-in. We email a magic-link to /settings and
//                   route them to /subscribe/sent?mode=signin. NO error,
//                   NO re-pendinging — they're already a subscriber, the
//                   picker on /subscribe is for new signups.
//   pending       → upsert pending row with new tokens, replace opt-ins,
//                   send confirmation.
//   unsubscribed  → same as pending — they're resubscribing with fresh
//                   picks, prior choices get fully replaced.
//   new           → create pending row, write picks, send confirmation.
//
// Picks are validated against the public sport/team registry server-side so
// a crafted POST can't write opt-in rows for hidden or unknown values.
export async function subscribe(formData: FormData): Promise<void> {
  const rawEmail = formData.get("email");
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  if (!EMAIL_RE.test(email)) {
    redirect("/subscribe?error=invalid_email");
  }

  const rawLeagues = formData.getAll("leagues").filter((v): v is string => typeof v === "string");
  const rawTeams = formData.getAll("teams").filter((v): v is string => typeof v === "string");

  // Filter to known-visible sports. Anything else is silently dropped so a
  // crafted POST with "?leagues=admin_only_sport" can't sneak through.
  const leagues: string[] = [];
  for (const id of rawLeagues) {
    if (await isSportVisible(id, { includeAdminOnly: false })) {
      leagues.push(id);
    }
  }

  // Parse "sport:slug" pairs and confirm each team is real for its sport.
  const teams: Array<{ sport: string; slug: string }> = [];
  for (const pair of rawTeams) {
    const [sport, slug] = pair.split(":", 2);
    if (!sport || !slug) continue;
    if (!(await isSportVisible(sport, { includeAdminOnly: false }))) continue;
    if (!findTeam(sport as Sport, slug)) continue;
    teams.push({ sport, slug });
  }

  // Empty pickers aren't a valid subscribe — would create a dead account
  // that receives nothing. Surface as an error instead of silently signing
  // them up to no digests.
  if (leagues.length === 0 && teams.length === 0) {
    redirect("/subscribe?error=no_picks");
  }

  const existing = await findByEmail(email);
  const origin = await siteOrigin();

  if (existing && existing.status === "active") {
    // Already a subscriber — quietly issue a sign-in link. They were given a
    // "Manage your subscription" link at the top of /subscribe; this is the
    // fallback for people who filled out the form anyway. No errors, no
    // re-pendinging, no overwriting their existing prefs.
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    const ip = fwd ? (fwd.split(",")[0]?.trim() ?? null) : (h.get("x-real-ip") ?? null);
    await requestMagicLink({
      email,
      ip,
      buildUrl: (token) => `${origin}/auth/${token}`,
    });
    redirect("/subscribe/sent?mode=signin");
  }

  // New / pending / unsubscribed → confirmation flow. startSubscription
  // upserts the row to pending and rotates tokens. applyInitialSubscriptions
  // replaces any existing opt-in state with what they picked (per Jeff: a
  // returning unsub re-picking only MLB should have Guardians removed).
  const subscriber = await startSubscription(email);
  await applyInitialSubscriptions(subscriber.id, { leagues, teams });

  const confirmUrl = `${origin}/c/${subscriber.confirm_token}`;
  const { subject, html, text } = confirmationEmail({ confirmUrl });
  await sendEmail({ to: subscriber.email, subject, html, text });

  redirect("/subscribe/sent");
}
