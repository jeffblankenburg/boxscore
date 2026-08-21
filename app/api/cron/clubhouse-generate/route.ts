import { NextResponse } from "next/server";
import { todayInET } from "@/lib/dates";
import { getPuzzleForDate, getAnchorPuzzleForDate } from "@/lib/games/clubhouse/generate";
import { savePuzzle, getRecentPuzzleTiles, getUsedAnchorIds } from "@/lib/games/clubhouse/store";

const WINDOW = 7;      // no player repeats within this many days
const TEAM_WINDOW = 5; // no franchise repeats within this many days

// Anchor days: one of the 16 is quietly eligible for all four teams. ~2×/week
// (Wed + Sat, by UTC weekday) so it stays a "from time to time" surprise, never
// signposted. Non-anchor days — and any anchor day that can't build — fall back
// to the normal generator.
const ANCHOR_DOWS = new Set([3, 6]);
function isAnchorDay(iso: string): boolean {
  return ANCHOR_DOWS.has(new Date(`${iso}T12:00:00Z`).getUTCDay());
}

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

  // Seed the rolling window with recent stored puzzles (so today excludes the
  // real prior week), then generate forward in date order threading exclusions.
  const byDate = new Map<string, { ids: number[]; teams: string[] }>();
  for (const r of await getRecentPuzzleTiles(addDaysET(start, -WINDOW))) byDate.set(r.date, { ids: r.ids, teams: r.teams });

  // Anchors are never reused across the whole history, so seed from every
  // stored puzzle, and grow the set as we generate this batch's anchor days.
  const usedAnchors = await getUsedAnchorIds();

  const generated: string[] = [];
  for (let k = 0; k <= AHEAD; k++) {
    const date = addDaysET(start, k);
    if (!force && byDate.has(date)) continue; // already stored (stays in the window)
    const exclude = new Set<number>();
    const excludeTeams = new Set<string>();
    for (let d = 1; d <= WINDOW; d++) for (const id of byDate.get(addDaysET(date, -d))?.ids ?? []) exclude.add(id);
    for (let d = 1; d <= TEAM_WINDOW; d++) for (const t of byDate.get(addDaysET(date, -d))?.teams ?? []) excludeTeams.add(t);
    const puzzle =
      (isAnchorDay(date) ? getAnchorPuzzleForDate(date, exclude, excludeTeams, usedAnchors) : null) ??
      getPuzzleForDate(date, exclude, excludeTeams);
    if (typeof puzzle.anchor === "number") usedAnchors.add(puzzle.anchor);
    await savePuzzle(date, puzzle);
    byDate.set(date, { ids: puzzle.tiles.map((t) => t.id), teams: puzzle.groups.map((g) => g.team) });
    generated.push(date);
  }
  return NextResponse.json({ ok: true, generated });
}
