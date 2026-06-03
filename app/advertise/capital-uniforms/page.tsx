export const metadata = {
  title: "Capital Custom Uniforms — Team gear, two-week turnaround",
  description: "Sublimated jerseys, embroidered caps, full kit. No team too small. Quotes by email.",
  robots: { index: false },
};

const PRODUCTS = [
  { name: "Sublimated Jersey",  desc: "Full color, full bleed, full custom — no panels.", price: "$48",  unit: "each" },
  { name: "Embroidered Cap",    desc: "Three-position stitching. Twelve crown colors.",   price: "$22",  unit: "each" },
  { name: "Pant + Belt Set",    desc: "Game-grade pant in three cuts. Belt included.",    price: "$36",  unit: "each" },
  { name: "Warmup Jacket",      desc: "Lightweight, custom embroidered.",                 price: "$54",  unit: "each" },
  { name: "Full Kit (12 ct.)",  desc: "Jersey + pant + cap + bag. Bulk rate.",            price: "$1,440", unit: "12 players" },
  { name: "Equipment Bag",      desc: "Heavy-duty, screen-printed.",                      price: "$32",  unit: "each" },
];

export default function CapitalUniformsPage() {
  return (
    <div className="sponsor-page capital-root">
      <style>{`
        .capital-root {
          --c-black: #0a0a0a;
          --c-charcoal: #1a1a1a;
          --c-red: #d31a1d;
          --c-red-deep: #8c0e10;
          --c-grey: #2a2a2a;
          --c-line: #404040;
          --c-cream: #f0e8d8;
          --c-text: #f3f3f3;
          background: var(--c-black);
          color: var(--c-text);
          font-family: "Oswald", "Roboto Condensed", "Arial Narrow", Arial, sans-serif;
          min-height: 100vh;
          text-transform: none;
        }
        .capital-root * { box-sizing: border-box; }

        .capital-strip {
          background: var(--c-red);
          color: #fff;
          padding: 9px 24px;
          text-align: center;
          font-size: 12px;
          letter-spacing: 0.36em;
          text-transform: uppercase;
          font-weight: 700;
        }

        .capital-hero {
          padding: 64px 28px 72px;
          background:
            linear-gradient(180deg, rgba(211,26,29,0.16), transparent 50%),
            radial-gradient(ellipse at 50% 0%, rgba(211,26,29,0.2), transparent 70%),
            var(--c-black);
          text-align: center;
          border-bottom: 6px solid var(--c-red);
        }
        .capital-emblem { display: block; margin: 0 auto 22px; }
        .capital-name {
          font-family: "Anton", "Oswald", Impact, sans-serif;
          font-size: clamp(64px, 11vw, 140px);
          line-height: 0.86;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          font-weight: 900;
          margin: 0;
          color: #fff;
        }
        .capital-name .red { color: var(--c-red); }
        .capital-sub {
          font-size: clamp(20px, 3vw, 30px);
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--c-text);
          margin: 8px 0 0;
        }
        .capital-tagline {
          margin: 28px auto 0;
          max-width: 720px;
          font-size: 18px;
          line-height: 1.55;
          color: #d0d0d0;
        }

        .capital-stats {
          margin-top: 36px;
          display: flex;
          justify-content: center;
          gap: 56px;
          flex-wrap: wrap;
        }
        .capital-stat .v {
          font-family: "Anton", "Oswald", Impact, sans-serif;
          font-size: 42px;
          color: var(--c-red);
          line-height: 1;
        }
        .capital-stat .l {
          font-size: 11px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: #d0d0d0;
          margin-top: 4px;
        }

        .capital-shell { max-width: 1080px; margin: 0 auto; padding: 56px 28px 80px; }

        .capital-section-title {
          font-family: "Anton", Oswald, Impact, sans-serif;
          font-size: clamp(36px, 5vw, 56px);
          letter-spacing: 0.02em;
          color: #fff;
          margin: 0 0 4px;
          text-transform: uppercase;
        }
        .capital-section-eyebrow {
          font-size: 12px;
          letter-spacing: 0.36em;
          text-transform: uppercase;
          color: var(--c-red);
          margin-bottom: 6px;
          font-weight: 700;
        }
        .capital-section-rule { height: 0; border-top: 3px solid var(--c-red); margin: 12px 0 30px; }

        .capital-products {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
        }
        @media (max-width: 800px) { .capital-products { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 540px) { .capital-products { grid-template-columns: 1fr; } }
        .capital-product {
          background: var(--c-charcoal);
          border: 1px solid var(--c-line);
          padding: 22px;
        }
        .capital-product .head {
          display: flex; justify-content: space-between; align-items: baseline;
          margin-bottom: 6px;
        }
        .capital-product h3 {
          font-family: "Anton", Oswald, Impact, sans-serif;
          font-size: 22px;
          letter-spacing: 0.04em;
          margin: 0;
          color: #fff;
          text-transform: uppercase;
        }
        .capital-product .price {
          font-family: "Anton", Oswald, Impact, sans-serif;
          font-size: 30px;
          color: var(--c-red);
        }
        .capital-product .unit {
          display: block;
          text-align: right;
          font-size: 10px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: #b0b0b0;
          margin-top: -6px;
        }
        .capital-product p {
          font-size: 13.5px;
          line-height: 1.5;
          color: #d0d0d0;
          margin: 12px 0 0;
        }

        .capital-jerseys {
          margin-top: 64px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 28px;
          padding: 36px 28px;
          background: var(--c-charcoal);
          border-top: 4px solid var(--c-red);
          border-bottom: 4px solid var(--c-red);
        }
        @media (max-width: 720px) { .capital-jerseys { grid-template-columns: 1fr; } }
        .capital-jersey { text-align: center; }
        .capital-jersey .number {
          font-family: "Anton", Oswald, Impact, sans-serif;
          font-size: 24px;
          color: var(--c-red);
          letter-spacing: 0.06em;
          margin-top: 10px;
          text-transform: uppercase;
        }
        .capital-jersey .label {
          font-size: 12px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: #b0b0b0;
        }

        .capital-process {
          margin-top: 64px;
        }
        .capital-process-steps {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 24px;
        }
        @media (max-width: 800px) { .capital-process-steps { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 480px) { .capital-process-steps { grid-template-columns: 1fr; } }
        .capital-step .n {
          font-family: "Anton", Oswald, Impact, sans-serif;
          font-size: 64px;
          color: var(--c-red);
          line-height: 0.8;
          letter-spacing: -0.02em;
        }
        .capital-step h4 {
          font-family: "Oswald", Impact, sans-serif;
          font-size: 18px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #fff;
          margin: 8px 0 6px;
        }
        .capital-step p {
          font-size: 13.5px;
          line-height: 1.55;
          color: #d0d0d0;
          margin: 0;
        }

        .capital-cta {
          margin-top: 72px;
          padding: 44px 28px;
          background: var(--c-red);
          color: #fff;
          text-align: center;
        }
        .capital-cta h2 {
          font-family: "Anton", Oswald, Impact, sans-serif;
          font-size: clamp(32px, 5vw, 48px);
          letter-spacing: 0.04em;
          margin: 0 0 12px;
          text-transform: uppercase;
        }
        .capital-cta p { margin: 0; font-size: 16px; opacity: 0.95; }
        .capital-cta .btn {
          display: inline-block;
          margin-top: 22px;
          background: #fff;
          color: var(--c-red);
          padding: 14px 28px;
          font-family: "Anton", Oswald, Impact, sans-serif;
          font-size: 18px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          text-decoration: none;
        }

        .capital-foot {
          margin-top: 56px;
          padding: 28px 0;
          border-top: 1px solid var(--c-line);
          text-align: center;
          font-size: 12px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: #909090;
        }
      `}</style>

      <div className="capital-strip">
        Two-Week Turnaround · No Order Too Small · Sublimated in House
      </div>

      <section className="capital-hero">
        <svg className="capital-emblem" width="110" height="110" viewBox="0 0 110 110" role="img" aria-label="Capital Custom Uniforms emblem — bold C with crossbar">
          <rect x="6" y="6" width="98" height="98" fill="#0a0a0a" stroke="#d31a1d" strokeWidth="3" />
          <text x="55" y="76" textAnchor="middle" fontFamily="Anton, Oswald, Impact, sans-serif" fontWeight="900" fontSize="74" fill="#d31a1d">C</text>
          <rect x="22" y="58" width="66" height="6" fill="#fff" />
          <text x="55" y="98" textAnchor="middle" fontFamily="Oswald, sans-serif" fontSize="7" letterSpacing="2" fill="#fff">CAPITAL CUSTOM</text>
        </svg>

        <h1 className="capital-name">Capital <span className="red">Custom</span></h1>
        <div className="capital-sub">Uniforms</div>

        <p className="capital-tagline">
          We sublimate, embroider, screen-print, and ship full team kits
          out of a single warehouse on the south side. Two-week turnaround
          on a full set of fifteen. No minimums. No surprise fees.
        </p>

        <div className="capital-stats">
          <div className="capital-stat">
            <div className="v">14 days</div>
            <div className="l">Standard turn</div>
          </div>
          <div className="capital-stat">
            <div className="v">1+</div>
            <div className="l">Min. quantity</div>
          </div>
          <div className="capital-stat">
            <div className="v">700+</div>
            <div className="l">Teams a year</div>
          </div>
        </div>
      </section>

      <div className="capital-shell">
        <div className="capital-section-eyebrow">— Catalog —</div>
        <h2 className="capital-section-title">Built for Beer-League</h2>
        <div className="capital-section-rule" />

        <div className="capital-products">
          {PRODUCTS.map((p) => (
            <div key={p.name} className="capital-product">
              <div className="head">
                <h3>{p.name}</h3>
              </div>
              <div className="price">{p.price}</div>
              <span className="unit">{p.unit}</span>
              <p>{p.desc}</p>
            </div>
          ))}
        </div>

        <section className="capital-jerseys">
          {[
            { color: '#d31a1d', text: '#fff', num: '22', label: "Sublimated · Full Bleed" },
            { color: '#1a3a8c', text: '#fff', num: '07', label: "Two-Color · Screen Print" },
            { color: '#f0e8d8', text: '#0a0a0a', num: '14', label: "Cream · Tackle Twill" },
          ].map((j, i) => (
            <div key={i} className="capital-jersey">
              <svg width="160" height="180" viewBox="0 0 160 180" aria-hidden="true">
                {/* jersey shape */}
                <path d="M40 30 L20 50 L40 60 L40 160 L120 160 L120 60 L140 50 L120 30 L100 28 Q80 38 60 28 Z"
                      fill={j.color} stroke="#0a0a0a" strokeWidth="2" />
                {/* collar */}
                <path d="M60 28 Q80 42 100 28" fill="none" stroke="#0a0a0a" strokeWidth="2" />
                {/* number */}
                <text x="80" y="118" textAnchor="middle" fontFamily="Anton, Oswald, Impact, sans-serif" fontWeight="900" fontSize="58" fill={j.text}>{j.num}</text>
                {/* hem stripe */}
                <line x1="40" y1="150" x2="120" y2="150" stroke={j.text === '#fff' ? '#fff' : '#d31a1d'} strokeWidth="2" />
              </svg>
              <div className="number">No. {j.num}</div>
              <div className="label">{j.label}</div>
            </div>
          ))}
        </section>

        <div className="capital-process">
          <div className="capital-section-eyebrow">— How it works —</div>
          <h2 className="capital-section-title">Four Steps. Two Weeks.</h2>
          <div className="capital-section-rule" />
          <div className="capital-process-steps">
            <div className="capital-step">
              <div className="n">01</div>
              <h4>Email a brief</h4>
              <p>Team name, sport, count, deadline. We respond same day with a quote and a mock-up timeline.</p>
            </div>
            <div className="capital-step">
              <div className="n">02</div>
              <h4>Approve a proof</h4>
              <p>You get full-color digital mock-ups within 48 hours. Iterate until you're happy. No charge.</p>
            </div>
            <div className="capital-step">
              <div className="n">03</div>
              <h4>Production</h4>
              <p>Ten business days, sublimated and stitched on our floor. No outsourcing.</p>
            </div>
            <div className="capital-step">
              <div className="n">04</div>
              <h4>Pickup or ship</h4>
              <p>Pick up at the warehouse. Or we ship — flat $24 anywhere in the lower 48.</p>
            </div>
          </div>
        </div>
      </div>

      <section className="capital-cta">
        <h2>Get a Quote in 24 Hours.</h2>
        <p>Email <b>quotes@capitaluniforms.com</b> with your team count and sport. We'll reply same day.</p>
        <a className="btn" href="mailto:quotes@capitaluniforms.com">Email a Quote</a>
      </section>

      <div className="capital-foot">
        Capital Custom Uniforms · 4820 Industrial Pkwy. · Columbus, OH
      </div>
    </div>
  );
}
