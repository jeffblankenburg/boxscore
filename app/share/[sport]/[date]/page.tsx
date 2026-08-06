import { notFound } from "next/navigation";
import { isValidIsoDate, prettyDate } from "@/lib/dates";
import { ScoreboardImage } from "@/lib/scoreboard-image";
import { scoreTilesForSport, scoreboardGamesDate } from "@/lib/scoreboard-tiles";

// The 1200×630 scoreboard canvas Puppeteer screenshots for the day's share
// image (also the og:image for /[sport]/[date] link previews). Generic across
// sports — MLB keeps its own /share/mlb/[date] route (static segment wins), so
// this serves nba/wnba/nfl/ncaaf. URL date is the EDITION date; games are the
// previous day's. Not for human visitors; the og:image route serves the PNG.
//
// Site chrome is stripped by the .share-image-canvas :has() rule in globals.css
// so the capture is a clean 1200×630 viewport.

export const dynamic = "force-dynamic";
export const metadata = { title: "Share image", robots: { index: false, follow: false } };

const SUPPORTED = new Set(["mlb", "nba", "wnba", "nfl", "ncaaf"]);

export default async function ShareImageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string; date: string }>;
  searchParams: Promise<{ conf?: string }>;
}) {
  const { sport, date: editionDate } = await params;
  if (!SUPPORTED.has(sport) || !isValidIsoDate(editionDate)) notFound();
  const { conf } = await searchParams;

  const gamesDate = scoreboardGamesDate(editionDate);
  const scores = await scoreTilesForSport(sport, gamesDate, { ncaafScope: conf });

  // NCAAF fans out into a Top 25 board + one per conference; label each so the
  // image is self-describing on social. Other sports have a single board.
  let label: string | undefined;
  if (sport === "ncaaf") {
    if (conf && conf !== "top25") {
      const { findConferenceBySlug } = await import("@/lib/sports/football/conferences");
      label = findConferenceBySlug(conf)?.short;
    } else {
      label = "Top 25";
    }
  }

  return (
    <div className="share-image-canvas">
      {/* Dated by the GAMES date (what the scoreboard shows), not the edition
          date in the URL — a standalone share should describe its content. */}
      <ScoreboardImage scores={scores} date={prettyDate(gamesDate)} sport={sport} label={label} />
    </div>
  );
}
