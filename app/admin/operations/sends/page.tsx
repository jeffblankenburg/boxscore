import { requireAdmin } from "../../require-admin";
import { getSendCoverage } from "@/lib/dashboard";
import { SendCoverageTable } from "../../_components/dashboard-bits";
import { PageHeader, Section } from "../../_components/primitives";

// /admin/operations/sends — "Did yesterday's send reach everyone?"
// Compares eligible subscribers at send-time to the rows actually written
// to `sends` per sport. A coverage gap is the most actionable cron-level
// failure signal we have besides the watchwall itself.

export const dynamic = "force-dynamic";
export const metadata = { title: "Send coverage · Operations · boxscore admin", robots: { index: false } };

export default async function SendCoveragePage() {
  await requireAdmin();
  const rows = await getSendCoverage();

  return (
    <>
      <PageHeader
        title="Send coverage"
        subtitle="Subscribers eligible at yesterday's send vs. the rows actually written to sends. A small gap is normal (post-cron confirmations); a large gap is a problem."
        breadcrumbs={[{ label: "Operations" }, { label: "Send coverage" }]}
      />

      <Section>
        <SendCoverageTable rows={rows} />
      </Section>
    </>
  );
}
