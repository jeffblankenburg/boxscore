"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDigest } from "@/lib/digests";
import { sendEmail } from "@/lib/email";
import { dailyEmail } from "@/lib/emails/templates";
import { prettyDate, isValidIsoDate, yesterdayInET } from "@/lib/dates";
import { renderShareImages } from "@/lib/render-images";
import { uploadShareImages } from "@/lib/share-storage";
import { siteOrigin } from "@/lib/site";

export async function sendAdminPreview(date: string): Promise<void> {
  // Redirect must happen outside try/catch — Next.js implements redirects via
  // a thrown signal that would otherwise get swallowed.
  let target: string;
  try {
    if (!isValidIsoDate(date)) throw new Error(`Bad date: ${date}`);
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) throw new Error("ADMIN_EMAIL not set");

    const digest = await getDigest("mlb", date);
    if (!digest || !digest.email_html) {
      throw new Error(`No email_html for ${date}`);
    }

    const origin = await siteOrigin();
    const { subject, html, text } = dailyEmail({
      sport: "mlb",
      digestDate: date,
      digestPrettyDate: prettyDate(date),
      digestUrl: `${origin}/mlb/${date}`,
      unsubscribeUrl: `${origin}/u/admin-preview`,
      digestEmailHtml: digest.email_html,
    });

    await sendEmail({
      to: adminEmail,
      subject: `[ADMIN PREVIEW] ${subject}`,
      html,
      text,
    });

    target = `/admin?ok=${encodeURIComponent(`Sent ${prettyDate(date)} digest to ${adminEmail}.`)}`;
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[send-admin-preview] FAILED: ${msg}`);
    target = `/admin?error=${encodeURIComponent(msg)}`;
  }
  redirect(target);
}

// Trigger a cron route on demand. Calls the existing route handler over HTTP
// with the CRON_SECRET auth header so the route logs to cron_runs the same
// way a scheduled run would (with trigger="manual"). Awaits the result so the
// admin gets a redirect with success/error flash.
export async function triggerCron(formData: FormData): Promise<void> {
  const route = String(formData.get("route") ?? "");
  const rawDate = formData.get("date");
  const date = typeof rawDate === "string" && rawDate ? rawDate : yesterdayInET();
  const reset = formData.get("reset") === "1";

  let target: string;
  try {
    if (!["generate", "send-email", "post-bluesky", "post-twitter"].includes(route)) {
      throw new Error(`Unknown cron route: ${route}`);
    }
    if (!isValidIsoDate(date)) throw new Error(`Bad date: ${date}`);

    const origin = await siteOrigin();
    const params = new URLSearchParams({ trigger: "manual", date, sport: "mlb" });
    if (reset) params.set("reset", "1");
    const url = `${origin}/api/cron/${route}?${params}`;

    const headers: HeadersInit = {};
    const secret = process.env.CRON_SECRET;
    if (secret) headers.Authorization = `Bearer ${secret}`;

    const res = await fetch(url, { headers });
    const body = (await res.json()) as { error?: string; ok?: boolean } & Record<string, unknown>;
    if (!res.ok || body.error) {
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    target = `/admin?ok=${encodeURIComponent(`${route} for ${date} → ${JSON.stringify(body)}`)}`;
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[trigger-cron] ${route} ${date}: ${msg}`);
    target = `/admin?error=${encodeURIComponent(`${route}: ${msg}`)}`;
  }
  redirect(target);
}

export async function regenerateAllDigests(): Promise<void> {
  let target: string;
  try {
    const { supabaseAdmin } = await import("@/lib/supabase");
    const { data, error } = await supabaseAdmin()
      .from("daily_digests")
      .select("date,sport")
      .order("date", { ascending: true });
    if (error) throw new Error(`query digests: ${error.message}`);
    const rows = (data ?? []) as Array<{ date: string; sport: string }>;
    if (rows.length === 0) {
      target = `/admin?ok=${encodeURIComponent("No digests to regenerate.")}`;
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
          `${origin}/api/cron/generate?date=${row.date}&sport=${row.sport}&trigger=manual`,
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
      ? `Regenerated ${ok} digests in ${elapsed}s.`
      : `Regenerated ${ok} of ${rows.length} in ${elapsed}s. Failures: ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "…" : ""}`;
    target = fail === 0
      ? `/admin?ok=${encodeURIComponent(msg)}`
      : `/admin?error=${encodeURIComponent(msg)}`;
  } catch (err) {
    target = `/admin?error=${encodeURIComponent(`regenerate-all: ${(err as Error).message}`)}`;
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
