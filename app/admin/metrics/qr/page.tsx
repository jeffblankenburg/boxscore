import { requireAdmin } from "../../require-admin";
import { getQrFunnel, parseWindow, type QrFunnelRow } from "@/lib/dashboard";
import { KpiCard, WindowSelector } from "../../_components/dashboard-bits";
import { DataTable, EmptyState, PageHeader, Section } from "../../_components/primitives";
import QrGenerator from "./QrGenerator";

// /admin/metrics/qr — physical QR codes: generate them, and track scans +
// conversions. Codes route through /r/qr?src=<label>, which logs the scan in
// qr_scans and forwards to /subscribe with utm_source=qr so the resulting
// signup is attributed. Scans count raw reach (every phone); conversions are
// signups whose first-touch source was qr. Join key: src == utm_campaign.

export const dynamic = "force-dynamic";
export const metadata = { title: "QR codes · Metrics · boxscore admin", robots: { index: false } };

const BASE_PATH = "/admin/metrics/qr";

export default async function QrMetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  await requireAdmin();
  const { window: windowParam } = await searchParams;
  const w = parseWindow(windowParam);
  const qr = await getQrFunnel(w);

  const convPct = qr.totalScans === 0
    ? "—"
    : `${((qr.totalConversions / qr.totalScans) * 100).toFixed(1)}%`;

  return (
    <>
      <PageHeader
        title="QR codes"
        subtitle="Generate tracked QR codes for print, and measure scans and conversions per campaign."
        breadcrumbs={[{ label: "Metrics" }, { label: "QR codes" }]}
      />

      <h2 className="a-section-title">Generate</h2>
      <p className="a-section-note">
        Every generated code points at <code>/r/qr?src=&lt;label&gt;</code>, which
        logs the scan and forwards to /subscribe with <code>utm_source=qr</code>.
        Download SVG for a print shop, or a hi-res PNG for a layout. The label you
        pick here is what the report below groups by.
      </p>
      <Section>
        <QrGenerator />
      </Section>

      <h2 className="a-section-title">Scans &amp; conversions</h2>
      <p className="a-section-note">
        Scans count every phone that opened the link; conversions are in-window
        signups whose first-touch source was qr. Scan and signup are windowed
        independently, so per-src rate is approximate near the window edge.
      </p>

      <Section>
        <WindowSelector current={w} basePath={BASE_PATH} />
      </Section>

      <Section>
        <div className="admin-kpis">
          <KpiCard
            label={`Scans (${w})`}
            value={qr.totalScans.toLocaleString()}
            sub="qr_scans.scanned_at in window"
          />
          <KpiCard
            label="Conversions"
            value={qr.totalConversions.toLocaleString()}
            sub="signups with utm_source=qr"
          />
          <KpiCard
            label="Conversion rate"
            value={convPct}
            sub="conversions ÷ scans"
          />
        </div>
      </Section>

      <Section title="By QR label (src)">
        <QrTable rows={qr.rows} />
      </Section>
    </>
  );
}

// QR funnel: one row per src label, scans vs conversions vs rate. Empty state
// points at the /r/qr route so it's obvious how rows get created.
function QrTable({ rows }: { rows: QrFunnelRow[] }) {
  return (
    <DataTable
      rows={rows}
      empty={<EmptyState message="No QR scans in window. Generate a code above; physical codes route through /r/qr?src=<label>." />}
      columns={[
        {
          header: "src",
          cell: (r) => <code>{r.src}</code>,
        },
        {
          header: "scans",
          width: "110px",
          className: "num",
          cell: (r) => r.scans.toLocaleString(),
        },
        {
          header: "conversions",
          width: "130px",
          className: "num",
          cell: (r) => r.conversions.toLocaleString(),
        },
        {
          header: "conv rate",
          width: "110px",
          className: "num",
          cell: (r) => r.scans === 0 ? "—" : `${((r.conversions / r.scans) * 100).toFixed(1)}%`,
        },
      ]}
    />
  );
}
