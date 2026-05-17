import { NextResponse } from "next/server";
import { getDigest } from "@/lib/digests";
import { getActiveSubscribers } from "@/lib/subscribers";
import { getSentSubscriberIds, recordSend } from "@/lib/sends";
import { sendEmailBatch } from "@/lib/email";
import { dailyEmail } from "@/lib/emails/templates";
import { isValidIsoDate, prettyDate, yesterdayInET } from "@/lib/dates";
import { siteOrigin } from "@/lib/site";
import { startCronRun, finishCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
// Resend's batch API does ~100 sends in one HTTP round-trip, so even 5k+
// subscribers finish in seconds; 300s is gross overkill but cheap insurance.
export const maxDuration = 300;

const BATCH_SIZE = 100;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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
    // One bulk fetch instead of one round-trip per subscriber. At thousands
    // of subscribers the serial-check pattern can use as much wall-clock as
    // the actual sending did.
    const alreadySent = await getSentSubscriberIds(sport, date);
    const toSend = subscribers.filter((s) => !alreadySent.has(s.id));
    const skipped = subscribers.length - toSend.length;

    let sent = 0, failed = 0;

    for (const group of chunk(toSend, BATCH_SIZE)) {
      const payload = group.map((sub) => {
        const unsubscribeUrl = `${origin}/u/${sub.unsubscribe_token}`;
        // Mail-client native "Unsubscribe" buttons POST to this URL (RFC 8058).
        // It's a separate endpoint from the human-facing /u/[token] page so
        // GET requests from link scanners can't auto-unsubscribe real users.
        const oneClickUrl = `${origin}/api/u/${sub.unsubscribe_token}`;
        const { subject, html, text } = dailyEmail({
          digestPrettyDate,
          digestUrl,
          unsubscribeUrl,
          digestEmailHtml: digest.email_html!,
        });
        return {
          to: sub.email,
          subject,
          html,
          text,
          headers: {
            // RFC 8058 / 2369 — Gmail and Apple Mail show a native "Unsubscribe"
            // button next to the sender when this header is present.
            "List-Unsubscribe": `<${oneClickUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        };
      });

      let results;
      try {
        results = await sendEmailBatch(payload);
      } catch (err) {
        // Whole-batch transport failure (rare). Mark every row in this batch
        // failed so we can retry from /admin via the manual trigger button —
        // hasAlreadySent will skip the ones that did go through.
        const msg = (err as Error).message;
        for (const sub of group) {
          await recordSend({ subscriberId: sub.id, sport, date, resendId: null, error: msg });
          failed++;
        }
        continue;
      }

      for (let i = 0; i < group.length; i++) {
        const sub = group[i]!;
        const r = results[i] ?? { id: null, error: "missing result" };
        await recordSend({
          subscriberId: sub.id, sport, date,
          resendId: r.id, error: r.error,
        });
        if (r.error) {
          failed++;
          console.error(`send failed for ${sub.email}: ${r.error}`);
        } else {
          sent++;
        }
      }
    }

    const result = {
      sport, date,
      total_active_subscribers: subscribers.length,
      sent, skipped, failed,
    };
    await finishCronRun(runId, { status: "ok", result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    await finishCronRun(runId, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
