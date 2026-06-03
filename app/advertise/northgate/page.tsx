export const metadata = {
  title: "Northgate Batting Cages — Open 7 Days",
  description: "Twelve cages, six pitching speeds. League-rate bucket deals Mon–Thu. (614) 555-0142.",
  robots: { index: false },
};

export default function NorthgatePage() {
  return (
    <div className="sponsor-page northgate-root">
      <style>{`
        .northgate-root {
          --n-yellow: #ffd11a;
          --n-yellow-deep: #c69400;
          --n-blue: #1d3a8c;
          --n-blue-deep: #0e1f54;
          --n-red: #d62a1e;
          --n-cream: #f4ecd6;
          --n-ink: #0a1326;
          background: var(--n-blue-deep);
          color: #fff;
          font-family: "Roboto Condensed", "Arial Narrow", Arial, sans-serif;
          min-height: 100vh;
        }
        .northgate-root * { box-sizing: border-box; }

        .northgate-stripes {
          height: 10px;
          background:
            repeating-linear-gradient(
              90deg,
              var(--n-yellow) 0px, var(--n-yellow) 24px,
              var(--n-red) 24px, var(--n-red) 48px,
              var(--n-blue) 48px, var(--n-blue) 72px
            );
        }

        .northgate-hero {
          background:
            radial-gradient(ellipse at 50% 100%, rgba(255, 209, 26, 0.18), transparent 60%),
            var(--n-blue-deep);
          padding: 60px 28px 70px;
          text-align: center;
          position: relative;
          overflow: hidden;
        }

        .northgate-eyebrow {
          font-size: 13px;
          letter-spacing: 0.42em;
          color: var(--n-yellow);
          text-transform: uppercase;
          font-weight: 700;
          margin-bottom: 22px;
        }
        .northgate-emblem { display: block; margin: 0 auto 22px; filter: drop-shadow(0 4px 14px rgba(255, 209, 26, 0.3)); }
        .northgate-name {
          font-family: "Bungee", "Anton", Impact, sans-serif;
          font-size: clamp(56px, 10vw, 124px);
          font-weight: 900;
          letter-spacing: -0.005em;
          line-height: 0.9;
          text-transform: uppercase;
          color: var(--n-yellow);
          text-shadow:
            -3px 3px 0 var(--n-red),
            -6px 6px 0 var(--n-blue);
          margin: 0;
        }
        .northgate-sub {
          margin: 18px 0 0;
          font-size: clamp(22px, 3.4vw, 34px);
          letter-spacing: 0.28em;
          color: #fff;
          text-transform: uppercase;
        }
        .northgate-hot {
          display: inline-block;
          margin-top: 28px;
          padding: 12px 22px;
          background: var(--n-red);
          color: #fff;
          font-size: 17px;
          font-weight: 900;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          transform: rotate(-2deg);
          box-shadow: 4px 4px 0 var(--n-yellow);
        }

        .northgate-shell { max-width: 1080px; margin: 0 auto; padding: 56px 28px 0; }

        .northgate-speeds {
          background: var(--n-yellow);
          color: var(--n-ink);
          padding: 28px 28px;
          border: 5px solid var(--n-blue);
          margin-bottom: 56px;
        }
        .northgate-speeds h2 {
          font-family: "Bungee", "Anton", Impact, sans-serif;
          font-size: clamp(28px, 4vw, 38px);
          letter-spacing: 0.02em;
          margin: 0 0 6px;
          text-transform: uppercase;
        }
        .northgate-speeds .sub { font-size: 14px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--n-blue); margin-bottom: 18px; }
        .northgate-speeds-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 12px;
        }
        @media (max-width: 700px) { .northgate-speeds-grid { grid-template-columns: repeat(3, 1fr); } }
        .northgate-speed {
          background: var(--n-blue);
          color: #fff;
          padding: 16px 8px;
          text-align: center;
        }
        .northgate-speed .mph {
          font-family: "Bungee", "Anton", Impact, sans-serif;
          font-size: 32px;
          line-height: 1;
          color: var(--n-yellow);
        }
        .northgate-speed .mph small { font-size: 13px; letter-spacing: 0.18em; color: #fff; display: block; margin-top: 4px; }
        .northgate-speed .label {
          margin-top: 10px;
          font-size: 11px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #fff;
        }

        .northgate-rates {
          display: grid;
          grid-template-columns: 1.3fr 1fr;
          gap: 24px;
          margin-bottom: 56px;
        }
        @media (max-width: 800px) { .northgate-rates { grid-template-columns: 1fr; } }

        .northgate-card {
          background: #fff;
          color: var(--n-ink);
          padding: 28px 28px 24px;
          border: 5px solid var(--n-yellow);
        }
        .northgate-card h2 {
          font-family: "Bungee", "Anton", Impact, sans-serif;
          font-size: 30px;
          color: var(--n-blue);
          margin: 0 0 6px;
          text-transform: uppercase;
        }
        .northgate-card .sub { font-size: 13px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--n-red); margin-bottom: 18px; font-weight: 700; }
        .northgate-card ul { list-style: none; padding: 0; margin: 0; }
        .northgate-card li {
          display: flex; align-items: baseline;
          padding: 10px 0;
          border-bottom: 2px dotted #cccccc;
          font-size: 16px;
        }
        .northgate-card .what { flex: 1; }
        .northgate-card .price {
          font-family: "Bungee", "Anton", Impact, sans-serif;
          color: var(--n-red);
          font-size: 22px;
        }
        .northgate-card .deal { background: var(--n-yellow); color: var(--n-ink); padding: 0 8px; margin-right: 6px; font-weight: 700; font-size: 12px; }

        .northgate-leagues {
          background: var(--n-red);
          color: #fff;
          padding: 24px;
          border: 5px solid var(--n-yellow);
          display: flex; flex-direction: column;
          justify-content: center;
        }
        .northgate-leagues h2 {
          font-family: "Bungee", "Anton", Impact, sans-serif;
          font-size: 28px;
          margin: 0 0 6px;
          text-transform: uppercase;
        }
        .northgate-leagues p { font-size: 15px; line-height: 1.55; margin: 6px 0; }
        .northgate-leagues b { color: var(--n-yellow); }

        .northgate-hours {
          background: var(--n-blue);
          color: #fff;
          padding: 32px 28px;
          margin-bottom: 56px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 28px;
        }
        @media (max-width: 600px) { .northgate-hours { grid-template-columns: 1fr; } }
        .northgate-hours h3 {
          font-family: "Bungee", "Anton", Impact, sans-serif;
          color: var(--n-yellow);
          font-size: 22px;
          margin: 0 0 12px;
          text-transform: uppercase;
        }
        .northgate-hours dl { margin: 0; font-size: 15px; }
        .northgate-hours dt { float: left; clear: left; width: 96px; color: var(--n-yellow); }
        .northgate-hours dd { margin: 0 0 6px; }
        .northgate-hours .phone {
          margin-top: 12px;
          font-family: "Bungee", "Anton", Impact, sans-serif;
          font-size: 28px;
          color: var(--n-yellow);
        }
        .northgate-hours .addr { font-size: 14px; line-height: 1.55; }

        .northgate-foot {
          padding: 18px 24px;
          background: var(--n-yellow);
          color: var(--n-ink);
          text-align: center;
          font-size: 12px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          font-weight: 700;
        }
      `}</style>

      <div className="northgate-stripes" />

      <section className="northgate-hero">
        <div className="northgate-eyebrow">★ ★ ★  Open Since 1992  ★ ★ ★</div>

        <svg className="northgate-emblem" width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="Northgate emblem — baseball flying through a cage">
          <rect x="6" y="6" width="108" height="108" fill="#1d3a8c" stroke="#ffd11a" strokeWidth="4" />
          {/* cage grid */}
          <g stroke="#ffd11a" strokeWidth="1.2">
            <line x1="6" y1="36" x2="114" y2="36" />
            <line x1="6" y1="66" x2="114" y2="66" />
            <line x1="6" y1="96" x2="114" y2="96" />
            <line x1="36" y1="6" x2="36" y2="114" />
            <line x1="66" y1="6" x2="66" y2="114" />
            <line x1="96" y1="6" x2="96" y2="114" />
          </g>
          {/* baseball + motion */}
          <g>
            <line x1="20" y1="85" x2="60" y2="60" stroke="#fff" strokeWidth="2.5" strokeDasharray="3 3" />
            <circle cx="78" cy="48" r="14" fill="#fff" />
            <path d="M70 45 Q78 50 86 45" stroke="#d62a1e" strokeWidth="1.5" fill="none" />
            <path d="M70 51 Q78 46 86 51" stroke="#d62a1e" strokeWidth="1.5" fill="none" />
          </g>
        </svg>

        <h1 className="northgate-name">Northgate</h1>
        <div className="northgate-sub">Batting Cages</div>
        <div className="northgate-hot">★ 12 Cages · 6 Speeds · 7 Days a Week ★</div>
      </section>

      <div className="northgate-shell">
        <section className="northgate-speeds">
          <h2>Pick your pitch.</h2>
          <div className="sub">Calibrated daily · Pitch type printed on the cage</div>
          <div className="northgate-speeds-grid">
            <div className="northgate-speed">
              <div className="mph">35<small>MPH</small></div>
              <div className="label">Coach Pitch</div>
            </div>
            <div className="northgate-speed">
              <div className="mph">45<small>MPH</small></div>
              <div className="label">Little League</div>
            </div>
            <div className="northgate-speed">
              <div className="mph">55<small>MPH</small></div>
              <div className="label">Pony</div>
            </div>
            <div className="northgate-speed">
              <div className="mph">65<small>MPH</small></div>
              <div className="label">Babe Ruth</div>
            </div>
            <div className="northgate-speed">
              <div className="mph">75<small>MPH</small></div>
              <div className="label">High School</div>
            </div>
            <div className="northgate-speed">
              <div className="mph">85<small>MPH</small></div>
              <div className="label">College/Open</div>
            </div>
          </div>
        </section>

        <div className="northgate-rates">
          <div className="northgate-card">
            <h2>Rates</h2>
            <div className="sub">— Per cage · per session —</div>
            <ul>
              <li>
                <span className="what">25 pitches</span>
                <span className="price">$2</span>
              </li>
              <li>
                <span className="what">100 pitches (bucket)</span>
                <span className="price">$7</span>
              </li>
              <li>
                <span className="what"><span className="deal">DEAL</span> Half-hour cage</span>
                <span className="price">$18</span>
              </li>
              <li>
                <span className="what"><span className="deal">DEAL</span> Full-hour cage</span>
                <span className="price">$32</span>
              </li>
              <li>
                <span className="what">10-bucket card (save $10)</span>
                <span className="price">$60</span>
              </li>
              <li>
                <span className="what">Birthday party (2 cages, 90 min)</span>
                <span className="price">$95</span>
              </li>
            </ul>
          </div>

          <div className="northgate-leagues">
            <h2>League Night.</h2>
            <p>
              <b>Mon – Thu after 6 PM.</b> Bring your roster, pay one
              flat rate — half-hour cage per player, four players per
              cage, all-you-can-hit buckets while we still have light.
            </p>
            <p>
              <b>$12 per player.</b> Coffee, soda, and a clean towel on
              the house. Bring this digest, drop $1 off per player.
            </p>
          </div>
        </div>

        <section className="northgate-hours">
          <div>
            <h3>When we're open</h3>
            <dl>
              <dt>Mon – Thu</dt><dd>3 PM – 10 PM</dd>
              <dt>Fri</dt><dd>3 PM – 11 PM</dd>
              <dt>Saturday</dt><dd>9 AM – 11 PM</dd>
              <dt>Sunday</dt><dd>10 AM – 8 PM</dd>
            </dl>
          </div>
          <div>
            <h3>Where to find us</h3>
            <div className="addr">
              <b>2104 Northgate Road</b><br />
              In the strip behind the lumber yard.<br />
              Look for the giant baseball on the roof.
            </div>
            <div className="phone">(614) 555-0142</div>
          </div>
        </section>
      </div>

      <div className="northgate-foot">
        ★ Cages Cleaned Nightly · Helmets Sanitized Between Players · We're Serious About That ★
      </div>

      <div className="northgate-stripes" />
    </div>
  );
}
