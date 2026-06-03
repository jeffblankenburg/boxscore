export const metadata = {
  title: "Greenfield Lawn & Garden — Spring Opening Weekend",
  description: "Heirloom tomatoes, fruit trees, and the largest selection of starter herbs in the county. Open daily 8–6.",
  robots: { index: false },
};

export default function GreenfieldPage() {
  return (
    <div className="sponsor-page greenfield-root">
      <style>{`
        .greenfield-root {
          --g-forest: #284a2a;
          --g-leaf: #4a7c3a;
          --g-cream: #f5efde;
          --g-brick: #a44430;
          --g-soil: #5a3d24;
          --g-ink: #1a2a18;
          background: var(--g-cream);
          background-image:
            radial-gradient(circle at 20% 90%, rgba(40,74,42,0.07), transparent 50%),
            radial-gradient(circle at 80% 10%, rgba(164,68,48,0.05), transparent 50%);
          color: var(--g-ink);
          font-family: "EB Garamond", "Garamond", Georgia, serif;
          min-height: 100vh;
        }
        .greenfield-root * { box-sizing: border-box; }

        .greenfield-strip {
          background: var(--g-forest);
          color: var(--g-cream);
          padding: 10px 24px;
          text-align: center;
          font-size: 13px;
          letter-spacing: 0.3em;
          text-transform: uppercase;
        }

        .greenfield-shell { max-width: 1100px; margin: 0 auto; padding: 56px 32px 80px; }

        .greenfield-hero {
          display: grid;
          grid-template-columns: 180px 1fr;
          gap: 40px;
          align-items: center;
          padding-bottom: 32px;
          border-bottom: 1px solid var(--g-forest);
        }
        @media (max-width: 720px) {
          .greenfield-hero { grid-template-columns: 1fr; gap: 24px; text-align: center; }
        }
        .greenfield-name {
          font-size: clamp(46px, 7vw, 78px);
          font-style: italic;
          font-weight: 700;
          color: var(--g-forest);
          margin: 0;
          line-height: 1;
          letter-spacing: -0.005em;
        }
        .greenfield-name small {
          display: block;
          font-style: normal;
          font-size: 0.36em;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--g-brick);
          margin-top: 12px;
          font-weight: 400;
        }

        .greenfield-banner {
          margin-top: 48px;
          padding: 40px 32px;
          background:
            linear-gradient(90deg, rgba(40,74,42,0.06), rgba(40,74,42,0.02)),
            var(--g-cream);
          border: 1px solid var(--g-forest);
          border-left: 8px solid var(--g-brick);
          display: grid;
          grid-template-columns: 1fr 240px;
          gap: 36px;
          align-items: center;
        }
        @media (max-width: 720px) { .greenfield-banner { grid-template-columns: 1fr; } }
        .greenfield-banner h2 {
          font-style: italic;
          font-size: clamp(28px, 4vw, 42px);
          color: var(--g-forest);
          margin: 0 0 10px;
          line-height: 1.1;
        }
        .greenfield-banner p { margin: 0; font-size: 17px; line-height: 1.65; color: var(--g-ink); }
        .greenfield-banner .when {
          display: inline-block;
          margin-top: 14px;
          padding: 8px 16px;
          background: var(--g-brick);
          color: var(--g-cream);
          font-size: 14px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
        }

        .greenfield-section-title {
          margin-top: 64px;
          text-align: center;
        }
        .greenfield-section-title h2 {
          font-style: italic;
          font-size: 36px;
          color: var(--g-forest);
          margin: 0;
        }
        .greenfield-section-title .ornament {
          color: var(--g-leaf);
          font-size: 22px;
          letter-spacing: 0.4em;
          margin-bottom: 12px;
        }
        .greenfield-section-title small {
          display: block; margin-top: 8px;
          font-size: 13px; letter-spacing: 0.24em; text-transform: uppercase;
          color: var(--g-soil);
        }

        .greenfield-stock {
          margin-top: 32px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 28px;
        }
        @media (max-width: 800px) { .greenfield-stock { grid-template-columns: 1fr; } }
        .greenfield-stock-card {
          padding: 26px 22px;
          background: #fff;
          border: 1px solid var(--g-forest);
          position: relative;
        }
        .greenfield-stock-card svg { display: block; margin: 0 auto 16px; }
        .greenfield-stock-card h3 {
          text-align: center;
          font-size: 22px;
          font-style: italic;
          margin: 0 0 8px;
          color: var(--g-forest);
        }
        .greenfield-stock-card p {
          font-size: 14.5px;
          line-height: 1.55;
          color: var(--g-ink);
          margin: 0 0 12px;
          text-align: center;
        }
        .greenfield-stock-card ul {
          margin: 0; padding: 0; list-style: none;
          border-top: 1px dotted var(--g-soil);
          padding-top: 12px;
        }
        .greenfield-stock-card li {
          display: flex; justify-content: space-between;
          font-size: 13px; padding: 4px 0;
          color: var(--g-soil);
          font-style: italic;
        }
        .greenfield-stock-card li b { font-style: normal; color: var(--g-brick); font-weight: 600; }

        .greenfield-foot {
          margin-top: 56px;
          padding: 32px 28px;
          background: var(--g-forest);
          color: var(--g-cream);
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 28px;
        }
        @media (max-width: 720px) { .greenfield-foot { grid-template-columns: 1fr; } }
        .greenfield-foot h4 {
          font-style: italic;
          font-size: 18px;
          margin: 0 0 8px;
          color: #cce0b0;
        }
        .greenfield-foot p { margin: 0; font-size: 15px; line-height: 1.6; }
        .greenfield-foot .phone { font-size: 22px; font-style: italic; margin-top: 8px; }

        .greenfield-sig {
          margin-top: 32px;
          text-align: center;
          font-style: italic;
          color: var(--g-soil);
          font-size: 13px;
        }
      `}</style>

      <div className="greenfield-strip">
        Spring Opening Weekend · April 5 – 7 · The Greenhouses are Full
      </div>

      <div className="greenfield-shell">
        <header className="greenfield-hero">
          <svg width="170" height="170" viewBox="0 0 170 170" role="img" aria-label="Greenfield emblem — a tomato on the vine">
            <defs>
              {/* Text arcs centered on (85, 85) at r=58. Top arc bulges up
                  through (85, 27) so EST·1971 hugs the inner rim; bottom arc
                  bulges down through (85, 143) so GREENFIELD·CO hugs the
                  lower rim. Both texts read right-side up to a viewer. */}
              <path id="greenfield-top-arc" d="M 37.5 51.7 A 58 58 0 0 1 132.5 51.7" fill="none" />
              <path id="greenfield-bottom-arc" d="M 37.5 118.3 A 58 58 0 0 0 132.5 118.3" fill="none" />
            </defs>
            <circle cx="85" cy="85" r="80" fill="#fff" stroke="#284a2a" strokeWidth="2.5" />
            <circle cx="85" cy="85" r="72" fill="none" stroke="#284a2a" strokeWidth="0.8" />
            <text fontFamily="Georgia, serif" fontSize="10" letterSpacing="3" fill="#284a2a" textAnchor="middle">
              <textPath href="#greenfield-top-arc" startOffset="50%">EST · 1971</textPath>
            </text>
            <text fontFamily="Georgia, serif" fontSize="9" letterSpacing="2" fill="#284a2a" textAnchor="middle">
              <textPath href="#greenfield-bottom-arc" startOffset="50%">GREENFIELD · CO</textPath>
            </text>
            {/* vine + tomatoes */}
            <g>
              <path d="M85 60 Q88 78 78 90 Q66 100 72 116" stroke="#5a3d24" strokeWidth="2" fill="none" />
              <path d="M85 60 Q82 78 92 90 Q104 100 98 116" stroke="#5a3d24" strokeWidth="2" fill="none" />
              {/* leaves */}
              <path d="M85 60 Q72 50 64 58 Q72 64 85 60 Z" fill="#4a7c3a" />
              <path d="M85 60 Q98 50 106 58 Q98 64 85 60 Z" fill="#4a7c3a" />
              {/* fruit */}
              <circle cx="76" cy="95" r="12" fill="#a44430" />
              <circle cx="94" cy="95" r="12" fill="#a44430" />
              <circle cx="85" cy="115" r="13" fill="#a44430" />
              {/* highlights */}
              <ellipse cx="72" cy="91" rx="3" ry="2" fill="#e8a08a" />
              <ellipse cx="90" cy="91" rx="3" ry="2" fill="#e8a08a" />
              <ellipse cx="81" cy="111" rx="3" ry="2" fill="#e8a08a" />
              {/* stems */}
              <path d="M70 87 Q73 80 78 83" stroke="#4a7c3a" strokeWidth="2" fill="none" />
              <path d="M100 87 Q97 80 92 83" stroke="#4a7c3a" strokeWidth="2" fill="none" />
              <path d="M85 105 Q88 98 92 102" stroke="#4a7c3a" strokeWidth="2" fill="none" />
            </g>
          </svg>

          <div>
            <h1 className="greenfield-name">Greenfield
              <small>Lawn &amp; Garden · Since 1971</small>
            </h1>
          </div>
        </header>

        <section className="greenfield-banner">
          <div>
            <h2>The greenhouses are open.</h2>
            <p>
              Three acres of growing space, twenty-four heated benches, and
              the largest selection of starter herbs in the county. Bring
              the kids. The koi pond is back.
            </p>
            <div className="when">Daily · 8 AM – 6 PM</div>
          </div>
          <svg width="200" height="160" viewBox="0 0 200 160" aria-hidden="true">
            {/* small greenhouse */}
            <rect x="20" y="60" width="160" height="80" fill="#cce0b0" stroke="#284a2a" strokeWidth="2" />
            <path d="M20 60 L100 20 L180 60 Z" fill="#cce0b0" stroke="#284a2a" strokeWidth="2" />
            <line x1="20" y1="100" x2="180" y2="100" stroke="#284a2a" strokeWidth="1" />
            <line x1="100" y1="20" x2="100" y2="140" stroke="#284a2a" strokeWidth="1" />
            <line x1="60" y1="60" x2="60" y2="140" stroke="#284a2a" strokeWidth="0.5" />
            <line x1="140" y1="60" x2="140" y2="140" stroke="#284a2a" strokeWidth="0.5" />
            <rect x="86" y="100" width="28" height="40" fill="#284a2a" />
            <circle cx="108" cy="120" r="1.5" fill="#cce0b0" />
          </svg>
        </section>

        <div className="greenfield-section-title">
          <div className="ornament">❦ ❦ ❦</div>
          <h2>This Weekend in Stock</h2>
          <small>Heirloom · Organic · Locally Grown Where Possible</small>
        </div>

        <div className="greenfield-stock">
          <div className="greenfield-stock-card">
            <svg width="64" height="64" viewBox="0 0 64 64">
              <circle cx="32" cy="38" r="20" fill="#a44430" />
              <ellipse cx="32" cy="34" rx="6" ry="3" fill="#e8a08a" />
              <path d="M20 24 Q32 16 44 24 Q42 30 32 28 Q22 30 20 24 Z" fill="#4a7c3a" />
              <line x1="32" y1="20" x2="32" y2="14" stroke="#4a7c3a" strokeWidth="2" />
            </svg>
            <h3>Heirloom Tomatoes</h3>
            <p>Sixteen varieties, started in March from saved seed.</p>
            <ul>
              <li>Brandywine <b>$4.50</b></li>
              <li>Cherokee Purple <b>$4.50</b></li>
              <li>Black Krim <b>$5.00</b></li>
              <li>Mortgage Lifter <b>$5.00</b></li>
            </ul>
          </div>
          <div className="greenfield-stock-card">
            <svg width="64" height="64" viewBox="0 0 64 64">
              <rect x="20" y="40" width="24" height="18" fill="#5a3d24" />
              <path d="M32 12 Q24 22 24 32 Q24 42 32 40 Q40 42 40 32 Q40 22 32 12 Z" fill="#4a7c3a" />
              <line x1="32" y1="14" x2="32" y2="40" stroke="#284a2a" strokeWidth="1" />
              <line x1="28" y1="22" x2="32" y2="26" stroke="#284a2a" strokeWidth="0.6" />
              <line x1="36" y1="22" x2="32" y2="26" stroke="#284a2a" strokeWidth="0.6" />
            </svg>
            <h3>Fruit Trees</h3>
            <p>Five-gallon bareroots, grafted on hardy rootstock.</p>
            <ul>
              <li>Honeycrisp Apple <b>$48</b></li>
              <li>Stanley Plum <b>$42</b></li>
              <li>Bartlett Pear <b>$44</b></li>
              <li>Tart Cherry <b>$48</b></li>
            </ul>
          </div>
          <div className="greenfield-stock-card">
            <svg width="64" height="64" viewBox="0 0 64 64">
              <rect x="18" y="40" width="28" height="16" rx="2" fill="#a44430" />
              <path d="M22 40 Q28 24 32 18" stroke="#4a7c3a" strokeWidth="2.5" fill="none" />
              <path d="M32 40 Q34 28 36 22" stroke="#4a7c3a" strokeWidth="2.5" fill="none" />
              <path d="M42 40 Q40 26 36 22" stroke="#4a7c3a" strokeWidth="2.5" fill="none" />
              <circle cx="28" cy="22" r="2" fill="#4a7c3a" />
              <circle cx="36" cy="20" r="2" fill="#4a7c3a" />
            </svg>
            <h3>Starter Herbs</h3>
            <p>Forty-plus varieties. The biggest selection in the county.</p>
            <ul>
              <li>Genovese Basil <b>$3.50</b></li>
              <li>English Thyme <b>$3.50</b></li>
              <li>Italian Parsley <b>$3.00</b></li>
              <li>Rosemary, woody <b>$5.00</b></li>
            </ul>
          </div>
        </div>

        <footer className="greenfield-foot">
          <div>
            <h4>Find us.</h4>
            <p>
              4422 Greenfield Pike<br />
              Take the second left after the old Sherman barn. We're at
              the end of the gravel drive.
            </p>
            <div className="phone">(614) 555-0140</div>
          </div>
          <div>
            <h4>Open the season.</h4>
            <p>
              <i>April through October:</i> Daily 8 AM – 6 PM<br />
              <i>November:</i> Weekends only (poinsettias arrive)<br />
              <i>December:</i> Christmas trees Thanksgiving – Dec. 22<br />
              <i>January – March:</i> Closed. We're sleeping.
            </p>
          </div>
        </footer>

        <p className="greenfield-sig">— The Greenfield family · A working garden, four generations on. —</p>
      </div>
    </div>
  );
}
