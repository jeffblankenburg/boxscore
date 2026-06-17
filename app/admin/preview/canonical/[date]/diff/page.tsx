import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "../../../../require-admin";
import { Breadcrumbs, PageHeader, Section } from "../../../../_components/primitives";

import { getDailyRaw } from "@/lib/daily-raw";
import { getSdioDailyRaw } from "@/lib/sports/mlb/sources/sdio-storage";
import { adaptStatsapiDailyRaw } from "@/lib/sports/mlb/adapters/from-statsapi";
import { adaptSdioDailyPayload } from "@/lib/sports/mlb/adapters/from-sdio";
import { diffCanonical, type DiffReport, type EntityDiff, type SectionDiff } from "@/lib/sports/mlb/diff";
import { isValidIsoDate, prettyDate, yesterdayInET } from "@/lib/dates";

// /admin/preview/canonical/[date]/diff
//
// Semantic diff between the statsapi-canonical and sdio-canonical
// bundles for a single date. Renderer-visible fields only — anything
// listed here is something a digest reader would see.

export const dynamic  = "force-dynamic";
export const metadata = { title: "Canonical diff · admin · boxscore", robots: { index: false } };

export default async function CanonicalDiffPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  await requireAdmin();
  const { date } = await params;
  if (!isValidIsoDate(date)) notFound();

  const [statsapiRaw, sdioPayload] = await Promise.all([
    getDailyRaw("mlb", date),
    getSdioDailyRaw("mlb", date),
  ]);

  const previewUrl = `/admin/preview/canonical/${date}?source=statsapi`;

  if (!statsapiRaw || !sdioPayload) {
    return (
      <>
        <Breadcrumbs items={[
          { label: "Content" },
          { label: "Canonical preview", href: `/admin/preview/canonical/${yesterdayInET()}?source=statsapi` },
          { label: prettyDate(date), href: previewUrl },
          { label: "Diff" },
        ]} />
        <PageHeader title="Canonical diff" />
        <Section>
          <p className="admin-meta">
            Need both rows to diff.{" "}
            {!statsapiRaw && <>statsapi <code>daily_raw</code> for <b>{date}</b> is missing — the daily cron writes this at 09:00 UTC.{" "}</>}
            {!sdioPayload && <>SDIO <code>daily_raw_sdio</code> for <b>{date}</b> is missing — fetch it from the <Link href={previewUrl}>preview page</Link> first.</>}
          </p>
        </Section>
      </>
    );
  }

  const leftCanonical  = adaptStatsapiDailyRaw(date, statsapiRaw);
  const rightCanonical = adaptSdioDailyPayload(date, sdioPayload);
  const report = diffCanonical("statsapi", "SportsDataIO", leftCanonical, rightCanonical);

  return (
    <>
      <Breadcrumbs items={[
        { label: "Content" },
        { label: "Canonical preview", href: `/admin/preview/canonical/${yesterdayInET()}?source=statsapi` },
        { label: prettyDate(date), href: previewUrl },
        { label: "Diff" },
      ]} />
      <PageHeader
        title={`Canonical diff — ${prettyDate(date)}`}
        subtitle={(
          <>
            Semantic diff between <b>{report.leftLabel}</b> (left) and <b>{report.rightLabel}</b> (right).
            Renderer-visible fields only. Match keys: games / box scores / scoring plays by
            game id, standings by team id, leaderboards by (league, category) ranked top-5,
            transactions by player id.
          </>
        )}
      />

      <Section>
        <ReportSummary report={report} />
      </Section>

      {report.sections.map((s) => (
        <Section key={s.name} title={`${s.name} — ${s.summary}`}>
          <SectionDetail section={s} />
        </Section>
      ))}
    </>
  );
}

// ─── Components ─────────────────────────────────────────────────────────

function ReportSummary({ report }: { report: DiffReport }) {
  const total = report.sections.reduce((a, s) => a + s.total, 0);
  const matched = report.sections.reduce((a, s) => a + s.matched, 0);
  const differing = report.sections.reduce((a, s) => a + s.differing, 0);
  const onlyLeft  = report.sections.reduce((a, s) => a + s.leftOnly, 0);
  const onlyRight = report.sections.reduce((a, s) => a + s.rightOnly, 0);
  return (
    <div className="cx-diff-summary">
      <div><b>{total}</b> entities total</div>
      <div><span className="cx-diff-tone-match">{matched}</span> match</div>
      <div><span className="cx-diff-tone-differ">{differing}</span> differ</div>
      <div><span className="cx-diff-tone-only">{onlyLeft}</span> {report.leftLabel}-only</div>
      <div><span className="cx-diff-tone-only">{onlyRight}</span> {report.rightLabel}-only</div>
    </div>
  );
}

function SectionDetail({ section }: { section: SectionDiff }) {
  // Show all non-matching entities. Matching ones collapse into a count.
  const interesting = section.entities.filter((e) => e.status !== "match");
  if (interesting.length === 0) {
    return <p className="admin-meta">All {section.matched} entities match.</p>;
  }
  return (
    <table className="cx-diff-table">
      <thead>
        <tr>
          <th>Entity</th>
          <th>Status</th>
          <th>Field</th>
          <th>Left (statsapi)</th>
          <th>Right (SDIO)</th>
        </tr>
      </thead>
      <tbody>
        {interesting.map((e, i) => (
          <EntityRows key={`${e.label}-${i}`} entity={e} />
        ))}
      </tbody>
    </table>
  );
}

function EntityRows({ entity }: { entity: EntityDiff }) {
  // Each entity may have many field diffs — render the entity label on
  // the first row, leave subsequent rows visually grouped by indent so
  // the eye scans down the field column.
  if (entity.fields.length === 0) {
    return (
      <tr className={`cx-diff-row cx-diff-row-${entity.status}`}>
        <td>{entity.label}</td>
        <td><StatusBadge status={entity.status} /></td>
        <td colSpan={3} className="cx-diff-empty">—</td>
      </tr>
    );
  }
  return (
    <>
      {entity.fields.map((f, j) => (
        <tr key={j} className={`cx-diff-row cx-diff-row-${entity.status}`}>
          <td>{j === 0 ? entity.label : ""}</td>
          <td>{j === 0 ? <StatusBadge status={entity.status} /> : ""}</td>
          <td className="cx-diff-path"><code>{f.path}</code></td>
          <td className="cx-diff-val">{renderValue(f.left)}</td>
          <td className="cx-diff-val">{renderValue(f.right)}</td>
        </tr>
      ))}
    </>
  );
}

function StatusBadge({ status }: { status: EntityDiff["status"] }) {
  const label = status === "left-only"
    ? "statsapi only"
    : status === "right-only"
      ? "SDIO only"
      : status === "differ"
        ? "differs"
        : "match";
  return <span className={`cx-diff-badge cx-diff-badge-${status}`}>{label}</span>;
}

function renderValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v.length > 100 ? v.slice(0, 100) + "…" : v;
  return JSON.stringify(v);
}
