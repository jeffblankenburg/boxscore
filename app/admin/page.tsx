import { yesterdayInET, prettyDate } from "@/lib/dates";
import { recentCronRuns, type CronRun } from "@/lib/cron-runs";
import { requireAdmin } from "./require-admin";
import { AdminNav } from "./AdminNav";
import {
  parseWindow,
  WINDOW_OPTIONS,
  getKpis,
  getSubscriberSeries,
  getSendSeries,
  getDashboardWatchwall,
  getCronGridBySportDay,
  getContentSnapshot,
  getDeliverabilityStats,
  getSendCoverage,
  type Window,
  type SendCoverageRow,
  type SubscriberSeries,
} from "@/lib/dashboard";
import {
  SubscriberGrowthChart,
  SendHealthChart,
  Sparkline,
  Watchwall,
  CronGridBySportView,
} from "./charts";
import { EmailSearch } from "./EmailSearch";

// Universal dashboard. Read-only situational awareness across every sport,
// every format, every day. Per-sport tools (cron triggers, send-to-me,
// preview, share images) live on /admin/[sport]; this page is exclusively
// stats and the "is anything broken right now?" hero.

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · boxscore", robots: { index: false } };

const GMAIL_CLIP_BYTES = 102 * 1024;
const CRON_GRID_DAYS = 14;

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; window?: string }>;
}) {
  await requireAdmin();
  const { ok, error, window: windowParam } = await searchParams;
  const w = parseWindow(windowParam);
  const date = yesterdayInET();

  const [kpis, subSeries, sendSeries, watchwall, cronGrid, content, runs, deliverability, sendCoverage] = await Promise.all([
    getKpis(w),
    getSubscriberSeries(w),
    getSendSeries(w),
    getDashboardWatchwall(),
    getCronGridBySportDay(CRON_GRID_DAYS),
    getContentSnapshot(w),
    recentCronRuns(20),
    getDeliverabilityStats(w),
    getSendCoverage(),
  ]);

  return (
    <main className="admin admin-wide">
      <AdminNav active="dashboard" />
      <h1>Admin</h1>

      {ok && <p className="admin-success"><strong>✓</strong> {ok}</p>}
      {error && <p className="admin-error"><strong>Failed:</strong> {error}</p>}

      {/* 1. Watchwall — broken-detection hero. Shows current cron status for
          every (sport, expected route) for yesterday's digest date. Anything
          red or yellow is something to look at right now. */}
      <section>
        <h2>Is anything broken right now?</h2>
        <p className="admin-meta">
          Most recent run of each cron route per sport, for yesterday&apos;s
          digest date. Anything not green is the first thing to triage.
        </p>
        <Watchwall rows={watchwall} />
      </section>

      {/* 1b. Send coverage — eligible subscribers vs actually-sent for
          yesterday. Watchwall says "did the cron run"; this says "did it
          actually reach everyone it should have". A red bar here is the
          classic "cron ran fine but silently dropped sends" symptom. */}
      <section>
        <h2>Did the sends actually go out?</h2>
        <p className="admin-meta">
          Subscribers who were eligible at yesterday&apos;s send vs the
          rows actually written to <code>sends</code>. A small gap is
          normal (post-cron confirmations). A large gap is a problem.
        </p>
        <SendCoverageTable rows={sendCoverage} />
      </section>

      {/* 2. Email lookup — paste a recipient address, see every send to it.
          Lives near the top because it's the most common "I need to look
          something up right now" admin action. */}
      <section>
        <h2>Look up an email</h2>
        <EmailSearch />
      </section>

      <WindowSelector current={w} />

      {/* 2. KPI strip */}
      <section className="admin-kpis">
        <KpiCard
          label="Digests shipped"
          value={kpis.totalDigestsShipped.toLocaleString()}
          sub="all time"
        />
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

      {/* 3. Deliverability — what Resend actually did with the sends. Each
          send rolls up to delivered / bounced / delayed / pending / failed
          via the email_events join. Complained is a separate count that can
          overlap with delivered. */}
      <section>
        <h2>Deliverability ({w})</h2>
        <p className="admin-meta">
          Outcome of the {deliverability.sent.toLocaleString()} send
          {deliverability.sent === 1 ? "" : "s"} attempted in this window.
        </p>
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
      </section>

      {/* 4. Subscriber growth */}
      <section>
        <h2>Subscriber growth ({w})</h2>
        <SubscriberGrowthChart series={subSeries} window={w} />
        <SubscriberDailyTable series={subSeries} window={w} />
      </section>

      {/* 4. Cron contribution grid — sport × day, last 14d. Catches "WNBA
          quietly stopped firing 3 days ago" at a glance. */}
      <section>
        <h2>Cron health by league · last {CRON_GRID_DAYS} days</h2>
        <CronGridBySportView grid={cronGrid} />
      </section>

      {/* 5. Send health */}
      <section>
        <h2>Send health ({w})</h2>
        <SendHealthChart series={sendSeries} window={w} />
      </section>

      {/* 6. Content snapshot — MLB-only for now; generalize when basketball
          renderer lands (Phase 3). */}
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

      {/* 7. Recent cron runs across every sport. */}
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

function CronRunsTable({ runs }: { runs: CronRun[] }) {
  if (runs.length === 0) {
    return <p className="admin-meta">No runs yet.</p>;
  }
  return (
    <table className="admin-cron-runs">
      <thead>
        <tr>
          <th>Route</th>
          <th>Sport</th>
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
              <td><code>{r.sport ?? "—"}</code></td>
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

// Daily subscribe/unsubscribe counts pulled from the same series the growth
// chart renders. Newest day first. For sub-daily windows (24h, 3d) the series
// has hourly/6-hourly buckets — we re-aggregate into days so this table always
// reads as daily regardless of the chart's resolution.
function SubscriberDailyTable({ series, window: w }: { series: SubscriberSeries; window: Window }) {
  type Row = { date: string; newSubs: number; unsubs: number };
  const byDay = new Map<string, Row>();
  for (let i = 0; i < series.buckets.length; i++) {
    const bucket = series.buckets[i]!;
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(bucket);
    const existing = byDay.get(day) ?? { date: day, newSubs: 0, unsubs: 0 };
    existing.newSubs += series.newSubs[i] ?? 0;
    existing.unsubs += series.unsubs[i] ?? 0;
    byDay.set(day, existing);
  }
  const rows = [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
  void w;
  if (rows.length === 0) {
    return <p className="admin-meta">No subscribe activity in this window.</p>;
  }
  let totalNew = 0, totalUnsub = 0;
  for (const r of rows) { totalNew += r.newSubs; totalUnsub += r.unsubs; }
  return (
    <table className="admin-cron-runs">
      <thead>
        <tr>
          <th>Date</th>
          <th style={{ textAlign: "right" }}>New</th>
          <th style={{ textAlign: "right" }}>Unsubscribed</th>
          <th style={{ textAlign: "right" }}>Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const net = r.newSubs - r.unsubs;
          return (
            <tr key={r.date}>
              <td><code>{r.date}</code></td>
              <td style={{ textAlign: "right" }}>{r.newSubs > 0 ? `+${r.newSubs}` : "0"}</td>
              <td style={{ textAlign: "right" }}>{r.unsubs > 0 ? `−${r.unsubs}` : "0"}</td>
              <td
                style={{ textAlign: "right" }}
                className={net > 0 ? "admin-kpi-delta-good" : net < 0 ? "admin-kpi-delta-bad" : undefined}
              >{formatDelta(net)}</td>
            </tr>
          );
        })}
        <tr>
          <td><strong>Total</strong></td>
          <td style={{ textAlign: "right" }}><strong>+{totalNew}</strong></td>
          <td style={{ textAlign: "right" }}><strong>−{totalUnsub}</strong></td>
          <td style={{ textAlign: "right" }}><strong>{formatDelta(totalNew - totalUnsub)}</strong></td>
        </tr>
      </tbody>
    </table>
  );
}

function SendCoverageTable({ rows }: { rows: SendCoverageRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="admin-meta">
        No send-capable sports are configured yet.
      </p>
    );
  }
  return (
    <table className="admin-send-coverage">
      <thead>
        <tr>
          <th>Sport</th>
          <th>Date</th>
          <th>League send</th>
          <th>Team sends</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.sport}>
            <td className="admin-send-coverage-sport">{row.sportName}</td>
            <td><code>{row.date}</code></td>
            <td><CoverageCell bucket={row.league} /></td>
            <td><CoverageCell bucket={row.team} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CoverageCell({ bucket }: { bucket: SendCoverageRow["league"] }) {
  if (!bucket) return <span className="admin-meta">—</span>;
  const pct = (bucket.coverage * 100).toFixed(bucket.coverage === 1 ? 0 : 1);
  const gap = bucket.eligible - bucket.sent;
  const cls = bucket.warn ? "admin-send-coverage-warn" : "admin-send-coverage-ok";
  return (
    <span className={cls}>
      {bucket.sent.toLocaleString()} / {bucket.eligible.toLocaleString()}{" "}
      <span className="admin-send-coverage-pct">({pct}%)</span>
      {bucket.warn && (
        <span className="admin-send-coverage-gap">
          {" "}— {gap.toLocaleString()} missed
        </span>
      )}
    </span>
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
  if (typeof r.final_count === "number") parts.push(`${r.final_count} final`);
  if (typeof r.sent === "number") parts.push(`${r.sent} sent`);
  if (typeof r.skipped === "number" && (r.skipped as number) > 0) parts.push(`${r.skipped} skipped`);
  if (typeof r.failed === "number" && (r.failed as number) > 0) parts.push(`${r.failed} failed`);
  if (typeof r.posted === "number") parts.push(`${r.posted} posted`);
  if (typeof r.total === "number" && parts.length === 0) parts.push(`${r.total} total`);
  return parts.join(", ");
}
