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
  aRank?: number; // AP rank of the away team (NCAAF); undefined = unranked
  hRank?: number;
};

export function ScoreboardImage({
  scores,
  date,
  sport = "mlb",
  label,
}: {
  scores: ScoreTile[];
  date: string; // pretty-formatted, e.g. "Tuesday, June 2, 2026"
  sport?: string; // footer URL: boxscore.email/{sport}
  label?: string; // optional scope label (e.g. "Top 25", "SEC")
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
        <div style={{ textAlign: "right" }}>
          {label && (
            <div style={{ fontSize: 18, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
          )}
          <div style={{ fontSize: 22, fontStyle: "italic", color: "#161410" }}>{date}</div>
        </div>
      </div>

      <ScoreboardGrid scores={scores} />

      {/* Footer — same tagline as the site footer (BRAND.tagline). */}
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid #161410", display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 14, color: "#161410" }}>
        <div style={{ fontStyle: "italic" }}>{BRAND.tagline}</div>
        <div style={{ letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700 }}>boxscore.email/{sport}</div>
      </div>
    </div>
  );
}

// Drawing area for the grid inside the 1200×630 canvas, after the brand header,
// footer, and page padding. Deliberately a hair under the true available height
// so a bottom row of tiles never bleeds into the footer.
const GRID_W = 1104;
const GRID_H = 440;
// Up to five games per row; a sixth wraps to a new row. Tiles fill left-to-right
// and are top-left justified, so one game is a single box in the top-left corner
// — the same box size as any tile in a five-across row.
const COLS = 5;
// Every tile is sized to this width:height ratio so it always reads as a box,
// never the tall ribbon a lone game used to stretch into (fixed 2026-08).
const TILE_AR = 1.5;
const GAP_X = 14;
const GAP_Y = 10;

// Grid of completed-game tiles — renders EVERY game (NCAAF Saturdays run past 20
// on the Top 25 board). Fixed five-wide, top-left justified; tiles hold a
// constant box size until enough rows stack that they must shrink uniformly to
// keep the whole grid inside the fixed 1200×630 canvas.
function ScoreboardGrid({ scores }: { scores: ScoreTile[] }) {
  const n = Math.max(scores.length, 1);
  const cols = Math.min(n, COLS);
  const rows = Math.ceil(n / COLS);
  // The canonical box: width if five sit across, height from the box ratio.
  const fullW = (GRID_W - GAP_X * (COLS - 1)) / COLS;
  const fullH = fullW / TILE_AR;
  // Only shrink (keeping the ratio) once the stacked rows wouldn't otherwise
  // fit the canvas height; few-row slates keep the full box size.
  const rowH = (GRID_H - GAP_Y * (rows - 1)) / rows;
  const tileH = Math.floor(Math.min(fullH, rowH));
  const tileW = Math.round(tileH * TILE_AR);
  // Text tracks the box size so it fills a full-size tile and shrinks with it.
  const scale = Math.max(tileH / fullH, 0.45);
  return (
    <div style={{
      flex: 1,
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, ${tileW}px)`,
      gridTemplateRows: `repeat(${rows}, ${tileH}px)`,
      justifyContent: "start",
      alignContent: "start",
      gap: `${Math.round(GAP_Y * scale)}px ${Math.round(GAP_X * scale)}px`,
      marginTop: 14,
      minHeight: 0,
    }}>
      {scores.map((g, i) => <Tile key={i} g={g} scale={scale} />)}
    </div>
  );
}

function Tile({ g, scale }: { g: ScoreTile; scale: number }) {
  const awayWon = g.aR > g.hR;
  return (
    <div
      // data-share-tile lets the share-image renderer count games from the
      // rendered DOM (used by social-post captions and the manifest entry).
      data-share-tile=""
      style={{
        border: "1px solid #161410",
        background: "#fff",
        padding: `${Math.round(10 * scale)}px ${Math.round(14 * scale)}px`,
        fontVariantNumeric: "tabular-nums",
        display: "flex", flexDirection: "column", justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <Row tla={g.away} r={g.aR} winner={awayWon} rank={g.aRank} scale={scale} />
      <Row tla={g.home} r={g.hR} winner={!awayWon} rank={g.hRank} scale={scale} />
    </div>
  );
}

function Row({ tla, r, winner, rank, scale }: { tla: string; r: number; winner: boolean; rank?: number; scale: number }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      padding: `${Math.round(3 * scale)}px 0`,
    }}>
      <span style={{ fontSize: Math.round(30 * scale), fontWeight: 800, letterSpacing: "0.03em", color: winner ? "#161410" : "#6a6354" }}>
        {tla}
        {/* AP rank as a smaller raised superscript AFTER the abbr, so the team
            names stay left-aligned across every tile ("OSU¹"). */}
        {rank != null && (
          <span style={{ fontSize: Math.round(16 * scale), fontWeight: 700, color: winner ? "#161410" : "#6a6354", position: "relative", top: Math.round(-10 * scale), marginLeft: 3 }}>{rank}</span>
        )}
      </span>
      <span style={{ fontSize: Math.round(32 * scale), fontWeight: 900, color: winner ? "#161410" : "#9a9282" }}>{r}</span>
    </div>
  );
}
