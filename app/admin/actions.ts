"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDigest } from "@/lib/digests";
import { sendEmail } from "@/lib/email";
import { dailyEmail, teamDailyEmail } from "@/lib/emails/templates";
import { nextDay, prettyDate, isValidIsoDate, yesterdayInET } from "@/lib/dates";
import { renderShareImages } from "@/lib/render-images";
import { uploadShareImages } from "@/lib/share-storage";
import { EMAIL_LINK_BASE, siteOrigin } from "@/lib/site";
import { supabaseAdmin } from "@/lib/supabase";
import { findTeam, type Sport } from "@/lib/teams";
import { loadTeamEmailData, renderTeamEmailContent } from "@/lib/render-team-email";
import { requireAdmin } from "./require-admin";

export async function sendAdminPreview(
  date: string,
  sport: string = "mlb",
  returnTo: string = "/admin",
): Promise<void> {
  // requireAdmin() returns the currently-signed-in admin's email — that's
  // who gets the preview, replacing the previous ADMIN_EMAIL env-var lookup.
  // It's called outside the try/catch because its redirect-on-no-session
  // shouldn't be swallowed as a generic error.
  const adminEmail = await requireAdmin();

  // Redirect must happen outside try/catch — Next.js implements redirects via
  // a thrown signal that would otherwise get swallowed.
  let target: string;
  try {
    if (!isValidIsoDate(date)) throw new Error(`Bad date: ${date}`);

    const digest = await getDigest(sport, date);
    if (!digest || !digest.email_html) {
      throw new Error(`No email_html for ${sport}/${date}`);
    }

    const { getAnnouncement } = await import("@/lib/announcements");
    const announcementBanner = (await getAnnouncement(sport, date)) ?? undefined;
    // Admin preview emails should match what subscribers get — bake links
    // to https://boxscore.email/… even when running locally.
    const { subject, html, text } = dailyEmail({
      sport,
      digestDate: date,
      digestPrettyDate: prettyDate(date),
      digestUrl: `${EMAIL_LINK_BASE}/${sport}/${nextDay(date)}`,
      unsubscribeUrl: `${EMAIL_LINK_BASE}/u/admin-preview`,
      manageUrl: `${EMAIL_LINK_BASE}/settings`,
      announcementBanner,
      digestEmailHtml: digest.email_html,
    });

    await sendEmail({
      to: adminEmail,
      subject: `[ADMIN PREVIEW] ${subject}`,
      html,
      text,
    });

    target = `${returnTo}?ok=${encodeURIComponent(`Sent ${sport}/${prettyDate(date)} digest to ${adminEmail}.`)}`;
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[send-admin-preview] ${sport}/${date} FAILED: ${msg}`);
    target = `${returnTo}?error=${encodeURIComponent(msg)}`;
  }
  redirect(target);
}

// Renders + emails a single team's digest to the signed-in admin. Mirrors
// sendAdminPreview but routes through loadTeamEmailData/renderTeamEmailContent
// rather than the cached league digest, so we can dogfood team emails before
// any team-send cron has fired (and on dates where the team's row would be
// skipped as "empty" by the send cron — preview still emails it).
export async function sendTeamAdminPreview(
  date: string,
  sport: string = "mlb",
  teamSlug: string = "",
  returnTo: string = "/admin",
): Promise<void> {
  const adminEmail = await requireAdmin();

  let target: string;
  try {
    if (!isValidIsoDate(date)) throw new Error(`Bad date: ${date}`);
    if (sport !== "mlb") throw new Error(`Team preview only wired for MLB`);
    const team = findTeam(sport as Sport, teamSlug);
    if (!team) throw new Error(`Unknown team: ${sport}/${teamSlug}`);

    const data = await loadTeamEmailData(team, date);
    const body = renderTeamEmailContent(data);
    const { getAnnouncement } = await import("@/lib/announcements");
    const announcementBanner = (await getAnnouncement(sport, date)) ?? undefined;
    const { subject, html, text } = teamDailyEmail({
      teamName: team.name,
      digestDate: date,
      digestPrettyDate: prettyDate(date),
      digestUrl: `${EMAIL_LINK_BASE}/${sport}/${team.slug}/${nextDay(date)}`,
      unsubscribeUrl: `${EMAIL_LINK_BASE}/u/admin-preview`,
      manageUrl: `${EMAIL_LINK_BASE}/settings`,
      announcementBanner,
      digestEmailHtml: body,
    });

    await sendEmail({
      to: adminEmail,
      subject: `[ADMIN PREVIEW] ${subject}`,
      html,
      text,
    });

    target = `${returnTo}?ok=${encodeURIComponent(`Sent ${team.abbreviation}/${prettyDate(date)} digest to ${adminEmail}.`)}`;
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[send-team-admin-preview] ${sport}/${teamSlug}/${date} FAILED: ${msg}`);
    target = `${returnTo}?error=${encodeURIComponent(msg)}`;
  }
  redirect(target);
}

// Trigger a cron route on demand. Calls the existing route handler over HTTP
// with the CRON_SECRET auth header so the route logs to cron_runs the same
// way a scheduled run would (with trigger="manual"). Awaits the result so the
// admin gets a redirect with success/error flash.
//
// Sport defaults to "mlb" for back-compat with any caller that doesn't pass
// it explicitly. Per-league admin pages (/admin/[sport]) set both `sport`
// and `returnTo` via hidden form fields so the run is attributed correctly
// and the flash lands back on the originating page.
export async function triggerCron(formData: FormData): Promise<void> {
  const route = String(formData.get("route") ?? "");
  const rawDate = formData.get("date");
  const date = typeof rawDate === "string" && rawDate ? rawDate : yesterdayInET();
  const reset = formData.get("reset") === "1";
  const force = formData.get("force") === "1";
  const sport = String(formData.get("sport") ?? "mlb");
  const returnToRaw = formData.get("returnTo");
  const returnTo =
    typeof returnToRaw === "string" && returnToRaw.startsWith("/") ? returnToRaw : "/admin";

  let target: string;
  try {
    if (!["generate", "send-email", "send-team-email", "post-bluesky", "post-twitter", "post-facebook"].includes(route)) {
      throw new Error(`Unknown cron route: ${route}`);
    }
    if (!["mlb", "nba", "wnba"].includes(sport)) {
      throw new Error(`Unknown sport: ${sport}`);
    }
    if (!isValidIsoDate(date)) throw new Error(`Bad date: ${date}`);

    const origin = await siteOrigin();
    const params = new URLSearchParams({ trigger: "manual", date, sport });
    if (reset) params.set("reset", "1");
    // Manual Regen should always hit MLB/ESPN fresh. Without refetch=true,
    // the generator reuses whatever's in daily_raw — which is exactly the
    // stale row a "Regen" click is trying to fix.
    if (route === "generate") params.set("refetch", "true");
    // Force resend: only for the guarded send routes, opt-in from the
    // confirm modal. Bypasses the already-sent filter so the second send
    // reaches subscribers who got an earlier (bad) version.
    if (force && (route === "send-email" || route === "send-team-email")) {
      params.set("force", "true");
    }
    const url = `${origin}/api/cron/${route}?${params}`;

    const headers: HeadersInit = {};
    const secret = process.env.CRON_SECRET;
    if (secret) headers.Authorization = `Bearer ${secret}`;

    const res = await fetch(url, { headers });
    const body = (await res.json()) as { error?: string; ok?: boolean } & Record<string, unknown>;
    if (!res.ok || body.error) {
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    target = `${returnTo}?ok=${encodeURIComponent(`${route} ${sport}/${date} → ${JSON.stringify(body)}`)}`;
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[trigger-cron] ${route} ${sport} ${date}: ${msg}`);
    target = `${returnTo}?error=${encodeURIComponent(`${route}: ${msg}`)}`;
  }
  redirect(target);
}

// Save (or clear) an announcement banner. Scope is decided by the
// `apply_all` form field — when "1" the row is written under sport='*'
// (global, applies to every sport's send for the date); otherwise it's
// written under the page's sport. Empty/whitespace HTML clears the row.
export async function setAnnouncement(formData: FormData): Promise<void> {
  await requireAdmin();
  const pageSport = String(formData.get("sport") ?? "mlb");
  const applyAll = formData.get("apply_all") === "1";
  const date = String(formData.get("date") ?? "");
  const html = String(formData.get("html") ?? "");
  const returnToRaw = formData.get("returnTo");
  const returnTo =
    typeof returnToRaw === "string" && returnToRaw.startsWith("/") ? returnToRaw : `/admin/${pageSport}`;

  // The actual sport value we write under. "*" for global; the page's sport
  // otherwise. /admin/[sport] always passes one of mlb/nba/wnba.
  const scope = applyAll ? "*" : pageSport;
  const label = applyAll ? "all sports" : pageSport;

  let target: string;
  try {
    if (!isValidIsoDate(date)) throw new Error(`Bad date: ${date}`);
    if (!applyAll && !["mlb", "nba", "wnba"].includes(pageSport)) {
      throw new Error(`Unknown sport: ${pageSport}`);
    }
    const { upsertAnnouncement, deleteAnnouncement } = await import("@/lib/announcements");
    const trimmed = html.trim();
    if (trimmed.length === 0) {
      await deleteAnnouncement(scope, date);
      target = `${returnTo}?ok=${encodeURIComponent(`Announcement for ${label}/${date} cleared.`)}`;
    } else {
      await upsertAnnouncement({ sport: scope, date, html: trimmed });
      target = `${returnTo}?ok=${encodeURIComponent(`Announcement saved for ${label}/${date} (${trimmed.length} chars).`)}`;
    }
  } catch (err) {
    target = `${returnTo}?error=${encodeURIComponent(`announcement: ${(err as Error).message}`)}`;
  }
  redirect(target);
}

// Direct delete from the announcements list on /admin/[sport]. Takes the
// row's (sport, date) — sport may be "*" for a global row — and removes
// it. Avoids forcing the operator to switch the form's date input and
// re-save an empty value just to clear an existing row.
export async function removeAnnouncement(formData: FormData): Promise<void> {
  await requireAdmin();
  const scope = String(formData.get("scope") ?? "");
  const date = String(formData.get("date") ?? "");
  const pageSport = String(formData.get("pageSport") ?? "mlb");
  const returnToRaw = formData.get("returnTo");
  const returnTo =
    typeof returnToRaw === "string" && returnToRaw.startsWith("/") ? returnToRaw : `/admin/${pageSport}`;

  let target: string;
  try {
    if (!isValidIsoDate(date)) throw new Error(`Bad date: ${date}`);
    if (!["mlb", "nba", "wnba", "*"].includes(scope)) {
      throw new Error(`Unknown scope: ${scope}`);
    }
    const { deleteAnnouncement } = await import("@/lib/announcements");
    await deleteAnnouncement(scope, date);
    const label = scope === "*" ? "all sports" : scope;
    target = `${returnTo}?ok=${encodeURIComponent(`Announcement for ${label}/${date} cleared.`)}`;
  } catch (err) {
    target = `${returnTo}?error=${encodeURIComponent(`remove-announcement: ${(err as Error).message}`)}`;
  }
  redirect(target);
}

// Single-date regenerate, invoked from the client-side bulk runner. When
// includeTeams is false (default), passes skip_teams=1 so the iteration is
// sub-second per date. When true, hits the full generate path — ~20s/date
// for MLB because each call also rebuilds 30 team_digests rows. The runner
// surfaces this choice via a checkbox.
export async function regenerateOneDigest(
  sport: string,
  date: string,
  includeTeams = false,
): Promise<{ ok: boolean; error?: string }> {
  if (!["mlb", "nba", "wnba"].includes(sport)) {
    return { ok: false, error: `Unknown sport: ${sport}` };
  }
  if (!isValidIsoDate(date)) {
    return { ok: false, error: `Invalid date: ${date}` };
  }

  const origin = await siteOrigin();
  const headers: HeadersInit = {};
  const secret = process.env.CRON_SECRET;
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const params = new URLSearchParams({ date, sport, trigger: "manual" });
  if (!includeTeams) params.set("skip_teams", "1");
  // Force a fresh MLB/ESPN fetch — the whole point of clicking Regen is
  // to bypass the cached daily_raw row.
  params.set("refetch", "true");

  try {
    const res = await fetch(`${origin}/api/cron/generate?${params}`, { headers });
    const body = (await res.json()) as { error?: string };
    if (!res.ok || body.error) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// Legacy synchronous bulk regenerate — invoked from the /admin/[sport]
// "Regenerate all" form when there's no client-side runner. The runner is
// preferred since it gives the operator visible progress; this stays as a
// fallback for browsers that don't run the client component for any reason.
export async function regenerateAllDigests(formData: FormData): Promise<void> {
  const sport = String(formData.get("sport") ?? "mlb");
  const returnToRaw = formData.get("returnTo");
  const returnTo =
    typeof returnToRaw === "string" && returnToRaw.startsWith("/") ? returnToRaw : `/admin/${sport}`;

  let target: string;
  try {
    if (!["mlb", "nba", "wnba"].includes(sport)) {
      throw new Error(`Unknown sport: ${sport}`);
    }

    const { supabaseAdmin } = await import("@/lib/supabase");
    const { data, error } = await supabaseAdmin()
      .from("daily_digests")
      .select("date,sport")
      .eq("sport", sport)
      .order("date", { ascending: true });
    if (error) throw new Error(`query digests: ${error.message}`);
    const rows = (data ?? []) as Array<{ date: string; sport: string }>;
    if (rows.length === 0) {
      target = `${returnTo}?ok=${encodeURIComponent(`No ${sport} digests to regenerate.`)}`;
      redirect(target);
    }

    const origin = await siteOrigin();
    const headers: HeadersInit = {};
    const secret = process.env.CRON_SECRET;
    if (secret) headers.Authorization = `Bearer ${secret}`;

    const t0 = Date.now();
    let ok = 0, fail = 0;
    const failures: string[] = [];
    // Sequential — MLB API responses are cached server-side, so each call is
    // sub-second. Total time for ~50 dates is well under the 60s budget.
    for (const row of rows) {
      try {
        const res = await fetch(
          `${origin}/api/cron/generate?date=${row.date}&sport=${row.sport}&trigger=manual&skip_teams=1&refetch=true`,
          { headers },
        );
        const body = (await res.json()) as { error?: string };
        if (!res.ok || body.error) {
          fail++;
          failures.push(`${row.date}: ${body.error ?? `HTTP ${res.status}`}`);
        } else {
          ok++;
        }
      } catch (err) {
        fail++;
        failures.push(`${row.date}: ${(err as Error).message}`);
      }
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const msg = fail === 0
      ? `Regenerated ${ok} ${sport} digests in ${elapsed}s.`
      : `Regenerated ${ok} of ${rows.length} ${sport} digests in ${elapsed}s. Failures: ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "…" : ""}`;
    target = fail === 0
      ? `${returnTo}?ok=${encodeURIComponent(msg)}`
      : `${returnTo}?error=${encodeURIComponent(msg)}`;
  } catch (err) {
    target = `${returnTo}?error=${encodeURIComponent(`regenerate-all: ${(err as Error).message}`)}`;
  }
  redirect(target);
}

export async function regenerateShareImages(formData: FormData): Promise<void> {
  const raw = formData.get("date");
  const date = typeof raw === "string" && raw ? raw : yesterdayInET();

  let target: string;
  try {
    if (!isValidIsoDate(date)) throw new Error(`Bad date: ${date}`);

    const origin = await siteOrigin();
    console.log(`[regen] start ${date} origin=${origin}`);

    const t0 = Date.now();
    const images = await renderShareImages({ date, baseUrl: origin });
    console.log(`[regen] rendered ${images.length} images in ${Date.now() - t0}ms`);

    const t1 = Date.now();
    await uploadShareImages({ date, prettyDate: prettyDate(date), images });
    console.log(`[regen] uploaded in ${Date.now() - t1}ms`);

    revalidatePath("/admin/images");
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    target = `/admin/images?ok=${encodeURIComponent(`Generated ${images.length} images for ${date} in ${elapsed}s.`)}`;
  } catch (err) {
    const msg = (err as Error).message;
    const stack = (err as Error).stack ?? "";
    console.error(`[regen] FAILED for ${date}: ${msg}\n${stack}`);
    target = `/admin/images?error=${encodeURIComponent(msg)}`;
  }
  redirect(target);
}

// Recipient-email lookup for the /admin search box. Returns the most recent
// production sends for any subscriber whose email matches the query. Each row
// rolls up: status (delivered/bounced/delayed/complained/pending/failed),
// subject (reconstructed from sport + digest date), and sent-at timestamp.
//
// Admin previews aren't recorded in `sends`, so they never appear here. The
// search is case-insensitive substring; pasting a full email returns the
// usual 0–1 matches, partial input returns up to 50 ordered by recency.

export type SendStatus =
  | "delivered" | "bounced" | "delayed" | "complained" | "pending" | "failed";

export type SendSearchRow = {
  id: string;
  to: string;
  subject: string;
  status: SendStatus;
  sentAt: string;
};

export async function searchSends(query: string): Promise<SendSearchRow[]> {
  await requireAdmin();
  const q = query.trim();
  // Substring search at <3 chars would page through too much of the table;
  // the input enforces this client-side but verify here too.
  if (q.length < 3) return [];

  const db = supabaseAdmin();

  // 1. Subscribers matching the substring. Order by created_at desc so older
  // dormant accounts don't crowd out a recently active match.
  const { data: subs, error: subsErr } = await db
    .from("subscribers")
    .select("id, email")
    .ilike("email", `%${q}%`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (subsErr) throw new Error(`searchSends subs: ${subsErr.message}`);
  const subRows = (subs ?? []) as Array<{ id: string; email: string }>;
  if (subRows.length === 0) return [];
  const emailById = new Map(subRows.map((s) => [s.id, s.email]));

  // 2. Their sends, most recent first.
  type SendRow = {
    id: string;
    subscriber_id: string;
    digest_sport: string;
    digest_date: string;
    sent_at: string;
    resend_id: string | null;
    error: string | null;
  };
  const { data: sends, error: sendsErr } = await db
    .from("sends")
    .select("id, subscriber_id, digest_sport, digest_date, sent_at, resend_id, error")
    .in("subscriber_id", subRows.map((s) => s.id))
    .order("sent_at", { ascending: false })
    .limit(50);
  if (sendsErr) throw new Error(`searchSends sends: ${sendsErr.message}`);
  const sendRows = (sends ?? []) as SendRow[];
  if (sendRows.length === 0) return [];

  // 3. Terminal/engagement events keyed by resend_id, so we can derive the
  // displayed status without a per-row query.
  const resendIds = sendRows.map((s) => s.resend_id).filter((r): r is string => Boolean(r));
  const eventsByResendId: Record<string, Set<string>> = {};
  if (resendIds.length > 0) {
    const { data: events, error: evErr } = await db
      .from("email_events")
      .select("resend_id, event_type")
      .in("resend_id", resendIds);
    if (evErr) throw new Error(`searchSends events: ${evErr.message}`);
    for (const ev of (events ?? []) as Array<{ resend_id: string; event_type: string }>) {
      (eventsByResendId[ev.resend_id] ??= new Set()).add(ev.event_type);
    }
  }

  return sendRows.map<SendSearchRow>((s) => {
    const evts = s.resend_id ? eventsByResendId[s.resend_id] ?? new Set<string>() : new Set<string>();
    // Precedence puts hard signals before soft ones. complained beats
    // delivered (a complaint after delivery still indicates a problem);
    // failed (API-level rejection) beats everything since the email never
    // left Resend.
    const status: SendStatus = s.error ? "failed"
      : evts.has("email.complained") ? "complained"
      : evts.has("email.bounced") ? "bounced"
      : evts.has("email.delivered") ? "delivered"
      : evts.has("email.delivery_delayed") ? "delayed"
      : "pending";

    return {
      id: s.id,
      to: emailById.get(s.subscriber_id) ?? "(unknown)",
      subject: `${s.digest_sport.toUpperCase()} - ${prettyDate(s.digest_date)}`,
      status,
      sentAt: s.sent_at,
    };
  });
}
