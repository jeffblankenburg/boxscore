import { NextResponse } from "next/server";
import { todayInET } from "@/lib/dates";
import { getPuzzleForDate } from "@/lib/games/teammates/generate";
import { getStoredPuzzle, savePuzzle } from "@/lib/games/teammates/store";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function addDaysET(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Generate today + the next few days' puzzles and store them, so page requests
// read a small row instead of loading the multi-MB player pool each time.
// Idempotent: skips dates already stored, so re-running is cheap. Generating a
// few days ahead means the day's puzzle is always ready before midnight ET.
export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // ?force=1 overwrites already-stored dates — used to refresh after a
  // generation-logic change (stored puzzles otherwise persist as-is).
  const force = new URL(req.url).searchParams.get("force") === "1";
  const AHEAD = 4;
  const start = todayInET();
  const generated: string[] = [];
  for (let k = 0; k <= AHEAD; k++) {
    const date = addDaysET(start, k);
    if (!force && (await getStoredPuzzle(date))) continue;
    await savePuzzle(date, getPuzzleForDate(date));
    generated.push(date);
  }
  return NextResponse.json({ ok: true, generated });
}
