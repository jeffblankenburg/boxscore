export const metadata = {
  title: "MetroTickets Resale — Local, Verified, Below Face",
  description: "Lower-level seats every home stand, below face value. Locally owned since 2007.",
  robots: { index: false },
};

const LISTINGS = [
  { date: "Fri Jun 6",  matchup: "vs. Chicago",      time: "7:10 PM", section: "Sec. 118, Row 14", price: "$48", qty: 2, note: "Aisle" },
  { date: "Sat Jun 7",  matchup: "vs. Chicago",      time: "4:05 PM", section: "Sec. 142, Row 6",  price: "$72", qty: 4, note: "Together" },
  { date: "Sun Jun 8",  matchup: "vs. Chicago",      time: "1:35 PM", section: "Sec. 23, Row 12",  price: "$58", qty: 2, note: "Shade" },
  { date: "Tue Jun 10", matchup: "vs. Detroit",      time: "7:10 PM", section: "Sec. 109, Row 8",  price: "$36", qty: 3, note: "" },
  { date: "Wed Jun 11", matchup: "vs. Detroit",      time: "7:10 PM", section: "Sec. 130, Row 22", price: "$32", qty: 2, note: "Aisle" },
  { date: "Thu Jun 12", matchup: "vs. Detroit",      time: "1:10 PM", section: "Sec. 8, Row 4",    price: "$95", qty: 2, note: "Front row" },
];

export default function MetroTicketsPage() {
  return (
    <div className="sponsor-page metro-root">
      <style>{`
        .metro-root {
          --m-navy: #11233f;
          --m-navy-soft: #1c365f;
          --m-blue: #2e6eb6;
          --m-sky: #d6e5f5;
          --m-paper: #ffffff;
          --m-bg: #f5f7fc;
          --m-ink: #0d1626;
          --m-mute: #5f6c80;
          --m-line: #d8dee9;
          --m-success: #1f6e3d;
          background: var(--m-bg);
          color: var(--m-ink);
          font-family: "Inter", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
          min-height: 100vh;
        }
        .metro-root * { box-sizing: border-box; }

        .metro-nav {
          background: var(--m-paper);
          border-bottom: 1px solid var(--m-line);
          padding: 14px 28px;
          display: flex;
          align-items: center;
          gap: 24px;
          font-size: 14px;
        }
        .metro-brand {
          display: flex; align-items: center; gap: 10px;
          font-weight: 700; font-size: 18px;
          color: var(--m-navy);
        }
        .metro-nav .pad { flex: 1; }
        .metro-nav .link { color: var(--m-ink); text-decoration: none; opacity: 0.8; }
        .metro-nav .link:hover { opacity: 1; }
        .metro-nav .btn {
          background: var(--m-navy);
          color: #fff;
          padding: 8px 14px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 13px;
          text-decoration: none;
        }

        .metro-hero {
          background: linear-gradient(180deg, var(--m-navy), var(--m-navy-soft));
          color: #fff;
          padding: 72px 28px 80px;
          text-align: center;
        }
        .metro-eyebrow {
          font-size: 12px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: var(--m-sky);
          margin-bottom: 14px;
        }
        .metro-headline {
          font-size: clamp(36px, 5.5vw, 60px);
          font-weight: 800;
          letter-spacing: -0.02em;
          line-height: 1.05;
          margin: 0 auto 16px;
          max-width: 780px;
        }
        .metro-sub {
          font-size: 18px;
          line-height: 1.55;
          margin: 0 auto;
          max-width: 620px;
          color: var(--m-sky);
        }
        .metro-stats {
          margin-top: 36px;
          display: flex;
          justify-content: center;
          gap: 56px;
          flex-wrap: wrap;
        }
        .metro-stat .v {
          font-size: 32px; font-weight: 800; letter-spacing: -0.01em;
          color: #fff;
        }
        .metro-stat .l {
          font-size: 12px; letter-spacing: 0.18em;
          text-transform: uppercase; color: var(--m-sky);
          margin-top: 4px;
        }

        .metro-shell {
          max-width: 1080px;
          margin: -40px auto 60px;
          padding: 0 28px;
        }

        .metro-card {
          background: var(--m-paper);
          border: 1px solid var(--m-line);
          border-radius: 10px;
          box-shadow: 0 12px 32px rgba(17, 35, 63, 0.08);
          padding: 28px 28px 18px;
        }
        .metro-card h2 {
          font-size: 22px;
          letter-spacing: -0.01em;
          margin: 0 0 4px;
        }
        .metro-card .desc {
          font-size: 14px;
          color: var(--m-mute);
          margin: 0 0 22px;
        }

        .metro-table {
          width: 100%; border-collapse: collapse;
          font-size: 14px;
        }
        .metro-table th, .metro-table td {
          padding: 12px 8px;
          text-align: left;
          border-bottom: 1px solid var(--m-line);
        }
        .metro-table th {
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--m-mute);
          font-weight: 600;
        }
        .metro-table td.price {
          font-weight: 700; color: var(--m-success);
          font-variant-numeric: tabular-nums;
        }
        .metro-table td .badge {
          display: inline-block;
          font-size: 11px;
          background: var(--m-sky);
          color: var(--m-navy);
          padding: 2px 8px;
          border-radius: 999px;
          letter-spacing: 0.04em;
        }
        .metro-table td .matchup { font-weight: 600; }
        .metro-table td .time { color: var(--m-mute); font-size: 13px; }
        .metro-table td .qty { color: var(--m-mute); }

        .metro-features {
          margin-top: 56px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
        }
        @media (max-width: 720px) { .metro-features { grid-template-columns: 1fr; } }
        .metro-feature {
          background: var(--m-paper);
          border: 1px solid var(--m-line);
          border-radius: 10px;
          padding: 22px;
        }
        .metro-feature .icon {
          width: 40px; height: 40px;
          border-radius: 8px;
          background: var(--m-sky);
          display: flex; align-items: center; justify-content: center;
          color: var(--m-navy);
          margin-bottom: 14px;
        }
        .metro-feature h3 {
          font-size: 16px; font-weight: 700;
          margin: 0 0 4px;
        }
        .metro-feature p {
          font-size: 14px; line-height: 1.55;
          color: var(--m-mute);
          margin: 0;
        }

        .metro-foot {
          margin-top: 56px;
          padding: 36px 28px;
          background: var(--m-navy);
          color: #fff;
          border-radius: 10px;
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 28px;
          align-items: center;
        }
        @media (max-width: 720px) { .metro-foot { grid-template-columns: 1fr; } }
        .metro-foot h3 { margin: 0 0 6px; font-size: 22px; letter-spacing: -0.01em; }
        .metro-foot p { margin: 0; font-size: 14.5px; color: var(--m-sky); line-height: 1.55; }
        .metro-foot .btn {
          display: inline-block;
          background: #fff;
          color: var(--m-navy);
          padding: 12px 22px;
          border-radius: 8px;
          font-weight: 700;
          font-size: 14px;
          text-decoration: none;
        }

        .metro-bottom {
          margin-top: 24px;
          text-align: center;
          font-size: 12px;
          color: var(--m-mute);
        }
      `}</style>

      <nav className="metro-nav">
        <div className="metro-brand">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <rect x="2" y="2" width="24" height="24" rx="6" fill="#11233f" />
            <path d="M8 9 L20 9 L20 19 L8 19 Z" fill="#fff" />
            <path d="M8 9 L8 19" stroke="#2e6eb6" strokeWidth="1.5" strokeDasharray="2 2" />
            <path d="M20 9 L20 19" stroke="#2e6eb6" strokeWidth="1.5" strokeDasharray="2 2" />
            <circle cx="14" cy="14" r="2" fill="#11233f" />
          </svg>
          MetroTickets
        </div>
        <div className="pad" />
        <a className="link" href="#">Browse</a>
        <a className="link" href="#">Sell</a>
        <a className="link" href="#">FAQ</a>
        <a className="btn" href="#">Sign in</a>
      </nav>

      <section className="metro-hero">
        <div className="metro-eyebrow">Locally Owned · Since 2007</div>
        <h1 className="metro-headline">Lower-level seats. Every home stand. Below face value.</h1>
        <p className="metro-sub">
          We buy season-ticket inventory directly from local plan-holders
          and resell it without the markup. Real seats, real people, real
          phone number.
        </p>
        <div className="metro-stats">
          <div className="metro-stat">
            <div className="v">17 yrs</div>
            <div className="l">In Business</div>
          </div>
          <div className="metro-stat">
            <div className="v">{`<`} face</div>
            <div className="l">on 80% of seats</div>
          </div>
          <div className="metro-stat">
            <div className="v">0%</div>
            <div className="l">Hidden fees</div>
          </div>
        </div>
      </section>

      <div className="metro-shell">
        <section className="metro-card">
          <h2>This week's inventory</h2>
          <p className="desc">Six games. All prices final — what you see is what you pay.</p>
          <table className="metro-table">
            <thead>
              <tr>
                <th>Game</th>
                <th>Seats</th>
                <th>Qty</th>
                <th>Note</th>
                <th style={{ textAlign: 'right' }}>Price each</th>
              </tr>
            </thead>
            <tbody>
              {LISTINGS.map((l, i) => (
                <tr key={i}>
                  <td>
                    <div className="matchup">{l.date}, {l.matchup}</div>
                    <div className="time">{l.time}</div>
                  </td>
                  <td>{l.section}</td>
                  <td><span className="qty">×{l.qty}</span></td>
                  <td>{l.note && <span className="badge">{l.note}</span>}</td>
                  <td className="price" style={{ textAlign: 'right' }}>{l.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="metro-features">
          <div className="metro-feature">
            <div className="icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 10 L9 13 L14 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h3>Verified before you pay</h3>
            <p>Every seat sold has a confirmed barcode in our system before it lists. No "I'll find out the section later."</p>
          </div>
          <div className="metro-feature">
            <div className="icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10" cy="10" r="7" /><path d="M10 6 L10 10 L13 12" strokeLinecap="round" /></svg>
            </div>
            <h3>Pick up in person</h3>
            <p>Office is at 1404 Front Street, two blocks from the gate. Open from doors-open through the second inning.</p>
          </div>
          <div className="metro-feature">
            <div className="icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7 L17 7 L15 17 L5 17 Z" strokeLinejoin="round" /><path d="M7 7 L7 4 Q10 2 13 4 L13 7" /></svg>
            </div>
            <h3>Sell your unused plan seats</h3>
            <p>Holding a flex plan you can't use? Drop the tickets off Tuesday. We pay out by check on Friday.</p>
          </div>
        </section>

        <section className="metro-foot">
          <div>
            <h3>Looking for a specific game?</h3>
            <p>Call the office or text the number on the door. Most home stands sell out by mid-week; we get inventory back daily as plan-holders return seats they can't use.</p>
          </div>
          <div>
            <a className="btn" href="tel:+16145550207">(614) 555-0207</a>
            <p style={{ marginTop: 10, color: 'var(--m-sky)', fontSize: 12 }}>1404 Front Street · Open game days 10 AM – 1st pitch</p>
          </div>
        </section>

        <p className="metro-bottom">© 2026 MetroTickets Resale Co. · A locally owned business · BBB A+ since 2009</p>
      </div>
    </div>
  );
}
