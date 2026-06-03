export const metadata = {
  title: "Eastman & Reid Insurance — Since 1948",
  description: "Auto, home, life, and small-business coverage. Three generations. Same family. Same office.",
  robots: { index: false },
};

const SERVICES = [
  { label: "Personal Auto",         desc: "Liability, comprehensive, and rideshare endorsements." },
  { label: "Homeowner & Renter",    desc: "Standard and high-value home coverage; flood riders." },
  { label: "Term & Whole Life",     desc: "Twenty-, thirty-year term and whole-life with cash value." },
  { label: "Small Business",        desc: "General liability, BOP packages, and workers' comp." },
  { label: "Commercial Auto",       desc: "Single-vehicle and fleet, with hired-and-non-owned riders." },
  { label: "Umbrella",              desc: "Personal and commercial umbrella up to $5M." },
];

export default function EastmanReidPage() {
  return (
    <div className="sponsor-page eastman-root">
      <style>{`
        .eastman-root {
          --e-navy: #122845;
          --e-navy-deep: #07172d;
          --e-cream: #f0e7d0;
          --e-paper: #f9f3e1;
          --e-rose: #b6404a;
          --e-gold: #b9893d;
          --e-ink: #1a1410;
          background: var(--e-paper);
          color: var(--e-ink);
          font-family: "EB Garamond", "Garamond", Georgia, serif;
          min-height: 100vh;
        }
        .eastman-root * { box-sizing: border-box; }

        .eastman-band {
          background: var(--e-navy);
          color: var(--e-cream);
          padding: 7px 24px;
          text-align: center;
          font-size: 11.5px;
          letter-spacing: 0.42em;
          text-transform: uppercase;
        }
        .eastman-band b { color: var(--e-gold); font-style: italic; }

        .eastman-shell { max-width: 1000px; margin: 0 auto; padding: 64px 32px 80px; }

        .eastman-masthead {
          text-align: center;
          padding-bottom: 28px;
          border-bottom: 4px double var(--e-navy);
        }
        .eastman-est {
          font-size: 13px;
          letter-spacing: 0.46em;
          text-transform: uppercase;
          color: var(--e-rose);
          margin-bottom: 12px;
          font-style: italic;
        }
        .eastman-name {
          font-family: "Cormorant Garamond", "EB Garamond", Garamond, Georgia, serif;
          font-size: clamp(48px, 7.5vw, 88px);
          font-weight: 700;
          line-height: 1;
          color: var(--e-navy);
          margin: 0;
          letter-spacing: -0.005em;
        }
        .eastman-name em {
          font-style: italic;
          color: var(--e-rose);
          font-weight: 400;
        }
        .eastman-sub {
          margin: 22px 0 0;
          font-size: 15px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--e-navy);
        }
        .eastman-sub::before, .eastman-sub::after {
          content: "✦"; color: var(--e-gold); margin: 0 12px;
        }
        .eastman-emblem { display: block; margin: 0 auto 18px; }

        .eastman-grid {
          margin-top: 56px;
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 56px;
          column-rule: 1px solid var(--e-navy);
        }
        @media (max-width: 800px) { .eastman-grid { grid-template-columns: 1fr; gap: 36px; } }

        .eastman-letter h2 {
          font-style: italic;
          font-size: clamp(26px, 3.6vw, 34px);
          color: var(--e-navy);
          margin: 0 0 16px;
          line-height: 1.15;
          font-weight: 700;
        }
        .eastman-letter p {
          font-size: 17px;
          line-height: 1.75;
          margin: 0 0 14px;
        }
        .eastman-letter p:first-of-type::first-letter {
          font-size: 3em; float: left;
          line-height: 0.85;
          padding: 6px 8px 0 0;
          font-style: italic;
          color: var(--e-rose);
          font-weight: 700;
          font-family: "Cormorant Garamond", Georgia, serif;
        }
        .eastman-letter .sig {
          margin-top: 28px;
          font-style: italic;
          font-size: 16px;
          color: var(--e-navy);
        }
        .eastman-letter .sig b { font-weight: 700; }
        .eastman-letter .sig small { display: block; font-size: 13px; color: var(--e-ink); opacity: 0.7; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 4px; }

        .eastman-services h3 {
          font-style: italic;
          font-size: 22px;
          color: var(--e-navy);
          margin: 0 0 14px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--e-navy);
        }
        .eastman-services ul { list-style: none; padding: 0; margin: 0; }
        .eastman-services li {
          padding: 14px 0;
          border-bottom: 1px dotted #00000033;
        }
        .eastman-services li b {
          display: block;
          font-style: italic;
          color: var(--e-rose);
          font-size: 17px;
          margin-bottom: 4px;
        }
        .eastman-services li span {
          font-size: 14.5px;
          color: var(--e-ink);
          opacity: 0.85;
          line-height: 1.55;
        }

        .eastman-pillars {
          margin-top: 72px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 28px;
        }
        @media (max-width: 720px) { .eastman-pillars { grid-template-columns: 1fr; } }
        .eastman-pillar {
          padding: 26px 22px;
          background: var(--e-cream);
          border: 1px solid var(--e-navy);
          text-align: center;
        }
        .eastman-pillar .roman {
          font-family: "Cormorant Garamond", Georgia, serif;
          font-size: 28px;
          color: var(--e-gold);
          font-style: italic;
          letter-spacing: 0.04em;
        }
        .eastman-pillar h4 {
          margin: 4px 0 8px;
          font-style: italic;
          font-size: 20px;
          color: var(--e-navy);
        }
        .eastman-pillar p {
          font-size: 14.5px;
          line-height: 1.6;
          margin: 0;
          color: var(--e-ink);
        }

        .eastman-foot {
          margin-top: 64px;
          padding: 36px 28px;
          background: var(--e-navy);
          color: var(--e-cream);
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 36px;
        }
        @media (max-width: 700px) { .eastman-foot { grid-template-columns: 1fr; } }
        .eastman-foot h4 {
          font-style: italic;
          font-size: 22px;
          color: var(--e-gold);
          margin: 0 0 8px;
        }
        .eastman-foot p { margin: 0; font-size: 16px; line-height: 1.65; }
        .eastman-foot .phone {
          margin-top: 14px;
          font-style: italic;
          font-size: 26px;
          color: #fff;
        }

        .eastman-fine {
          margin-top: 24px;
          text-align: center;
          font-size: 11px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--e-navy);
          opacity: 0.75;
        }
      `}</style>

      <div className="eastman-band">
        Independent Agency <b>·</b> Family-Owned Since 1948 <b>·</b> Licensed in OH · IN · KY
      </div>

      <div className="eastman-shell">
        <header className="eastman-masthead">
          <svg className="eastman-emblem" width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="Eastman & Reid crest — quill and shield">
            <circle cx="60" cy="60" r="56" fill="none" stroke="#122845" strokeWidth="2" />
            <circle cx="60" cy="60" r="48" fill="none" stroke="#122845" strokeWidth="0.6" />
            <text x="60" y="20" textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontSize="9" letterSpacing="3" fill="#122845">EASTMAN · REID</text>
            <text x="60" y="108" textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontSize="9" letterSpacing="3" fill="#122845">EST · MCMXLVIII</text>
            {/* shield */}
            <path d="M48 32 L72 32 L72 60 Q72 80 60 86 Q48 80 48 60 Z" fill="#f0e7d0" stroke="#122845" strokeWidth="2" />
            <text x="60" y="62" textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontWeight="700" fontStyle="italic" fontSize="22" fill="#122845">E</text>
            <text x="60" y="76" textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontWeight="700" fontStyle="italic" fontSize="14" fill="#b6404a">R</text>
            {/* quill */}
            <line x1="40" y1="78" x2="80" y2="38" stroke="#b9893d" strokeWidth="2" />
            <path d="M76 32 L82 32 L82 38 L78 38 L76 36 Z" fill="#b9893d" />
          </svg>

          <div className="eastman-est">A Family of Brokers</div>
          <h1 className="eastman-name">Eastman <em>&amp;</em> Reid</h1>
          <div className="eastman-sub">Insurance Brokers · Columbus</div>
        </header>

        <div className="eastman-grid">
          <section className="eastman-letter">
            <h2>From the desk of Margaret Eastman-Reid, Principal.</h2>
            <p>
              My grandfather, Henry Eastman, started this agency over a
              kitchen table in 1948 with one client — a barber on Long
              Street — and a single typewriter that still sits in the
              front window. Eighteen years later he wrote a small
              brochure that said, in part, "An insurance policy is a
              promise. We intend to keep it."
            </p>
            <p>
              Three generations of Eastmans and Reids have intended the
              same thing. We are an independent agency, which means we
              represent the client and not the carrier. We write with
              twenty-two companies, but we will only write you with one
              that we'd write our own brother with.
            </p>
            <p>
              We answer the phone. We make house calls for claims. We
              still mail a hand-signed Christmas card to every client we
              have. If your insurance company has stopped feeling like a
              relationship and started feeling like a phone tree, we
              would like to make your acquaintance.
            </p>
            <p className="sig">
              With our regards,
              <br />
              <b>Margaret Eastman-Reid</b>
              <small>Principal · Third generation · Class of '03</small>
            </p>
          </section>

          <aside className="eastman-services">
            <h3>What We Write</h3>
            <ul>
              {SERVICES.map((s) => (
                <li key={s.label}>
                  <b>{s.label}</b>
                  <span>{s.desc}</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        <section className="eastman-pillars">
          <div className="eastman-pillar">
            <div className="roman">I.</div>
            <h4>Independent</h4>
            <p>Twenty-two carriers. We compete for your renewal each year. You don't have to.</p>
          </div>
          <div className="eastman-pillar">
            <div className="roman">II.</div>
            <h4>Local</h4>
            <p>One office, on the corner of Broad and Sixth. Three principals, all on premises, every weekday.</p>
          </div>
          <div className="eastman-pillar">
            <div className="roman">III.</div>
            <h4>Patient</h4>
            <p>Claim filed at 6 PM gets a callback the same evening. House call within forty-eight hours.</p>
          </div>
        </section>

        <footer className="eastman-foot">
          <div>
            <h4>Set an appointment.</h4>
            <p>
              Walk in, or call ahead. The conference room has coffee
              and a window that opens. Bring whatever paperwork you
              have. We'll sort the rest.
            </p>
            <p className="phone">(614) 555-0148</p>
          </div>
          <div>
            <h4>Visit the office.</h4>
            <p>
              <i>1216 East Broad Street</i><br />
              Suite 200 · Above the bank<br />
              <br />
              <i>Mon – Fri 8:30 AM – 5:30 PM</i><br />
              <i>Saturday by appointment</i>
            </p>
          </div>
        </footer>

        <p className="eastman-fine">
          Eastman &amp; Reid Insurance Agency, Inc. · Licensed in OH · IN · KY · A member of the Independent Insurance Agents of Ohio
        </p>
      </div>
    </div>
  );
}
