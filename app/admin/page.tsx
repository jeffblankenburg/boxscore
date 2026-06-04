import { Suspense } from "react";
import { requireAdmin } from "./require-admin";
import { PageHeader } from "./_components/primitives";
import {
  PulseBlock,
  PulseSkeleton,
  QueueBlock,
  QueueSkeleton,
  TodaysSendBlock,
  TodaysSendSkeleton,
  WatchwallBlock,
  WatchwallSkeleton,
} from "./_components/dashboard-blocks";

// /admin — morning report card for a fully-automated newsletter operator.
//
// Four blocks, each in its own Suspense boundary so they stream in
// independently. The fastest queries (action queue, 24h pulse counts) paint
// in the first second; the slower ones (per-sport send tallies, watchwall
// joining cron_runs) stream in as they resolve.
//
// The whole page is small by design — every detail/drill-down lives on a
// dedicated sub-page (Operations/*, Metrics/*, Content/*). The dashboard
// answers exactly: "did everything run, what did it produce, anything
// waiting for me?" Five-second scan then close the tab.

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · boxscore", robots: { index: false } };

export default async function AdminDashboard() {
  // Auth at the top blocks rendering for unauthenticated users — Suspense
  // streaming only kicks in once we know the request is allowed.
  await requireAdmin();

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Did everything run last night, and what did it produce?"
      />

      <Suspense fallback={<TodaysSendSkeleton />}>
        <TodaysSendBlock />
      </Suspense>

      <Suspense fallback={<WatchwallSkeleton />}>
        <WatchwallBlock />
      </Suspense>

      <Suspense fallback={<PulseSkeleton />}>
        <PulseBlock />
      </Suspense>

      <Suspense fallback={<QueueSkeleton />}>
        <QueueBlock />
      </Suspense>
    </>
  );
}
