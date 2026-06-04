import { requireAdmin } from "../../require-admin";
import { getRssReadership } from "@/lib/dashboard";
import { RssReadershipTable } from "../../_components/dashboard-bits";
import { PageHeader, Section } from "../../_components/primitives";

// /admin/metrics/rss — feed-reader readership over the last 30 days.
// Aggregator subs come from MAX(subscribers) per aggregator per day
// (Feedly & co. advertise their count in the user-agent). Individuals are
// distinct non-aggregator UAs — one human each.

export const dynamic = "force-dynamic";
export const metadata = { title: "RSS · Metrics · boxscore admin", robots: { index: false } };

export default async function RssMetricsPage() {
  await requireAdmin();
  const rows = await getRssReadership("mlb", 30);

  return (
    <>
      <PageHeader
        title="RSS readership"
        subtitle="Daily readership estimates over the last 30 days."
        breadcrumbs={[{ label: "Metrics" }, { label: "RSS" }]}
      />

      <Section>
        <p className="a-muted" style={{ marginBottom: 12 }}>
          Aggregator subs come from MAX(subscribers) per aggregator per day
          (Feedly &amp; co. advertise their count in the UA). Individuals are
          distinct non-aggregator user agents — one human each.
        </p>
        <RssReadershipTable rows={rows} />
      </Section>
    </>
  );
}
