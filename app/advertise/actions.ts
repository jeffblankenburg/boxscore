"use server";

import { headers } from "next/headers";
import { sendEmail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabase";
import { enrichFromDomain } from "@/lib/advertise-enrichment";
import { BUDGETS, FORMATS } from "./options";

const INBOX = process.env.ADVERTISE_INBOX_EMAIL ?? "hello@boxscore.email";

const BUDGET_SET: ReadonlySet<string> = new Set(BUDGETS);
const FORMAT_SET: ReadonlySet<string> = new Set(FORMATS);

export type InquiryResult =
  | { ok: true }
  | { ok: false; error: string };

// Reads the public client IP from the standard Vercel / proxy chain.
// Falls back to null if none of the expected headers are present (local
// dev without a reverse proxy). x-forwarded-for can be a comma-separated
// list — the leftmost entry is the original client.
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip") ?? h.get("cf-connecting-ip") ?? null;
}

export async function submitAdInquiry(formData: FormData): Promise<InquiryResult> {
  // Honeypot: real browsers leave this empty; bots fill every input. If it's
  // set, silently report success and drop the message — no point telling a
  // bot it was flagged.
  const trap = String(formData.get("website") ?? "").trim();
  if (trap.length > 0) return { ok: true };

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const budget = String(formData.get("budget") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const formats = formData.getAll("formats").map(String).filter(Boolean);

  if (name.length < 2) return { ok: false, error: "Please share your name." };
  if (!email.includes("@") || email.length < 5) {
    return { ok: false, error: "Please share a working email so we can reply." };
  }
  if (message.length < 10) {
    return { ok: false, error: "Tell us a bit more about what you're looking for (at least a sentence)." };
  }
  if (budget && !BUDGET_SET.has(budget)) {
    return { ok: false, error: "Invalid budget selection." };
  }
  for (const f of formats) {
    if (!FORMAT_SET.has(f)) return { ok: false, error: "Invalid format selection." };
  }

  // Attribution fields posted from the client. All optional — older
  // clients or stripped sessions will just send empty strings.
  const attrStr = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v.length > 0 ? v.slice(0, 1024) : null;
  };
  const h = await headers();
  const userAgent = h.get("user-agent");
  const ip = await clientIp();

  // Enrich synchronously — domain parsing only, no network call. If we
  // later add an API enrichment, swap this out for an async path.
  const enrichment = enrichFromDomain(email);

  // Persist FIRST so a downstream email failure doesn't lose the lead.
  // Email still ships best-effort below.
  let savedId: string | null = null;
  try {
    const { data, error } = await supabaseAdmin()
      .from("advertise_inquiries")
      .insert({
        name, email, company: company || null, budget: budget || null,
        formats, message,
        utm_source:      attrStr("utm_source"),
        utm_medium:      attrStr("utm_medium"),
        utm_campaign:    attrStr("utm_campaign"),
        utm_term:        attrStr("utm_term"),
        utm_content:     attrStr("utm_content"),
        referer:         attrStr("referer"),
        landing_path:    attrStr("landing_path"),
        posthog_session: attrStr("posthog_session"),
        user_agent:      userAgent ? userAgent.slice(0, 1024) : null,
        ip_address:      ip,
        ...enrichment,
        enriched_at:     new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) {
      console.error(`[advertise inquiry] persist failed: ${error.message}`);
    } else {
      savedId = (data as { id: string } | null)?.id ?? null;
    }
  } catch (err) {
    console.error(`[advertise inquiry] persist threw: ${(err as Error).message}`);
  }

  // Pick the best company label for the subject — prefer what the
  // person typed; fall back to the enriched-from-domain guess.
  const companyLabel = company || enrichment.enrichment_company || null;
  const subject = `[advertise] ${name}${companyLabel ? ` (${companyLabel})` : ""}`;

  // Source line for the email body — same data /admin/leads renders.
  const sourceParts: string[] = [];
  const utmSource = attrStr("utm_source"), utmMedium = attrStr("utm_medium");
  const utmCampaign = attrStr("utm_campaign");
  if (utmSource)   sourceParts.push(`utm_source=${utmSource}`);
  if (utmMedium)   sourceParts.push(`utm_medium=${utmMedium}`);
  if (utmCampaign) sourceParts.push(`utm_campaign=${utmCampaign}`);
  const referer = attrStr("referer");
  if (sourceParts.length === 0 && referer) sourceParts.push(`referer=${referer}`);
  const landingPath = attrStr("landing_path");
  if (landingPath && landingPath !== "/advertise") sourceParts.push(`landed=${landingPath}`);
  const sourceLine = sourceParts.length > 0 ? sourceParts.join(" · ") : "direct";

  const lines = [
    `From: ${name} <${email}>`,
    company ? `Company (typed): ${company}` : null,
    enrichment.enrichment_domain ? `Domain: ${enrichment.enrichment_domain}` : null,
    enrichment.enrichment_company && !company ? `Company (guessed): ${enrichment.enrichment_company}` : null,
    budget ? `Budget: ${budget}` : null,
    formats.length > 0 ? `Formats: ${formats.join(", ")}` : null,
    `Source: ${sourceLine}`,
    savedId ? `Lead: https://boxscore.email/admin/ads/leads#${savedId}` : null,
    "",
    message,
  ].filter((l): l is string => l !== null);
  const text = lines.join("\n");
  const html = `<pre style="font-family: ui-monospace, monospace; white-space: pre-wrap;">${
    escapeHtml(text)
  }</pre>`;

  try {
    await sendEmail({
      to: INBOX,
      subject,
      html,
      text,
      headers: { "Reply-To": email },
    });
    // Mark notified so a future "missed-notification" sweep doesn't
    // re-send to Jeff. Only attempted when the row actually persisted.
    if (savedId) {
      await supabaseAdmin()
        .from("advertise_inquiries")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", savedId);
    }
    return { ok: true };
  } catch (err) {
    console.error(`[advertise inquiry] email failed: ${(err as Error).message}`);
    // Inquiry is still saved (if persist succeeded). Treat the submission
    // as successful — Jeff will see it in /admin/leads even without email.
    if (savedId) return { ok: true };
    return { ok: false, error: "Couldn't send the message — try again, or email hello@boxscore.email directly." };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

