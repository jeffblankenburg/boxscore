import { requireAdmin } from "../../require-admin";
import {
  getKpis,
  getSendSeries,
  parseWindow,
} from "@/lib/dashboard";
import { SendHealthChart } from "../../charts";
import {
  KpiCard,
  WindowSelector,
} from "../../_components/dashboard-bits";
import { PageHeader, Section } from "../../_components/primitives";

// /admin/metrics/sends — outgoing email health over time.
// Send rate + open rate KPIs + send health chart. Deliverability detail
// (per-status breakdown of bounced/delayed/etc.) lives at
// /admin/operations/deliverability — this page is the trend view.

export const dynamic = "force-dynamic";
export const metadata = { title: "Sends · Metrics · boxscore admin", robots: { index: false } };

const BASE_PATH = "/admin/metrics/sends";

export default async function SendsMetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  await requireAdmin();
  const { window: windowParam } = await searchParams;
  const w = parseWindow(windowParam);
  const [kpis, sendSeries] = await Promise.all([
    getKpis(w),
    getSendSeries(w),
  ]);

  return (
    <>
      <PageHeader
        title="Sends"
        subtitle="Send success rate, open rate, and the day-by-day send health chart."
        breadcrumbs={[{ label: "Metrics" }, { label: "Sends" }]}
      />

      <Section>
        <WindowSelector current={w} basePath={BASE_PATH} />
      </Section>

      <Section>
        <div className="admin-kpis">
          <KpiCard
            label={`Send rate (${w})`}
            value={kpis.sendSuccess.total === 0
              ? "—"
              : `${(kpis.sendSuccess.rate * 100).toFixed(1)}%`}
            sub={kpis.sendSuccess.total === 0
              ? "no sends in window"
              : `${kpis.sendSuccess.ok.toLocaleString()} / ${kpis.sendSuccess.total.toLocaleString()}`}
            deltaTone={kpis.sendSuccess.failed > 0 ? "bad" : "good"}
          />
          <KpiCard
            label={`Open rate (${w})`}
            value={!kpis.openRate.tracked
              ? "—"
              : kpis.openRate.sends === 0
                ? "—"
                : `${(kpis.openRate.rate * 100).toFixed(1)}%`}
            sub={!kpis.openRate.tracked
              ? "tracking not enabled"
              : kpis.openRate.sends === 0
                ? "no sends in window"
                : `${kpis.openRate.opened.toLocaleString()} / ${kpis.openRate.sends.toLocaleString()} sends opened`}
            deltaTone={!kpis.openRate.tracked ? "neutral"
              : kpis.openRate.rate >= 0.3 ? "good"
              : kpis.openRate.rate >= 0.15 ? "neutral"
              : "bad"}
          />
          <KpiCard
            label="Digests shipped"
            value={kpis.totalDigestsShipped.toLocaleString()}
            sub="all time"
          />
        </div>
      </Section>

      <Section title={`Send health (${w})`}>
        <SendHealthChart series={sendSeries} window={w} />
      </Section>
    </>
  );
}
