import type { HistoricalBox } from "@/lib/historical/render-game";
import { prettyDate } from "@/lib/dates";
import { BRAND } from "@/lib/brand";

// One box score in the standard boxscore social-image chrome: cream card,
// logo + wordmark + game-date header, the renderGame() box score, and a
// tagline + marketing-URL footer. Fixed 600px width so the screenshot
// generator (scripts/gen-redbaron77-images.ts) produces a consistent
// 1200px-wide PNG at DPR 2. data-rb-card marks it for the screenshotter.

const PAPER = "#f9f7f1";
const INK = "#161410";
const RULE = "#c4baa5";
const MUTED = "#6a6354";

export function ShareCard({ box }: { box: HistoricalBox }) {
  return (
    <div
      data-rb-card=""
      style={{
        width: 600,
        background: PAPER,
        border: `1px solid ${INK}`,
        padding: "28px 32px 24px",
        boxSizing: "border-box",
        fontFamily: "'Source Sans 3', Helvetica, Arial, sans-serif",
        color: INK,
      }}
    >
      {/* Header — logo + wordmark left, game date right. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `2px solid ${INK}`, paddingBottom: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 28, fontWeight: 800, letterSpacing: "-0.01em" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" width={40} height={40} style={{ borderRadius: 6, display: "block" }} />
          boxscore
        </div>
        <div style={{ fontSize: 16, fontStyle: "italic", color: MUTED }}>{prettyDate(box.gameDate)}</div>
      </div>

      {/* renderGame() output, styled by globals.css (classes aren't .newspaper-scoped). */}
      <div dangerouslySetInnerHTML={{ __html: box.html }} />

      {/* Footer — tagline left, marketing URL right. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: `2px solid ${RULE}`, marginTop: 16, paddingTop: 12, fontSize: 14, color: INK }}>
        <div style={{ fontStyle: "italic", color: MUTED }}>{BRAND.tagline}</div>
        <div style={{ letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700 }}>boxscore.email/mlb</div>
      </div>
    </div>
  );
}
