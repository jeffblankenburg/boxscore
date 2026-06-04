import { requireAdmin } from "../../require-admin";
import {
  formatBytes,
  getContentSnapshot,
  getStorageStats,
  parseWindow,
} from "@/lib/dashboard";
import { yesterdayInET, prettyDate } from "@/lib/dates";
import { Sparkline } from "../../charts";
import {
  KpiCard,
  WindowSelector,
} from "../../_components/dashboard-bits";
import { PageHeader, Section } from "../../_components/primitives";

// /admin/content/digests — what we've shipped + capacity.
// Yesterday's digest at a glance (size, game count, sends), email-size
// trend over the window, and a storage stat for each monitored bucket.

export const dynamic = "force-dynamic";
export const metadata = { title: "Digests · Content · boxscore admin", robots: { index: false } };

const GMAIL_CLIP_BYTES = 102 * 1024;
const BASE_PATH = "/admin/content/digests";

export default async function DigestsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  await requireAdmin();
  const { window: windowParam } = await searchParams;
  const w = parseWindow(windowParam);
  const date = yesterdayInET();
  const [content, storage] = await Promise.all([
    getContentSnapshot(w),
    getStorageStats(),
  ]);

  return (
    <>
      <PageHeader
        title="Digests"
        subtitle="What we've published — content snapshot + storage footprint."
        breadcrumbs={[{ label: "Content" }, { label: "Digests" }]}
      />

      <Section>
        <WindowSelector current={w} basePath={BASE_PATH} />
      </Section>

      <Section>
        <div className="admin-kpis">
          <KpiCard
            label="Storage used"
            value={formatBytes(storage.totalBytes)}
            sub={`${storage.totalFiles.toLocaleString()} files across ${storage.buckets.length} bucket${storage.buckets.length === 1 ? "" : "s"}`}
          />
          {storage.buckets.map((b) => (
            <KpiCard
              key={b.name}
              label={b.name}
              value={formatBytes(b.bytes)}
              sub={`${b.files.toLocaleString()} file${b.files === 1 ? "" : "s"}`}
            />
          ))}
        </div>
      </Section>

      <Section title="Yesterday's digest">
        {content.yesterday ? (
          <ul className="admin-stats">
            <li><strong>{prettyDate(content.yesterday.date)}</strong></li>
            <li><strong>Games:</strong> {content.yesterday.gameCount}</li>
            <li>
              <strong>Web HTML:</strong> {(content.yesterday.htmlSize / 1024).toFixed(1)} KB
              {" · "}
              <strong>Email HTML:</strong> {(content.yesterday.emailSize / 1024).toFixed(1)} KB
              {content.yesterday.emailSize > GMAIL_CLIP_BYTES && (
                <span className="admin-cron-error"> ⚠ over Gmail clip threshold</span>
              )}
            </li>
            <li><strong>Emails delivered:</strong> {content.yesterday.sendCount.toLocaleString()}</li>
          </ul>
        ) : (
          <p className="a-muted">No digest for {prettyDate(date)}.</p>
        )}
      </Section>

      <Section title={`Email size trend (${w})`}>
        <p className="a-muted" style={{ marginBottom: 8 }}>
          Red dashed line marks the Gmail clip threshold (102 KB) — emails
          over that get truncated in Gmail&apos;s reading pane.
        </p>
        <Sparkline
          values={content.emailSizeTrend.map((p) => p.size)}
          labels={content.emailSizeTrend.map((p) => p.date)}
          threshold={GMAIL_CLIP_BYTES}
          formatValue={(v) => `${(v / 1024).toFixed(0)}K`}
        />
      </Section>
    </>
  );
}
