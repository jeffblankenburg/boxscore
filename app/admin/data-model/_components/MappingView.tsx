import type { MlbSourceMapping, MappingStatus } from "../_data/mapping-shape";

// Renders a vendor → canonical mapping document: top-of-page gap summary,
// per-type tables, then an "Unmapped vendor fields" section. Used by both
// /admin/data-model/statsapi and /admin/data-model/sportsdataio so the two
// pages stay visually identical.

const STATUS_LABEL: Record<MappingStatus, string> = {
  direct: "✓ direct",
  transformed: "↦ transformed",
  derived: "↦ derived",
  degraded: "⚠ degraded",
  unwired: "⚙ unwired",
  missing: "✗ missing",
};

export function MappingView({ mapping }: { mapping: MlbSourceMapping }) {
  // Counts for the top-of-page gap summary.
  const statusCounts: Record<MappingStatus, number> = {
    direct: 0, transformed: 0, derived: 0, degraded: 0, unwired: 0, missing: 0,
  };
  for (const t of mapping.types) {
    for (const f of t.fields) statusCounts[f.status]++;
  }
  const unmappedTotal = mapping.unmappedVendor.reduce((n, g) => n + g.fields.length, 0);

  // Pre-compute the "what's broken" list for the gap summary. Includes
  // missing (real catalog gap) + degraded (lossy fidelity), but NOT unwired
  // — unwired entries are sourceable, just not pulled yet, so they belong
  // on a to-do list rather than a gap list.
  const gaps: Array<{ canonicalType: string; canonical: string; status: MappingStatus; notes?: string }> = [];
  for (const t of mapping.types) {
    for (const f of t.fields) {
      if (f.status === "missing" || f.status === "degraded") {
        gaps.push({ canonicalType: t.canonicalType, canonical: f.canonical, status: f.status, notes: f.notes });
      }
    }
  }

  return (
    <div className="admin-wide">
      <div className="a-page-head">
        <div>
          <h1>{mapping.vendor}</h1>
          <p className="subtitle">
            How <code>{mapping.baseUrl}</code> maps into the{" "}
            <a href="/admin/data-model">canonical MLB model</a>.
          </p>
        </div>
      </div>

      {mapping.notes.length > 0 && (
        <section className="a-section">
          <div className="a-section-head"><h2>Notes</h2></div>
          <ul className="dm-notes">
            {mapping.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </section>
      )}

      <section className="a-section">
        <div className="a-section-head"><h2>Gap summary</h2></div>
        <div className="dm-counts">
          <span className="dm-count dm-status-direct"><b>{statusCounts.direct}</b> direct</span>
          <span className="dm-count dm-status-transformed"><b>{statusCounts.transformed}</b> transformed</span>
          <span className="dm-count dm-status-derived"><b>{statusCounts.derived}</b> derived</span>
          <span className="dm-count dm-status-degraded"><b>{statusCounts.degraded}</b> degraded</span>
          <span className="dm-count dm-status-unwired"><b>{statusCounts.unwired}</b> unwired</span>
          <span className="dm-count dm-status-missing"><b>{statusCounts.missing}</b> missing</span>
          <span className="dm-count dm-status-unmapped"><b>{unmappedTotal}</b> unmapped vendor</span>
        </div>

        {gaps.length > 0 && (
          <details className="dm-gap-details">
            <summary>{gaps.length} canonical field{gaps.length === 1 ? "" : "s"} not fully sourced</summary>
            <table className="a-table dm-gap-table">
              <thead>
                <tr>
                  <th style={{ width: "180px" }}>Canonical type</th>
                  <th style={{ width: "160px" }}>Field</th>
                  <th style={{ width: "120px" }}>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((g, i) => (
                  <tr key={i}>
                    <td><a href={`#${g.canonicalType}`}><code>{g.canonicalType}</code></a></td>
                    <td><code>{g.canonical}</code></td>
                    <td><StatusPill status={g.status} /></td>
                    <td className="muted">{g.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </section>

      <section className="a-section">
        <div className="a-section-head"><h2>Per-type mapping</h2></div>
        <div className="dm-mapping-list">
          {mapping.types.map((t) => (
            <article key={t.canonicalType} className="dm-card" id={t.canonicalType}>
              <header className="dm-card-head">
                <h3 className="dm-card-name">
                  <a href={`/admin/data-model#${t.canonicalType}`}>{t.canonicalType}</a>
                </h3>
              </header>
              <p className="dm-purpose"><code>{t.endpoint}</code></p>
              <table className="a-table dm-fields">
                <thead>
                  <tr>
                    <th style={{ width: "26%" }}>Canonical field</th>
                    <th style={{ width: "32%" }}>Vendor source</th>
                    <th style={{ width: "12%" }}>Status</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {t.fields.map((f, i) => (
                    <tr key={i}>
                      <td><code>{f.canonical}</code></td>
                      <td><code className="dm-vendor">{f.vendor}</code></td>
                      <td><StatusPill status={f.status} /></td>
                      <td className="muted">{f.notes ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ))}
        </div>
      </section>

      <section className="a-section">
        <div className="a-section-head">
          <h2>Unmapped vendor fields</h2>
        </div>
        <p className="subtitle" style={{ marginBottom: 12 }}>
          Fields {mapping.vendor} returns that the canonical model doesn't carry.
          Some are intentional drops (vendor metadata, audit fields);
          others may be candidates to add when the digest grows new content.
        </p>
        <div className="dm-unmapped-list">
          {mapping.unmappedVendor.map((g) => (
            <article key={g.type} className="dm-card dm-unmapped-card">
              <header className="dm-card-head">
                <h3 className="dm-card-name">{g.type}</h3>
                <span className="dm-kind dm-kind-unmapped">{g.fields.length} unmapped</span>
              </header>
              <ul className="dm-unmapped-fields">
                {g.fields.map((f, i) => (
                  <li key={i}>
                    <code>{f.vendor}</code>
                    {f.notes && <span className="muted"> — {f.notes}</span>}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: MappingStatus }) {
  return <span className={`dm-pill dm-status-${status}`}>{STATUS_LABEL[status]}</span>;
}
