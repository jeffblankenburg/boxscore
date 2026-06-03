export const metadata = {
  title: "The Westbrook Bookshop — Independent, since 1983",
  description: "Sports section restocked weekly. Roger Angell, Buster Olney, Bill James. 71 Westbrook Avenue.",
  robots: { index: false },
};

const NEW_ARRIVALS = [
  { title: "Late Innings",                  author: "Roger Angell",        cat: "Essays · Reissue",      price: "$22" },
  { title: "Buster Olney on the Yankees",   author: "Buster Olney",        cat: "Reporting",             price: "$28" },
  { title: "The Bill James Historical Abstract", author: "Bill James",     cat: "Reference · Updated",   price: "$34" },
  { title: "The Boys of Summer",            author: "Roger Kahn",          cat: "Memoir · Anniversary",  price: "$20" },
  { title: "Ball Four (50th)",              author: "Jim Bouton",          cat: "Memoir",                price: "$19" },
  { title: "A Pitcher's Story",             author: "Roger Angell",        cat: "Profile · Used",        price: "$12" },
];

const SECTIONS = [
  { label: "Baseball",         note: "the largest section in the store" },
  { label: "American History", note: "biography heavy on the founding era" },
  { label: "Mystery & Crime",  note: "first editions in a glass case behind the counter" },
  { label: "Poetry",           note: "a small chair, a good lamp, an open invitation" },
  { label: "Children's",       note: "a reading nook with a window seat" },
  { label: "Local Authors",    note: "twelve writers from within twenty miles" },
];

export default function WestbrookPage() {
  return (
    <div className="sponsor-page westbrook-root">
      <style>{`
        .westbrook-root {
          --w-forest: #2a3b22;
          --w-cream: #ece1c4;
          --w-paper: #f7eed3;
          --w-crimson: #7a1e1a;
          --w-gilt: #b58c3f;
          --w-ink: #1c1810;
          background: var(--w-paper);
          color: var(--w-ink);
          font-family: "EB Garamond", "Garamond", Georgia, serif;
          min-height: 100vh;
        }
        .westbrook-root * { box-sizing: border-box; }

        .westbrook-shell { max-width: 1080px; margin: 0 auto; padding: 60px 32px 80px; }

        .westbrook-masthead {
          text-align: center;
          margin-bottom: 28px;
        }
        .westbrook-the {
          font-style: italic;
          font-size: 22px;
          letter-spacing: 0.32em;
          color: var(--w-crimson);
          font-weight: 400;
          margin-bottom: 6px;
        }
        .westbrook-name {
          font-family: "Cormorant Garamond", "EB Garamond", Garamond, Georgia, serif;
          font-size: clamp(56px, 9vw, 108px);
          line-height: 0.9;
          letter-spacing: -0.005em;
          color: var(--w-forest);
          font-weight: 700;
          margin: 0;
          font-variant: small-caps;
        }
        .westbrook-rule {
          margin: 18px auto;
          height: 0;
          border-top: 1px solid var(--w-forest);
          width: 60%;
          position: relative;
        }
        .westbrook-rule::before {
          content: "❦";
          position: absolute;
          top: -14px; left: 50%;
          transform: translateX(-50%);
          background: var(--w-paper);
          color: var(--w-gilt);
          padding: 0 14px;
          font-size: 18px;
        }
        .westbrook-tag {
          font-style: italic;
          font-size: 19px;
          letter-spacing: 0.04em;
          color: var(--w-ink);
        }

        .westbrook-cols {
          margin-top: 56px;
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 56px;
          column-rule: 1px solid var(--w-forest);
        }
        @media (max-width: 900px) { .westbrook-cols { grid-template-columns: 1fr; gap: 36px; } }

        .westbrook-pitch h2 {
          font-style: italic;
          font-size: clamp(28px, 3.8vw, 38px);
          color: var(--w-forest);
          font-weight: 400;
          margin: 0 0 16px;
        }
        .westbrook-pitch p {
          font-size: 17px;
          line-height: 1.7;
          margin: 0 0 14px;
        }
        .westbrook-pitch p:first-letter {
          font-size: 3.2em;
          float: left;
          line-height: 0.85;
          padding: 6px 8px 0 0;
          font-style: italic;
          color: var(--w-crimson);
          font-weight: 700;
        }

        .westbrook-shelf-illu { display: block; margin: 36px auto 0; }

        .westbrook-sections h3,
        .westbrook-arrivals h3 {
          font-style: italic;
          font-size: 22px;
          color: var(--w-crimson);
          margin: 0 0 14px;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--w-crimson);
          font-weight: 400;
          letter-spacing: 0.02em;
        }
        .westbrook-sections ul { margin: 0; padding: 0; list-style: none; }
        .westbrook-sections li {
          padding: 10px 0;
          border-bottom: 1px dotted #00000026;
          font-size: 15.5px;
          line-height: 1.5;
        }
        .westbrook-sections li b {
          color: var(--w-forest);
          font-weight: 700;
          font-variant: small-caps;
          letter-spacing: 0.05em;
        }
        .westbrook-sections li i {
          display: block;
          color: var(--w-ink);
          opacity: 0.7;
          font-size: 14px;
          margin-top: 2px;
        }

        .westbrook-arrivals {
          margin-top: 64px;
          padding-top: 28px;
          border-top: 4px double var(--w-forest);
        }
        .westbrook-arrivals h3 { border-bottom: none; padding-bottom: 0; }
        .westbrook-arrivals .header-row {
          display: flex; align-items: baseline; gap: 20px;
        }
        .westbrook-arrivals .header-row h2 {
          font-style: italic;
          font-size: clamp(28px, 4vw, 38px);
          color: var(--w-forest);
          font-weight: 400;
          margin: 0;
        }
        .westbrook-arrivals .header-row .sub {
          font-size: 13px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: var(--w-crimson);
        }
        .westbrook-arrivals-list {
          margin-top: 20px;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 4px 48px;
        }
        @media (max-width: 720px) { .westbrook-arrivals-list { grid-template-columns: 1fr; } }
        .westbrook-arrivals-list .item {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 4px 12px;
          padding: 14px 0;
          border-bottom: 1px dotted #00000022;
        }
        .westbrook-arrivals-list .t { font-size: 17px; font-style: italic; }
        .westbrook-arrivals-list .a { font-size: 13px; color: var(--w-ink); opacity: 0.7; }
        .westbrook-arrivals-list .c {
          font-size: 11px; color: var(--w-crimson);
          letter-spacing: 0.16em; text-transform: uppercase;
          grid-column: 1 / -1; margin-top: -2px;
        }
        .westbrook-arrivals-list .p {
          font-family: Georgia, serif;
          font-weight: 700; color: var(--w-forest);
          font-size: 17px;
        }

        .westbrook-foot {
          margin-top: 56px;
          padding: 28px 32px;
          background: var(--w-cream);
          border: 1px solid var(--w-forest);
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 28px;
          align-items: center;
        }
        @media (max-width: 720px) { .westbrook-foot { grid-template-columns: 1fr; } }
        .westbrook-foot p { margin: 0; font-size: 17px; line-height: 1.6; }
        .westbrook-foot h4 {
          font-style: italic;
          font-size: 22px;
          color: var(--w-crimson);
          margin: 0 0 6px;
          font-weight: 400;
        }
        .westbrook-foot .right {
          text-align: right;
          font-size: 14px;
          line-height: 1.6;
        }
        @media (max-width: 720px) { .westbrook-foot .right { text-align: left; } }

        .westbrook-sign {
          margin-top: 36px;
          text-align: center;
          font-style: italic;
          color: var(--w-forest);
          font-size: 15px;
        }
        .westbrook-sign .name { display: block; margin-top: 4px; font-size: 13px; opacity: 0.7; letter-spacing: 0.08em; }
      `}</style>

      <div className="westbrook-shell">
        <header className="westbrook-masthead">
          <div className="westbrook-the">The</div>
          <h1 className="westbrook-name">Westbrook Bookshop</h1>
          <div className="westbrook-rule" />
          <p className="westbrook-tag">71 Westbrook Avenue · Open Tuesday through Sunday · Independent since 1983</p>
        </header>

        <div className="westbrook-cols">
          <section className="westbrook-pitch">
            <h2>A small store with a long sports section.</h2>
            <p>
              We sell books in the way a bookseller does — slowly, with
              opinions, and with the lights on a little longer than the
              lease requires. The sports section has been our largest
              since 1985, when Mrs. Westbrook started filing the
              biographies by team and refused to put them back by author.
              We never undid it. It works.
            </p>
            <p>
              New arrivals every Tuesday. A standing order with three small
              publishers nobody else carries. A counter you can sit at if
              you want to flip through a book before you buy it. We do not
              sell e-readers.
            </p>

            <svg className="westbrook-shelf-illu" width="320" height="120" viewBox="0 0 320 120" role="img" aria-label="An illustrated row of books on a shelf">
              <rect x="0" y="100" width="320" height="6" fill="#5a3d24" />
              <g stroke="#1c1810" strokeWidth="1">
                <rect x="8" y="20" width="22" height="80" fill="#7a1e1a" />
                <rect x="32" y="32" width="16" height="68" fill="#b58c3f" />
                <rect x="50" y="14" width="20" height="86" fill="#2a3b22" />
                <rect x="72" y="40" width="14" height="60" fill="#ece1c4" />
                <rect x="88" y="22" width="22" height="78" fill="#1c1810" />
                <rect x="112" y="32" width="18" height="68" fill="#7a1e1a" />
                <rect x="132" y="14" width="14" height="86" fill="#5a3d24" />
                <rect x="148" y="44" width="20" height="56" fill="#2a3b22" />
                <rect x="170" y="20" width="24" height="80" fill="#b58c3f" />
                <rect x="196" y="34" width="16" height="66" fill="#7a1e1a" />
                <rect x="214" y="22" width="18" height="78" fill="#ece1c4" />
                <rect x="234" y="38" width="22" height="62" fill="#2a3b22" />
                <rect x="258" y="14" width="14" height="86" fill="#1c1810" />
                <rect x="274" y="28" width="18" height="72" fill="#7a1e1a" />
                <rect x="294" y="42" width="18" height="58" fill="#b58c3f" />
              </g>
              {/* small text on a few spines */}
              <text x="19" y="62" textAnchor="middle" fontFamily="Georgia, serif" fontSize="6" fill="#ece1c4" transform="rotate(-90 19 62)">ANGELL</text>
              <text x="60" y="60" textAnchor="middle" fontFamily="Georgia, serif" fontSize="6" fill="#ece1c4" transform="rotate(-90 60 60)">KAHN</text>
              <text x="181" y="62" textAnchor="middle" fontFamily="Georgia, serif" fontSize="6" fill="#1c1810" transform="rotate(-90 181 62)">JAMES</text>
            </svg>
          </section>

          <aside className="westbrook-sections">
            <h3>The Store, by Section</h3>
            <ul>
              {SECTIONS.map((s) => (
                <li key={s.label}>
                  <b>{s.label}</b>
                  <i>{s.note}</i>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        <section className="westbrook-arrivals">
          <div className="header-row">
            <h2>New This Week</h2>
            <span className="sub">— Restocked Tuesdays —</span>
          </div>
          <div className="westbrook-arrivals-list">
            {NEW_ARRIVALS.map((b) => (
              <div key={b.title} className="item">
                <div className="t">{b.title}</div>
                <div className="p">{b.price}</div>
                <div className="a">{b.author}</div>
                <div className="c">{b.cat}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="westbrook-foot">
          <div>
            <h4>Find us — or call ahead.</h4>
            <p>
              71 Westbrook Avenue, on the corner of Garrison. Park in the
              alley. The door is the one with the bell.
            </p>
          </div>
          <div className="right">
            <b style={{ fontStyle: 'italic', fontSize: 18, color: 'var(--w-crimson)' }}>(614) 555-0183</b>
            <br />
            Tue – Sat &nbsp; 10 AM – 7 PM<br />
            Sunday &nbsp; 11 AM – 5 PM<br />
            Monday &nbsp; Closed
          </div>
        </div>

        <p className="westbrook-sign">
          ❦ &nbsp; Thank you for buying books from a person. &nbsp; ❦
          <span className="name">— The Westbrook family</span>
        </p>
      </div>
    </div>
  );
}
