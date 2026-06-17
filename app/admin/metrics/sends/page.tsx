import { requireAdmin } from "../../require-admin";
import {
  getKpis,
  getOpenStickiness,
  getSendSeries,
  parseWindow,
  type OpenStickiness,
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
  const [kpis, sendSeries, stickiness] = await Promise.all([
    getKpis(w),
    getSendSeries(w),
    getOpenStickiness("mlb", 7),
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

      <Section title={`Open stickiness (last ${stickiness.windowDays} days, MLB league)`}>
        <StickinessPanel data={stickiness} />
      </Section>
    </>
  );
}

// Renders the stickiness histogram as a vertical list with bars sized
// to the largest bucket so spread reads at a glance. Headline row is
// the "opened every day" KPI plus a "no opens at all" callout — the
// two ends of the distribution that matter most for engagement.
function StickinessPanel({ data }: { data: OpenStickiness }) {
  const { windowDays, eligible, histogram, windowStart, windowEnd } = data;
  if (eligible === 0) {
    return (
      <p className="admin-meta">
        No eligible subscribers in window — nobody received all {windowDays}
        sends between {windowStart} and {windowEnd}.
      </p>
    );
  }
  const allOpens   = histogram[windowDays] ?? 0;
  const noOpens    = histogram[0] ?? 0;
  const fiveOrMore = histogram.slice(5).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...histogram);

  return (
    <>
      <p className="admin-meta" style={{ margin: "0 0 14px" }}>
        Of {eligible.toLocaleString()} subscribers who received every league
        send between <b>{windowStart}</b> and <b>{windowEnd}</b>, how many days
        they opened. Apple Mail Privacy Protection prefetches the open pixel,
        so these counts are an upper bound on real reads.
      </p>
      <div className="admin-kpis">
        <KpiCard
          label="Opened every day"
          value={`${(allOpens / eligible * 100).toFixed(1)}%`}
          sub={`${allOpens.toLocaleString()} / ${eligible.toLocaleString()} eligible`}
          deltaTone="good"
        />
        <KpiCard
          label={`Opened 5+ of ${windowDays}`}
          value={`${(fiveOrMore / eligible * 100).toFixed(1)}%`}
          sub={`${fiveOrMore.toLocaleString()} subscribers`}
          deltaTone="neutral"
        />
        <KpiCard
          label="Opened zero"
          value={`${(noOpens / eligible * 100).toFixed(1)}%`}
          sub={`${noOpens.toLocaleString()} delivered but never opened`}
          deltaTone="bad"
        />
      </div>
      <table className="admin-clicks-table" style={{ width: "100%", marginTop: 18 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left",  width: "12%" }}>Opens</th>
            <th style={{ textAlign: "right", width: "12%" }}>Subs</th>
            <th style={{ textAlign: "right", width: "10%" }}>%</th>
            <th style={{ textAlign: "left" }}>Bar</th>
          </tr>
        </thead>
        <tbody>
          {/* Walk highest-stickiness row first so the table reads top-down
              as "best engagement → worst engagement". */}
          {histogram.map((_, k) => windowDays - k).map((idx) => {
            const count = histogram[idx]!;
            const pct = (count / eligible) * 100;
            const width = (count / max) * 100;
            const isAllOpens = idx === windowDays;
            const isZero     = idx === 0;
            return (
              <tr key={idx}>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>
                  {idx}/{windowDays}
                </td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                  {count.toLocaleString()}
                </td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                  {pct.toFixed(1)}%
                </td>
                <td>
                  <div style={{
                    width:      `${width}%`,
                    minWidth:   count > 0 ? 2 : 0,
                    height:     12,
                    background: isAllOpens ? "#1f7a3a" : isZero ? "#b14a4a" : "#3a5fcc",
                    borderRadius: 2,
                  }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
