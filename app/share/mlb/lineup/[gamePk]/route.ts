// Renders one game's lineup card as a full HTML document (issue #140). Serves as
// both the browser preview and the page the share-image pipeline screenshots to
// a PNG. Navigate to /share/mlb/lineup/{gamePk} — use a gamePk whose lineups are
// posted (e.g. any game once the card would fire, ~1-3h pregame).
//
// Odds are SAMPLE values for now — the real ML/run-line/total capture is the
// next step in #140. The layout is final.

import { NextResponse } from "next/server";
import { loadLineupCard, loadCardOdds } from "@/lib/sports/mlb/lineup-card";
import { renderLineupCardHtml } from "@/lib/sports/mlb/lineup-card-image";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ gamePk: string }> },
) {
  const { gamePk } = await params;
  const pk = Number(gamePk);
  if (!Number.isFinite(pk)) return new NextResponse("bad gamePk", { status: 400 });

  const data = await loadLineupCard(pk);
  if (!data) {
    return new NextResponse(
      `<!DOCTYPE html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px">` +
      `<p>No card for game ${pk} — lineups aren't posted yet (both teams need a 9-man lineup).</p>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  // Real odds: ML/run-line/total fresh from ESPN + NRFI from daily_odds.
  const odds = await loadCardOdds(data.date);
  data.odds = odds(data.away.abbr, data.home.abbr);

  return new NextResponse(renderLineupCardHtml(data, "/icon.png"), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
