import { notFound } from "next/navigation";
import { loadDailyRaw } from "@/lib/daily";
import { postseasonBracketForDate } from "@/lib/sports/mlb/adapters/from-statsapi";
import { renderPostseasonBracketWeb } from "@/lib/sports/mlb/render/postseason";
import { isValidIsoDate, prettyDate, prevDay } from "@/lib/dates";

// The postseason bracket as a landscape social image. Puppeteer screenshots the
// `.bracket-share` element (see lib/render-images.ts); the site chrome is
// stripped by the body:has(.share-image-canvas) rules in globals.css. URL date
// is the EDITION date (matches /mlb/[date]); the bracket is built as-of the
// previous day's games, same as the digest. Not for human visitors.

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Bracket share image",
  robots: { index: false, follow: false },
};

export default async function BracketShareImage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date: editionDate } = await params;
  if (!isValidIsoDate(editionDate)) notFound();

  const gamesDate = prevDay(editionDate);
  const raw = await loadDailyRaw(gamesDate);
  const bracket = raw ? postseasonBracketForDate(raw, gamesDate) : null;
  // No bracket (not a postseason day) → 404 so the renderer skips it cleanly.
  if (!bracket || bracket.series.length === 0) notFound();

  return (
    <div className="share-image-canvas bracket-share">
      <div className="bracket-share-head">
        <span className="bracket-share-brand">boxscore</span>
        <span className="bracket-share-title">{bracket.season} MLB Postseason</span>
        {/* Dated by the games date — a standalone share should describe its
            content, not the publication day. */}
        <span className="bracket-share-date">{prettyDate(gamesDate)}</span>
      </div>
      {/* renderPostseasonBracketWeb emits both the wide + stacked layouts; at
          the 1200px canvas width the wide symmetric bracket shows. */}
      <div
        className="bracket-share-body"
        dangerouslySetInnerHTML={{ __html: renderPostseasonBracketWeb(bracket) }}
      />
    </div>
  );
}
