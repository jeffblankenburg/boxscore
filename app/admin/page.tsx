import { yesterdayInET, prettyDate } from "@/lib/dates";
import { recentCronRuns, type CronRun } from "@/lib/cron-runs";
import { SubmitButton } from "./SubmitButton";
import { requireAdmin } from "./require-admin";
import { AdminNav } from "./AdminNav";
import { SendEmailGuard } from "./SendEmailGuard";
import {
  parseWindow,
  WINDOW_OPTIONS,
  windowDays,
  getKpis,
  getSubscriberSeries,
  getSendSeries,
  getCronHeatMap,
  getContentSnapshot,
  type Window,
} from "@/lib/dashboard";
import {
  SubscriberGrowthChart,
  SendHealthChart,
  CronHeatMapView,
  Sparkline,
} from "./charts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · boxscore", robots: { index: false } };

const GMAIL_CLIP_BYTES = 102 * 1024;

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; window?: string }>;
}) {
  await requireAdmin();
  const { ok, error, window: windowParam } = await searchParams;
  const w = parseWindow(windowParam);
  const date = yesterdayInET();

  const [kpis, subSeries, sendSeries, heatMap, content, runs] = await Promise.all([
    getKpis(w),
    getSubscriberSeries(w),
    getSendSeries(w),
    getCronHeatMap(windowDays(w)),
    getContentSnapshot(w),
    recentCronRuns(20),
  ]);

  return (
    <main className="admin admin-wide">
      <AdminNav />
      <h1>Admin</h1>

      {ok && <p className="admin-success"><strong>✓</strong> {ok}</p>}
      {error && <p className="admin-error"><strong>Failed:</strong> {error}</p>}

      <WindowSelector current={w} />

      {/* 1. Hero KPI strip */}
      <section className="admin-kpis">
        <KpiCard
          label="Active subscribers"
          value={kpis.activeSubscribers.toLocaleString()}
          delta={formatDelta(kpis.activeSubscribersDelta)}
          deltaTone={toneFor(kpis.activeSubscribersDelta)}
          sub={`vs. ${w} ago`}
        />
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
      </section>

      {/* 2. Subscriber growth */}
      <section>
        <h2>Subscriber growth ({w})</h2>
        <SubscriberGrowthChart series={subSeries} window={w} />
      </section>

      {/* 3. Send health */}
      <section>
        <h2>Send health ({w})</h2>
        <SendHealthChart series={sendSeries} window={w} />
      </section>

      {/* 4. Cron heat-map */}
      <section>
        <h2>Cron health ({w})</h2>
        <CronHeatMapView data={heatMap} />
      </section>

      {/* 5. Content snapshot */}
      <section>
        <h2>Content snapshot</h2>
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
          <p className="admin-meta">No digest for {prettyDate(date)}.</p>
        )}
        <p className="admin-meta">Email size trend ({w}) — red dashed line = Gmail clip threshold (102 KB)</p>
        <Sparkline
          values={content.emailSizeTrend.map((p) => p.size)}
          labels={content.emailSizeTrend.map((p) => p.date)}
          threshold={GMAIL_CLIP_BYTES}
          formatValue={(v) => `${(v / 1024).toFixed(0)}K`}
        />
      </section>

      {/* 6. Quick links (kept for now; will move) */}
      <section>
        <h2>Quick links</h2>
        <ul className="admin-stats">
          <li><a href={`/mlb/${date}`} target="_blank" rel="noreferrer">View /mlb/{date}</a></li>
          <li><a href={`/admin/email/${date}`} target="_blank" rel="noreferrer">Preview today&apos;s email</a></li>
          <li><a href="/admin/images">Share images</a></li>
          <li><a href="/admin/twitter">Twitter compose</a></li>
        </ul>
      </section>

      {/* 7. Actions — pushed to the bottom (eventually move to /admin/cron) */}
      <section>
        <h2>Run a cron</h2>
        <p className="admin-meta">
          Manually fire any cron route. Date defaults to yesterday in ET; results land in
          the cron-runs table below.
        </p>
        <TriggerForm route="generate" date={date} label="Generate digest" />
        <SendEmailGuard defaultDate={date} activeSubscribers={kpis.activeSubscribers} />
        <TriggerForm route="post-bluesky" date={date} label="Post to BlueSky" allowReset />
        <TriggerForm route="post-twitter" date={date} label="Post to Twitter" allowReset />
        <RegenerateAllForm />
        <SendEmailForm date={date} />
      </section>

      <section>
        <h2>Recent cron runs</h2>
        <CronRunsTable runs={runs} />
      </section>
    </main>
  );
}

// ---- helpers ----------------------------------------------------------

function WindowSelector({ current }: { current: Window }) {
  return (
    <nav className="admin-window-selector" aria-label="Trend window">
      <span className="admin-window-label">Window</span>
      {WINDOW_OPTIONS.map((o) => (
        <a
          key={o.value}
          href={`/admin?window=${o.value}`}
          className={o.value === current ? "current" : ""}
        >{o.label}</a>
      ))}
    </nav>
  );
}

function KpiCard({
  label, value, sub, delta, deltaTone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: string;
  deltaTone?: "good" | "bad" | "neutral";
}) {
  return (
    <div className="admin-kpi">
      <div className="admin-kpi-label">{label}</div>
      <div className="admin-kpi-value">{value}</div>
      {delta && <div className={`admin-kpi-delta admin-kpi-delta-${deltaTone}`}>{delta}</div>}
      {sub && <div className="admin-kpi-sub">{sub}</div>}
    </div>
  );
}

function formatDelta(n: number): string {
  if (n > 0) return `+${n.toLocaleString()}`;
  if (n < 0) return `−${Math.abs(n).toLocaleString()}`;
  return "0";
}

function toneFor(n: number): "good" | "bad" | "neutral" {
  if (n > 0) return "good";
  if (n < 0) return "bad";
  return "neutral";
}

function RegenerateAllForm() {
  return (
    <form
      action={async () => {
        "use server";
        const { regenerateAllDigests } = await import("./actions");
        await regenerateAllDigests();
      }}
      className="admin-trigger-form"
    >
      <span className="admin-trigger-label">Regenerate ALL digests (re-renders every date in DB)</span>
      <SubmitButton idleLabel="Regenerate all" pendingLabel="Regenerating… (may take ~1 min)" />
    </form>
  );
}

function SendEmailForm({ date }: { date: string }) {
  return (
    <form action={async () => {
      "use server";
      const { sendAdminPreview } = await import("./actions");
      await sendAdminPreview(date);
    }} className="admin-trigger-form">
      <span className="admin-trigger-label">Send today&apos;s email to me ({date})</span>
      <SubmitButton idleLabel="Send to me" pendingLabel="Sending…" />
    </form>
  );
}

function TriggerForm({
  route, date, label, allowReset = false,
}: {
  route: string; date: string; label: string; allowReset?: boolean;
}) {
  return (
    <form
      action={async (formData: FormData) => {
        "use server";
        const { triggerCron } = await import("./actions");
        await triggerCron(formData);
      }}
      className="admin-trigger-form"
    >
      <input type="hidden" name="route" value={route} />
      <label>
        <span className="admin-trigger-label">{label}</span>
        <input
          className="admin-input"
          type="date"
          name="date"
          defaultValue={date}
        />
      </label>
      {allowReset && (
        <label className="admin-trigger-checkbox">
          <input type="checkbox" name="reset" value="1" /> reset
        </label>
      )}
      <SubmitButton idleLabel={`Run ${route}`} pendingLabel="Running…" />
    </form>
  );
}

function CronRunsTable({ runs }: { runs: CronRun[] }) {
  if (runs.length === 0) {
    return <p className="admin-meta">No runs yet.</p>;
  }
  return (
    <table className="admin-cron-runs">
      <thead>
        <tr>
          <th>Route</th>
          <th>Date</th>
          <th>Trigger</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Started</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => {
          const dur = r.finished_at
            ? ((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000).toFixed(1) + "s"
            : "—";
          const detail = r.error
            ? <span className="admin-cron-error">{r.error}</span>
            : r.result
              ? <code>{summarizeResult(r.result)}</code>
              : "";
          return (
            <tr key={r.id}>
              <td><code>{r.route}</code></td>
              <td>{r.date ?? "—"}</td>
              <td>{r.trigger}</td>
              <td><span className={`status-${r.status}`}>{statusLabel(r.status)}</span></td>
              <td>{dur}</td>
              <td className="admin-meta">{new Date(r.started_at).toLocaleString()}</td>
              <td>{detail}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function statusLabel(s: CronRun["status"]): string {
  if (s === "ok") return "PASS";
  if (s === "failed") return "FAIL";
  return "RUNNING";
}

function summarizeResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof r.game_count === "number") parts.push(`${r.game_count} games`);
  if (typeof r.sent === "number") parts.push(`${r.sent} sent`);
  if (typeof r.skipped === "number" && (r.skipped as number) > 0) parts.push(`${r.skipped} skipped`);
  if (typeof r.failed === "number" && (r.failed as number) > 0) parts.push(`${r.failed} failed`);
  if (typeof r.posted === "number") parts.push(`${r.posted} posted`);
  if (typeof r.total === "number" && parts.length === 0) parts.push(`${r.total} total`);
  return parts.join(", ");
}
