import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <div className="dateline">404 — Page Not Found</div>

      <div className="not-found-game">
        <div className="game-header">Internet 4, Your URL 0</div>
        <div className="team-line">
          <div className="team-name">Internet</div>
          <div className="team-score">{`404 000 000  —  4  0  4`}</div>
        </div>
        <div className="team-line">
          <div className="team-name">Your URL</div>
          <div className="team-score">{`000 000 000  —  0  0  0`}</div>
        </div>

        <div className="notes">
          <b>W:</b> Server (200&minus;0) &nbsp;·&nbsp;
          <b>L:</b> This URL (0&minus;404) &nbsp;·&nbsp;
          <b>Sv:</b> Browser Back Button (&infin;)
        </div>

        <div className="scoring-block">
          <div><span className="inn">T1 (1&ndash;0)</span> <span className="ev">Visitor swung at a URL no longer in the rotation.</span></div>
          <div><span className="inn">T1 (2&ndash;0)</span> <span className="ev">Server fielded the 404 cleanly. No play at the plate.</span></div>
          <div><span className="inn">T1 (3&ndash;0)</span> <span className="ev">Page retired the side in order.</span></div>
          <div><span className="inn">T1 (4&ndash;0)</span> <span className="ev">Visitor advanced safely home: <Link href="/">boxscore</Link>.</span></div>
        </div>

        <div className="gameinfo">
          <b>Venue:</b> The Internet &nbsp;·&nbsp;
          <b>Attendance:</b> 1 &nbsp;·&nbsp;
          <b>T:</b> 0:00 &nbsp;·&nbsp;
          <b>Weather:</b> 404, partly cloudy.
        </div>
      </div>
    </>
  );
}
