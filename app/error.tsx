"use client";

// Segment-level error boundary. Catches anything a page or nested layout
// throws that isn't already a Next.js redirect/notFound. The root layout
// still renders (header/footer intact); this file owns the content area.
//
// Common trigger: Supabase 5xx / connection timeout blowing up a server
// component's DB call. Rather than surfacing a raw 500 to the visitor,
// we show a linescore-themed "having technical issues" screen with a
// retry button. The site chrome around it keeps working.

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side digests are opaque hashes; log them client-side so the
    // Vercel Runtime Logs → digest lookup still works if we're chasing
    // a specific incident.
    console.error("[boxscore error boundary]", error.digest ?? "no-digest", error);
  }, [error]);

  return (
    <>
      <div className="dateline">Rain Delay — Technical Difficulties</div>

      <div className="not-found-game">
        <div className="game-header">Uptime 0, Us 0 — F/Rain</div>
        <div className="team-line">
          <div className="team-name">Boxscore</div>
          <div className="team-score">{`000 000 0 X X  —  0  0  ?`}</div>
        </div>
        <div className="team-line">
          <div className="team-name">Uptime</div>
          <div className="team-score">{`000 000 0 X X  —  0  0  ?`}</div>
        </div>

        <div className="notes">
          <b>Delay:</b> Data services unreachable &nbsp;·&nbsp;
          <b>Status:</b> Investigating &nbsp;·&nbsp;
          <b>Resume:</b> When conditions clear
        </div>

        <div className="scoring-block">
          <div><span className="inn">T1 (0&ndash;0)</span> <span className="ev">Sorry — we&apos;re having technical issues on our end.</span></div>
          <div><span className="inn">T1 (0&ndash;0)</span> <span className="ev">This is usually short. The game will resume shortly.</span></div>
          <div>
            <span className="inn">T1 (0&ndash;0)</span>{" "}
            <span className="ev">
              <button
                type="button"
                onClick={reset}
                style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" }}
              >
                Try again
              </button>
              {" · or "}
              <Link href="/">head back to the front page</Link>.
            </span>
          </div>
        </div>

        <div className="gameinfo">
          <b>Venue:</b> The Internet &nbsp;·&nbsp;
          <b>Weather:</b> Overcast, chance of 5xx &nbsp;·&nbsp;
          <b>T:</b> Brief, we hope
          {error.digest ? <> &nbsp;·&nbsp; <b>Ref:</b> {error.digest}</> : null}
        </div>
      </div>
    </>
  );
}
