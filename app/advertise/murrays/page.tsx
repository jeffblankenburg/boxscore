export const metadata = {
  title: "Murray's Leather Works — Glove relacing & repair",
  description: "Hand-stitched glove repairs since 1978. Two-week turnaround. Little League through adult.",
  robots: { index: false },
};

export default function MurraysPage() {
  return (
    <div className="sponsor-page murrays-root">
      <style>{`
        .murrays-root {
          --m-tan: #c89968;
          --m-tan-dark: #8e6536;
          --m-cream: #f3e6cd;
          --m-paper: #ede0c0;
          --m-deep: #3c2210;
          --m-ink: #1f140a;
          --m-thread: #b54421;
          background: var(--m-paper);
          background-image:
            radial-gradient(circle at 20% 30%, rgba(60,34,16,0.06), transparent 50%),
            radial-gradient(circle at 80% 70%, rgba(60,34,16,0.05), transparent 50%);
          color: var(--m-ink);
          font-family: "Lora", Georgia, "Times New Roman", serif;
          min-height: 100vh;
        }
        .murrays-root * { box-sizing: border-box; }

        .murrays-shell { max-width: 980px; margin: 0 auto; padding: 56px 28px 80px; }

        .murrays-hero { text-align: center; padding-bottom: 36px; }
        .murrays-eyebrow {
          font-size: 12px; letter-spacing: 0.46em;
          text-transform: uppercase; color: var(--m-tan-dark);
          margin-bottom: 16px;
        }
        .murrays-emblem { display: block; margin: 0 auto; }
        .murrays-name {
          font-family: "Playfair Display", "Lora", Georgia, serif;
          font-size: clamp(56px, 9vw, 100px);
          font-weight: 900;
          font-style: italic;
          color: var(--m-deep);
          margin: 18px 0 6px;
          line-height: 0.95;
          letter-spacing: -0.015em;
        }
        .murrays-name small {
          display: block;
          font-style: normal; font-weight: 400;
          font-size: 0.24em;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--m-tan-dark);
          margin-top: 14px;
        }
        .murrays-lede {
          max-width: 620px; margin: 28px auto 0;
          font-size: 19px; line-height: 1.7;
          color: var(--m-deep);
          font-style: italic;
        }

        .murrays-process {
          margin-top: 64px;
          padding-top: 30px;
          border-top: 1px solid var(--m-tan-dark);
        }
        .murrays-section-h {
          text-align: center;
          font-size: 13px; letter-spacing: 0.42em;
          text-transform: uppercase;
          color: var(--m-tan-dark);
          font-weight: 700;
          margin: 0 0 28px;
        }
        .murrays-steps {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 22px;
        }
        @media (max-width: 800px) { .murrays-steps { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 480px) { .murrays-steps { grid-template-columns: 1fr; } }
        .murrays-step {
          padding: 22px 18px;
          background: var(--m-cream);
          border: 1px solid var(--m-tan-dark);
          position: relative;
        }
        .murrays-step .num {
          position: absolute;
          top: -16px; left: 14px;
          background: var(--m-thread);
          color: var(--m-cream);
          width: 32px; height: 32px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-style: italic;
          font-weight: 700;
          font-family: "Playfair Display", Georgia, serif;
          font-size: 18px;
          box-shadow: 2px 2px 0 var(--m-deep);
        }
        .murrays-step h3 {
          font-style: italic;
          font-size: 19px;
          color: var(--m-deep);
          margin: 8px 0 6px;
        }
        .murrays-step p {
          font-size: 14px;
          line-height: 1.55;
          color: var(--m-ink);
          margin: 0;
        }

        .murrays-pricing {
          margin-top: 64px;
          padding: 32px 28px;
          background:
            linear-gradient(180deg, rgba(60,34,16,0.04), transparent),
            var(--m-cream);
          border: 1px solid var(--m-tan-dark);
        }
        .murrays-pricing h2 {
          font-style: italic;
          font-size: 30px;
          color: var(--m-deep);
          margin: 0 0 18px;
          text-align: center;
        }
        .murrays-pricing dl {
          margin: 0;
          display: grid;
          grid-template-columns: 1fr 1fr;
          column-gap: 56px;
        }
        @media (max-width: 600px) { .murrays-pricing dl { grid-template-columns: 1fr; } }
        .murrays-pricing dt {
          float: left; clear: left;
          font-size: 16px;
          padding: 10px 0;
          font-style: italic;
          color: var(--m-deep);
        }
        .murrays-pricing dd {
          margin: 0; padding: 10px 0;
          text-align: right;
          font-size: 16px;
          color: var(--m-thread);
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          border-bottom: 1px dotted var(--m-tan-dark);
        }
        .murrays-pricing .note {
          margin-top: 22px;
          text-align: center;
          font-size: 13px;
          color: var(--m-tan-dark);
          font-style: italic;
        }

        .murrays-quote {
          margin-top: 56px;
          padding: 32px 28px;
          text-align: center;
          background: var(--m-deep);
          color: var(--m-cream);
        }
        .murrays-quote .q {
          font-family: "Playfair Display", Georgia, serif;
          font-style: italic;
          font-size: clamp(22px, 3vw, 30px);
          line-height: 1.4;
          margin: 0;
        }
        .murrays-quote .a {
          margin-top: 18px;
          font-size: 12px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--m-tan);
        }

        .murrays-foot {
          margin-top: 56px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 28px;
          text-align: center;
        }
        @media (max-width: 600px) { .murrays-foot { grid-template-columns: 1fr; } }
        .murrays-foot h4 {
          font-style: italic; font-size: 22px;
          color: var(--m-deep); margin: 0 0 6px;
        }
        .murrays-foot p { font-size: 15.5px; line-height: 1.6; margin: 0; color: var(--m-ink); }
        .murrays-foot .phone { font-size: 22px; margin-top: 8px; font-style: italic; color: var(--m-thread); font-weight: 700; }

        .murrays-stitch {
          text-align: center;
          margin-top: 56px;
          color: var(--m-thread);
          letter-spacing: 0.6em;
          font-size: 14px;
        }
      `}</style>

      <div className="murrays-shell">
        <header className="murrays-hero">
          <div className="murrays-eyebrow">Established 1978 · Three Bench Shop</div>

          <svg className="murrays-emblem" width="170" height="170" viewBox="0 0 170 170" role="img" aria-label="Murray's emblem — a baseball glove with stitching">
            {/* outer ring */}
            <circle cx="85" cy="85" r="80" fill="none" stroke="#3c2210" strokeWidth="2" />
            <circle cx="85" cy="85" r="70" fill="none" stroke="#3c2210" strokeWidth="0.6" strokeDasharray="2 3" />
            <text x="85" y="32" textAnchor="middle" fontFamily="Playfair Display, Georgia, serif" fontStyle="italic" fontSize="10" letterSpacing="2.5" fill="#3c2210">MURRAY'S · LEATHER</text>
            <text x="85" y="150" textAnchor="middle" fontFamily="Playfair Display, Georgia, serif" fontStyle="italic" fontSize="9" letterSpacing="3" fill="#3c2210">EST · 1978</text>

            {/* glove body */}
            <g transform="translate(40 50)">
              <path d="M14 38 Q4 22 14 8 Q22 0 36 4 Q44 -4 56 4 Q68 0 78 10 Q86 22 78 38 Q72 52 56 56 L26 56 Q12 52 14 38 Z"
                    fill="#c89968" stroke="#3c2210" strokeWidth="2" />
              {/* fingers cut */}
              <path d="M22 8 L24 38" stroke="#3c2210" strokeWidth="1" />
              <path d="M38 4 L40 38" stroke="#3c2210" strokeWidth="1" />
              <path d="M54 4 L56 38" stroke="#3c2210" strokeWidth="1" />
              <path d="M70 8 L70 38" stroke="#3c2210" strokeWidth="1" />
              {/* web */}
              <path d="M40 4 L54 4 L54 18 L40 18 Z" fill="#8e6536" stroke="#3c2210" strokeWidth="1" />
              <path d="M40 4 L54 18 M54 4 L40 18" stroke="#b54421" strokeWidth="0.8" />
              {/* stitches around outline */}
              <path d="M14 38 Q4 22 14 8 Q22 0 36 4 Q44 -4 56 4 Q68 0 78 10 Q86 22 78 38 Q72 52 56 56 L26 56 Q12 52 14 38 Z"
                    fill="none" stroke="#b54421" strokeWidth="0.7" strokeDasharray="2 2" />
            </g>
          </svg>

          <h1 className="murrays-name">Murray's
            <small>Leather Works · Columbus, Ohio</small>
          </h1>

          <p className="murrays-lede">
            Three benches, two cobblers' awls, one waxed thread spool that's
            been in the same drawer since the carter. We relace, restitch,
            and repair gloves the same way Mr. Murray learned from his
            father — by hand, with patience, and with no shortcut taken.
          </p>
        </header>

        <section className="murrays-process">
          <h2 className="murrays-section-h">— Our Process —</h2>
          <div className="murrays-steps">
            <div className="murrays-step">
              <div className="num">1</div>
              <h3>Drop it off</h3>
              <p>Bring it to the shop or mail it in a box. Tell us what you want fixed; we'll tell you what we'd also fix while we're in there.</p>
            </div>
            <div className="murrays-step">
              <div className="num">2</div>
              <h3>Assess &amp; quote</h3>
              <p>Same-day inspection. Most repairs quoted within the hour. No work begins until you say go.</p>
            </div>
            <div className="murrays-step">
              <div className="num">3</div>
              <h3>Bench time</h3>
              <p>Two weeks on the bench. Hand-stitched with waxed nylon, full leather lace, period-appropriate hardware where it matters.</p>
            </div>
            <div className="murrays-step">
              <div className="num">4</div>
              <h3>Conditioned, returned</h3>
              <p>We oil and condition the whole glove before it goes home. Comes back with paperwork and the new break-in instructions.</p>
            </div>
          </div>
        </section>

        <section className="murrays-pricing">
          <h2>Pricing — Honest, Posted, Held</h2>
          <dl>
            <dt>Full re-lace, infielder</dt>
            <dd>$38</dd>
            <dt>Full re-lace, outfielder/first base</dt>
            <dd>$48</dd>
            <dt>Web replacement</dt>
            <dd>$55</dd>
            <dt>Heel pad rebuild</dt>
            <dd>$32</dd>
            <dt>Catcher's mitt overhaul</dt>
            <dd>$95</dd>
            <dt>Hand-rolled break-in</dt>
            <dd>$28</dd>
            <dt>Leather conditioning &amp; oil</dt>
            <dd>$12</dd>
            <dt>Reattach broken strap</dt>
            <dd>$18</dd>
          </dl>
          <p className="note">Little League discount: knock off ten percent on any repair to a sized 9–11 glove. No questions asked.</p>
        </section>

        <section className="murrays-quote">
          <p className="q">"The glove was my grandfather's. Mr. Murray fixed it like it was his own. Came back better than when he gave it to me forty years ago."</p>
          <div className="a">— Tom R., customer since 1991</div>
        </section>

        <footer className="murrays-foot">
          <div>
            <h4>The shop.</h4>
            <p>
              219 East Cherry Street<br />
              Above the cobbler. Up the stairs, blue door, smell the
              leather before you see it.
            </p>
            <div className="phone">(614) 555-0179</div>
          </div>
          <div>
            <h4>The bench.</h4>
            <p>
              <i>Tue – Fri:</i> 9 AM – 5 PM<br />
              <i>Saturday:</i> 9 AM – 1 PM<br />
              <i>Sun &amp; Mon:</i> At home, with the family. Drop-offs by mail.
            </p>
          </div>
        </footer>

        <div className="murrays-stitch">— — — — — — — — — —</div>
      </div>
    </div>
  );
}
