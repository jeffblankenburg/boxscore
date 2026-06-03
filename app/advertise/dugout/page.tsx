export const metadata = {
  title: "The Dugout Tavern — Gameday HQ",
  description: "Every televised game, every night. $4 drafts through the 7th inning. 1820 Westwood Ave.",
  robots: { index: false },
};

export default function DugoutPage() {
  return (
    <div className="sponsor-page dugout-root">
      <style>{`
        .dugout-root {
          --d-wood: #2a1810;
          --d-wood-deep: #18100a;
          --d-felt: #1a4d2e;
          --d-felt-light: #2a6b46;
          --d-cream: #f4ecd6;
          --d-neon: #ffd040;
          --d-neon-glow: #fff097;
          --d-red: #b51e1f;
          --d-chalk: #e9e2c8;
          background: var(--d-wood);
          color: var(--d-cream);
          font-family: "Oswald", "Impact", "Arial Black", sans-serif;
          min-height: 100vh;
        }
        .dugout-root * { box-sizing: border-box; }
        .dugout-hero {
          background:
            repeating-linear-gradient(
              90deg,
              var(--d-wood-deep) 0px,
              var(--d-wood-deep) 22px,
              #211309 22px,
              #211309 44px
            );
          padding: 60px 28px 70px;
          border-bottom: 6px solid var(--d-felt);
          text-align: center;
        }
        .dugout-eyebrow {
          font-size: 13px;
          letter-spacing: 0.46em;
          color: var(--d-neon);
          text-transform: uppercase;
          margin-bottom: 22px;
          text-shadow: 0 0 12px rgba(255, 208, 64, 0.6);
        }
        .dugout-crest { display: block; margin: 0 auto 22px; filter: drop-shadow(0 0 8px rgba(255,208,64,0.45)); }
        .dugout-name {
          font-size: clamp(64px, 11vw, 130px);
          font-weight: 900;
          letter-spacing: 0.04em;
          line-height: 0.9;
          margin: 0;
          text-transform: uppercase;
          color: var(--d-neon);
          text-shadow:
            0 0 6px var(--d-neon-glow),
            0 0 18px rgba(255, 208, 64, 0.5),
            0 0 40px rgba(255, 208, 64, 0.2);
        }
        .dugout-sub {
          font-size: clamp(22px, 3vw, 32px);
          color: var(--d-cream);
          margin: 6px 0 0;
          letter-spacing: 0.4em;
          text-transform: uppercase;
        }
        .dugout-tag {
          margin-top: 28px;
          display: inline-block;
          padding: 10px 22px;
          background: var(--d-red);
          color: var(--d-cream);
          font-size: 16px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          transform: rotate(-1deg);
          box-shadow: 4px 4px 0 var(--d-wood-deep);
        }

        .dugout-stripe {
          background: var(--d-felt);
          padding: 22px 28px;
          text-align: center;
          color: var(--d-cream);
          font-size: clamp(22px, 3vw, 28px);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          border-bottom: 6px solid var(--d-wood-deep);
        }
        .dugout-stripe b { color: var(--d-neon); }

        .dugout-shell { max-width: 1100px; margin: 0 auto; padding: 56px 28px 0; }

        .dugout-rail {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 40px;
        }
        @media (max-width: 800px) { .dugout-rail { grid-template-columns: 1fr; } }

        .dugout-rail h2 {
          font-size: 14px;
          color: var(--d-neon);
          letter-spacing: 0.42em;
          text-transform: uppercase;
          margin: 0 0 16px;
          padding-bottom: 8px;
          border-bottom: 2px solid var(--d-neon);
        }

        .dugout-deals {
          background:
            linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.0)),
            var(--d-wood-deep);
          padding: 28px;
          border: 3px solid var(--d-cream);
        }
        .dugout-deals .price-list { display: flex; flex-direction: column; gap: 14px; font-family: "Special Elite", Georgia, serif; }
        .dugout-deals .price-row {
          display: flex; align-items: baseline;
          font-size: 18px;
          color: var(--d-chalk);
          letter-spacing: 0.02em;
        }
        .dugout-deals .price-row .label { font-weight: 700; }
        .dugout-deals .price-row .dots { flex: 1; border-bottom: 2px dotted rgba(255,255,255,0.3); transform: translateY(-3px); margin: 0 10px; }
        .dugout-deals .price-row .price { color: var(--d-neon); font-weight: 900; }

        .dugout-schedule {
          padding: 28px;
          background: rgba(26, 77, 46, 0.2);
          border: 3px dashed var(--d-felt-light);
        }
        .dugout-schedule ul { list-style: none; margin: 0; padding: 0; }
        .dugout-schedule li {
          display: flex; gap: 14px; align-items: baseline;
          padding: 10px 0;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          font-size: 16px;
          color: var(--d-cream);
        }
        .dugout-schedule li:last-child { border-bottom: none; }
        .dugout-schedule .day {
          color: var(--d-neon);
          font-weight: 700;
          width: 72px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          font-size: 14px;
        }

        .dugout-rules {
          margin-top: 56px;
          background: var(--d-felt);
          padding: 36px 28px;
          text-align: center;
        }
        .dugout-rules h2 {
          color: var(--d-cream);
          font-size: 14px; letter-spacing: 0.42em;
          text-transform: uppercase; margin: 0 0 16px;
        }
        .dugout-rules .three-rules {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 22px;
          max-width: 900px;
          margin: 0 auto;
        }
        @media (max-width: 720px) { .dugout-rules .three-rules { grid-template-columns: 1fr; } }
        .dugout-rule {
          padding: 18px;
          background: var(--d-wood-deep);
          border-top: 4px solid var(--d-neon);
          color: var(--d-cream);
        }
        .dugout-rule .n {
          color: var(--d-neon);
          font-size: 38px;
          font-weight: 900;
          line-height: 1;
        }
        .dugout-rule .t {
          margin-top: 8px;
          font-size: 15px;
          letter-spacing: 0.06em;
          line-height: 1.5;
          font-family: Georgia, serif;
          font-weight: 400;
          text-transform: none;
        }

        .dugout-foot {
          background: var(--d-wood-deep);
          padding: 36px 28px 50px;
          text-align: center;
          border-top: 4px solid var(--d-neon);
        }
        .dugout-foot .address {
          font-size: clamp(22px, 3vw, 30px);
          color: var(--d-neon);
          letter-spacing: 0.18em;
          margin: 0;
        }
        .dugout-foot .city {
          margin: 6px 0 22px;
          font-size: 16px;
          letter-spacing: 0.3em;
          color: var(--d-cream);
          text-transform: uppercase;
        }
        .dugout-foot .nope {
          margin-top: 18px;
          font-size: 12px;
          color: var(--d-cream);
          opacity: 0.55;
          font-style: italic;
          font-family: Georgia, serif;
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0.02em;
        }
      `}</style>

      <section className="dugout-hero">
        <div className="dugout-eyebrow">Westside · Since 1987</div>
        <svg className="dugout-crest" width="100" height="100" viewBox="0 0 100 100" role="img" aria-label="The Dugout Tavern crest — crossed bats and a baseball">
          <circle cx="50" cy="50" r="44" fill="#1a4d2e" stroke="#ffd040" strokeWidth="3" />
          <g stroke="#f4ecd6" strokeWidth="6" strokeLinecap="round">
            <line x1="22" y1="22" x2="78" y2="78" />
            <line x1="78" y1="22" x2="22" y2="78" />
          </g>
          <circle cx="50" cy="50" r="14" fill="#f4ecd6" />
          <path d="M42 46 Q50 50 58 46" stroke="#b51e1f" strokeWidth="1.5" fill="none" />
          <path d="M42 54 Q50 50 58 54" stroke="#b51e1f" strokeWidth="1.5" fill="none" />
        </svg>
        <h1 className="dugout-name">The Dugout</h1>
        <div className="dugout-sub">Tavern</div>
        <div className="dugout-tag">Gameday HQ</div>
      </section>

      <div className="dugout-stripe">
        Every Televised Game · Every Night · <b>14 Screens</b>
      </div>

      <div className="dugout-shell">
        <div className="dugout-rail">
          <section className="dugout-deals">
            <h2>The Lineup</h2>
            <div className="price-list">
              <div className="price-row">
                <span className="label">Drafts thru the 7th</span>
                <span className="dots" />
                <span className="price">$4</span>
              </div>
              <div className="price-row">
                <span className="label">Drafts after the 7th</span>
                <span className="dots" />
                <span className="price">$5</span>
              </div>
              <div className="price-row">
                <span className="label">Whiskey shot &amp; a beer</span>
                <span className="dots" />
                <span className="price">$7</span>
              </div>
              <div className="price-row">
                <span className="label">Stadium dog &amp; fries</span>
                <span className="dots" />
                <span className="price">$8</span>
              </div>
              <div className="price-row">
                <span className="label">Wings, dozen</span>
                <span className="dots" />
                <span className="price">$11</span>
              </div>
              <div className="price-row">
                <span className="label">Pitcher of the house</span>
                <span className="dots" />
                <span className="price">$14</span>
              </div>
            </div>
          </section>

          <section className="dugout-schedule">
            <h2>This Week's Specials</h2>
            <ul>
              <li><span className="day">Mon</span> Free pool, all night</li>
              <li><span className="day">Tue</span> Trivia at 8 — sports round at 9</li>
              <li><span className="day">Wed</span> $2 off all pitchers</li>
              <li><span className="day">Thu</span> Wing night — 50¢ per</li>
              <li><span className="day">Fri</span> Live jukebox, half-priced shots</li>
              <li><span className="day">Sat</span> First pitch, first round on us</li>
              <li><span className="day">Sun</span> Kitchen open till midnight</li>
            </ul>
          </section>
        </div>

        <section className="dugout-rules">
          <h2>House Rules</h2>
          <div className="three-rules">
            <div className="dugout-rule">
              <div className="n">1.</div>
              <div className="t">If you don't want to watch the game, sit at the bar. Booths are for the diehards.</div>
            </div>
            <div className="dugout-rule">
              <div className="n">2.</div>
              <div className="t">No phone arguments about box scores. We have a copy on the rail.</div>
            </div>
            <div className="dugout-rule">
              <div className="n">3.</div>
              <div className="t">If you brought a glove, the next round is on the house. We're not joking.</div>
            </div>
          </div>
        </section>
      </div>

      <footer className="dugout-foot">
        <p className="address">1820 WESTWOOD AVENUE</p>
        <p className="city">Open Until 1 AM · Kitchen Till Midnight</p>
        <p className="nope">Must be 21 to drink. Don't drive drunk. Tip your bartender.</p>
      </footer>
    </div>
  );
}
