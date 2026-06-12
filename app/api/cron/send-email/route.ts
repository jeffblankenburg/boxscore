import { NextResponse } from "next/server";
import { getDigest } from "@/lib/digests";
import { getActiveSubscribersForSport } from "@/lib/subscribers";
import { getSentSubscriberIds, recordSend } from "@/lib/sends";
import { sendEmailBatch } from "@/lib/email";
import { dailyEmail } from "@/lib/emails/templates";
import { isValidIsoDate, nextDay, prettyDate, yesterdayInET } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { startCronRun, finishCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
// Matches vercel.json's functions config for this route — both must agree
// or readers of this file get a misleading picture of the actual cap.
// Healthy runtime projects to ~315s (57 batches × ~5s Resend + parallel
// recordSend); 800s gives 2.5x headroom for Resend or Supabase latency
// spikes. The supervisor at /api/cron/supervise catches genuine hangs
// at 30 min, which is a better signal than aggressively low maxDuration.
export const maxDuration = 800;

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
  // force=true bypasses the already-sent filter so we can re-send a
  // corrected digest after a bad render. Sends are upserted on
  // (subscriber, sport, date) so re-sending replaces the prior row.
  const force = url.searchParams.get("force") === "true";
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

    // Email links bake to https://boxscore.email/… regardless of where the
    // cron ran. A dev send to a real inbox must never embed a localhost URL,
    // and a preview-deployment cron must never embed a vercel.app URL.
    // Public URL uses the EDITION date (= games_date + 1). The send goes
    // out on edition day with yesterday's results.
    const digestUrl = `${EMAIL_LINK_BASE}/${sport}/${nextDay(date)}`;
    const digestPrettyDate = prettyDate(date);

    // Only subscribers who have opted in to this sport's league digest.
    // The 0013 backfill made every pre-existing MLB subscriber opted-in,
    // so for MLB the result set is identical to the old getActiveSubscribers.
    const subscribers = await getActiveSubscribersForSport(sport);
    // One bulk fetch instead of one round-trip per subscriber. At thousands
    // of subscribers the serial-check pattern can use as much wall-clock as
    // the actual sending did.
    // Skip already-sent unless force=true. Force is used to re-send a
    // corrected digest after a bad render.
    const alreadySent = force ? new Set<string>() : await getSentSubscriberIds(sport, date);
    const toSend = subscribers.filter((s) => !alreadySent.has(s.id));
    const skipped = subscribers.length - toSend.length;

    let sent = 0, failed = 0;

    const manageUrl = `${EMAIL_LINK_BASE}/settings`;
    // Wrap the top-of-email links through /r/e/[src] for first-party
    // click tracking. The destination is HMAC-signed so the URL can't
    // be re-aimed at a different target. Wrapping happens once per
    // batch — the secret is cached in module memory after the first
    // call, so the second is a no-op.
    const { trackedEmailLink } = await import("@/lib/link-tracking");
    const [digestTrackedUrl, manageTrackedUrl] = await Promise.all([
      trackedEmailLink("email-header-digest", digestUrl),
      trackedEmailLink("email-header-manage", manageUrl),
    ]);
    const { getAnnouncement } = await import("@/lib/announcements");
    const announcementBanner = (await getAnnouncement(sport, date)) ?? undefined;

    const groups = chunk(toSend, BATCH_SIZE);
    for (const [batchIndex, group] of groups.entries()) {
      const batchStart = performance.now();
      const payload = group.map((sub) => {
        const unsubscribeUrl = `${EMAIL_LINK_BASE}/u/${sub.unsubscribe_token}`;
        // Mail-client native "Unsubscribe" buttons POST to this URL (RFC 8058).
        // It's a separate endpoint from the human-facing /u/[token] page so
        // GET requests from link scanners can't auto-unsubscribe real users.
        const oneClickUrl = `${EMAIL_LINK_BASE}/api/u/${sub.unsubscribe_token}`;
        const { subject, html, text } = dailyEmail({
          sport,
          digestDate: date,
          digestPrettyDate,
          digestUrl:  digestTrackedUrl,
          unsubscribeUrl,
          manageUrl:  manageTrackedUrl,
          announcementBanner,
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
        // Whole-batch transport failure (rare — network/timeout reaching
        // Resend). Resend's structured errors are already caught inside
        // sendEmailBatch and returned as per-row results. Mark every row
        // in this batch failed so manual /admin retry or supervisor heal
        // picks them up; hasAlreadySent will skip the ones that did go
        // through. Parallelized to match the success path — sequential
        // awaits here re-introduce the 100× latency multiplier.
        const msg = (err as Error).message;
        await Promise.all(group.map(async (sub) => {
          await recordSend({ subscriberId: sub.id, sport, date, resendId: null, error: msg });
          failed++;
        }));
        console.log(
          `[send-email] sport=${sport} date=${date} batch=${batchIndex + 1}/${groups.length}` +
          ` size=${group.length} elapsed_ms=${Math.round(performance.now() - batchStart)} status=batch_failed`,
        );
        continue;
      }

      // Parallelize the per-subscriber recordSend writes. The previous
      // sequential `await recordSend(...)` loop multiplied Supabase
      // round-trip latency by group.length (100), which pushed
      // multi-thousand-subscriber sends past Vercel's maxDuration when
      // round-trip rose from ~50ms to ~150ms in early June 2026. See
      // cron_runs failures on 2026-06-05..07; full diagnosis in
      // scripts/diag-send-rate.ts. PostgREST is stateless HTTP so 100
      // concurrent upserts finish in roughly one round-trip's wall time.
      // sent/failed counter increments are safe under JS single-threaded
      // concurrency — the async callbacks interleave on the event loop
      // but each increment is atomic.
      await Promise.all(group.map(async (sub, i) => {
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
      }));
      // Per-batch timing log. Lets future debugging see exactly where
      // a stuck cron got to, and how long each batch took. Cheap to
      // emit (57 lines per healthy run); filter on `[send-email]` in
      // Vercel logs to pull just these.
      console.log(
        `[send-email] sport=${sport} date=${date} batch=${batchIndex + 1}/${groups.length}` +
        ` size=${group.length} elapsed_ms=${Math.round(performance.now() - batchStart)} status=ok`,
      );
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
