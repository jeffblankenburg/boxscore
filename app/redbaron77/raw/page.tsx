import { notFound } from "next/navigation";
import { loadGameBoxHtml } from "@/lib/historical/render-game";
import { ShareCard } from "../../ShareCard";
import { REDBARON_GAMES } from "../games";

// Screenshot source for scripts/gen-redbaron77-images.ts — renders each
// box-score card standalone on a plain background so the generator can clip
// [data-rb-card] to a tight PNG. Not meant for human visitors; the public
// /redbaron77 page shows the generated images instead.

export const dynamic = "force-dynamic";
export const metadata = {
  title: "boxscore",
  robots: { index: false, follow: false },
};

export default async function RedBaronRaw() {
  const cards = await Promise.all(REDBARON_GAMES.map((g) => loadGameBoxHtml(g.gamePk)));
  const loaded = cards.filter((c): c is NonNullable<typeof c> => c !== null);
  if (loaded.length === 0) notFound();

  return (
    <div style={{ background: "#fff", padding: 24, display: "flex", flexDirection: "column", gap: 40, alignItems: "flex-start" }}>
      {loaded.map((box) => (
        <ShareCard key={box.gameDate + box.awayName} box={box} />
      ))}
    </div>
  );
}
