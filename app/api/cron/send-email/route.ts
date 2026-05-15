import { NextResponse } from "next/server";
import { getDigest } from "@/lib/digests";
import { getActiveSubscribers } from "@/lib/subscribers";
import { hasAlreadySent, recordSend } from "@/lib/sends";
import { sendEmail } from "@/lib/email";
import { dailyEmail } from "@/lib/emails/templates";
import { isValidIsoDate, prettyDate, yesterdayInET } from "@/lib/dates";
import { siteOrigin } from "@/lib/site";
import { startCronRun, finishCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? yesterdayInET();
  const sport = url.searchParams.get("sport") ?? "mlb";
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  let runId: string | null = null;
  try {
    runId = await startCronRun({ route: "send-email", sport, date, trigger });

    const digest = await getDigest(sport, date);
    if (!digest || !digest.email_html) {
      throw new Error(`no digest for ${sport} ${date}`);
    }

    const origin = await siteOrigin();
    const digestUrl = `${origin}/${sport}/${date}`;
    const digestPrettyDate = prettyDate(date);

    const subscribers = await getActiveSubscribers();
    let sent = 0, skipped = 0, failed = 0;

    for (const sub of subscribers) {
      if (await hasAlreadySent(sub.id, sport, date)) {
        skipped++;
        continue;
      }

      const unsubscribeUrl = `${origin}/u/${sub.unsubscribe_token}`;
      const { subject, html, text } = dailyEmail({
        digestPrettyDate,
        digestUrl,
        unsubscribeUrl,
        digestEmailHtml: digest.email_html,
      });

      try {
        const { id } = await sendEmail({
          to: sub.email,
          subject,
          html,
          text,
          headers: {
            // RFC 8058 / 2369 — Gmail and Apple Mail show a native "Unsubscribe"
            // button next to the sender when this header is present.
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
        await recordSend({
          subscriberId: sub.id, sport, date,
          resendId: id, error: null,
        });
        sent++;
      } catch (err) {
        const msg = (err as Error).message;
        await recordSend({
          subscriberId: sub.id, sport, date,
          resendId: null, error: msg,
        });
        console.error(`send failed for ${sub.email}: ${msg}`);
        failed++;
      }
    }

    const result = {
      sport, date,
      total_active_subscribers: subscribers.length,
      sent, skipped, failed,
    };
    // If any sends failed we still record "ok" but include counts — the cron
    // didn't crash, it just had a partial failure. A complete failure (no sends
    // attempted because the digest was missing, for example) lands in the
    // catch block below as "failed".
    await finishCronRun(runId, { status: "ok", result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    await finishCronRun(runId, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
