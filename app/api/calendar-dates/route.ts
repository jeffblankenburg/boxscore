import { NextResponse } from "next/server";
import { listAllDigestDates } from "@/lib/digests";
import { listAllTeamDigestKeys } from "@/lib/team-digests";
import { nextDay } from "@/lib/dates";

// Returns the set of EDITION dates (URL date segments) that have a digest
// for the given sport, optionally narrowed to a single team. Powers the
// date-header calendar popover.
//
// Cached for 1 hour; refreshes naturally on the next request after expiry.
// Acceptable staleness because the calendar is an aid for browsing past
// editions — the new date appears in the dropdown within an hour of the
// daily generate cron, which is well before anyone notices it's missing.
export const revalidate = 3600;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sport = url.searchParams.get("sport") ?? "mlb";
  const team = url.searchParams.get("team");

  if (team) {
    const keys = await listAllTeamDigestKeys(sport);
    const dates = keys
      .filter((k) => k.team_slug === team)
      .map((k) => nextDay(k.date));
    return NextResponse.json({ dates });
  }

  const games = await listAllDigestDates(sport);
  const dates = games.map((d) => nextDay(d));
  return NextResponse.json({ dates });
}
