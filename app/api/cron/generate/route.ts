import { NextResponse } from "next/server";
import { loadDailyData } from "@/lib/daily";
import { renderContent } from "@/lib/render";
import { renderEmailContent } from "@/lib/render-email";
import { upsertDigest } from "@/lib/digests";
import { yesterdayInET, isValidIsoDate } from "@/lib/dates";

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
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const data = await loadDailyData(date);
  const html = renderContent(data);
  const email_html = renderEmailContent(data);
  await upsertDigest({
    sport: "mlb", date, html, email_html, game_count: data.games.length,
  });

  return NextResponse.json({
    ok: true,
    sport: "mlb",
    date,
    game_count: data.games.length,
    html_bytes: html.length,
    email_bytes: email_html.length,
  });
}
