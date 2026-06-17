import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "../../../../require-admin";
import { Breadcrumbs, PageHeader, Section } from "../../../../_components/primitives";
import { AutoSize } from "./AutoSize";
import { SyncScroll } from "./SyncScroll";
import {
  isValidIsoDate,
  nextDay,
  prevDay,
  prettyDate,
  yesterdayInET,
} from "@/lib/dates";

// /admin/preview/canonical/[date]/sxs?surface=web|email
//
// Two iframes side-by-side: statsapi canonical render (left) and SDIO
// canonical render (right). Same date, same canonical renderer, two
// adapters. Eyeball comparison surface — the structured diff lives at
// /admin/preview/canonical/[date]/diff.

export const dynamic  = "force-dynamic";
export const metadata = { title: "Canonical side-by-side · admin · boxscore", robots: { index: false } };

type Surface = "web" | "email";

export default async function CanonicalSxsPage({
  params,
  searchParams,
}: {
  params:       Promise<{ date: string }>;
  searchParams: Promise<{ surface?: string }>;
}) {
  await requireAdmin();
  const { date } = await params;
  const { surface: surfaceParam } = await searchParams;
  if (!isValidIsoDate(date)) notFound();
  const surface: Surface = surfaceParam === "email" ? "email" : "web";

  const pageUrl = (d: string, sf: Surface) => `/admin/preview/canonical/${d}/sxs?surface=${sf}`;
  const leftFrame  = `/admin/preview/canonical/${date}/frame?source=statsapi&surface=${surface}&highlight=1`;
  const rightFrame = `/admin/preview/canonical/${date}/frame?source=sdio&surface=${surface}&highlight=1`;

  return (
    <>
      <Breadcrumbs items={[
        { label: "Content" },
        { label: "Canonical preview", href: `/admin/preview/canonical/${yesterdayInET()}?source=statsapi` },
        { label: prettyDate(date), href: `/admin/preview/canonical/${date}?source=statsapi&surface=${surface}` },
        { label: "Side-by-side" },
      ]} />
      <PageHeader
        title={`Side-by-side — ${prettyDate(date)}`}
        subtitle={(
          <>
            statsapi (left) and SportsDataIO (right) rendered through the same canonical renderer.
            Use this for eyeball comparison; field-level differences live in the{" "}
            <Link href={`/admin/preview/canonical/${date}/diff`}>structured diff</Link>.
          </>
        )}
      />

      <Section>
        <div className="cx-controls">
          <div className="cx-surface-toggle" role="tablist" aria-label="Surface">
            <SurfaceTab active={surface === "web"}   href={pageUrl(date, "web")}   label="Web" />
            <SurfaceTab active={surface === "email"} href={pageUrl(date, "email")} label="Email" />
          </div>
          <div className="cx-date-nav">
            <Link className="admin-btn" href={pageUrl(prevDay(date), surface)}>&larr; Prev</Link>
            <Link className="admin-btn" href={pageUrl(yesterdayInET(), surface)}>Yesterday</Link>
            <Link className="admin-btn" href={pageUrl(nextDay(date), surface)}>Next &rarr;</Link>
          </div>
        </div>
      </Section>

      <Section>
        <div className="cx-sxs-grid">
          <div className="cx-sxs-pane">
            <div className="cx-sxs-label">statsapi.mlb.com</div>
            <iframe id="cx-sxs-left" className="cx-sxs-iframe" src={leftFrame} title="statsapi canonical render" />
          </div>
          <div className="cx-sxs-pane">
            <div className="cx-sxs-label">SportsDataIO</div>
            <iframe id="cx-sxs-right" className="cx-sxs-iframe" src={rightFrame} title="SDIO canonical render" />
          </div>
        </div>
        <AutoSize   leftId="cx-sxs-left" rightId="cx-sxs-right" />
        <SyncScroll leftId="cx-sxs-left" rightId="cx-sxs-right" />
      </Section>
    </>
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
