"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { findByEmail, startSubscription, type SubscriberAttribution } from "@/lib/subscribers";
import { applyInitialSubscriptions } from "@/lib/email-subscriptions";
import { sendEmail } from "@/lib/email";
import { confirmationEmail } from "@/lib/emails/templates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { requestMagicLink } from "@/lib/subscriber-auth";
import { isSportVisible } from "@/lib/sports";
import { findTeam, type Sport } from "@/lib/teams";
import { checkSubscribeRate, recordSubscribeAttempt } from "@/lib/subscribe-rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-field caps for attribution. utm_* in the wild rarely exceed 64 chars;
// referrer (full URL) and landing_path (pathname only) can be longer but we
// truncate to keep a crafted POST from writing megabytes.
const ATTR_LIMITS: Record<keyof SubscriberAttribution, number> = {
  utm_source: 128,
  utm_medium: 128,
  utm_campaign: 256,
  utm_content: 256,
  utm_term: 256,
  referrer: 512,
  landing_path: 256,
};

function readAttribution(formData: FormData): SubscriberAttribution {
  const read = (key: keyof SubscriberAttribution): string | null => {
    const v = formData.get(key);
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    if (trimmed === "") return null;
    return trimmed.slice(0, ATTR_LIMITS[key]);
  };
  return {
    utm_source: read("utm_source"),
    utm_medium: read("utm_medium"),
    utm_campaign: read("utm_campaign"),
    utm_content: read("utm_content"),
    utm_term: read("utm_term"),
    referrer: read("referrer"),
    landing_path: read("landing_path"),
  };
}

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

  // Rate limit before we touch subscribers / Resend. Blocks list-bombing
  // (attacker fires arbitrary emails to burn our sender reputation) and
  // enumeration probes. The check happens AFTER validation so a malformed
  // POST doesn't inflate the counter.
  const hSubs = await headers();
  const fwdSubs = hSubs.get("x-forwarded-for");
  const ipSubs = fwdSubs ? (fwdSubs.split(",")[0]?.trim() ?? null) : (hSubs.get("x-real-ip") ?? null);
  const rate = await checkSubscribeRate({ ip: ipSubs, email });
  if (!rate.ok) {
    // Silent redirect to the "check your email" page. Don't leak whether
    // it was IP or email that tripped — an attacker could probe either.
    redirect("/subscribe/sent");
  }
  await recordSubscribeAttempt({ ip: ipSubs, email });

  const existing = await findByEmail(email);

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
      buildUrl: (token) => `${EMAIL_LINK_BASE}/auth/${token}`,
    });
    redirect("/subscribe/sent?mode=signin");
  }

  // Acquisition attribution. Populated by app/subscribe/AttributionFields.tsx
  // from the sessionStorage write the root-layout script makes on first
  // page-load of the session. Bounded length on each field guards against a
  // crafted POST trying to bloat the row; UTMs in the wild are rarely above
  // 64 chars and referrer/landing_path stay well under 512.
  const attribution = readAttribution(formData);

  // New / pending / unsubscribed → confirmation flow. startSubscription
  // upserts the row to pending and rotates tokens. applyInitialSubscriptions
  // replaces any existing opt-in state with what they picked (per Jeff: a
  // returning unsub re-picking only MLB should have Guardians removed).
  // Attribution is only written for genuinely-new rows (see startSubscription).
  const subscriber = await startSubscription(email, attribution);
  await applyInitialSubscriptions(subscriber.id, { leagues, teams });

  const confirmUrl = `${EMAIL_LINK_BASE}/c/${subscriber.confirm_token}`;
  const { subject, html, text } = confirmationEmail({ confirmUrl });
  await sendEmail({ to: subscriber.email, subject, html, text });

  redirect("/subscribe/sent");
}
