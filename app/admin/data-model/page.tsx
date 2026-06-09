import { requireAdmin } from "../require-admin";
import { CANONICAL_SECTIONS, CANONICAL_TYPE_NAMES } from "./_data/canonical";

export const dynamic = "force-dynamic";
export const metadata = { title: "Canonical model · admin · boxscore", robots: { index: false } };

// Renders the canonical MLB model as per-section, per-type cards. Each
// field's type is parsed and any canonical type-name reference becomes
// an anchor link to that type's card.
//
// The data comes from _data/canonical.ts (hand-authored to mirror
// lib/sports/mlb/types.ts). Sister pages /admin/data-model/statsapi and
// /sportsdataio render mapping tables against the same canonical names.

export default async function DataModelPage() {
  await requireAdmin();
  const typeCount = CANONICAL_SECTIONS.reduce((n, s) => n + s.types.length, 0);

  return (
    <div className="admin-wide">
      <div className="a-page-head">
        <div>
          <h1>Canonical MLB model</h1>
          <p className="subtitle">
            Source-agnostic types every renderer consumes. Adapters in{" "}
            <code>lib/sports/mlb/sources/*</code> are the only code that touches
            vendor-shaped data — everything downstream sees these shapes.
          </p>
        </div>
      </div>

      <dl className="a-info" style={{ gridTemplateColumns: "180px 1fr", marginBottom: 24 }}>
        <dt>Types</dt>
        <dd>{typeCount} across {CANONICAL_SECTIONS.length} sections</dd>
        <dt>Source file</dt>
        <dd><code>lib/sports/mlb/types.ts</code></dd>
        <dt>Vendor mappings</dt>
        <dd>
          <a href="/admin/data-model/statsapi">statsapi.mlb.com →</a>
          {" · "}
          <a href="/admin/data-model/sportsdataio">SportsDataIO →</a>
        </dd>
      </dl>

      {/* Quick-jump nav: section anchors + the type names underneath */}
      <nav className="dm-toc">
        {CANONICAL_SECTIONS.map((section) => (
          <div key={section.label} className="dm-toc-section">
            <a href={`#section-${slug(section.label)}`} className="dm-toc-section-label">
              {section.label}
            </a>
            <span className="dm-toc-types">
              {section.types.map((t, i) => (
                <span key={t.name}>
                  {i > 0 && <span className="dm-toc-sep"> · </span>}
                  <a href={`#${t.name}`}>{t.name}</a>
                </span>
              ))}
            </span>
          </div>
        ))}
      </nav>

      {CANONICAL_SECTIONS.map((section) => (
        <section key={section.label} className="a-section" id={`section-${slug(section.label)}`}>
          <div className="a-section-head">
            <h2>{section.label}</h2>
          </div>
          <div className="dm-grid">
            {section.types.map((t) => (
              <article key={t.name} className="dm-card" id={t.name}>
                <header className="dm-card-head">
                  <h3 className="dm-card-name">{t.name}</h3>
                  <span className={`dm-kind dm-kind-${t.kind}`}>{t.kind}</span>
                </header>
                <p className="dm-purpose">{t.purpose}</p>

                {t.kind === "alias" && t.aliasOf && (
                  <div className="dm-alias">
                    = <TypeReference text={t.aliasOf} />
                  </div>
                )}

                {t.kind === "union" && t.unionMembers && (
                  <ul className="dm-union">
                    {t.unionMembers.map((m) => (
                      <li key={m}><code>{m}</code></li>
                    ))}
                  </ul>
                )}

                {t.kind === "object" && t.fields && (
                  <table className="a-table dm-fields">
                    <thead>
                      <tr>
                        <th style={{ width: "30%" }}>Field</th>
                        <th style={{ width: "32%" }}>Type</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.fields.map((f) => (
                        <tr key={f.name}>
                          <td><code>{f.name}</code></td>
                          <td><TypeReference text={f.type} /></td>
                          <td className="muted">{f.notes ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Turn a type expression like "MlbInningLine[]" or "MlbDecisions | null" into
// JSX with anchor links to any canonical type names it mentions. Splits on
// non-identifier characters, looks each token up in CANONICAL_TYPE_NAMES.
function TypeReference({ text }: { text: string }) {
  const tokens = text.split(/(\b[A-Za-z_][A-Za-z0-9_]*\b)/g);
  return (
    <code className="dm-type">
      {tokens.map((tok, i) =>
        CANONICAL_TYPE_NAMES.has(tok)
          ? <a key={i} href={`#${tok}`} className="dm-type-link">{tok}</a>
          : <span key={i}>{tok}</span>
      )}
    </code>
  );
}
