import { requireAdmin } from "../../require-admin";
import {
  getKpis,
  getSubscriberSeries,
  parseWindow,
} from "@/lib/dashboard";
import { SubscriberGrowthChart } from "../../charts";
import {
  KpiCard,
  SubscriberDailyTable,
  WindowSelector,
  formatDelta,
  toneFor,
} from "../../_components/dashboard-bits";
import { PageHeader, Section } from "../../_components/primitives";

// /admin/metrics/subscribers — audience trends.
// Active/pending counts + growth chart + per-day add/remove breakdown.

export const dynamic = "force-dynamic";
export const metadata = { title: "Subscribers · Metrics · boxscore admin", robots: { index: false } };

const BASE_PATH = "/admin/metrics/subscribers";

export default async function SubscribersMetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  await requireAdmin();
  const { window: windowParam } = await searchParams;
  const w = parseWindow(windowParam);
  const [kpis, subSeries] = await Promise.all([
    getKpis(w),
    getSubscriberSeries(w),
  ]);

  return (
    <>
      <PageHeader
        title="Subscribers"
        subtitle="Active list size, growth, churn, and the day-by-day add/remove breakdown."
        breadcrumbs={[{ label: "Metrics" }, { label: "Subscribers" }]}
      />

      <Section>
        <WindowSelector current={w} basePath={BASE_PATH} />
      </Section>

      <Section>
        <div className="admin-kpis">
          <KpiCard
            label="Active subscribers"
            value={kpis.activeSubscribers.toLocaleString()}
            delta={formatDelta(kpis.activeSubscribersDelta)}
            deltaTone={toneFor(kpis.activeSubscribersDelta)}
            sub={`vs. ${w} ago`}
          />
          <KpiCard
            label={`Net growth (${w})`}
            value={formatDelta(kpis.netGrowth.net)}
            deltaTone={toneFor(kpis.netGrowth.net)}
            sub={`+${kpis.netGrowth.newSubs} new / −${kpis.netGrowth.unsubs} unsub`}
          />
          <KpiCard
            label={`Churn (${w})`}
            value={kpis.churn.activeAtStart === 0
              ? "—"
              : `${(kpis.churn.rate * 100).toFixed(2)}%`}
            sub={kpis.churn.activeAtStart === 0
              ? "no subs at window start"
              : `${kpis.churn.unsubs} / ${kpis.churn.activeAtStart.toLocaleString()} unsub`}
            deltaTone={kpis.churn.rate > 0.01 ? "bad" : kpis.churn.unsubs === 0 ? "good" : "neutral"}
          />
          <KpiCard
            label="Pending subscribers"
            value={kpis.pending.count.toLocaleString()}
            delta={formatDelta(kpis.pending.delta)}
            deltaTone={kpis.pending.delta > 0 ? "bad" : kpis.pending.delta < 0 ? "good" : "neutral"}
            sub="signed up, never confirmed"
          />
        </div>
      </Section>

      <Section title={`Subscriber growth (${w})`}>
        <SubscriberGrowthChart series={subSeries} window={w} />
      </Section>

      <Section title="Daily add / remove">
        <SubscriberDailyTable series={subSeries} />
      </Section>
    </>
  );
}
