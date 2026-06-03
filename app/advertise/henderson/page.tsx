export const metadata = {
  title: "Henderson Sporting Goods — Since 1962",
  description: "Outfitting weekend ballplayers since 1962. Bats, gloves, cleats, and uniforms. Two locations, one phone number.",
  robots: { index: false },
};

export default function HendersonPage() {
  return (
    <div className="sponsor-page henderson-root">
      <style>{`
        .henderson-root {
          --h-olive: #5a6a3a;
          --h-olive-deep: #3c4625;
          --h-cream: #f3ead0;
          --h-paper: #fbf6e3;
          --h-chestnut: #7a3d22;
          --h-ink: #20180a;
          --h-rust: #b04a1f;
          background: var(--h-paper);
          background-image:
            radial-gradient(circle at 10% 10%, rgba(122,61,34,0.05), transparent 40%),
            radial-gradient(circle at 90% 80%, rgba(90,106,58,0.06), transparent 40%);
          color: var(--h-ink);
          font-family: "Trade Gothic", "Roboto Slab", "Georgia", serif;
          min-height: 100vh;
        }
        .henderson-root * { box-sizing: border-box; }

        .henderson-masthead {
          background: var(--h-olive-deep);
          color: var(--h-cream);
          padding: 8px 28px;
          font-size: 12px;
          letter-spacing: 0.36em;
          text-transform: uppercase;
          text-align: center;
        }
        .henderson-masthead .dot { color: var(--h-rust); }

        .henderson-shell { max-width: 1100px; margin: 0 auto; padding: 48px 32px 60px; }

        .henderson-hero {
          display: grid;
          grid-template-columns: 220px 1fr;
          gap: 36px;
          padding-bottom: 28px;
          border-bottom: 4px double var(--h-olive-deep);
          align-items: end;
        }
        @media (max-width: 720px) {
          .henderson-hero { grid-template-columns: 1fr; gap: 18px; }
        }

        .henderson-name {
          font-family: "Georgia", "Times New Roman", serif;
          font-size: clamp(48px, 7vw, 84px);
          line-height: 0.95;
          font-weight: 900;
          font-style: italic;
          letter-spacing: -0.02em;
          color: var(--h-olive-deep);
          margin: 0;
        }
        .henderson-tag {
          margin-top: 10px;
          font-size: 16px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--h-chestnut);
          font-weight: 700;
        }

        .henderson-volume {
          margin-top: 22px;
          font-size: 12px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--h-ink);
          opacity: 0.6;
        }

        .henderson-departments {
          margin-top: 48px;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0;
          border-top: 1px solid var(--h-olive-deep);
          border-left: 1px solid var(--h-olive-deep);
        }
        @media (max-width: 720px) { .henderson-departments { grid-template-columns: repeat(2, 1fr); } }

        .henderson-dept {
          padding: 22px 18px;
          border-right: 1px solid var(--h-olive-deep);
          border-bottom: 1px solid var(--h-olive-deep);
          background: var(--h-cream);
        }
        .henderson-dept svg { display: block; margin: 0 auto 10px; }
        .henderson-dept .label {
          text-align: center;
          font-size: 13px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--h-olive-deep);
          font-weight: 700;
        }
        .henderson-dept .sub {
          text-align: center;
          font-size: 11.5px;
          color: var(--h-chestnut);
          margin-top: 4px;
          font-style: italic;
        }

        .henderson-stripe {
          margin-top: 56px;
          background: var(--h-chestnut);
          color: var(--h-cream);
          padding: 22px 28px;
          text-align: center;
          font-size: 17px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .henderson-stripe b { color: #f5d488; font-style: italic; }

        .henderson-grid {
          margin-top: 56px;
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 48px;
        }
        @media (max-width: 800px) { .henderson-grid { grid-template-columns: 1fr; } }

        .henderson-pitch h2 {
          font-family: Georgia, serif;
          font-style: italic;
          font-size: 30px;
          color: var(--h-olive-deep);
          margin: 0 0 16px;
          line-height: 1.15;
        }
        .henderson-pitch p {
          font-size: 17px;
          line-height: 1.65;
          color: var(--h-ink);
          margin: 0 0 14px;
          font-family: Georgia, serif;
        }
        .henderson-pitch .quote {
          margin-top: 28px;
          padding: 18px 22px;
          border-left: 5px solid var(--h-rust);
          font-style: italic;
          font-family: Georgia, serif;
          font-size: 16px;
          color: var(--h-chestnut);
          background: var(--h-cream);
        }
        .henderson-pitch .signoff {
          margin-top: 8px;
          font-size: 13px;
          letter-spacing: 0.1em;
          color: var(--h-ink);
          opacity: 0.7;
          font-style: normal;
        }

        .henderson-locations {
          background: var(--h-cream);
          padding: 28px;
          border: 1px solid var(--h-olive-deep);
        }
        .henderson-locations h3 {
          font-family: Georgia, serif;
          font-style: italic;
          font-size: 22px;
          color: var(--h-olive-deep);
          margin: 0 0 16px;
        }
        .henderson-locations h4 {
          font-size: 12px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--h-chestnut);
          margin: 18px 0 4px;
        }
        .henderson-locations p { margin: 0; font-size: 15px; line-height: 1.55; color: var(--h-ink); }
        .henderson-locations .phone {
          margin-top: 18px;
          font-family: Georgia, serif;
          font-size: 26px;
          font-style: italic;
          font-weight: 900;
          color: var(--h-rust);
          letter-spacing: 0.04em;
        }
        .henderson-locations .hours {
          margin-top: 10px;
          font-size: 13px;
          color: var(--h-ink);
        }

        .henderson-foot {
          margin-top: 48px;
          text-align: center;
          font-size: 12px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: var(--h-olive-deep);
          padding-top: 18px;
          border-top: 4px double var(--h-olive-deep);
        }
      `}</style>

      <div className="henderson-masthead">
        Outfitting Weekend Ballplayers <span className="dot">·</span> Since 1962 <span className="dot">·</span> Two Locations
      </div>

      <div className="henderson-shell">
        <header className="henderson-hero">
          <svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label="Henderson seal — diamond with HSG monogram">
            <circle cx="100" cy="100" r="92" fill="#fbf6e3" stroke="#3c4625" strokeWidth="3" />
            <circle cx="100" cy="100" r="80" fill="none" stroke="#3c4625" strokeWidth="1" />
            {/* baseball diamond */}
            <g stroke="#7a3d22" strokeWidth="2" fill="none">
              <path d="M100 50 L150 100 L100 150 L50 100 Z" />
            </g>
            <circle cx="100" cy="50" r="4" fill="#7a3d22" />
            <circle cx="150" cy="100" r="4" fill="#7a3d22" />
            <circle cx="100" cy="150" r="4" fill="#7a3d22" />
            <circle cx="50" cy="100" r="4" fill="#7a3d22" />
            {/* monogram */}
            <text x="100" y="111" textAnchor="middle" fontFamily="Georgia, serif" fontStyle="italic" fontSize="48" fontWeight="900" fill="#3c4625">H</text>
            {/* ring text imitation */}
            <text x="100" y="36" textAnchor="middle" fontFamily="Georgia, serif" fontSize="10" letterSpacing="3" fill="#3c4625">EST · 1962</text>
            <text x="100" y="180" textAnchor="middle" fontFamily="Georgia, serif" fontSize="10" letterSpacing="3" fill="#3c4625">HENDERSON</text>
          </svg>

          <div>
            <h1 className="henderson-name">Henderson<br />Sporting&nbsp;Goods</h1>
            <div className="henderson-tag">A Family Firm · Columbus &amp; Worthington</div>
            <div className="henderson-volume">Catalog No. 64 — Spring &amp; Summer Edition</div>
          </div>
        </header>

        <section className="henderson-departments">
          <div className="henderson-dept">
            <svg width="48" height="48" viewBox="0 0 48 48"><g stroke="#5a6a3a" strokeWidth="2.5" strokeLinecap="round" fill="#fbf6e3"><path d="M10 38 L34 14" /><circle cx="36" cy="12" r="4" fill="#5a6a3a" /></g></svg>
            <div className="label">Bats</div>
            <div className="sub">Wood · Ash · Maple</div>
          </div>
          <div className="henderson-dept">
            <svg width="48" height="48" viewBox="0 0 48 48"><g fill="#7a3d22" stroke="#3c4625" strokeWidth="1.5"><path d="M10 14 Q24 6 38 14 Q42 26 38 36 Q24 42 10 36 Q6 26 10 14 Z" /><line x1="14" y1="22" x2="34" y2="22" stroke="#fbf6e3" strokeWidth="1" /><line x1="14" y1="28" x2="34" y2="28" stroke="#fbf6e3" strokeWidth="1" /></g></svg>
            <div className="label">Gloves</div>
            <div className="sub">Infield · Outfield · Catcher</div>
          </div>
          <div className="henderson-dept">
            <svg width="48" height="48" viewBox="0 0 48 48"><g fill="#3c4625"><path d="M6 30 L34 30 L42 36 L42 40 L6 40 Z" /><circle cx="12" cy="38" r="2" fill="#fbf6e3" /><circle cx="20" cy="38" r="2" fill="#fbf6e3" /><circle cx="28" cy="38" r="2" fill="#fbf6e3" /></g></svg>
            <div className="label">Cleats</div>
            <div className="sub">Metal · Molded · Turf</div>
          </div>
          <div className="henderson-dept">
            <svg width="48" height="48" viewBox="0 0 48 48"><g fill="#b04a1f" stroke="#3c4625" strokeWidth="1.5"><path d="M12 10 L24 6 L36 10 L34 38 L14 38 Z" /><text x="24" y="26" textAnchor="middle" fontFamily="Georgia, serif" fontSize="12" fontWeight="900" fill="#fbf6e3">22</text></g></svg>
            <div className="label">Uniforms</div>
            <div className="sub">Stocked &amp; Custom</div>
          </div>
        </section>

        <div className="henderson-stripe">
          Spring Sale · <b>15% off</b> any glove with a bat purchase · April–June
        </div>

        <div className="henderson-grid">
          <article className="henderson-pitch">
            <h2>If your team plays on Sundays, we open Sundays.</h2>
            <p>
              We stock what beer-league ballplayers actually buy — a good
              ash bat at thirty-eight dollars, a glove broken in over a
              weekend, cleats that survive a season in a damp duffel.
            </p>
            <p>
              Custom uniforms are quoted by phone and stitched in-house.
              Two weeks for a full set of fifteen. Embroidered caps and
              numbered jerseys, no minimums on small jobs.
            </p>
            <div className="quote">
              "The Hendersons have been outfitting our company team for
              eleven seasons. The gear lasts and the people behind the
              counter remember your kid's number."
              <div className="signoff">— Marlene B., Bonded Iron Works softball, since 2014</div>
            </div>
          </article>

          <aside className="henderson-locations">
            <h3>Two locations.</h3>
            <h4>Columbus</h4>
            <p>418 East Fifth Avenue<br />Behind the rail bridge, look for the green awning.</p>
            <h4>Worthington</h4>
            <p>1209 High Street<br />Across from the old armory.</p>
            <div className="phone">(614) 555-0162</div>
            <div className="hours">
              Mon–Fri 9–7 · Sat 9–6 · Sun 10–4
            </div>
          </aside>
        </div>

        <div className="henderson-foot">
          ★ Henderson Sporting Goods ★ A Family Firm ★ Since 1962 ★
        </div>
      </div>
    </div>
  );
}
