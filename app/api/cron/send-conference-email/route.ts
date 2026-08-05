import { NextResponse } from "next/server";
import { getSportRow } from "@/lib/sports";
import { getActiveConferenceIds } from "@/lib/email-subscriptions";
import { getActiveSubscribers, getConferenceOptInSubscriberIds, type Subscriber } from "@/lib/subscribers";
import { getSentSubscriberIds, recordSend } from "@/lib/sends";
import { sendEmailBatch } from "@/lib/email";
import { paceBatch } from "@/lib/send-pacing";
import { teamDailyEmail } from "@/lib/emails/templates";
import { getAnnouncement } from "@/lib/announcements";
import { loadFootballData } from "@/lib/sports/football/data";
import { renderFootballConferenceEmailContent } from "@/lib/sports/football/render/digest";
import { findConferenceBySlug, scopeToConference } from "@/lib/sports/football/conferences";
import { isValidIsoDate, nextDay, prettyDate, yesterdayInET } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { BRAND } from "@/lib/brand";
import { startCronRun, finishCronRun } from "@/lib/cron-runs";

// NCAAF conference-digest send cron. Renders each subscribed conference's digest
// from the day's bundle and fans out via Resend. Modeled on send-team-email but
// keyed on scope='conference' subscriptions; the conference slug plays the role
// of teamId for opt-in lookup + sent-tracking (slugs never collide with FBS
// team slugs). Weekly cadence: a conference sends only on days it had a final.

export const runtime = "nodejs";
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

type ConfResult = { conference: string; sent: number; skipped: number; failed: number; empty?: boolean; error?: string };

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? yesterdayInET();
  const sport = url.searchParams.get("sport") ?? "ncaaf";
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  const force = url.searchParams.get("force") === "true";
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  // Conference digests are an NCAAF concept only.
  if (sport !== "ncaaf") {
    return NextResponse.json({ error: `no conference digests for sport=${sport}` }, { status: 501 });
  }

  let runId: string | null = null;
  try {
    runId = await startCronRun({ route: "send-conference-email", sport, date, trigger });

    // Per-sport send kill switch — same gate as the league/team sends.
    const sportRow = await getSportRow(sport);
    if (sportRow && sportRow.sends_enabled === false) {
      const result = { sport, date, conferences: 0, sent: 0, skipped: 0, failed: 0, empty: 0, skipped_reason: "sends_disabled" };
      console.log(`[send-conference-email] sport=${sport} date=${date} status=skipped reason=sends_disabled`);
      await finishCronRun(runId, { status: "ok", result });
      return NextResponse.json({ ok: true, ...result });
    }

    const confSlugs = await getActiveConferenceIds(sport);
    if (confSlugs.length === 0) {
      const result = { sport, date, conferences: 0, sent: 0, skipped: 0, failed: 0 };
      await finishCronRun(runId, { status: "ok", result });
      return NextResponse.json({ ok: true, ...result });
    }

    // One bundle for the day, reused across every conference (scoped per conf).
    const bundle = await loadFootballData(sport, date);
    const digestPrettyDate = prettyDate(date);
    const announcementBanner = (await getAnnouncement(sport, date)) ?? undefined;
    const allActive = await getActiveSubscribers();
    const subscriberById = new Map<string, Subscriber>(allActive.map((s) => [s.id, s]));

    let totalSent = 0, totalSkipped = 0, totalFailed = 0, totalEmpty = 0;
    const perConf: ConfResult[] = [];

    for (const slug of confSlugs) {
      const conf = findConferenceBySlug(slug);
      if (!conf) {
        perConf.push({ conference: slug, sent: 0, skipped: 0, failed: 0, error: "unknown conference" });
        continue;
      }
      try {
        // Weekly cadence: only send when the conference had a final on the date.
        const scoped = scopeToConference(bundle, conf);
        const hadGame = scoped.games.some((g) => g.status === "final");
        if (!hadGame) {
          totalEmpty++;
          perConf.push({ conference: slug, sent: 0, skipped: 0, failed: 0, empty: true });
          continue;
        }

        const body = renderFootballConferenceEmailContent(bundle, conf);

        const optedIds = await getConferenceOptInSubscriberIds(sport, slug);
        const subscribers: Subscriber[] = [];
        for (const id of optedIds) {
          const sub = subscriberById.get(id);
          if (sub) subscribers.push(sub);
        }
        const alreadySent = force ? new Set<string>() : await getSentSubscriberIds(sport, date, slug);
        const toSend = subscribers.filter((s) => !alreadySent.has(s.id));
        const skipped = subscribers.length - toSend.length;

        let sent = 0, failed = 0;
        const digestUrl = `${EMAIL_LINK_BASE}/${sport}/conference/${slug}`;
        const manageUrl = `${EMAIL_LINK_BASE}/settings`;
        const gamesUrl = `${EMAIL_LINK_BASE}/games`;
        const tipJarUrl = BRAND.tipJarUrl;
        const { trackedEmailLink } = await import("@/lib/link-tracking");
        const [digestTrackedUrl, manageTrackedUrl, gamesTrackedUrl, tipJarTrackedUrl] = await Promise.all([
          trackedEmailLink("conf-email-header-digest", digestUrl),
          trackedEmailLink("conf-email-header-manage", manageUrl),
          trackedEmailLink("conf-email-header-games", gamesUrl),
          trackedEmailLink("conf-email-header-tip", tipJarUrl),
        ]);

        for (const group of chunk(toSend, BATCH_SIZE)) {
          const openTokens = group.map(() => crypto.randomUUID());
          const payload = group.map((sub, i) => {
            const unsubscribeUrl = `${EMAIL_LINK_BASE}/u/${sub.unsubscribe_token}`;
            const oneClickUrl = `${EMAIL_LINK_BASE}/api/u/${sub.unsubscribe_token}`;
            const { subject, html, text } = teamDailyEmail({
              sport,
              teamName: `${conf.short} Conference`,
              digestDate: date,
              digestPrettyDate,
              digestUrl: digestTrackedUrl,
              unsubscribeUrl,
              manageUrl: manageTrackedUrl,
              gamesUrl: gamesTrackedUrl,
              tipJarUrl: tipJarTrackedUrl,
              announcementBanner,
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
            for (let i = 0; i < group.length; i++) {
              await recordSend({ subscriberId: group[i]!.id, sport, date, resendId: null, error: msg, teamId: slug, openToken: openTokens[i]! });
              failed++;
            }
            continue;
          }

          for (let i = 0; i < group.length; i++) {
            const sub = group[i]!;
            const r = results[i] ?? { id: null, error: "missing result" };
            await recordSend({ subscriberId: sub.id, sport, date, resendId: r.id, error: r.error, teamId: slug, openToken: openTokens[i]! });
            if (r.error) failed++; else sent++;
          }
          await paceBatch(); // flatten the delivery burst
        }

        totalSent += sent; totalSkipped += skipped; totalFailed += failed;
        perConf.push({ conference: slug, sent, skipped, failed });
      } catch (err) {
        const msg = (err as Error).message;
        console.error(`[send-conference-email] ${slug} failed: ${msg}`);
        perConf.push({ conference: slug, sent: 0, skipped: 0, failed: 0, error: msg });
      }
    }

    const result = {
      sport, date,
      conferences: confSlugs.length,
      sent: totalSent, skipped: totalSkipped, failed: totalFailed, empty: totalEmpty,
      perConference: perConf,
    };
    console.log(`[send-conference-email] sport=${sport} date=${date} sent=${totalSent} skipped=${totalSkipped} failed=${totalFailed} empty=${totalEmpty}`);
    await finishCronRun(runId, { status: "ok", result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    if (runId) await finishCronRun(runId, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
