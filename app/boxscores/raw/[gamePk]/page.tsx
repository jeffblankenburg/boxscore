import { notFound } from "next/navigation";
import { loadHistoricalBoxHtml } from "@/lib/historical/render-game";
import { ShareCard } from "../../ShareCard";

// Screenshot source for the /boxscores/image/[gamePk] route: one box-score
// card standalone on a plain background. The image route points headless
// Chrome here and clips [data-rb-card]. Not for human visitors.

export const dynamic = "force-dynamic";
export const metadata = {
  title: "boxscore",
  robots: { index: false, follow: false },
};

export default async function BoxscoreRaw({ params }: { params: Promise<{ gamePk: string }> }) {
  const { gamePk } = await params;
  const pk = Number(gamePk);
  if (!Number.isFinite(pk) || pk <= 0) notFound();

  const box = await loadHistoricalBoxHtml(pk);
  if (!box) notFound();

  return (
    <div style={{ background: "#fff", padding: 24, display: "inline-block" }}>
      <ShareCard box={box} />
    </div>
  );
}
