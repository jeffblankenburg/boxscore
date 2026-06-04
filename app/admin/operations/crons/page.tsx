import { requireAdmin } from "../../require-admin";
import { recentCronRuns } from "@/lib/cron-runs";
import { getCronGridBySportDay } from "@/lib/dashboard";
import { CronGridBySportView } from "../../charts";
import { CronRunsTable } from "../../_components/dashboard-bits";
import { PageHeader, Section } from "../../_components/primitives";

// /admin/operations/crons — full cron history.
// Watchwall (today's status) lives on /admin; this page is for drilling
// into "when did this last work" / "what failed yesterday".

export const dynamic = "force-dynamic";
export const metadata = { title: "Crons · Operations · boxscore admin", robots: { index: false } };

const GRID_DAYS = 14;

export default async function CronsPage() {
  await requireAdmin();
  const [grid, runs] = await Promise.all([
    getCronGridBySportDay(GRID_DAYS),
    recentCronRuns(20),
  ]);

  return (
    <>
      <PageHeader
        title="Crons"
        subtitle={`Cron health by league for the last ${GRID_DAYS} days, plus the most recent runs across every route.`}
        breadcrumbs={[{ label: "Operations" }, { label: "Crons" }]}
      />

      <Section title={`Cron health by league · last ${GRID_DAYS} days`}>
        <CronGridBySportView grid={grid} />
      </Section>

      <Section title="Recent cron runs">
        <CronRunsTable runs={runs} />
      </Section>
    </>
  );
}
