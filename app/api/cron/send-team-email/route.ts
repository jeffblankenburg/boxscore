import { NextResponse } from "next/server";
import { getActiveTeamIds } from "@/lib/email-subscriptions";
import { getActiveSubscribers, getTeamOptInSubscriberIds, type Subscriber } from "@/lib/subscribers";
import { getSentSubscriberIds, recordSend } from "@/lib/sends";
import { sendEmailBatch } from "@/lib/email";
import { teamDailyEmail } from "@/lib/emails/templates";
import { getTeamDigest } from "@/lib/team-digests";
import { getAnnouncement } from "@/lib/announcements";
import { findTeam, type Sport } from "@/lib/teams";
import { isValidIsoDate, nextDay, prettyDate, yesterdayInET } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { startCronRun, finishCronRun } from "@/lib/cron-runs";

// Team-digest send cron. One run iterates every team that has at least one
// active subscriber, renders the per-team digest for the given date, and
// fans out via Resend. Modeled on /api/cron/send-email but with an extra
// outer loop over teams.
//
// Skips the actual send (but still records a `sends` row with no error) when
// the team is in true-offseason emptiness — no game yesterday, no upcoming
// games this week, no transactions on the date. Avoids waking subscribers up
// to a digest that has nothing in it.

export const runtime = "nodejs";
// Worst-case shape: 30 MLB teams × up to ~5k subscribers / 100 per batch =
// ~1500 Resend calls. Each is sub-second, total well under 300s. Same
// budget as the league send cron for parity.
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

type TeamResult = {
  team: string;
  sent: number;
  skipped: number;
  failed: number;
  empty?: boolean;
  error?: string;
};

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? yesterdayInET();
  const sport = url.searchParams.get("sport") ?? "mlb";
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  // force=true bypasses the already-sent filter so we can re-send corrected
  // team digests after a bad render.
  const force = url.searchParams.get("force") === "true";
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  // V1 only supports MLB team digests; NBA/WNBA team renderers don't exist
  // yet. Fail loudly so we don't silently no-op when the cron is wired but
  // the renderer isn't.
  if (sport !== "mlb") {
    return NextResponse.json(
      { error: `no team-digest renderer for sport=${sport}` },
      { status: 501 },
    );
  }

  let runId: string | null = null;
  try {
    runId = await startCronRun({ route: "send-team-email", sport, date, trigger });

    const teamIds = await getActiveTeamIds(sport);
    if (teamIds.length === 0) {
      const result = { sport, date, teams: 0, sent: 0, skipped: 0, failed: 0 };
      await finishCronRun(runId, { status: "ok", result });
      return NextResponse.json({ ok: true, ...result });
    }

    // Email links bake to https://boxscore.email/… regardless of where the
    // cron ran (dev box, preview deployment). See lib/site.ts EMAIL_LINK_BASE.
    const digestPrettyDate = prettyDate(date);
    // Announcement is league-wide for the day; fetched once and applied to
    // every team's send below.
    const announcementBanner = (await getAnnouncement(sport, date)) ?? undefined;
    // Pre-fetch active subscribers ONCE and reuse for every team. Was
    // previously called per-team via getActiveSubscribersForTeam; 29
    // repeated calls were silently dropping subscribers from the second
    // page on some calls, capping each team's send to ~21% of eligible.
    // One fetch + an in-memory map sidesteps the issue entirely.
    const allActive = await getActiveSubscribers();
    const subscriberById = new Map<string, Subscriber>(
      allActive.map((s) => [s.id, s]),
    );
    let totalSent = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let totalEmpty = 0;
    const perTeam: TeamResult[] = [];

    for (const teamId of teamIds) {
      const team = findTeam(sport as Sport, teamId);
      if (!team) {
        perTeam.push({ team: teamId, sent: 0, skipped: 0, failed: 0, error: "unknown team" });
        continue;
      }

      try {
        // Read the pre-rendered email_html from team_digests. The generate
        // cron writes one row per team per day, so by the time the send
        // cron runs the body is already cached. If the row is missing (e.g.
        // a manual send for a date generate hasn't covered), we fail this
        // team — the operator's expected to run /api/cron/generate first.
        const cached = await getTeamDigest(sport, team.slug, date);
        if (!cached) {
          perTeam.push({ team: teamId, sent: 0, skipped: 0, failed: 0, error: "no team_digest row — run generate first" });
          continue;
        }

        // Skip-send heuristic: nothing happened. has_game already encodes
        // "had a final game yesterday"; we still skip if there's no game and
        // the renderer would produce only the team-heading shell with no
        // upcoming + no transactions. Cheap shortcut here looks at the
        // cached HTML length — the offseason shell is ~500 bytes after
        // dateline + heading; real digests are 10x+.
        if (!cached.has_game && cached.html.length < 1500) {
          totalEmpty++;
          perTeam.push({ team: teamId, sent: 0, skipped: 0, failed: 0, empty: true });
          continue;
        }

        const body = cached.email_html;
        // Get this team's opt-in subscriber IDs, then intersect with the
        // pre-fetched active subscribers map. Avoids the 29x repeated
        // getActiveSubscribers fetch that was causing the truncation bug.
        const optedIds = await getTeamOptInSubscriberIds(sport, teamId);
        const subscribers: Subscriber[] = [];
        for (const id of optedIds) {
          const sub = subscriberById.get(id);
          if (sub) subscribers.push(sub);
        }
        const alreadySent = force
          ? new Set<string>()
          : await getSentSubscriberIds(sport, date, teamId);
        const toSend = subscribers.filter((s) => !alreadySent.has(s.id));
        const skipped = subscribers.length - toSend.length;

        let sent = 0;
        let failed = 0;
        // Per-team archive page: /{sport}/{slug}/{edition_date}. Served
        // from team_digests.html (no request-time rendering).
        const digestUrl = `${EMAIL_LINK_BASE}/${sport}/${team.slug}/${nextDay(date)}`;
        const manageUrl = `${EMAIL_LINK_BASE}/settings`;

        for (const group of chunk(toSend, BATCH_SIZE)) {
          const payload = group.map((sub) => {
            const unsubscribeUrl = `${EMAIL_LINK_BASE}/u/${sub.unsubscribe_token}`;
            // Mail-client native one-click unsubscribe (RFC 8058). Separate
            // POST endpoint so a forwarded email / link scanner can't auto-
            // unsubscribe the real user.
            const oneClickUrl = `${EMAIL_LINK_BASE}/api/u/${sub.unsubscribe_token}`;
            const { subject, html, text } = teamDailyEmail({
              teamName: team.name,
              digestDate: date,
              digestPrettyDate,
              digestUrl,
              unsubscribeUrl,
              manageUrl,
              announcementBanner,
              digestEmailHtml: body,
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
            // Whole-batch transport failure (rare). Mark every row in this
            // batch failed so we can retry from /admin/mlb — hasAlreadySent
            // will skip the ones that did go through.
            const msg = (err as Error).message;
            for (const sub of group) {
              await recordSend({
                subscriberId: sub.id, sport, date,
                resendId: null, error: msg, teamId,
              });
              failed++;
            }
            continue;
          }

          for (let i = 0; i < group.length; i++) {
            const sub = group[i]!;
            const r = results[i] ?? { id: null, error: "missing result" };
            await recordSend({
              subscriberId: sub.id, sport, date,
              resendId: r.id, error: r.error, teamId,
            });
            if (r.error) {
              failed++;
              console.error(`team-send failed ${team.abbreviation}/${sub.email}: ${r.error}`);
            } else {
              sent++;
            }
          }
        }

        totalSent += sent;
        totalSkipped += skipped;
        totalFailed += failed;
        perTeam.push({ team: teamId, sent, skipped, failed });
      } catch (err) {
        const msg = (err as Error).message;
        console.error(`team-send error ${teamId}: ${msg}`);
        perTeam.push({ team: teamId, sent: 0, skipped: 0, failed: 0, error: msg });
      }
    }

    const result = {
      sport, date,
      teams: teamIds.length,
      empty: totalEmpty,
      sent: totalSent,
      skipped: totalSkipped,
      failed: totalFailed,
      perTeam,
    };
    await finishCronRun(runId, { status: "ok", result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    await finishCronRun(runId, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
