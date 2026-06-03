// The 1200×630 scoreboard image rendered at /share/mlb/[date] and previewed
// in /admin/share-preview. Same component renders both — Puppeteer will
// screenshot the share page; the admin page scales it to fit a comparison
// grid. Exported as a server component because there's no client behavior.

import { BRAND } from "./brand";

export type ScoreTile = {
  away: string;
  home: string;
  aR: number;
  hR: number;
};

export function ScoreboardImage({
  scores,
  date,
}: {
  scores: ScoreTile[];
  date: string; // pretty-formatted, e.g. "Tuesday, June 2, 2026"
}) {
  return (
    <div style={{
      width: 1200, height: 630,
      background: "#f9f7f1",
      fontFamily: "'Source Sans 3', Helvetica, Arial, sans-serif",
      color: "#161410",
      padding: "30px 48px 32px",
      boxSizing: "border-box",
      display: "flex", flexDirection: "column",
    }}>
      {/* Brand strip — matches the site header: 800-weight Source Sans 3
          wordmark next to a square logo at the same 1.56:1 height ratio. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #161410", paddingBottom: 14 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          fontFamily: "'Source Sans 3', 'Segoe UI', Helvetica, Arial, sans-serif",
          fontSize: 36, fontWeight: 800, letterSpacing: "-0.01em",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" width={56} height={56} style={{ borderRadius: 8, display: "block" }} />
          boxscore
        </div>
        <div style={{ fontSize: 22, fontStyle: "italic", color: "#161410" }}>{date}</div>
      </div>

      <ScoreboardGrid scores={scores} />

      {/* Footer — same tagline as the site footer (BRAND.tagline). */}
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid #161410", display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 14, color: "#161410" }}>
        <div style={{ fontStyle: "italic" }}>{BRAND.tagline}</div>
        <div style={{ letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700 }}>boxscore.email/mlb</div>
      </div>
    </div>
  );
}

// 5×3 grid of completed-game tiles. Renders as many as we have, up to 15.
// Fewer days leave empty cells at the bottom-right (left-aligned fill).
function ScoreboardGrid({ scores }: { scores: ScoreTile[] }) {
  return (
    <div style={{
      flex: 1,
      display: "grid",
      gridTemplateColumns: "repeat(5, 1fr)",
      gridTemplateRows: "repeat(3, 1fr)",
      gap: "10px 14px",
      marginTop: 14,
    }}>
      {scores.slice(0, 15).map((g, i) => <Tile key={i} g={g} />)}
    </div>
  );
}

function Tile({ g }: { g: ScoreTile }) {
  const awayWon = g.aR > g.hR;
  return (
    <div
      // data-share-tile lets the share-image renderer count games from the
      // rendered DOM (used by social-post captions and the manifest entry).
      data-share-tile=""
      style={{
        border: "1px solid #161410",
        background: "#fff",
        padding: "10px 14px",
        fontVariantNumeric: "tabular-nums",
        display: "flex", flexDirection: "column", justifyContent: "center",
      }}
    >
      <Row tla={g.away} r={g.aR} winner={awayWon} />
      <Row tla={g.home} r={g.hR} winner={!awayWon} />
    </div>
  );
}

function Row({ tla, r, winner }: { tla: string; r: number; winner: boolean }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      padding: "3px 0",
    }}>
      <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "0.03em", color: winner ? "#161410" : "#6a6354" }}>{tla}</span>
      <span style={{ fontSize: 32, fontWeight: 900, color: winner ? "#161410" : "#9a9282" }}>{r}</span>
    </div>
  );
}
