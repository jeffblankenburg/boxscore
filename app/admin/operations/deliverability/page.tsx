import { requireAdmin } from "../../require-admin";
import { getDeliverabilityStats, parseWindow } from "@/lib/dashboard";
import { KpiCard, WindowSelector } from "../../_components/dashboard-bits";
import { PageHeader, Section } from "../../_components/primitives";

// /admin/operations/deliverability — what Resend actually did with the sends
// we asked it to deliver. Each send rolls up to delivered / bounced / delayed
// / pending / failed via the email_events join. Complained is a separate
// count that can overlap with delivered.

export const dynamic = "force-dynamic";
export const metadata = { title: "Deliverability · Operations · boxscore admin", robots: { index: false } };

const BASE_PATH = "/admin/operations/deliverability";

export default async function DeliverabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  await requireAdmin();
  const { window: windowParam } = await searchParams;
  const w = parseWindow(windowParam);
  const deliverability = await getDeliverabilityStats(w);

  return (
    <>
      <PageHeader
        title="Deliverability"
        subtitle={`Outcome of the ${deliverability.sent.toLocaleString()} send${deliverability.sent === 1 ? "" : "s"} attempted in this window.`}
        breadcrumbs={[{ label: "Operations" }, { label: "Deliverability" }]}
      />

      <Section>
        <WindowSelector current={w} basePath={BASE_PATH} />
      </Section>

      <Section>
        <div className="admin-kpis">
          <KpiCard
            label="Delivered"
            value={deliverability.sent === 0 ? "—" : `${(deliverability.deliveredRate * 100).toFixed(1)}%`}
            sub={`${deliverability.delivered.toLocaleString()} / ${deliverability.sent.toLocaleString()}`}
            deltaTone={deliverability.sent === 0 ? "neutral"
              : deliverability.deliveredRate >= 0.98 ? "good"
              : deliverability.deliveredRate >= 0.95 ? "neutral"
              : "bad"}
          />
          <KpiCard
            label="Bounced"
            value={deliverability.sent === 0 ? "—" : `${(deliverability.bouncedRate * 100).toFixed(2)}%`}
            sub={`${deliverability.bounced.toLocaleString()} bounce${deliverability.bounced === 1 ? "" : "s"}`}
            deltaTone={deliverability.bouncedRate > 0.02 ? "bad" : deliverability.bounced === 0 ? "good" : "neutral"}
          />
          <KpiCard
            label="Delayed"
            value={deliverability.sent === 0 ? "—" : `${(deliverability.delayedRate * 100).toFixed(2)}%`}
            sub={`${deliverability.delayed.toLocaleString()} pending retry`}
            deltaTone={deliverability.delayed === 0 ? "good" : "neutral"}
          />
          <KpiCard
            label="Complained"
            value={deliverability.sent === 0 ? "—" : `${(deliverability.complainedRate * 100).toFixed(2)}%`}
            sub={`${deliverability.complained.toLocaleString()} spam mark${deliverability.complained === 1 ? "" : "s"}`}
            deltaTone={deliverability.complainedRate > 0.001 ? "bad" : "good"}
          />
          <KpiCard
            label="Failed"
            value={deliverability.sent === 0 ? "—" : `${(deliverability.failedRate * 100).toFixed(2)}%`}
            sub={`${deliverability.failed.toLocaleString()} Resend rejected`}
            deltaTone={deliverability.failed === 0 ? "good" : "bad"}
          />
          <KpiCard
            label="Pending"
            value={deliverability.sent === 0 ? "—" : `${((deliverability.pending / deliverability.sent) * 100).toFixed(2)}%`}
            sub={`${deliverability.pending.toLocaleString()} awaiting event`}
            deltaTone="neutral"
          />
        </div>
      </Section>
    </>
  );
}
