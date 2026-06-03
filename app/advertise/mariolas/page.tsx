export const metadata = {
  title: "Mariola's Italian Kitchen — Two blocks from the ballpark",
  description: "Family-owned trattoria serving Naples-style pizza and house-made pasta since 1973. Open late on game nights.",
  robots: { index: false },
};

export default function MariolasPage() {
  return (
    <div className="sponsor-page mariolas-root">
      <style>{`
        .mariolas-root {
          --m-red: #8c1e1e;
          --m-cream: #f7ecd2;
          --m-deep: #4a0e0e;
          --m-olive: #5f6b3a;
          --m-gold: #c79b3c;
          --m-ink: #2b1410;
          background: var(--m-cream);
          color: var(--m-ink);
          font-family: Georgia, "Times New Roman", Times, serif;
          min-height: 100vh;
        }
        .mariolas-root * { box-sizing: border-box; }
        .mariolas-checker {
          height: 18px;
          background-image:
            linear-gradient(45deg, var(--m-red) 25%, transparent 25%, transparent 75%, var(--m-red) 75%),
            linear-gradient(45deg, var(--m-red) 25%, transparent 25%, transparent 75%, var(--m-red) 75%);
          background-size: 18px 18px;
          background-position: 0 0, 9px 9px;
          background-color: #fff;
        }
        .mariolas-bar {
          background: var(--m-deep);
          color: var(--m-cream);
          text-align: center;
          padding: 8px 12px;
          font-size: 14px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }
        .mariolas-bar b { color: var(--m-gold); }
        .mariolas-shell { max-width: 980px; margin: 0 auto; padding: 36px 28px 60px; }
        .mariolas-hero { text-align: center; padding: 18px 0 28px; }
        .mariolas-crest { display: inline-block; }
        .mariolas-name {
          font-style: italic;
          font-weight: 900;
          font-size: clamp(54px, 9vw, 96px);
          line-height: 0.95;
          color: var(--m-red);
          margin: 18px 0 6px;
          letter-spacing: -0.02em;
        }
        .mariolas-tag {
          font-size: 14px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--m-olive);
          font-style: normal;
        }
        .mariolas-tag span {
          display: inline-block; padding: 0 14px;
        }
        .mariolas-tag span + span { border-left: 1px solid var(--m-olive); }
        .mariolas-intro {
          max-width: 680px;
          margin: 28px auto 0;
          font-size: 18px;
          line-height: 1.7;
          font-style: italic;
          text-align: center;
        }
        .mariolas-section-title {
          text-align: center;
          font-size: 14px;
          letter-spacing: 0.36em;
          text-transform: uppercase;
          color: var(--m-red);
          font-weight: 700;
          margin: 56px 0 6px;
        }
        .mariolas-section-ornament {
          text-align: center;
          color: var(--m-gold);
          font-size: 18px;
          letter-spacing: 0.4em;
          margin-bottom: 22px;
        }
        .mariolas-menu {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 24px 48px;
        }
        @media (max-width: 700px) {
          .mariolas-menu { grid-template-columns: 1fr; }
        }
        .mariolas-dish {
          padding: 6px 0;
          border-bottom: 1px dotted var(--m-olive);
        }
        .mariolas-dish-row {
          display: flex; align-items: baseline; gap: 12px;
          font-weight: 700; font-size: 19px;
        }
        .mariolas-dish-name { font-style: italic; }
        .mariolas-dish-dots { flex: 1; border-bottom: 2px dotted var(--m-ink); transform: translateY(-4px); opacity: 0.4; }
        .mariolas-dish-price { color: var(--m-red); }
        .mariolas-dish-desc { font-size: 14px; line-height: 1.5; color: #5a3a30; margin-top: 2px; }
        .mariolas-hours-block {
          background: #fff;
          border: 1px solid var(--m-red);
          padding: 28px 32px;
          margin-top: 28px;
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 32px;
        }
        @media (max-width: 700px) {
          .mariolas-hours-block { grid-template-columns: 1fr; }
        }
        .mariolas-hours h3, .mariolas-find h3 {
          font-size: 13px; letter-spacing: 0.24em; text-transform: uppercase;
          color: var(--m-red); margin: 0 0 12px; font-weight: 700;
        }
        .mariolas-hours dl { margin: 0; font-size: 16px; }
        .mariolas-hours dt {
          float: left; clear: left; font-style: italic; padding-right: 16px;
          width: 130px;
        }
        .mariolas-hours dd { margin: 0 0 6px; }
        .mariolas-find { font-size: 16px; line-height: 1.6; }
        .mariolas-find b { font-style: italic; }
        .mariolas-game-night {
          margin-top: 28px;
          text-align: center;
          padding: 22px;
          background: var(--m-deep);
          color: var(--m-cream);
          font-size: 17px;
          line-height: 1.55;
        }
        .mariolas-game-night b { color: var(--m-gold); font-style: italic; }
        .mariolas-foot {
          text-align: center;
          margin-top: 48px;
          font-size: 12px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--m-olive);
        }
      `}</style>

      <div className="mariolas-checker" aria-hidden="true" />
      <div className="mariolas-bar">
        Family-Owned <b>·</b> Since 1973 <b>·</b> Two Blocks from the Ballpark
      </div>

      <div className="mariolas-shell">
        <header className="mariolas-hero">
          <div className="mariolas-crest" aria-hidden="true">
            <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="Mariola's tomato and basil crest">
              <circle cx="60" cy="60" r="56" fill="#fff" stroke="#8c1e1e" strokeWidth="3" />
              <circle cx="60" cy="60" r="50" fill="none" stroke="#c79b3c" strokeWidth="1" />
              {/* tomato */}
              <ellipse cx="60" cy="74" rx="22" ry="20" fill="#c8281f" />
              <path d="M52 56 Q60 50 68 56 Q66 62 60 60 Q54 62 52 56 Z" fill="#5f6b3a" />
              <line x1="60" y1="50" x2="60" y2="44" stroke="#5f6b3a" strokeWidth="2" />
              {/* basil leaves */}
              <path d="M38 44 Q30 36 36 28 Q46 32 44 44 Z" fill="#5f6b3a" />
              <path d="M82 44 Q90 36 84 28 Q74 32 76 44 Z" fill="#5f6b3a" />
              {/* monogram */}
              <text x="60" y="34" textAnchor="middle" fontFamily="Georgia, serif" fontStyle="italic" fontSize="14" fill="#4a0e0e" fontWeight="700">M</text>
            </svg>
          </div>
          <h1 className="mariolas-name">Mariola's</h1>
          <div className="mariolas-tag">
            <span>Italian Kitchen</span>
            <span>est. 1973</span>
            <span>Columbus</span>
          </div>

          <p className="mariolas-intro">
            Three generations of Mariolas have rolled the dough, simmered the
            gravy, and walked plates to the table. The menu hasn't changed
            much. Neither has the welcome.
          </p>
        </header>

        <div className="mariolas-section-title">Tonight's Kitchen</div>
        <div className="mariolas-section-ornament">✦ ✦ ✦</div>
        <div className="mariolas-menu">
          <div className="mariolas-dish">
            <div className="mariolas-dish-row">
              <span className="mariolas-dish-name">Bucatini all'Amatriciana</span>
              <span className="mariolas-dish-dots" />
              <span className="mariolas-dish-price">$22</span>
            </div>
            <div className="mariolas-dish-desc">Guanciale, San Marzano, pecorino romano, a slow turn of black pepper.</div>
          </div>
          <div className="mariolas-dish">
            <div className="mariolas-dish-row">
              <span className="mariolas-dish-name">Veal Saltimbocca</span>
              <span className="mariolas-dish-dots" />
              <span className="mariolas-dish-price">$32</span>
            </div>
            <div className="mariolas-dish-desc">Sage and prosciutto pounded in. White wine pan sauce.</div>
          </div>
          <div className="mariolas-dish">
            <div className="mariolas-dish-row">
              <span className="mariolas-dish-name">Margherita, Wood-Fired</span>
              <span className="mariolas-dish-dots" />
              <span className="mariolas-dish-price">$18</span>
            </div>
            <div className="mariolas-dish-desc">Fior di latte, hand-torn basil, 90 seconds in the oven.</div>
          </div>
          <div className="mariolas-dish">
            <div className="mariolas-dish-row">
              <span className="mariolas-dish-name">Eggplant Parmigiana</span>
              <span className="mariolas-dish-dots" />
              <span className="mariolas-dish-price">$24</span>
            </div>
            <div className="mariolas-dish-desc">Layered, baked, rested an hour. Nonna's recipe; no apologies.</div>
          </div>
          <div className="mariolas-dish">
            <div className="mariolas-dish-row">
              <span className="mariolas-dish-name">Tiramisù</span>
              <span className="mariolas-dish-dots" />
              <span className="mariolas-dish-price">$11</span>
            </div>
            <div className="mariolas-dish-desc">Espresso, mascarpone, savoiardi, dust of cocoa.</div>
          </div>
          <div className="mariolas-dish">
            <div className="mariolas-dish-row">
              <span className="mariolas-dish-name">House Chianti</span>
              <span className="mariolas-dish-dots" />
              <span className="mariolas-dish-price">$11 / $42</span>
            </div>
            <div className="mariolas-dish-desc">By the glass or by the bottle. Tuscany, 2022.</div>
          </div>
        </div>

        <div className="mariolas-hours-block">
          <div className="mariolas-hours">
            <h3>Hours</h3>
            <dl>
              <dt>Tue – Thu</dt><dd>5:00 PM – 10:00 PM</dd>
              <dt>Fri – Sat</dt><dd>5:00 PM – 11:30 PM</dd>
              <dt>Sunday</dt><dd>3:00 PM – 9:00 PM</dd>
              <dt>Monday</dt><dd><i>Famiglia. Chiuso.</i></dd>
            </dl>
          </div>
          <div className="mariolas-find">
            <h3>How to find us</h3>
            441 South High Street, two blocks south of the ballpark. Look
            for the <b>red awning</b> and the line on the sidewalk.
            <br /><br />
            Reservations welcome. Walk-ins fed.
            <br />
            <b>(614) 555-0190</b>
          </div>
        </div>

        <div className="mariolas-game-night">
          <b>Game-night special.</b> Show us the box score in your inbox and
          your first carafe of house red is on the kitchen. Postgame, every
          home stand.
        </div>

        <div className="mariolas-foot">
          ✦ Buon Appetito ✦ Mariola's Italian Kitchen ✦ Columbus, OH ✦
        </div>
      </div>

      <div className="mariolas-checker" aria-hidden="true" />
    </div>
  );
}
