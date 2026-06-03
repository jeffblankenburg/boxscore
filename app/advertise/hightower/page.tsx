export const metadata = {
  title: "Hightower Bourbon Co. — Aged Six Years in Charred Oak",
  description: "Small-batch Kentucky bourbon. Six-year mash bill. Find a bottle near you.",
  robots: { index: false },
};

export default function HightowerPage() {
  return (
    <div className="sponsor-page hightower-root">
      <style>{`
        .hightower-root {
          --h-amber: #b8741a;
          --h-amber-deep: #7a3f0c;
          --h-cream: #f1e0bc;
          --h-paper: #e8d6a8;
          --h-deep: #2a1408;
          --h-gilt: #d4a64a;
          --h-rust: #8a3614;
          background:
            radial-gradient(circle at 50% 0%, #3a200e 0%, #1c0a04 75%),
            #1c0a04;
          color: var(--h-cream);
          font-family: "Cormorant Garamond", "EB Garamond", Garamond, Georgia, serif;
          min-height: 100vh;
        }
        .hightower-root * { box-sizing: border-box; }

        .hightower-shell { max-width: 900px; margin: 0 auto; padding: 56px 28px 72px; }

        .hightower-rule {
          margin: 0 auto;
          height: 0;
          border-top: 1px solid var(--h-gilt);
          width: 80%;
          opacity: 0.6;
        }
        .hightower-thick {
          border-top: 3px solid var(--h-gilt);
          border-bottom: 1px solid var(--h-gilt);
          padding: 4px 0;
        }

        .hightower-eyebrow {
          text-align: center;
          font-size: 11px;
          letter-spacing: 0.62em;
          text-transform: uppercase;
          color: var(--h-gilt);
          padding-left: 0.62em;
          margin-top: 8px;
        }

        .hightower-emblem {
          display: block;
          margin: 36px auto 22px;
        }

        .hightower-name {
          text-align: center;
          font-family: "Cinzel", "Cormorant Garamond", Georgia, serif;
          font-size: clamp(48px, 8vw, 96px);
          font-weight: 900;
          letter-spacing: 0.06em;
          line-height: 0.95;
          color: var(--h-cream);
          margin: 0;
          text-transform: uppercase;
        }
        .hightower-name em {
          display: block;
          font-style: italic;
          font-weight: 400;
          font-size: 0.28em;
          letter-spacing: 0.32em;
          color: var(--h-gilt);
          margin-top: 18px;
        }

        .hightower-est {
          text-align: center;
          font-size: 13px;
          letter-spacing: 0.42em;
          text-transform: uppercase;
          color: var(--h-gilt);
          margin: 24px 0 8px;
        }

        .hightower-batch {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 0;
          margin: 36px 0;
          text-align: center;
          color: var(--h-cream);
          border-top: 1px solid var(--h-gilt);
          border-bottom: 1px solid var(--h-gilt);
          padding: 18px 0;
        }
        @media (max-width: 600px) { .hightower-batch { grid-template-columns: 1fr; } }
        .hightower-batch .item { padding: 10px 12px; border-right: 1px solid rgba(212, 166, 74, 0.3); }
        .hightower-batch .item:last-child { border-right: none; }
        @media (max-width: 600px) { .hightower-batch .item { border-right: none; border-bottom: 1px solid rgba(212, 166, 74, 0.3); } .hightower-batch .item:last-child { border-bottom: none; } }
        .hightower-batch .v {
          font-family: "Cinzel", Georgia, serif;
          font-size: 24px;
          color: var(--h-gilt);
          margin-bottom: 4px;
        }
        .hightower-batch .l {
          font-size: 11px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--h-cream);
          opacity: 0.8;
        }

        .hightower-pitch {
          max-width: 680px; margin: 36px auto 0;
          font-size: 19px; line-height: 1.7;
          font-style: italic;
          color: var(--h-cream);
          text-align: center;
        }
        .hightower-pitch::first-letter {
          font-size: 3em; float: left; line-height: 0.9;
          padding: 6px 8px 0 0;
          font-style: normal;
          font-weight: 900;
          color: var(--h-gilt);
          font-family: "Cinzel", Georgia, serif;
        }

        .hightower-notes {
          margin-top: 64px;
          padding: 36px 32px;
          background:
            linear-gradient(180deg, rgba(184, 116, 26, 0.08), transparent),
            rgba(0, 0, 0, 0.18);
          border-top: 1px solid var(--h-gilt);
          border-bottom: 1px solid var(--h-gilt);
        }
        .hightower-notes h2 {
          text-align: center;
          font-family: "Cinzel", Georgia, serif;
          font-size: 22px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: var(--h-gilt);
          margin: 0 0 6px;
        }
        .hightower-notes .ornament {
          text-align: center;
          color: var(--h-gilt);
          letter-spacing: 0.4em;
          margin-bottom: 22px;
        }
        .hightower-notes-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 28px;
        }
        @media (max-width: 720px) { .hightower-notes-grid { grid-template-columns: 1fr; } }
        .hightower-note h3 {
          text-align: center;
          font-style: italic;
          font-size: 16px;
          color: var(--h-gilt);
          letter-spacing: 0.16em;
          text-transform: uppercase;
          font-weight: 400;
          margin: 0 0 10px;
        }
        .hightower-note p {
          margin: 0;
          font-size: 15.5px;
          line-height: 1.6;
          color: var(--h-cream);
          text-align: center;
          opacity: 0.95;
        }

        .hightower-bottle-row {
          margin-top: 72px;
          display: grid;
          grid-template-columns: 1fr 1.2fr;
          gap: 48px;
          align-items: center;
        }
        @media (max-width: 720px) { .hightower-bottle-row { grid-template-columns: 1fr; } }
        .hightower-bottle-row svg { display: block; margin: 0 auto; }
        .hightower-bottle-row h2 {
          font-family: "Cinzel", Georgia, serif;
          font-size: clamp(28px, 4vw, 38px);
          letter-spacing: 0.04em;
          color: var(--h-gilt);
          margin: 0 0 12px;
          text-transform: uppercase;
        }
        .hightower-bottle-row p {
          font-size: 17px;
          line-height: 1.7;
          color: var(--h-cream);
          margin: 0 0 12px;
        }
        .hightower-bottle-row .spec dt {
          font-size: 11px; letter-spacing: 0.18em;
          text-transform: uppercase; color: var(--h-gilt);
          margin-top: 14px;
        }
        .hightower-bottle-row .spec dd {
          margin: 4px 0 0; font-size: 15px; color: var(--h-cream);
          font-style: italic;
        }

        .hightower-foot {
          margin-top: 72px;
          text-align: center;
          font-size: 12px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--h-gilt);
        }
        .hightower-foot .age {
          margin-top: 14px;
          font-style: italic;
          font-size: 11px;
          color: var(--h-cream);
          opacity: 0.6;
          letter-spacing: 0.06em;
          text-transform: none;
        }
      `}</style>

      <div className="hightower-shell">
        <div className="hightower-thick" />
        <div className="hightower-eyebrow">Kentucky · Small Batch · Bottled by Hand</div>
        <div className="hightower-thick" />

        <svg className="hightower-emblem" width="200" height="200" viewBox="0 0 200 200" role="img" aria-label="Hightower crest — tall barrel monogram">
          <circle cx="100" cy="100" r="95" fill="none" stroke="#d4a64a" strokeWidth="2" />
          <circle cx="100" cy="100" r="85" fill="none" stroke="#d4a64a" strokeWidth="0.8" />
          <text x="100" y="32" textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontSize="11" letterSpacing="4" fill="#d4a64a">HIGHTOWER · BOURBON</text>
          <text x="100" y="178" textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontSize="9" letterSpacing="3" fill="#d4a64a">SIX · YEARS · OAK</text>
          {/* barrel */}
          <g transform="translate(70 56)">
            <path d="M0 12 Q30 0 60 12 L60 76 Q30 88 0 76 Z" fill="#7a3f0c" stroke="#d4a64a" strokeWidth="2" />
            {/* hoops */}
            <path d="M0 22 Q30 14 60 22" stroke="#d4a64a" strokeWidth="2" fill="none" />
            <path d="M0 38 Q30 32 60 38" stroke="#d4a64a" strokeWidth="2" fill="none" />
            <path d="M0 56 Q30 50 60 56" stroke="#d4a64a" strokeWidth="2" fill="none" />
            <path d="M0 70 Q30 66 60 70" stroke="#d4a64a" strokeWidth="2" fill="none" />
            {/* monogram */}
            <text x="30" y="58" textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontWeight="900" fontSize="28" fill="#d4a64a">H</text>
          </g>
          {/* wheat sprigs */}
          <g stroke="#d4a64a" strokeWidth="1.2" fill="none">
            <path d="M40 100 Q30 110 32 130 Q42 132 48 122 Q44 116 40 100 Z" />
            <path d="M160 100 Q170 110 168 130 Q158 132 152 122 Q156 116 160 100 Z" />
          </g>
        </svg>

        <h1 className="hightower-name">Hightower
          <em>Bourbon Co. · Est. 1947</em>
        </h1>

        <div className="hightower-est">Distilled in Bardstown, Kentucky</div>

        <div className="hightower-batch">
          <div className="item">
            <div className="v">6 yrs</div>
            <div className="l">In Oak</div>
          </div>
          <div className="item">
            <div className="v">94 proof</div>
            <div className="l">Non-Chill Filtered</div>
          </div>
          <div className="item">
            <div className="v">71 · 14 · 15</div>
            <div className="l">Corn · Rye · Malt</div>
          </div>
        </div>

        <p className="hightower-pitch">
          Three generations of distillers, one mash bill that hasn't moved
          since 1968. Aged six years in heavy-char number four oak in our
          original rickhouse on Bullitt Lane. Bottled by hand at ninety-
          four proof. Nothing chill-filtered. Nothing rushed.
        </p>

        <section className="hightower-notes">
          <h2>Tasting Notes</h2>
          <div className="ornament">✦ ✦ ✦</div>
          <div className="hightower-notes-grid">
            <div className="hightower-note">
              <h3>The Nose</h3>
              <p>Warm vanilla, toasted oak, a quiet thread of orange peel and dark cherry.</p>
            </div>
            <div className="hightower-note">
              <h3>The Palate</h3>
              <p>Caramel up front, baking spice through the middle, an honest tobacco-leaf finish.</p>
            </div>
            <div className="hightower-note">
              <h3>The Finish</h3>
              <p>Long and dry. Stays with you the way a good evening does — never overstays.</p>
            </div>
          </div>
        </section>

        <div className="hightower-bottle-row">
          <svg width="160" height="280" viewBox="0 0 160 280" aria-hidden="true">
            {/* bottle */}
            <rect x="62" y="14" width="36" height="44" fill="#2a1408" stroke="#d4a64a" strokeWidth="1.5" />
            <rect x="58" y="56" width="44" height="14" fill="#7a3f0c" stroke="#d4a64a" strokeWidth="1.5" />
            <path d="M38 70 L38 260 Q38 272 50 272 L110 272 Q122 272 122 260 L122 70 Z" fill="#3a200e" stroke="#d4a64a" strokeWidth="2" />
            {/* label */}
            <rect x="48" y="120" width="64" height="100" fill="#f1e0bc" stroke="#d4a64a" strokeWidth="1" />
            <text x="80" y="145" textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontSize="10" letterSpacing="3" fill="#7a3f0c" fontWeight="900">HIGHTOWER</text>
            <line x1="58" y1="152" x2="102" y2="152" stroke="#7a3f0c" strokeWidth="0.6" />
            <text x="80" y="174" textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontSize="8" fontStyle="italic" fill="#2a1408">Kentucky Straight</text>
            <text x="80" y="185" textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontSize="8" fontStyle="italic" fill="#2a1408">Bourbon Whiskey</text>
            <line x1="58" y1="195" x2="102" y2="195" stroke="#7a3f0c" strokeWidth="0.6" />
            <text x="80" y="210" textAnchor="middle" fontFamily="Cinzel, serif" fontSize="11" fontWeight="900" fill="#7a3f0c">6 YEARS</text>
            {/* liquid */}
            <rect x="40" y="146" width="80" height="124" fill="#b8741a" opacity="0.7" />
          </svg>

          <div>
            <h2>The Six-Year</h2>
            <p>
              The flagship. The first bottle Eli Hightower poured himself
              from in 1953. Same recipe, same rickhouse, same number-four
              char. We don't dress it up. The bourbon does the work.
            </p>
            <dl className="spec">
              <dt>Mash Bill</dt><dd>71% corn · 14% rye · 15% malted barley</dd>
              <dt>Proof</dt><dd>94 · Non-chill-filtered</dd>
              <dt>Age</dt><dd>Six years in new charred American oak</dd>
              <dt>MSRP</dt><dd>$42 per 750ml · select retailers</dd>
            </dl>
          </div>
        </div>

        <div className="hightower-foot">
          ✦ Hightower Bourbon Co. ✦ Bardstown, KY ✦ hightowerbourbon.com ✦
          <div className="age">
            You must be 21+ to view this site. Please drink responsibly.
          </div>
        </div>
      </div>
    </div>
  );
}
