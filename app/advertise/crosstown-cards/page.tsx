export const metadata = {
  title: "Crosstown Cards & Memorabilia — Buying & Selling",
  description: "Vintage commons, complete sets, unopened wax. Buying every day. Open Tue–Sat, 10–6.",
  robots: { index: false },
};

const CARDS = [
  { year: "'56", player: "Hank Aaron", team: "MILWAUKEE", num: "#31", pos: "RF", color: "#d8c98f", accent: "#5e2a1b" },
  { year: "'68", player: "Tom Seaver", team: "NEW YORK",  num: "#45", pos: "P",  color: "#a8c3d6", accent: "#15375a" },
  { year: "'72", player: "Roberto Clemente", team: "PITTSBURGH", num: "#21", pos: "RF", color: "#e8d8b8", accent: "#a4441a" },
  { year: "'85", player: "Ozzie Smith", team: "ST. LOUIS", num: "#1",  pos: "SS", color: "#d6b0a8", accent: "#7a1a1a" },
];

export default function CrosstownCardsPage() {
  return (
    <div className="sponsor-page crosstown-root">
      <style>{`
        .crosstown-root {
          --c-cork: #b88a52;
          --c-cork-dark: #8e6336;
          --c-wood: #4a2a18;
          --c-cream: #f3eada;
          --c-ink: #2a1e10;
          --c-red: #a4221a;
          --c-blue: #1a3866;
          background:
            radial-gradient(circle at 30% 20%, rgba(0,0,0,0.05), transparent 50%),
            radial-gradient(circle at 70% 60%, rgba(0,0,0,0.05), transparent 50%),
            var(--c-cork);
          color: var(--c-ink);
          font-family: "Courier Prime", "Courier New", Courier, monospace;
          min-height: 100vh;
          padding: 36px 24px 60px;
        }
        .crosstown-root * { box-sizing: border-box; }
        .crosstown-pin {
          position: absolute;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #ff5050, #8a0000 70%, #4a0000);
          box-shadow: 0 2px 3px rgba(0,0,0,0.4);
        }
        .crosstown-shop-sign {
          max-width: 880px;
          margin: 0 auto 56px;
          background: var(--c-cream);
          padding: 36px 28px 30px;
          border: 4px solid var(--c-wood);
          position: relative;
          transform: rotate(-1.5deg);
          box-shadow: 8px 10px 18px rgba(0,0,0,0.35);
        }
        .crosstown-shop-sign .crosstown-pin { top: -7px; left: 24px; }
        .crosstown-shop-sign .crosstown-pin.right { top: -7px; left: auto; right: 24px; }
        .crosstown-eyebrow {
          text-align: center;
          font-size: 12px;
          letter-spacing: 0.36em;
          text-transform: uppercase;
          color: var(--c-red);
          margin-bottom: 12px;
        }
        .crosstown-name {
          text-align: center;
          font-family: "Bungee", "Impact", "Arial Black", sans-serif;
          font-size: clamp(40px, 7vw, 76px);
          font-weight: 900;
          color: var(--c-ink);
          letter-spacing: -0.005em;
          margin: 0;
          line-height: 1;
          text-transform: uppercase;
        }
        .crosstown-and {
          font-family: Georgia, serif;
          font-style: italic;
          color: var(--c-red);
          font-weight: 400;
          font-size: 0.55em;
          padding: 0 8px;
        }
        .crosstown-sub {
          text-align: center;
          margin: 14px 0 0;
          font-size: 14px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--c-blue);
        }
        .crosstown-rule {
          margin: 14px auto;
          width: 70%;
          height: 0;
          border-top: 1px dashed var(--c-wood);
        }
        .crosstown-tag {
          text-align: center;
          font-family: Georgia, serif;
          font-style: italic;
          font-size: 17px;
          color: var(--c-ink);
        }

        .crosstown-board { max-width: 1200px; margin: 0 auto; }

        .crosstown-want {
          background: var(--c-cream);
          max-width: 720px;
          margin: 0 auto 56px;
          padding: 24px 30px;
          border: 3px solid var(--c-ink);
          position: relative;
          transform: rotate(1deg);
          box-shadow: 6px 7px 14px rgba(0,0,0,0.3);
        }
        .crosstown-want .crosstown-pin { top: -7px; left: 50%; transform: translateX(-50%); }
        .crosstown-want h2 {
          margin: 0 0 8px;
          font-family: "Impact", "Arial Black", sans-serif;
          font-size: 38px;
          letter-spacing: 0.04em;
          color: var(--c-red);
          line-height: 1;
        }
        .crosstown-want h2 small {
          display: block; font-size: 13px; letter-spacing: 0.3em;
          color: var(--c-ink); margin-top: 6px;
        }
        .crosstown-want ul {
          list-style: none; padding: 0;
          margin: 14px 0 0;
          columns: 2;
          column-gap: 20px;
        }
        @media (max-width: 600px) { .crosstown-want ul { columns: 1; } }
        .crosstown-want li {
          font-size: 14px;
          padding: 6px 0;
          border-bottom: 1px dotted var(--c-wood);
          break-inside: avoid;
        }
        .crosstown-want li::before { content: "✓ "; color: var(--c-red); font-weight: bold; }

        .crosstown-cards-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 18px;
          margin: 0 auto 56px;
          max-width: 1100px;
        }
        @media (max-width: 900px) { .crosstown-cards-row { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 480px) { .crosstown-cards-row { grid-template-columns: 1fr; } }

        .crosstown-card {
          background: var(--c-cream);
          padding: 14px;
          aspect-ratio: 2.5 / 3.5;
          position: relative;
          box-shadow: 4px 5px 10px rgba(0,0,0,0.35);
          display: flex; flex-direction: column;
        }
        .crosstown-card:nth-child(1) { transform: rotate(-3deg); }
        .crosstown-card:nth-child(2) { transform: rotate(2deg); }
        .crosstown-card:nth-child(3) { transform: rotate(-1.5deg); }
        .crosstown-card:nth-child(4) { transform: rotate(3deg); }
        .crosstown-card .crosstown-pin { top: -7px; left: 50%; transform: translateX(-50%); }
        .crosstown-card .photo {
          flex: 1;
          background: var(--card-bg, #d8c98f);
          border: 1px solid #00000020;
          position: relative;
          margin-bottom: 8px;
          overflow: hidden;
        }
        .crosstown-card .photo svg {
          position: absolute;
          inset: 0;
          margin: auto;
        }
        .crosstown-card .name {
          font-family: "Bungee", "Impact", sans-serif;
          font-size: 15px;
          line-height: 1.05;
          color: var(--card-accent, #5e2a1b);
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }
        .crosstown-card .meta {
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--c-ink);
          opacity: 0.7;
          margin-top: 2px;
          display: flex; justify-content: space-between;
        }
        .crosstown-card .corner {
          position: absolute; top: 8px; right: 8px;
          background: var(--card-accent, #5e2a1b);
          color: var(--c-cream);
          padding: 2px 8px;
          font-size: 11px;
          letter-spacing: 0.08em;
        }

        .crosstown-hours-pin {
          background: var(--c-ink);
          color: var(--c-cream);
          max-width: 560px;
          margin: 0 auto 30px;
          padding: 22px 28px;
          position: relative;
          transform: rotate(-1deg);
          box-shadow: 6px 7px 14px rgba(0,0,0,0.4);
        }
        .crosstown-hours-pin .crosstown-pin { top: -7px; left: 32px; background: radial-gradient(circle at 35% 35%, #ffcc66, #8a5a00 70%); }
        .crosstown-hours-pin h3 {
          margin: 0 0 8px;
          font-family: "Bungee", Impact, sans-serif;
          font-size: 22px;
          color: #ffcc66;
          letter-spacing: 0.1em;
        }
        .crosstown-hours-pin dl { margin: 0; font-size: 14px; }
        .crosstown-hours-pin dt { float: left; clear: left; width: 100px; font-style: italic; color: #ffcc66; }
        .crosstown-hours-pin dd { margin: 0 0 4px; }
        .crosstown-hours-pin .addr {
          margin-top: 12px;
          font-size: 13px;
          opacity: 0.9;
          padding-top: 10px;
          border-top: 1px dashed #ffcc6660;
        }

        .crosstown-foot {
          text-align: center;
          color: var(--c-ink);
          opacity: 0.65;
          margin-top: 32px;
          font-size: 12px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }
      `}</style>

      <div className="crosstown-shop-sign">
        <span className="crosstown-pin" />
        <span className="crosstown-pin right" />
        <div className="crosstown-eyebrow">Established 1989 · Tuesday – Saturday</div>
        <h1 className="crosstown-name">Crosstown<span className="crosstown-and"> &amp; </span>Cards</h1>
        <div className="crosstown-rule" />
        <div className="crosstown-sub">Memorabilia · Vintage · Wax · Slabs</div>
        <div className="crosstown-rule" />
        <p className="crosstown-tag">"Fair offers. Cash on the spot. Coffee on the house."</p>
      </div>

      <div className="crosstown-board">
        <div className="crosstown-want">
          <span className="crosstown-pin" />
          <h2>WANTED
            <small>—— BUYING EVERY DAY ——</small>
          </h2>
          <ul>
            <li>Pre-1970 commons (any condition)</li>
            <li>Complete or partial sets, 1948–1989</li>
            <li>Unopened wax — Topps, Bowman, Donruss</li>
            <li>Signed game balls (provenance helps)</li>
            <li>Yearbooks, programs, ticket stubs</li>
            <li>Team-signed bats, jerseys, helmets</li>
            <li>Old store-model gloves (Heart of the Hide & similar)</li>
            <li>Anything Hall-of-Fame, anything pre-war</li>
          </ul>
        </div>

        <div className="crosstown-cards-row">
          {CARDS.map((c) => (
            <div key={c.player} className="crosstown-card" style={{ ['--card-bg' as never]: c.color, ['--card-accent' as never]: c.accent }}>
              <span className="crosstown-pin" />
              <div className="corner">{c.year}</div>
              <div className="photo">
                <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden="true">
                  <circle cx="40" cy="32" r="14" fill={c.accent} opacity="0.5" />
                  <path d={`M16 70 Q40 50 64 70 L64 80 L16 80 Z`} fill={c.accent} opacity="0.55" />
                  <text x="40" y="78" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="900" fontSize="14" fill={c.accent}>{c.num}</text>
                </svg>
              </div>
              <div className="name">{c.player}</div>
              <div className="meta"><span>{c.team}</span><span>{c.pos}</span></div>
            </div>
          ))}
        </div>

        <div className="crosstown-hours-pin">
          <span className="crosstown-pin" />
          <h3>SHOP HOURS</h3>
          <dl>
            <dt>Tue – Fri</dt><dd>10 AM – 6 PM</dd>
            <dt>Saturday</dt><dd>9 AM – 5 PM</dd>
            <dt>Sun & Mon</dt><dd>By appointment</dd>
          </dl>
          <div className="addr">
            312 Crosstown Boulevard · crosstowncards.com · (614) 555-0214
          </div>
        </div>

        <div className="crosstown-foot">
          Walk in with a shoebox · Walk out with cash
        </div>
      </div>
    </div>
  );
}
