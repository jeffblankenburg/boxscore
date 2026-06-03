export const metadata = {
  title: "Fairview Cigars & Lounge",
  description: "Walk-in humidor, member's lounge, and the game still on the radio. Open six nights a week.",
  robots: { index: false },
};

export default function FairviewPage() {
  return (
    <div className="sponsor-page fairview-root">
      <style>{`
        .fairview-root {
          --f-mahogany: #3a1d12;
          --f-bordeaux: #5a1622;
          --f-brass: #c7a24a;
          --f-cream: #ece1c8;
          --f-ink: #1a0d08;
          --f-charcoal: #2a1f17;
          background:
            radial-gradient(ellipse at 50% 0%, #2a1209 0%, #1a0d08 70%),
            #1a0d08;
          color: var(--f-cream);
          font-family: "Baskerville", "Times New Roman", Times, serif;
          min-height: 100vh;
        }
        .fairview-root * { box-sizing: border-box; }
        .fairview-shell { max-width: 980px; margin: 0 auto; padding: 36px 28px 80px; }
        .fairview-top-rule {
          height: 0; border-top: 2px solid var(--f-brass);
          margin-bottom: 4px;
        }
        .fairview-thin-rule {
          height: 0; border-top: 1px solid var(--f-brass);
          margin-bottom: 36px;
        }
        .fairview-eyebrow {
          text-align: center;
          font-size: 11px;
          letter-spacing: 0.6em;
          text-transform: uppercase;
          color: var(--f-brass);
          margin: 0 0 18px;
          padding-left: 0.6em; /* compensate letter-spacing trailing */
        }
        .fairview-crest { display: block; margin: 0 auto 18px; }
        .fairview-name {
          text-align: center;
          font-size: clamp(50px, 8vw, 86px);
          line-height: 0.95;
          font-weight: 400;
          letter-spacing: 0.04em;
          color: var(--f-brass);
          margin: 0;
          font-variant: small-caps;
        }
        .fairview-name em {
          display: block;
          font-style: italic;
          font-size: 0.42em;
          letter-spacing: 0.18em;
          margin-top: 6px;
          color: var(--f-cream);
        }
        .fairview-tag {
          text-align: center;
          font-size: 13px;
          letter-spacing: 0.42em;
          text-transform: uppercase;
          color: var(--f-cream);
          margin: 22px 0 0;
          opacity: 0.85;
        }
        .fairview-tag::before, .fairview-tag::after {
          content: "✦";
          margin: 0 12px;
          color: var(--f-brass);
        }
        .fairview-lede {
          max-width: 640px;
          margin: 44px auto 0;
          text-align: center;
          font-size: 19px;
          line-height: 1.7;
          font-style: italic;
          color: var(--f-cream);
        }
        .fairview-section {
          margin-top: 64px;
          padding: 30px 0;
          border-top: 1px solid rgba(199, 162, 74, 0.4);
          border-bottom: 1px solid rgba(199, 162, 74, 0.4);
        }
        .fairview-section-title {
          text-align: center;
          font-size: 13px; letter-spacing: 0.42em;
          text-transform: uppercase;
          color: var(--f-brass);
          margin: 0 0 22px;
        }
        .fairview-cols {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 40px;
          padding: 0 6px;
        }
        @media (max-width: 720px) { .fairview-cols { grid-template-columns: 1fr; gap: 28px; } }
        .fairview-col h3 {
          font-size: 18px;
          color: var(--f-brass);
          margin: 0 0 10px;
          letter-spacing: 0.06em;
          font-variant: small-caps;
        }
        .fairview-col p {
          margin: 0;
          font-size: 14.5px;
          line-height: 1.65;
          color: var(--f-cream);
          opacity: 0.9;
        }
        .fairview-radio {
          margin-top: 56px;
          text-align: center;
        }
        .fairview-radio h2 {
          font-size: clamp(26px, 4vw, 38px);
          color: var(--f-brass);
          margin: 0 0 14px;
          font-style: italic;
          font-weight: 400;
        }
        .fairview-radio p {
          max-width: 600px;
          margin: 0 auto;
          font-size: 16.5px;
          line-height: 1.7;
          color: var(--f-cream);
        }
        .fairview-grid {
          margin-top: 56px;
          display: grid;
          grid-template-columns: 1.1fr 1fr;
          gap: 36px;
          padding: 30px;
          background: rgba(199, 162, 74, 0.06);
          border: 1px solid rgba(199, 162, 74, 0.35);
        }
        @media (max-width: 720px) { .fairview-grid { grid-template-columns: 1fr; padding: 22px; } }
        .fairview-grid h3 {
          font-size: 13px; letter-spacing: 0.36em;
          text-transform: uppercase;
          color: var(--f-brass);
          margin: 0 0 14px;
        }
        .fairview-hours dl { margin: 0; font-size: 15px; }
        .fairview-hours dt {
          float: left; clear: left; padding-right: 14px;
          width: 130px; font-style: italic;
          color: var(--f-brass);
        }
        .fairview-hours dd { margin: 0 0 6px; color: var(--f-cream); }
        .fairview-address { font-size: 16px; line-height: 1.7; color: var(--f-cream); }
        .fairview-address .strong { color: var(--f-brass); font-style: italic; }
        .fairview-foot {
          margin-top: 60px;
          text-align: center;
          font-size: 11px;
          letter-spacing: 0.36em;
          text-transform: uppercase;
          color: var(--f-brass);
          opacity: 0.7;
        }
        .fairview-foot .age {
          display: block; margin-top: 10px;
          font-size: 10px;
          letter-spacing: 0.2em;
          color: var(--f-cream);
          opacity: 0.55;
          font-style: italic;
          text-transform: none;
        }
      `}</style>

      <div className="fairview-top-rule" />
      <div className="fairview-thin-rule" />

      <div className="fairview-shell">
        <div className="fairview-eyebrow">Established Nineteen Forty-Six</div>

        <svg className="fairview-crest" width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="Fairview crest">
          {/* art deco frame */}
          <rect x="10" y="10" width="100" height="100" fill="none" stroke="#c7a24a" strokeWidth="1.5" />
          <rect x="16" y="16" width="88" height="88" fill="none" stroke="#c7a24a" strokeWidth="0.8" />
          {/* monogram center */}
          <text x="60" y="58" textAnchor="middle" fontFamily="Baskerville, serif" fontSize="40" fill="#c7a24a" fontStyle="italic">F</text>
          {/* cigar silhouette */}
          <rect x="30" y="78" width="60" height="6" rx="3" fill="#c7a24a" />
          <rect x="76" y="79" width="14" height="4" fill="#3a1d12" />
          <line x1="36" y1="81" x2="74" y2="81" stroke="#3a1d12" strokeWidth="0.5" opacity="0.6" />
          {/* fan/sunburst above F */}
          <g stroke="#c7a24a" strokeWidth="0.8" fill="none">
            <line x1="60" y1="22" x2="60" y2="32" />
            <line x1="48" y1="26" x2="52" y2="32" />
            <line x1="72" y1="26" x2="68" y2="32" />
            <line x1="40" y1="32" x2="46" y2="34" />
            <line x1="80" y1="32" x2="74" y2="34" />
          </g>
        </svg>

        <h1 className="fairview-name">
          Fairview
          <em>Cigars &amp; Lounge</em>
        </h1>

        <div className="fairview-tag">Where the Game is Still on the Radio</div>

        <p className="fairview-lede">
          A walk-in humidor at the front. A long mahogany bar in the middle.
          Six leather chairs in the back facing the cabinet radio Mr. Fairview
          installed himself in nineteen forty-eight. The radio still works.
          So does the rest of the place.
        </p>

        <section className="fairview-section">
          <h2 className="fairview-section-title">— Three Rooms —</h2>
          <div className="fairview-cols">
            <div className="fairview-col">
              <h3>The Humidor</h3>
              <p>
                Eight cedar-lined cabinets. Connecticut shade through
                Nicaraguan corojo. Single sticks or a box of twenty-five.
                Bring it home or smoke it here.
              </p>
            </div>
            <div className="fairview-col">
              <h3>The Bar</h3>
              <p>
                Forty-six bourbons. Twelve ryes. Six houses of scotch and
                an honest old fashioned. No cocktail menu — the bartender
                remembers what you drink.
              </p>
            </div>
            <div className="fairview-col">
              <h3>The Back Room</h3>
              <p>
                Six chairs, one radio, one rule: whoever's there gets a say
                in the station. Game days the dial doesn't move. Tuesdays
                are jazz. Sundays are silence.
              </p>
            </div>
          </div>
        </section>

        <section className="fairview-radio">
          <h2>"The dial doesn't move on game days."</h2>
          <p>
            Every home stand we tune the cabinet radio to the broadcast,
            dim the lights, and pour something brown. Members reserve a
            chair. Walk-ins welcome if there's room. There usually is.
          </p>
        </section>

        <section className="fairview-grid">
          <div className="fairview-hours">
            <h3>Hours</h3>
            <dl>
              <dt>Tue – Thu</dt><dd>4:00 PM – 11:00 PM</dd>
              <dt>Fri – Sat</dt><dd>2:00 PM – 1:00 AM</dd>
              <dt>Sunday</dt><dd>2:00 PM – 9:00 PM</dd>
              <dt>Monday</dt><dd>Closed</dd>
            </dl>
          </div>
          <div className="fairview-address">
            <h3>Address</h3>
            <span className="strong">218 East Fairview Avenue</span>
            <br />
            Two doors down from the corner of Pearl. Look for the
            green awning and the brass nameplate.
            <br /><br />
            <span className="strong">Memberships</span> by introduction.
            Ask any regular.
          </div>
        </section>

        <div className="fairview-foot">
          ✦ Fairview Cigars &amp; Lounge ✦ Since 1946 ✦
          <span className="age">You must be twenty-one years of age to purchase tobacco products.</span>
        </div>
      </div>
    </div>
  );
}
