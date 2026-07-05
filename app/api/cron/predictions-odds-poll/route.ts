// Odds polling — fires every 30 min during MLB game hours and appends
// a fresh capture to daily_odds. The table is now append-only, so each
// invocation writes new rows keyed by (sport, date, game_pk, book,
// captured_at) rather than overwriting.
//
// Why append-only + polling instead of a single "closing" capture: MLB
// slates span 1:05 PM ET (weekend afternoons, getaway days) to
// 10:10 PM ET (West Coast night games). A single close-time capture
// would either miss the afternoon slate (still open on the board) or
// write next-day lines for early games (already concluded and delisted).
// Polling every 30 min guarantees the LAST capture before each game's
// scheduled first-pitch time is at most 30 min stale, regardless of
// where in the day the game falls. The predictions-comparator does
// the "latest capture before first pitch" join to derive the closing
// price per game.
//
// Bonus: complete line-movement history is now a byproduct, useful for
// later diagnostics — e.g. "did the market move toward or away from
// our side after we published our pick?"
//
// Both books queried in parallel; either failing shouldn't abort the
// other capture. Idempotent within a single 30-min bucket: if the cron
// fires twice at the same minute (retry, manual trigger), the second
// insert wins because captured_at differs by microseconds; readers
// pick the latest.

import { NextResponse } from "next/server";
import { todayInET, isValidIsoDate } from "@/lib/dates";
import {
  captureEspnOddsForDate,
  captureFanDuelNrfiForDate,
} from "@/lib/sports/mlb/odds-cache";

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
    return NextResponse.json({ error: `no odds poll for sport=${sport}` }, { status: 501 });
  }
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const [espnResult, fdResult] = await Promise.allSettled([
    captureEspnOddsForDate(date),
    captureFanDuelNrfiForDate(date),
  ]);

  const espn = espnResult.status === "fulfilled" ? espnResult.value : null;
  const espnError = espnResult.status === "rejected" ? (espnResult.reason as Error).message : null;
  const fd = fdResult.status === "fulfilled" ? fdResult.value : null;
  const fdError = fdResult.status === "rejected" ? (fdResult.reason as Error).message : null;

  if (espnError) console.error(`[predictions-odds-poll] ESPN capture failed: ${espnError}`);
  if (fdError)   console.error(`[predictions-odds-poll] FanDuel capture failed: ${fdError}`);

  return NextResponse.json({
    ok: true,
    date,
    espn: espn ? {
      matched: espn.matched, withMl: espn.withMl,
      inserted: espn.upserted, unmatched: espn.unmatched.length,
    } : null,
    ...(espnError ? { espn_error: espnError } : {}),
    fanduel: fd ? {
      matched: fd.matched, withNrfi: fd.withNrfi,
      inserted: fd.upserted, unmatched: fd.unmatched.length,
    } : null,
    ...(fdError ? { fanduel_error: fdError } : {}),
  });
}
