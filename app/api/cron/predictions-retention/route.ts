import { NextResponse } from "next/server";
import { todayInET } from "@/lib/dates";
import { findAccessEndingSoon, findSeasonWindDownRecipients } from "@/lib/predictions-retention";
import { sendPredictionsAccessEndingEmail, sendPredictionsSeasonWindDownEmail } from "@/lib/predictions-emails";
import { startCronRun, finishCronRun } from "@/lib/cron-runs";

// Predictions retention (#111, Phase 5). Daily: a heads-up ~3 days before a
// non-renewing window lapses, and — only on the season-end date — the season
// wind-down. Emails are best-effort per recipient so one bad address doesn't
// fail the run. Transactional (bypasses newsletter unsubscribe).

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  const today = todayInET();

  let runId: string | null = null;
  try {
    runId = await startCronRun({ route: "predictions-retention", sport: "mlb", date: today, trigger });

    let headsUp = 0, headsUpFailed = 0;
    for (const e of await findAccessEndingSoon(today)) {
      try {
        await sendPredictionsAccessEndingEmail({ subscriberId: e.subscriberId, accessEnd: e.accessEnd });
        headsUp++;
      } catch (err) {
        headsUpFailed++;
        console.error(`retention heads-up failed for ${e.subscriberId}: ${(err as Error).message}`);
      }
    }

    let windDown = 0, windDownFailed = 0;
    for (const w of await findSeasonWindDownRecipients(today)) {
      try {
        await sendPredictionsSeasonWindDownEmail({ subscriberId: w.subscriberId });
        windDown++;
      } catch (err) {
        windDownFailed++;
        console.error(`retention wind-down failed for ${w.subscriberId}: ${(err as Error).message}`);
      }
    }

    const result = { headsUp, headsUpFailed, windDown, windDownFailed };
    await finishCronRun(runId, { status: "ok", result });
    return NextResponse.json({ ok: true, date: today, ...result });
  } catch (e) {
    if (runId) await finishCronRun(runId, { status: "failed", error: (e as Error).message });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
