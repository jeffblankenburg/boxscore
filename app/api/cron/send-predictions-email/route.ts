import { NextResponse } from "next/server";
import { getActiveSubscribers } from "@/lib/subscribers";
import { getSentSubscriberIds, recordSend } from "@/lib/sends";
import { sendEmailBatch } from "@/lib/email";
import { predictionsEmail } from "@/lib/emails/templates";
import { loadPredictionsDigestData, renderPredictionsDigestBody } from "@/lib/sports/mlb/predictions-digest";
import { isValidIsoDate, todayInET } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { BRAND } from "@/lib/brand";
import { startCronRun, finishCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
export const maxDuration = 300;

// Distinct sends key so predictions rows never collide with the league MLB
// digest's (subscriber, sport, date) uniqueness. A subscriber can get both
// the 5am league digest AND the 11:30am picks email on the same date.
const SEND_KEY = "mlb-predictions";
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
  // Picks are for TODAY (unlike the league digest, which recaps yesterday).
  const date = url.searchParams.get("date") ?? todayInET();
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  const force = url.searchParams.get("force") === "true";
  // One-off verification send: ?test=<email> mails a single recipient and
  // records nothing (no sends row, no already-sent skip). Used to eyeball the
  // rendered email before the real fan-out. Never runs on the cron path.
  const testEmail = url.searchParams.get("test");
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  let runId: string | null = null;
  try {
    runId = await startCronRun({ route: "send-predictions-email", sport: SEND_KEY, date, trigger });

    // Admins-only while the picks product is pre-launch. Filtering here (not
    // in a getActiveSubscribersForSport call) keeps delivery independent of
    // MLB league opt-in: an admin gets the picks email whether or not they're
    // on the newsletter.
    const subscribers = (await getActiveSubscribers()).filter((s) => s.is_admin);

    // Render the digest once — the body is identical for every recipient (only
    // the per-subscriber open pixel + unsubscribe URL differ, injected by the
    // shell). If there are no picks yet (lines not captured), the body still
    // renders a "picks lock at 10:30 AM ET" note, but we skip sending so the
    // cron can fire early without mailing an empty card.
    const data = await loadPredictionsDigestData(date);
    if (data.picksPending) {
      const result = { sport: SEND_KEY, date, total_active_subscribers: subscribers.length, sent: 0, skipped: 0, failed: 0, skipped_reason: "picks_pending" };
      console.log(`[send-predictions-email] date=${date} status=skipped reason=picks_pending`);
      await finishCronRun(runId, { status: "ok", result });
      return NextResponse.json({ ok: true, ...result });
    }
    const body = renderPredictionsDigestBody(data);

    const digestUrl0 = `${EMAIL_LINK_BASE}/mlb/predictions`;

    // Preview: return the rendered HTML without sending. For eyeballing the
    // email at a given date/width before a real fan-out.
    if (url.searchParams.get("preview") === "1") {
      const { html } = predictionsEmail({
        digestDate: date, digestUrl: digestUrl0,
        unsubscribeUrl: `${EMAIL_LINK_BASE}/settings`, manageUrl: `${EMAIL_LINK_BASE}/settings`,
        gamesUrl: `${EMAIL_LINK_BASE}/games`, tipJarUrl: BRAND.tipJarUrl,
        digestEmailHtml: body, openToken: null,
      });
      if (runId) await finishCronRun(runId, { status: "ok", result: { preview: true, date } });
      return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Verification send: one recipient, no DB writes, no tracking wrappers.
    if (testEmail) {
      const { subject, html, text } = predictionsEmail({
        digestDate: date,
        digestUrl: digestUrl0,
        unsubscribeUrl: `${EMAIL_LINK_BASE}/settings`,
        manageUrl: `${EMAIL_LINK_BASE}/settings`,
        gamesUrl: `${EMAIL_LINK_BASE}/games`,
        tipJarUrl: BRAND.tipJarUrl,
        digestEmailHtml: body,
        openToken: null,
      });
      const [r] = await sendEmailBatch([{ to: testEmail, subject, html, text }]);
      const result = { sport: SEND_KEY, date, test: testEmail, sent: r?.error ? 0 : 1, failed: r?.error ? 1 : 0, error: r?.error ?? null };
      await finishCronRun(runId, { status: "ok", result });
      return NextResponse.json({ ok: !r?.error, ...result });
    }

    const alreadySent = force ? new Set<string>() : await getSentSubscriberIds(SEND_KEY, date);
    const toSend = subscribers.filter((s) => !alreadySent.has(s.id));
    const skipped = subscribers.length - toSend.length;

    const digestUrl = `${EMAIL_LINK_BASE}/mlb/predictions`;
    const manageUrl = `${EMAIL_LINK_BASE}/settings`;
    const gamesUrl = `${EMAIL_LINK_BASE}/games`;
    const tipJarUrl = BRAND.tipJarUrl;
    const { trackedEmailLink } = await import("@/lib/link-tracking");
    const [digestTrackedUrl, manageTrackedUrl, gamesTrackedUrl, tipJarTrackedUrl] = await Promise.all([
      trackedEmailLink("email-header-predictions", digestUrl),
      trackedEmailLink("email-header-manage", manageUrl),
      trackedEmailLink("email-header-games", gamesUrl),
      trackedEmailLink("email-header-tip", tipJarUrl),
    ]);

    let sent = 0, failed = 0;
    const groups = chunk(toSend, BATCH_SIZE);
    for (const group of groups) {
      const openTokens = group.map(() => crypto.randomUUID());
      const payload = group.map((sub, i) => {
        const unsubscribeUrl = `${EMAIL_LINK_BASE}/u/${sub.unsubscribe_token}`;
        const oneClickUrl = `${EMAIL_LINK_BASE}/api/u/${sub.unsubscribe_token}`;
        const { subject, html, text } = predictionsEmail({
          digestDate: date,
          digestUrl: digestTrackedUrl,
          unsubscribeUrl,
          manageUrl: manageTrackedUrl,
          gamesUrl: gamesTrackedUrl,
          tipJarUrl: tipJarTrackedUrl,
          digestEmailHtml: body,
          openToken: openTokens[i]!,
        });
        return {
          to: sub.email,
          subject,
          html,
          text,
          headers: {
            "List-Unsubscribe": `<${oneClickUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        };
      });

      let results;
      try {
        results = await sendEmailBatch(payload);
      } catch (err) {
        const msg = (err as Error).message;
        await Promise.all(group.map(async (sub, i) => {
          await recordSend({ subscriberId: sub.id, sport: SEND_KEY, date, resendId: null, error: msg, openToken: openTokens[i]! });
          failed++;
        }));
        continue;
      }

      await Promise.all(group.map(async (sub, i) => {
        const r = results[i] ?? { id: null, error: "missing result" };
        await recordSend({ subscriberId: sub.id, sport: SEND_KEY, date, resendId: r.id, error: r.error, openToken: openTokens[i]! });
        if (r.error) {
          failed++;
          console.error(`predictions send failed for ${sub.email}: ${r.error}`);
        } else {
          sent++;
        }
      }));
    }

    const result = { sport: SEND_KEY, date, total_active_subscribers: subscribers.length, sent, skipped, failed };
    await finishCronRun(runId, { status: "ok", result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    await finishCronRun(runId, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
