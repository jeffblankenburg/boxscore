export const metadata = {
  title: "WKBR 1340 AM — Sports and Talk for the City",
  description: "Postgame call-in show, weeknights 10 PM–midnight. Tune in or stream at wkbr1340.com.",
  robots: { index: false },
};

const SCHEDULE = [
  { time: "6:00 AM", show: "Sunrise Sports",     host: "with Jim Marek",     note: "Scores, leads, traffic" },
  { time: "9:00 AM", show: "The Morning Drive",  host: "with Linda Kovacs",  note: "Talk, callers, weather" },
  { time: "12:00 PM", show: "Lunch Pail",        host: "with Bobby Vasquez", note: "Local news, business" },
  { time: "3:00 PM", show: "Afternoon Standings",host: "with Pat Ellington", note: "Reports, beat writers" },
  { time: "6:00 PM", show: "First Pitch",        host: "Live game broadcast",note: "When the team plays" },
  { time: "10:00 PM",show: "Postgame Call-In",   host: "with Eddie Russo",   note: "Two hours, your calls" },
  { time: "12:00 AM",show: "Overnight Talk",     host: "Syndicated",         note: "Sports talk till sunup" },
];

export default function WkbrPage() {
  return (
    <div className="sponsor-page wkbr-root">
      <style>{`
        .wkbr-root {
          --w-maroon: #6e1a22;
          --w-maroon-deep: #421016;
          --w-cream: #ede4c4;
          --w-paper: #f3ead0;
          --w-amber: #f0b840;
          --w-dial: #2a1010;
          --w-ink: #1a0a0a;
          background:
            linear-gradient(180deg, #4a1218 0%, #2a0a0e 60%);
          color: var(--w-cream);
          font-family: "Roboto Slab", "Lora", Georgia, serif;
          min-height: 100vh;
        }
        .wkbr-root * { box-sizing: border-box; }

        .wkbr-strip {
          background: var(--w-dial);
          color: var(--w-amber);
          padding: 8px 24px;
          text-align: center;
          font-size: 12px;
          letter-spacing: 0.42em;
          text-transform: uppercase;
          font-family: "Courier Prime", "Courier New", monospace;
          border-bottom: 1px solid var(--w-amber);
        }

        .wkbr-hero {
          padding: 60px 28px 50px;
          text-align: center;
          background:
            radial-gradient(circle at 50% 0%, rgba(240, 184, 64, 0.12), transparent 60%);
        }

        .wkbr-on-air {
          display: inline-block;
          padding: 8px 24px;
          font-family: "Courier Prime", "Courier New", monospace;
          background: #c8181a;
          color: var(--w-cream);
          font-size: 14px;
          letter-spacing: 0.4em;
          text-transform: uppercase;
          font-weight: 700;
          border: 2px solid var(--w-amber);
          box-shadow: 0 0 18px rgba(200, 24, 26, 0.5);
          margin-bottom: 28px;
        }

        .wkbr-name {
          font-family: "Anton", "Roboto Slab", Impact, sans-serif;
          font-size: clamp(70px, 13vw, 156px);
          font-weight: 900;
          letter-spacing: -0.01em;
          line-height: 0.86;
          color: var(--w-cream);
          margin: 0;
        }
        .wkbr-name .freq {
          display: block;
          font-size: 0.45em;
          color: var(--w-amber);
          margin-top: 12px;
          letter-spacing: 0.04em;
          font-weight: 400;
        }

        .wkbr-tag {
          margin: 22px auto 0;
          max-width: 720px;
          font-family: Georgia, serif;
          font-style: italic;
          font-size: 19px;
          line-height: 1.65;
          color: var(--w-cream);
          opacity: 0.95;
        }

        .wkbr-dial {
          display: block;
          margin: 36px auto 8px;
        }

        .wkbr-shell { max-width: 1100px; margin: 0 auto; padding: 56px 28px 60px; }

        .wkbr-headliner {
          background: var(--w-maroon-deep);
          border: 2px solid var(--w-amber);
          padding: 36px 32px;
          display: grid;
          grid-template-columns: 1fr 1.4fr;
          gap: 36px;
          align-items: center;
          margin-bottom: 56px;
        }
        @media (max-width: 720px) { .wkbr-headliner { grid-template-columns: 1fr; } }

        .wkbr-headliner .title-block {
          padding: 18px;
          background: var(--w-dial);
          border: 1px dashed var(--w-amber);
        }
        .wkbr-headliner .eyebrow {
          font-family: "Courier Prime", monospace;
          font-size: 11px;
          letter-spacing: 0.42em;
          color: var(--w-amber);
          text-transform: uppercase;
        }
        .wkbr-headliner h2 {
          font-family: "Anton", "Roboto Slab", Impact, sans-serif;
          font-size: clamp(38px, 5.2vw, 56px);
          color: var(--w-cream);
          margin: 8px 0 0;
          letter-spacing: 0.01em;
          line-height: 0.95;
          text-transform: uppercase;
        }
        .wkbr-headliner h2 small {
          display: block; font-size: 0.4em;
          letter-spacing: 0.18em;
          color: var(--w-amber);
          margin-top: 8px;
          font-weight: 400;
          text-transform: uppercase;
        }
        .wkbr-headliner p { margin: 0 0 12px; font-size: 17px; line-height: 1.65; color: var(--w-cream); }
        .wkbr-headliner .when {
          display: inline-block;
          padding: 6px 12px;
          background: var(--w-amber);
          color: var(--w-dial);
          font-family: "Courier Prime", monospace;
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 0.18em;
          margin-top: 6px;
        }

        .wkbr-section-h {
          font-family: "Anton", "Roboto Slab", Impact, sans-serif;
          font-size: clamp(28px, 4vw, 38px);
          letter-spacing: 0.04em;
          color: var(--w-cream);
          text-transform: uppercase;
          margin: 0 0 8px;
          text-align: center;
        }
        .wkbr-section-sub {
          text-align: center;
          font-size: 12px;
          letter-spacing: 0.42em;
          text-transform: uppercase;
          color: var(--w-amber);
          margin-bottom: 28px;
          font-family: "Courier Prime", monospace;
        }

        .wkbr-schedule {
          width: 100%;
          border-collapse: collapse;
          background: var(--w-maroon-deep);
          border: 2px solid var(--w-amber);
        }
        .wkbr-schedule th, .wkbr-schedule td {
          padding: 12px 14px;
          text-align: left;
          border-bottom: 1px dashed rgba(240, 184, 64, 0.3);
        }
        .wkbr-schedule th {
          background: var(--w-dial);
          font-family: "Courier Prime", monospace;
          font-size: 11px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: var(--w-amber);
          font-weight: 700;
        }
        .wkbr-schedule td.time {
          font-family: "Courier Prime", monospace;
          color: var(--w-amber);
          font-size: 15px;
          white-space: nowrap;
          width: 110px;
        }
        .wkbr-schedule td.show {
          font-family: "Anton", "Roboto Slab", Impact, sans-serif;
          font-size: 18px;
          color: var(--w-cream);
          letter-spacing: 0.01em;
          text-transform: uppercase;
        }
        .wkbr-schedule td.host { font-style: italic; color: var(--w-cream); opacity: 0.85; font-size: 14px; }
        .wkbr-schedule td.note { font-size: 13px; color: var(--w-cream); opacity: 0.7; }

        .wkbr-tune {
          margin-top: 56px;
          background: var(--w-amber);
          color: var(--w-dial);
          padding: 32px 28px;
          text-align: center;
          border: 2px solid var(--w-cream);
        }
        .wkbr-tune h3 {
          font-family: "Anton", Impact, sans-serif;
          font-size: clamp(28px, 4.2vw, 42px);
          margin: 0 0 8px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .wkbr-tune p { margin: 0; font-size: 16px; line-height: 1.6; }
        .wkbr-tune a {
          display: inline-block;
          margin-top: 18px;
          padding: 12px 24px;
          background: var(--w-dial);
          color: var(--w-amber);
          font-family: "Courier Prime", monospace;
          font-weight: 700;
          font-size: 14px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          text-decoration: none;
        }

        .wkbr-foot {
          margin-top: 48px;
          padding-top: 24px;
          border-top: 1px solid rgba(240, 184, 64, 0.4);
          text-align: center;
          font-family: "Courier Prime", monospace;
          font-size: 11px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--w-amber);
        }
        .wkbr-foot small {
          display: block; margin-top: 8px;
          font-family: Georgia, serif;
          font-style: italic;
          font-size: 12px;
          color: var(--w-cream); opacity: 0.7;
          letter-spacing: 0.04em;
          text-transform: none;
        }
      `}</style>

      <div className="wkbr-strip">⬤ Broadcasting at 1340 kHz · Streaming at wkbr1340.com · Since 1962</div>

      <section className="wkbr-hero">
        <div className="wkbr-on-air">⬤ On Air</div>

        <h1 className="wkbr-name">WKBR
          <span className="freq">1340 AM · Columbus</span>
        </h1>

        <p className="wkbr-tag">
          The first sports-talk station in central Ohio, broadcasting from
          a single tower on the river since the Kennedy administration.
          Live games. Live callers. Live every night.
        </p>

        <svg className="wkbr-dial" width="320" height="100" viewBox="0 0 320 100" role="img" aria-label="Radio dial centered on 1340 kHz">
          {/* dial face */}
          <rect x="6" y="20" width="308" height="60" fill="#2a1010" stroke="#f0b840" strokeWidth="2" />
          <rect x="14" y="28" width="292" height="44" fill="#f0b840" />
          {/* tick marks */}
          {[540, 700, 900, 1100, 1340, 1500, 1700].map((freq, i, arr) => {
            const x = 22 + (i / (arr.length - 1)) * 276;
            const isOurs = freq === 1340;
            return (
              <g key={freq}>
                <line x1={x} y1="32" x2={x} y2={isOurs ? 72 : 56} stroke="#2a1010" strokeWidth={isOurs ? 2 : 1} />
                <text x={x} y={isOurs ? 86 : 67} textAnchor="middle" fontFamily="Courier Prime, monospace" fontSize="9" fill={isOurs ? "#c8181a" : "#2a1010"} fontWeight={isOurs ? "700" : "400"}>{freq}</text>
                {[0, 1, 2, 3].map((m) => i < arr.length - 1 && (
                  <line key={m} x1={x + ((m + 1) / 5) * (276 / (arr.length - 1))} y1="32" x2={x + ((m + 1) / 5) * (276 / (arr.length - 1))} y2="42" stroke="#2a1010" strokeWidth="0.6" />
                ))}
              </g>
            );
          })}
          {/* pointer */}
          <line x1={22 + (4 / 6) * 276} y1="14" x2={22 + (4 / 6) * 276} y2="94" stroke="#c8181a" strokeWidth="3" />
          <polygon points={`${22 + (4 / 6) * 276 - 5},14 ${22 + (4 / 6) * 276 + 5},14 ${22 + (4 / 6) * 276},22`} fill="#c8181a" />
        </svg>
      </section>

      <div className="wkbr-shell">
        <section className="wkbr-headliner">
          <div className="title-block">
            <div className="eyebrow">★ Marquee Show ★</div>
            <h2>Postgame Call-In
              <small>with Eddie Russo</small>
            </h2>
          </div>
          <div>
            <p>
              Two hours of you. Eddie keeps the phone lines open from the
              last out until midnight Eastern, weeknights, year-round.
              Local beat writers Wednesdays. Manager phone-in Fridays.
              Open mic the rest.
            </p>
            <p>
              Twenty-two years on the air, six regional Murrows, one
              broken nose (Eddie, 2008). Tune in. Call in.
              <b style={{ display: 'inline-block', marginLeft: 4, color: 'var(--w-amber)' }}>(614) 555-1340</b>
            </p>
            <div className="when">Weeknights · 10:00 PM – 12:00 AM</div>
          </div>
        </section>

        <h2 className="wkbr-section-h">Today on WKBR</h2>
        <div className="wkbr-section-sub">— Monday through Friday Programming —</div>

        <table className="wkbr-schedule">
          <thead>
            <tr>
              <th>Hour</th>
              <th>Show</th>
              <th>Host</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {SCHEDULE.map((s, i) => (
              <tr key={i}>
                <td className="time">{s.time}</td>
                <td className="show">{s.show}</td>
                <td className="host">{s.host}</td>
                <td className="note">{s.note}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="wkbr-tune">
          <h3>Tune In · Stream Anywhere.</h3>
          <p>
            1340 on your AM dial. Streaming free, no app, no login at our
            site. We broadcast a clean 1,000-watt signal from the river
            tower — clear within forty miles.
          </p>
          <a href="https://example.com" onClick={(e) => e.preventDefault()}>Stream Live →</a>
        </section>

        <div className="wkbr-foot">
          ⬤ WKBR · 1340 kHz · Licensed by the F.C.C. · Studios at Riverview Park ⬤
          <small>The opinions expressed by callers are theirs and not those of the station.</small>
        </div>
      </div>
    </div>
  );
}
