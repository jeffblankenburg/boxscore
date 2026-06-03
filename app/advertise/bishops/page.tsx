export const metadata = {
  title: "Bishop's Shoe Repair — Since 1956",
  description: "Resoling, restitching, and cleat regrips. Same-week turnaround. 218 South Main Street.",
  robots: { index: false },
};

const SERVICES = [
  { name: "Resole, leather sole",   price: "$48" },
  { name: "Resole, rubber",         price: "$38" },
  { name: "Heel rebuild",           price: "$22" },
  { name: "Restitching, any seam",  price: "$18" },
  { name: "Cleat regrip / replace", price: "$28" },
  { name: "Zipper replacement",     price: "$32" },
  { name: "Edge dressing & polish", price: "$12" },
  { name: "Insole replacement",     price: "$15" },
];

export default function BishopsPage() {
  return (
    <div className="sponsor-page bishops-root">
      <style>{`
        .bishops-root {
          --b-leather: #4a2d18;
          --b-leather-deep: #2d1a0c;
          --b-cream: #ebd9b6;
          --b-tan: #b88a4d;
          --b-amber: #c97b1f;
          --b-ink: #1a0f06;
          background:
            linear-gradient(180deg, #f0dfba 0%, #e6d2a8 100%);
          color: var(--b-ink);
          font-family: "Old Standard TT", Georgia, "Times New Roman", serif;
          min-height: 100vh;
        }
        .bishops-root * { box-sizing: border-box; }

        .bishops-band {
          background: var(--b-leather-deep);
          color: var(--b-cream);
          padding: 8px 24px;
          text-align: center;
          font-size: 12px;
          letter-spacing: 0.42em;
          text-transform: uppercase;
        }
        .bishops-band b { color: var(--b-amber); }

        .bishops-shell { max-width: 980px; margin: 0 auto; padding: 56px 32px 64px; }

        .bishops-hero {
          text-align: center;
          padding-bottom: 28px;
        }
        .bishops-emblem { display: block; margin: 0 auto 22px; }
        .bishops-name {
          font-family: "Cinzel", "Old Standard TT", Georgia, serif;
          font-size: clamp(46px, 7vw, 78px);
          font-weight: 900;
          color: var(--b-leather-deep);
          margin: 0;
          letter-spacing: 0.04em;
          line-height: 0.95;
          text-transform: uppercase;
        }
        .bishops-name em {
          display: block;
          font-style: italic;
          font-size: 0.46em;
          letter-spacing: 0.08em;
          color: var(--b-leather);
          margin-top: 10px;
          font-weight: 400;
        }
        .bishops-est {
          margin-top: 14px;
          font-size: 13px;
          letter-spacing: 0.42em;
          text-transform: uppercase;
          color: var(--b-amber);
          font-style: italic;
        }

        .bishops-rules {
          margin: 22px 0;
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          gap: 14px;
          align-items: center;
        }
        .bishops-rules::before, .bishops-rules::after {
          content: ""; display: block; height: 0;
          border-top: 1px solid var(--b-leather);
        }
        .bishops-rules .x {
          color: var(--b-leather);
          font-size: 18px;
        }

        .bishops-lede {
          max-width: 640px; margin: 28px auto 0;
          font-size: 19px; line-height: 1.7;
          font-style: italic; color: var(--b-leather);
          text-align: center;
        }

        .bishops-twocol {
          margin-top: 64px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 56px;
        }
        @media (max-width: 800px) { .bishops-twocol { grid-template-columns: 1fr; gap: 40px; } }

        .bishops-h2 {
          font-family: "Cinzel", Georgia, serif;
          font-size: 22px;
          color: var(--b-leather-deep);
          margin: 0 0 16px;
          letter-spacing: 0.12em;
          padding-bottom: 8px;
          border-bottom: 2px solid var(--b-leather);
          text-transform: uppercase;
        }
        .bishops-pricing dl { margin: 0; }
        .bishops-pricing dt {
          float: left; clear: left;
          font-size: 16px;
          padding: 8px 0;
          font-style: italic;
        }
        .bishops-pricing dd {
          margin: 0;
          padding: 8px 0;
          text-align: right;
          font-size: 17px;
          font-weight: 700;
          color: var(--b-amber);
          border-bottom: 1px dotted var(--b-leather);
          font-variant-numeric: tabular-nums;
        }
        .bishops-pricing .note {
          margin-top: 18px;
          font-size: 13.5px;
          color: var(--b-leather);
          font-style: italic;
        }

        .bishops-story h3 {
          font-style: italic;
          font-size: 19px;
          color: var(--b-leather-deep);
          margin: 0 0 8px;
        }
        .bishops-story p {
          font-size: 16px;
          line-height: 1.7;
          color: var(--b-ink);
          margin: 0 0 12px;
        }
        .bishops-story p:first-letter {
          font-size: 3em;
          float: left;
          line-height: 0.85;
          padding: 6px 8px 0 0;
          font-style: italic;
          font-weight: 900;
          color: var(--b-amber);
        }
        .bishops-story .small {
          margin-top: 14px;
          font-size: 13px;
          letter-spacing: 0.06em;
          color: var(--b-leather);
          font-style: italic;
        }

        .bishops-banner {
          margin-top: 56px;
          background: var(--b-leather);
          color: var(--b-cream);
          padding: 28px 28px;
          text-align: center;
        }
        .bishops-banner h2 {
          font-family: "Cinzel", Georgia, serif;
          font-size: clamp(22px, 3.4vw, 30px);
          letter-spacing: 0.06em;
          margin: 0 0 8px;
        }
        .bishops-banner p { margin: 0; font-size: 15px; line-height: 1.6; opacity: 0.95; }
        .bishops-banner b { color: var(--b-amber); font-style: italic; }

        .bishops-foot {
          margin-top: 48px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          padding-top: 28px;
          border-top: 1px solid var(--b-leather);
          font-size: 16px;
          color: var(--b-leather-deep);
        }
        @media (max-width: 600px) { .bishops-foot { grid-template-columns: 1fr; } }
        .bishops-foot h4 {
          margin: 0 0 6px;
          font-style: italic;
          font-size: 18px;
          color: var(--b-amber);
        }
        .bishops-foot p { margin: 0; line-height: 1.55; }
      `}</style>

      <div className="bishops-band">
        Hand Repair <b>·</b> Same-Week Turnaround <b>·</b> Same-Day Polish
      </div>

      <div className="bishops-shell">
        <header className="bishops-hero">
          <svg className="bishops-emblem" width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Bishop's emblem — an awl, thread, and leather oxford">
            <circle cx="70" cy="70" r="66" fill="none" stroke="#2d1a0c" strokeWidth="2" />
            <circle cx="70" cy="70" r="58" fill="none" stroke="#2d1a0c" strokeWidth="0.6" />
            {/* awl crossed with shoe */}
            <g transform="translate(70 70)">
              {/* shoe (Oxford silhouette) */}
              <path d="M-36 14 Q-30 4 -12 4 L20 4 Q34 4 36 14 L36 22 Q30 26 -34 26 Q-38 22 -36 14 Z" fill="#4a2d18" />
              <path d="M-22 4 Q-14 -4 -4 -2 Q4 4 12 4" fill="none" stroke="#c97b1f" strokeWidth="1.5" />
              <circle cx="-2" cy="2" r="1.2" fill="#c97b1f" />
              <circle cx="6" cy="2" r="1.2" fill="#c97b1f" />
              <line x1="-30" y1="14" x2="32" y2="14" stroke="#c97b1f" strokeWidth="0.8" strokeDasharray="2 2" />
              {/* awl (crossing diagonally) */}
              <g transform="rotate(-22)">
                <rect x="-3" y="-44" width="6" height="32" rx="1.5" fill="#b88a4d" />
                <polygon points="-3,-12 3,-12 0,12" fill="#9a9a9a" stroke="#2d1a0c" strokeWidth="0.7" />
                <line x1="-3" y1="-30" x2="3" y2="-30" stroke="#2d1a0c" strokeWidth="0.5" />
              </g>
              {/* spool of thread */}
              <g transform="translate(-44 -28)">
                <rect x="-7" y="-3" width="14" height="6" fill="#ebd9b6" stroke="#2d1a0c" strokeWidth="0.6" />
                <rect x="-9" y="-5" width="2" height="10" fill="#2d1a0c" />
                <rect x="7" y="-5" width="2" height="10" fill="#2d1a0c" />
                <path d="M5 0 Q12 6 18 18" stroke="#c97b1f" strokeWidth="1" fill="none" />
              </g>
            </g>
            <text x="70" y="20" textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontSize="9" letterSpacing="3" fill="#2d1a0c">BISHOP'S</text>
            <text x="70" y="132" textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontSize="8" letterSpacing="3" fill="#2d1a0c">EST · 1956</text>
          </svg>

          <h1 className="bishops-name">Bishop's
            <em>Shoe Repair</em>
          </h1>
          <div className="bishops-est">Sixty-Nine Years on Main Street</div>

          <div className="bishops-rules"><span /><span className="x">✦</span><span /></div>

          <p className="bishops-lede">
            Walk in with the boots you wore at the wedding. Walk out with
            them resoled, restitched, and ready for the next thirty years.
            Third generation. Same bench. Same patience.
          </p>
        </header>

        <section className="bishops-twocol">
          <div className="bishops-pricing">
            <h2 className="bishops-h2">Services &amp; Pricing</h2>
            <dl>
              {SERVICES.map((s) => (
                <div key={s.name}>
                  <dt>{s.name}</dt>
                  <dd>{s.price}</dd>
                </div>
              ))}
            </dl>
            <p className="note">
              Custom and orthotic work quoted in person. Cleats and
              athletic shoes always priority-routed Monday through
              Wednesday so you have them back by gameday.
            </p>
          </div>

          <div className="bishops-story">
            <h2 className="bishops-h2">A Brief History</h2>
            <h3>Started by Joseph Bishop, 1956.</h3>
            <p>
              Joseph came back from Korea with a trade and a thousand
              dollars. He rented a corner of a tailor's shop on Main and
              hung his shingle. By 1962 he had the whole storefront, by
              1971 a second bench, by 1989 a son named Patrick at the
              bench beside him.
            </p>
            <p>
              Patrick still runs the shop. His daughter Eleanor took over
              the cleat and athletic repair side in 2018. The bench is
              the same one Joseph bought in 1956. The signage is original.
              The wax on the thread spool is the same brand.
            </p>
            <p className="small">— Three generations, one storefront, no franchising.</p>
          </div>
        </section>

        <section className="bishops-banner">
          <h2>Show us this digest. Take 10% off your first visit.</h2>
          <p>
            New customers — bring this page in (or the email it came in)
            and we'll take <b>ten percent</b> off any repair, no minimum.
            Cleats and gameday work included.
          </p>
        </section>

        <footer className="bishops-foot">
          <div>
            <h4>The Shop</h4>
            <p>
              218 South Main Street<br />
              Three doors down from the courthouse. The blue awning, the
              brass bell.
            </p>
            <p style={{ marginTop: 10, fontStyle: 'italic' }}>(614) 555-0156</p>
          </div>
          <div>
            <h4>Hours</h4>
            <p>
              Mon – Fri &nbsp; 8 AM – 6 PM<br />
              Saturday &nbsp; 8 AM – 2 PM<br />
              Sunday &nbsp; Closed (we're at Mass)
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
