import { notFound } from "next/navigation";
import { loadGameBoxHtml } from "@/lib/historical/render-game";
import { ShareCard } from "../../../../ShareCard";
import { isValidIsoDate } from "@/lib/dates";

// Screenshot source for the /mlb/art/image/[gamePk] route: one box-score card
// standalone on a plain background. The image route points headless Chrome
// here and clips [data-rb-card]. `date` fills the card's dateline on the
// statsapi render path (2026 games). Not for human visitors.

export const dynamic = "force-dynamic";
export const metadata = { title: "boxscore", robots: { index: false, follow: false } };

export default async function BoxArtRaw({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string; gamePk: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { sport, gamePk } = await params;
  if (sport !== "mlb") notFound();
  const pk = Number(gamePk);
  if (!Number.isFinite(pk) || pk <= 0) notFound();

  const { date } = await searchParams;
  const box = await loadGameBoxHtml(pk, date && isValidIsoDate(date) ? date : undefined);
  if (!box) notFound();

  return (
    <div style={{ background: "#fff", padding: 24, display: "inline-block" }}>
      <ShareCard box={box} />
    </div>
  );
}
