import { notFound } from "next/navigation";
import { loadHistoricalBoxHtml } from "@/lib/historical/render-game";
import { prettyDate } from "@/lib/dates";
import { BRAND } from "@/lib/brand";

// Standalone vanity page: two specific 2025 Astros box scores rendered in the
// standard boxscore social-image chrome (cream card, wordmark + date header,
// tagline + URL footer — matches lib/scoreboard-image.tsx and the share
// images from lib/render-images.ts). Not linked from anywhere.

export const dynamic = "force-dynamic";
export const metadata = {
  title: "boxscore",
  robots: { index: false, follow: false },
};

const GAMES = [
  { gamePk: 776531 }, // 2025-08-30 LAA @ HOU
  { gamePk: 777494 }, // 2025-06-15 MIN @ HOU
];

const PAPER = "#f9f7f1";
const INK = "#161410";
const RULE = "#c4baa5";
const MUTED = "#6a6354";

export default async function RedBaron77() {
  const cards = await Promise.all(GAMES.map((g) => loadHistoricalBoxHtml(g.gamePk)));
  const loaded = cards.filter((c): c is NonNullable<typeof c> => c !== null);
  if (loaded.length === 0) notFound();

  return (
    <div style={{ background: "#e9e5da", padding: "28px 16px", minHeight: "100vh" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 }}>
        {loaded.map((c) => (
          <div
            key={c.gameDate + c.awayName}
            style={{
              background: PAPER,
              border: `1px solid ${INK}`,
              padding: "26px 30px 22px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
              fontFamily: "'Source Sans 3', Helvetica, Arial, sans-serif",
              color: INK,
            }}
          >
            {/* Share-image header — logo + wordmark left, game date right. */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `2px solid ${INK}`, paddingBottom: 12, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 26, fontWeight: 800, letterSpacing: "-0.01em" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icon.png" alt="" width={38} height={38} style={{ borderRadius: 6, display: "block" }} />
                boxscore
              </div>
              <div style={{ fontSize: 15, fontStyle: "italic", color: MUTED }}>{prettyDate(c.gameDate)}</div>
            </div>

            {/* The box score itself — renderGame() output, styled by globals.css.
                Box-score classes aren't .newspaper-scoped, so no wrapper needed. */}
            <div dangerouslySetInnerHTML={{ __html: c.html }} />

            {/* Share-image footer — tagline left, marketing URL right. */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: `2px solid ${RULE}`, marginTop: 16, paddingTop: 12, fontSize: 13, color: INK }}>
              <div style={{ fontStyle: "italic", color: MUTED }}>{BRAND.tagline}</div>
              <div style={{ letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700 }}>boxscore.email/mlb</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
