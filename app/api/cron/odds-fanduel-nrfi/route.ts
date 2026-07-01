// Daily FanDuel NRFI/YRFI odds capture.
//
// Why a separate cron from predictions-snapshot: NRFI lines post much
// later in the day than predictions can be generated. Snapshot fires
// ~10:30am ET (before SP confirmations); NRFI lines often don't appear
// until 2-4 hours before first pitch. Running this around 3pm ET
// catches the evening slate's lines as they become available.
//
// Idempotent — re-running upserts the same `(sport, date, game_pk,
// book='FanDuel')` row. Doesn't touch ML rows (book='DraftKings').
//
// Internal-only data — see memory feedback_scraped_odds_internal_only.md.

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { todayInET, isValidIsoDate } from "@/lib/dates";
import { captureFanDuelNrfiForDate } from "@/lib/sports/mlb/odds-cache";
import {
  rebuildPredictionsRenderCache,
  warmPredictionsPage,
} from "@/lib/sports/mlb/predictions-cache";
import { siteOrigin } from "@/lib/site";

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
  const sport = url.searchParams.get("sport") ?? "mlb";
  const date = url.searchParams.get("date") ?? todayInET();
  if (sport !== "mlb") {
    return NextResponse.json({ error: `no nrfi capture for sport=${sport}` }, { status: 501 });
  }
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  let report: Awaited<ReturnType<typeof captureFanDuelNrfiForDate>>;
  try {
    report = await captureFanDuelNrfiForDate(date);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // NRFI lines moving means our ROI numbers move, so refresh the
  // render cache + revalidate so /mlb/predictions picks up the new
  // ROI without waiting on its own timer.
  let cacheError: string | null = null;
  let warm: Awaited<ReturnType<typeof warmPredictionsPage>> | null = null;
  try {
    await rebuildPredictionsRenderCache(todayInET());
    revalidatePath("/mlb/predictions");
    const origin = await siteOrigin();
    warm = await warmPredictionsPage(origin);
  } catch (e) {
    cacheError = (e as Error).message;
    console.error(`[odds-fanduel-nrfi] cache rebuild failed: ${cacheError}`);
  }

  return NextResponse.json({
    ok: true,
    ...report,
    ...(cacheError ? { cache_error: cacheError } : {}),
    ...(warm ? { warm_status: warm.status, warm_ms: warm.durationMs } : {}),
  });
}
