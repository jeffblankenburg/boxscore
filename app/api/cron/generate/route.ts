import { NextResponse } from "next/server";
import { loadDailyData } from "@/lib/daily";
import { renderContent } from "@/lib/render";
import { renderEmailContent } from "@/lib/render-email";
import { upsertDigest } from "@/lib/digests";
import { loadNbaData } from "@/lib/nba";
import { loadWnbaData } from "@/lib/wnba";
import { yesterdayInET, isValidIsoDate } from "@/lib/dates";
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
  const sport = url.searchParams.get("sport") ?? "mlb";
  const date = url.searchParams.get("date") ?? yesterdayInET();
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  const refetch = url.searchParams.get("refetch") === "true";
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  if (sport !== "mlb" && sport !== "nba" && sport !== "wnba") {
    return NextResponse.json(
      { error: `no generator implemented for sport=${sport}` },
      { status: 501 },
    );
  }

  let runId: string | null = null;
  try {
    runId = await startCronRun({ route: "generate", sport, date, trigger });

    if (sport === "mlb") {
      const data = await loadDailyData(date, { refetch });
      const html = renderContent(data);
      const email_html = renderEmailContent(data);
      await upsertDigest({
        sport, date, html, email_html, game_count: data.games.length,
      });
      const result = {
        sport, date,
        mode: data.mode,
        game_count: data.games.length,
        html_bytes: html.length,
        email_bytes: email_html.length,
      };
      await finishCronRun(runId, { status: "ok", result });
      return NextResponse.json({ ok: true, ...result });
    }

    // Basketball (nba | wnba): cache raw payload only. Renderer + digest
    // write land in Phase 3; until then a "generate" run for basketball
    // means "warm the raw cache" so the eventual renderer has data ready.
    const bb = sport === "nba"
      ? await loadNbaData(date, { refetch })
      : await loadWnbaData(date, { refetch });
    const finals = bb.games.filter((g) => g.event.status === "final").length;
    const result = {
      sport, date,
      game_count: bb.games.length,
      final_count: finals,
      conference_count: bb.standings.conferences.length,
      season: bb.season,
    };
    await finishCronRun(runId, { status: "ok", result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    await finishCronRun(runId, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
