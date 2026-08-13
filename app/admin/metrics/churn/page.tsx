import { requireAdmin } from "../../require-admin";
import { getChurnAnalysis, type Count, type TenureBucket } from "@/lib/churn";
import { KpiCard } from "../../_components/dashboard-bits";
import { PageHeader, Section, DataTable, EmptyState } from "../../_components/primitives";

// /admin/metrics/churn — WHY people unsubscribe. Surfaces the unsubscribe survey
// (reason + verbatim feedback), the system reason split (real vs deliverability),
// tenure at churn, acquisition source, and emails received before leaving.

export const dynamic = "force-dynamic";
export const metadata = { title: "Churn · Metrics · boxscore admin", robots: { index: false } };

// A label + count row with a proportional bar, scaled to the section's max.
function BarTable({ rows }: { rows: Array<Count | (TenureBucket & { key?: string; pct?: number })> }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <DataTable
      rows={rows}
      columns={[
        { header: "", cell: (r) => ("label" in r ? r.label : ""), width: "44%" },
        {
          header: "",
          cell: (r) => (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  height: 12,
                  width: `${Math.round((100 * r.count) / max)}%`,
                  minWidth: r.count > 0 ? 2 : 0,
                  background: "#161410",
                  borderRadius: 2,
                }}
              />
              <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {r.count.toLocaleString()}
                {"pct" in r && r.pct != null ? <span style={{ color: "#8a857b" }}> · {r.pct}%</span> : null}
              </span>
            </div>
          ),
        },
      ]}
    />
  );
}

export default async function ChurnMetricsPage() {
  await requireAdmin();
  const c = await getChurnAnalysis();

  return (
    <>
      <PageHeader
        title="Churn"
        subtitle="Why people unsubscribe — stated reasons, verbatim feedback, tenure, and how they left."
        breadcrumbs={[{ label: "Metrics" }, { label: "Churn" }]}
      />

      <Section>
        <div className="admin-kpis">
          <KpiCard label="Total unsubscribes" value={c.totalUnsub.toLocaleString()} sub="all time" />
          <KpiCard
            label="User-initiated"
            value={c.userInitiated.toLocaleString()}
            sub={`${c.totalUnsub ? Math.round((100 * c.userInitiated) / c.totalUnsub) : 0}% clicked unsubscribe`}
          />
          <KpiCard
            label="Deliverability"
            value={c.deliverability.toLocaleString()}
            deltaTone={c.deliverability > 0 ? "bad" : "neutral"}
            sub={`${c.totalUnsub ? Math.round((100 * c.deliverability) / c.totalUnsub) : 0}% bounce / complaint`}
          />
          <KpiCard
            label="Survey response"
            value={`${c.surveyAnsweredPct}%`}
            sub="of user-initiated left a reason"
          />
          <KpiCard
            label="Median tenure"
            value={c.medianTenureDays == null ? "—" : `${c.medianTenureDays.toFixed(0)}d`}
            sub="confirmed → unsubscribed"
          />
          <KpiCard
            label="Median emails first"
            value={c.emailsBeforeUnsub.median == null ? "—" : String(c.emailsBeforeUnsub.median)}
            sub="received before leaving"
          />
        </div>
      </Section>

      <Section title="Why they left — stated reason">
        <p className="a-note">
          The dropdown on the unsubscribe page, among user-initiated unsubscribes. Most leave via the
          one-click mail-client button, which can't carry a reason — hence the large “no answer”.
        </p>
        <BarTable rows={c.statedReasons} />
      </Section>

      <Section title="How they left — system reason">
        <p className="a-note">
          <strong>User</strong> is genuine churn; <strong>bounce / complaint</strong> is a deliverability
          problem (list hygiene, sending reputation), not content.
        </p>
        <BarTable rows={c.systemReasons} />
      </Section>

      <Section title="Tenure at unsubscribe">
        <BarTable rows={c.tenure} />
      </Section>

      <Section title={`Emails received before unsubscribing (n=${c.emailsBeforeUnsub.sampled.toLocaleString()})`}>
        <p className="a-note">
          How many digests a user-initiated unsubscriber got before leaving — the counterpart to the
          “too many emails” complaint.
        </p>
        <BarTable rows={c.emailsBeforeUnsub.buckets} />
      </Section>

      <Section title="Acquisition source of churned readers">
        <BarTable rows={c.sources} />
      </Section>

      <Section title={`Recent feedback — verbatim (${c.feedback.length})`}>
        <DataTable
          rows={c.feedback}
          empty={<EmptyState message="No free-text feedback yet." />}
          columns={[
            { header: "Date", cell: (r) => r.at?.slice(0, 10) ?? "—", width: "90px" },
            { header: "Reason", cell: (r) => r.reasonLabel, width: "130px" },
            { header: "Feedback", cell: (r) => r.feedback },
            { header: "Email", cell: (r) => <span style={{ color: "#8a857b" }}>{r.email}</span>, width: "180px" },
          ]}
        />
      </Section>

      <Section title="Not yet measured">
        <p className="a-note">
          <strong>Did they stop opening first?</strong> — engagement-drop before churn needs an
          email_events scan too heavy for a live page; best added as a nightly rollup. Ask to wire it up.
        </p>
      </Section>
    </>
  );
}
