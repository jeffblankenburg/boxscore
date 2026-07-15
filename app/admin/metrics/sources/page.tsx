import { requireAdmin } from "../../require-admin";
import {
  getQrFunnel,
  getSubscriberSources,
  getTrafficSources,
  parseWindow,
  type QrFunnelRow,
  type SourceCount,
} from "@/lib/dashboard";
import { KpiCard, WindowSelector } from "../../_components/dashboard-bits";
import { DataTable, EmptyState, PageHeader, Section } from "../../_components/primitives";

// /admin/metrics/sources — acquisition attribution.
// Groups in-window signups by utm_source / medium / campaign and by
// referrer hostname. Captured at /subscribe POST via migration 0057;
// pre-migration rows have nulls and contribute only to the "unknown"
// bucket (which is correct — we don't know where they came from).

export const dynamic = "force-dynamic";
export const metadata = { title: "Sources · Metrics · boxscore admin", robots: { index: false } };

const BASE_PATH = "/admin/metrics/sources";

export default async function SourcesMetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  await requireAdmin();
  const { window: windowParam } = await searchParams;
  const w = parseWindow(windowParam);
  const [sources, traffic, qr] = await Promise.all([
    getSubscriberSources(w),
    getTrafficSources(w),
    getQrFunnel(w),
  ]);

  const qrConvPct = qr.totalScans === 0
    ? "—"
    : `${((qr.totalConversions / qr.totalScans) * 100).toFixed(1)}%`;

  const knownPct = sources.total === 0
    ? "—"
    : `${((sources.withAttribution / sources.total) * 100).toFixed(0)}%`;
  const unknownPct = sources.total === 0
    ? "—"
    : `${((sources.unknownOrDirect / sources.total) * 100).toFixed(0)}%`;

  const referredPct = traffic.sessions === 0
    ? "—"
    : `${((traffic.referredSessions / traffic.sessions) * 100).toFixed(0)}%`;

  return (
    <>
      <PageHeader
        title="Sources"
        subtitle="Where signups and visitors came from. Subscriber attribution captured at /subscribe; traffic attribution from Vercel Web Analytics (one entry referrer per session)."
        breadcrumbs={[{ label: "Metrics" }, { label: "Sources" }]}
      />

      <Section>
        <WindowSelector current={w} basePath={BASE_PATH} />
      </Section>

      <h2 className="a-section-title">Subscriber acquisition</h2>
      <p className="a-section-note">
        First-touch attribution recorded at /subscribe POST. Returning unsubs
        keep their original source. Pre-migration rows (signups before 2026-06-22)
        have nulls for all fields and land in the &ldquo;direct / unknown&rdquo; bucket.
      </p>

      <Section>
        <div className="admin-kpis">
          <KpiCard
            label={`Signups (${w})`}
            value={sources.total.toLocaleString()}
            sub="created_at in window"
          />
          <KpiCard
            label="With known source"
            value={sources.withAttribution.toLocaleString()}
            sub={`${knownPct} of signups had UTM or referrer`}
          />
          <KpiCard
            label="Direct / unknown"
            value={sources.unknownOrDirect.toLocaleString()}
            sub={`${unknownPct} — direct traffic or pre-migration row`}
          />
        </div>
      </Section>

      <Section title="Signups by utm_source">
        <SourceTable rows={sources.bySource} total={sources.total} keyHeader="utm_source" />
      </Section>

      <Section title="Signups by referrer host">
        <SourceTable rows={sources.byReferrerHost} total={sources.total} keyHeader="hostname" />
      </Section>

      <Section title="Signups by referring URL (click to visit)">
        <UrlTable rows={sources.byReferrerUrl} total={sources.total} />
      </Section>

      <Section title="Signups by utm_campaign">
        <SourceTable rows={sources.byCampaign} total={sources.total} keyHeader="utm_campaign" />
      </Section>

      <Section title="Signups by utm_medium">
        <SourceTable rows={sources.byMedium} total={sources.total} keyHeader="utm_medium" />
      </Section>

      <Section title="Signups by landing path">
        <SourceTable rows={sources.byLandingPath} total={sources.total} keyHeader="first-touch path" />
      </Section>

      <h2 className="a-section-title">QR code scans</h2>
      <p className="a-section-note">
        Physical QR codes (business cards, flyers) route through{" "}
        <code>/r/qr?src=&lt;label&gt;</code>, which logs the scan and forwards to
        /subscribe with <code>utm_source=qr</code> and{" "}
        <code>utm_campaign=&lt;label&gt;</code>. Scans count every phone that
        opened the link; conversions are in-window signups whose first-touch
        source was qr. Scan and signup are windowed independently, so per-src
        rate is approximate near the window edge.
      </p>

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
            value={qrConvPct}
            sub="conversions ÷ scans"
          />
        </div>
      </Section>

      <Section title="By QR label (src)">
        <QrTable rows={qr.rows} />
      </Section>

      <h2 className="a-section-title">Site traffic (all visitors)</h2>
      <p className="a-section-note">
        Sessions, not pageviews. One entry referrer per session — Vercel
        Web Analytics ships referrer on the first event of a session only.
        Direct/unknown is "typed URL, bookmark, app link, or a source page
        that strips referrer."
      </p>

      <Section>
        <div className="admin-kpis">
          <KpiCard
            label={`Pageviews (${w})`}
            value={traffic.pageviews.toLocaleString()}
            sub="production, event_type=pageview"
          />
          <KpiCard
            label="Sessions"
            value={traffic.sessions.toLocaleString()}
            sub="distinct (session, device)"
          />
          <KpiCard
            label="With referrer"
            value={traffic.referredSessions.toLocaleString()}
            sub={`${referredPct} of sessions`}
          />
          <KpiCard
            label="Direct / unknown"
            value={traffic.directOrUnknown.toLocaleString()}
            sub="no referrer on entry"
          />
        </div>
      </Section>

      <Section title="Traffic by referrer host">
        <SourceTable rows={traffic.byReferrerHost} total={traffic.referredSessions} keyHeader="hostname" />
      </Section>

      <Section title="Traffic by referring URL (click to visit)">
        <UrlTable rows={traffic.byReferrerUrl} total={traffic.referredSessions} />
      </Section>

      <Section title="Traffic by landing path">
        <SourceTable rows={traffic.byLandingPath} total={traffic.sessions} keyHeader="entry path" />
      </Section>
    </>
  );
}

function SourceTable({
  rows,
  total,
  keyHeader,
}: {
  rows: SourceCount[];
  total: number;
  keyHeader: string;
}) {
  return (
    <DataTable
      rows={rows}
      empty={<EmptyState message="No rows in window — capture started 2026-06-22, so older windows can be empty until enough signups accumulate." />}
      columns={[
        {
          header: keyHeader,
          cell: (r) => <code>{r.key}</code>,
        },
        {
          header: "signups",
          width: "120px",
          className: "num",
          cell: (r) => r.count.toLocaleString(),
        },
        {
          header: "share",
          width: "100px",
          className: "num",
          cell: (r) => total === 0 ? "—" : `${((r.count / total) * 100).toFixed(1)}%`,
        },
      ]}
    />
  );
}

// QR funnel: one row per src label, scans vs conversions vs rate. Empty
// state points at the /r/qr route so it's obvious how rows get created.
function QrTable({ rows }: { rows: QrFunnelRow[] }) {
  return (
    <DataTable
      rows={rows}
      empty={<EmptyState message="No QR scans in window. Physical codes route through /r/qr?src=<label>." />}
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

// Full referring URL renderer. Linkifies the URL with target="_blank" and
// rel="noreferrer" so visits to the linking page don't pass our admin URL
// back as a referrer. "Origin only" rows (just `https://google.com/`) are
// rendered as plain text — search-engine referrers degenerate to origin,
// and clicking them just goes to the search homepage.
function UrlTable({
  rows,
  total,
}: {
  rows: SourceCount[];
  total: number;
}) {
  return (
    <DataTable
      rows={rows}
      empty={<EmptyState message="No URL-level referrer data in window." />}
      columns={[
        {
          header: "URL",
          cell: (r) => {
            const isOriginOnly = isOriginRoot(r.key);
            return isOriginOnly ? (
              <span style={{ color: "var(--a-muted, #888)" }}>
                {r.key}{" "}
                <span style={{ fontSize: "0.8em" }}>(origin only — search engine or stripped referrer)</span>
              </span>
            ) : (
              <a href={r.key} target="_blank" rel="noreferrer">{r.key}</a>
            );
          },
        },
        {
          header: "count",
          width: "100px",
          className: "num",
          cell: (r) => r.count.toLocaleString(),
        },
        {
          header: "share",
          width: "100px",
          className: "num",
          cell: (r) => total === 0 ? "—" : `${((r.count / total) * 100).toFixed(1)}%`,
        },
      ]}
    />
  );
}

// "https://google.com/" → true; "https://www.reddit.com/r/baseball/comments/xyz/" → false.
// We classify a URL as origin-only when the pathname is empty or "/" and
// there's no query string — clicking those is pointless.
function isOriginRoot(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.pathname === "" || u.pathname === "/") && u.search === "" && u.hash === "";
  } catch {
    return false;
  }
}
