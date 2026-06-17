import { NextResponse } from "next/server";
import { yesterdayInET, isValidIsoDate } from "@/lib/dates";
import { fetchAndStoreSdioDaily } from "@/lib/sports/mlb/sources/sdio-storage";
import { startCronRun, finishCronRun } from "@/lib/cron-runs";

// Daily SDIO pull. Lives alongside /api/cron/generate (the statsapi cron)
// and shares its auth model, but writes to daily_raw_sdio and does NOT
// render anything. The production digest is unaffected by this route —
// it only feeds the canonical preview tool at /admin/preview/canonical
// so we can validate SDIO before any migration decision.

export const runtime = "nodejs";
// Six parallel SDIO endpoints per date; well under 300s in practice but
// pad to the platform ceiling in case SDIO is having a slow day.
export const maxDuration = 300;

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

  const url     = new URL(req.url);
  const sport   = url.searchParams.get("sport") ?? "mlb";
  const date    = url.searchParams.get("date") ?? yesterdayInET();
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  // ?force=1 bypasses the standings/playerStats preservation so the
  // canonical-preview validation can pull a fresh snapshot for vendor
  // comparison. Production cron path never sets this.
  const force   = url.searchParams.get("force") === "1";

  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  if (sport !== "mlb") {
    return NextResponse.json(
      { error: `no SDIO generator implemented for sport=${sport}` },
      { status: 501 },
    );
  }

  let runId: string | null = null;
  try {
    runId = await startCronRun({ route: "generate-sdio", sport, date, trigger });
    const payload = await fetchAndStoreSdioDaily(sport, date, { force });
    const summary = {
      games:        Array.isArray(payload.games)        ? payload.games.length        : 0,
      boxScores:    Array.isArray(payload.boxScores)    ? payload.boxScores.length    : 0,
      transactions: Array.isArray(payload.transactions) ? payload.transactions.length : 0,
    };
    await finishCronRun(runId, { status: "ok", result: summary });
    return NextResponse.json({ ok: true, sport, date, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (runId) await finishCronRun(runId, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
