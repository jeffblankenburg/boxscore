import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "../../../require-admin";
import { SubmitButton } from "../../../SubmitButton";
import { Breadcrumbs, PageHeader, Section } from "../../../_components/primitives";
import { fetchSdioNowAction } from "../actions";
import { getDailyRaw } from "@/lib/daily-raw";
import { getSdioDailyRaw } from "@/lib/sports/mlb/sources/sdio-storage";
import {
  isValidIsoDate,
  nextDay,
  prevDay,
  prettyDate,
  yesterdayInET,
} from "@/lib/dates";

// /admin/preview/canonical/[date]?source=statsapi|sdio&surface=web|email
//
// Loads the chosen source's raw row, runs the canonical adapter, bridges
// to DailyData, then hands it to the PRODUCTION renderers (renderContent
// or renderEmailContent) via an iframe. The output is identical to what
// /[sport]/[date] serves when the underlying data agrees.
//
// Production digest path is untouched — this surface only reads from the
// daily_raw / daily_raw_sdio tables; it never touches the digests table
// or the send pipeline.

export const dynamic  = "force-dynamic";
export const metadata = { title: "Canonical preview · admin · boxscore", robots: { index: false } };

type Source  = "statsapi" | "sdio";
type Surface = "web" | "email";

export default async function CanonicalPreviewPage({
  params,
  searchParams,
}: {
  params:       Promise<{ date: string }>;
  searchParams: Promise<{ source?: string; surface?: string }>;
}) {
  await requireAdmin();
  const { date } = await params;
  const { source: sourceParam, surface: surfaceParam } = await searchParams;
  if (!isValidIsoDate(date)) notFound();

  const source:  Source  = sourceParam  === "sdio"  ? "sdio"  : "statsapi";
  const surface: Surface = surfaceParam === "email" ? "email" : "web";

  // Read-existence checks for both rows so the tabs can show "loaded"
  // vs "no row" without us having to render the heavy adapter first.
  const [hasStatsapi, hasSdio] = await Promise.all([
    getDailyRaw("mlb", date).then(Boolean),
    getSdioDailyRaw("mlb", date).then(Boolean),
  ]);

  const pageUrl = (d: string, s: Source, sf: Surface) =>
    `/admin/preview/canonical/${d}?source=${s}&surface=${sf}`;
  const frameUrl = `/admin/preview/canonical/${date}/frame?source=${source}&surface=${surface}`;

  return (
    <>
      <Breadcrumbs items={[
        { label: "Content" },
        { label: "Canonical preview", href: pageUrl(yesterdayInET(), source, surface) },
        { label: prettyDate(date) },
      ]} />
      <PageHeader
        title="Canonical preview"
        subtitle={(
          <>
            Same production renderer (<code>renderContent</code> / <code>renderEmailContent</code>),
            two source adapters. Toggle source to validate that SDIO produces the same digest body
            as statsapi. The production digest path at <code>/mlb/{date}</code> is unaffected.
          </>
        )}
      />

      <Section>
        <div className="cx-controls">
          <div className="cx-source-toggle" role="tablist" aria-label="Data source">
            <SourceTab
              active={source === "statsapi"}
              href={pageUrl(date, "statsapi", surface)}
              label="statsapi.mlb.com"
              hint={hasStatsapi ? "loaded" : "no row"}
              ok={hasStatsapi}
            />
            <SourceTab
              active={source === "sdio"}
              href={pageUrl(date, "sdio", surface)}
              label="SportsDataIO"
              hint={hasSdio ? "loaded" : "no row — fetch below"}
              ok={hasSdio}
            />
          </div>
          <div className="cx-surface-toggle" role="tablist" aria-label="Surface">
            <SurfaceTab active={surface === "web"}   href={pageUrl(date, source, "web")}   label="Web" />
            <SurfaceTab active={surface === "email"} href={pageUrl(date, source, "email")} label="Email" />
          </div>
          <div className="cx-date-nav">
            <Link className="admin-btn" href={pageUrl(prevDay(date), source, surface)}>&larr; Prev</Link>
            <Link className="admin-btn" href={pageUrl(yesterdayInET(), source, surface)}>Yesterday</Link>
            <Link className="admin-btn" href={pageUrl(nextDay(date), source, surface)}>Next &rarr;</Link>
          </div>
          <Link className="admin-btn" href={`/admin/preview/canonical/${date}/sxs?surface=${surface}`}>
            Side-by-side
          </Link>
          <Link className="admin-btn" href={`/admin/preview/canonical/${date}/diff`}>
            Diff statsapi vs SDIO
          </Link>
          <form action={fetchSdioNowAction} className="cx-fetch-form">
            <input type="hidden" name="date" value={date} />
            <SubmitButton idleLabel="Fetch SDIO now" pendingLabel="Fetching…" />
          </form>
        </div>
        <div className="cx-meta">
          Date: <b>{prettyDate(date)}</b>
          {" "}&middot; Source: <b>{source}</b>
          {" "}&middot; Surface: <b>{surface}</b>
        </div>
      </Section>

      <Section title="Rendered output">
        <iframe
          className="cx-iframe"
          src={frameUrl}
          title={`Canonical preview ${source}/${surface}`}
        />
      </Section>
    </>
  );
}

function SourceTab({
  active, href, label, hint, ok,
}: {
  active: boolean;
  href:   string;
  label:  string;
  hint:   string;
  ok:     boolean;
}) {
  return (
    <Link
      role="tab"
      aria-selected={active}
      href={href}
      className={`cx-source-tab${active ? " is-active" : ""}${ok ? "" : " is-missing"}`}
    >
      <span className="cx-source-label">{label}</span>
      <span className="cx-source-hint">{hint}</span>
    </Link>
  );
}

function SurfaceTab({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link
      role="tab"
      aria-selected={active}
      href={href}
      className={`cx-surface-tab${active ? " is-active" : ""}`}
    >
      {label}
    </Link>
  );
}
