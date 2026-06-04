// Helpers extracted from the old /admin dashboard so the split-out sub-pages
// (Operations, Metrics, Content) can render the same widgets without
// duplicating ~200 lines each.
//
// These still use the legacy `admin-*` CSS classes from globals.css. That
// works — the new shell's universal font/width overrides ensure they fit
// the new chrome, and the colors/spacings on those classes are still fine.
// Chunk 2c will rewrite them in the `a-*` namespace; chunk 6 will delete
// the legacy classes.

import type { CronRun } from "@/lib/cron-runs";
import {
  WINDOW_OPTIONS,
  type RssReadershipDay,
  type SendCoverageRow,
  type SubscriberSeries,
  type Window,
} from "@/lib/dashboard";

// ─── Window selector ────────────────────────────────────────────────────

export function WindowSelector({
  current,
  basePath,
}: {
  current: Window;
  basePath: string;
}) {
  return (
    <nav className="admin-window-selector" aria-label="Trend window">
      <span className="admin-window-label">Window</span>
      {WINDOW_OPTIONS.map((o) => (
        <a
          key={o.value}
          href={`${basePath}?window=${o.value}`}
          className={o.value === current ? "current" : ""}
        >
          {o.label}
        </a>
      ))}
    </nav>
  );
}

// ─── KPI card ───────────────────────────────────────────────────────────

export function KpiCard({
  label,
  value,
  sub,
  delta,
  deltaTone = "neutral",
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
      {delta && (
        <div className={`admin-kpi-delta admin-kpi-delta-${deltaTone}`}>{delta}</div>
      )}
      {sub && <div className="admin-kpi-sub">{sub}</div>}
    </div>
  );
}

export function formatDelta(n: number): string {
  if (n > 0) return `+${n.toLocaleString()}`;
  if (n < 0) return `−${Math.abs(n).toLocaleString()}`;
  return "0";
}

export function toneFor(n: number): "good" | "bad" | "neutral" {
  if (n > 0) return "good";
  if (n < 0) return "bad";
  return "neutral";
}

// ─── Cron runs table ────────────────────────────────────────────────────

export function CronRunsTable({ runs }: { runs: CronRun[] }) {
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
          const detail = r.error ? (
            <span className="admin-cron-error">{r.error}</span>
          ) : r.result ? (
            <code>{summarizeResult(r.result)}</code>
          ) : (
            ""
          );
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

// ─── Subscriber daily table ──────────────────────────────────────────────

export function SubscriberDailyTable({ series }: { series: SubscriberSeries }) {
  type Row = { date: string; newSubs: number; unsubsReal: number; unsubsAuto: number };
  const byDay = new Map<string, Row>();
  for (let i = 0; i < series.buckets.length; i++) {
    const bucket = series.buckets[i]!;
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(bucket);
    const existing = byDay.get(day) ?? { date: day, newSubs: 0, unsubsReal: 0, unsubsAuto: 0 };
    existing.newSubs += series.newSubs[i] ?? 0;
    existing.unsubsReal += series.unsubsReal[i] ?? 0;
    existing.unsubsAuto += series.unsubsAuto[i] ?? 0;
    byDay.set(day, existing);
  }
  const rows = [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
  if (rows.length === 0) {
    return <p className="admin-meta">No subscribe activity in this window.</p>;
  }
  let totalNew = 0, totalReal = 0, totalAuto = 0;
  for (const r of rows) {
    totalNew += r.newSubs;
    totalReal += r.unsubsReal;
    totalAuto += r.unsubsAuto;
  }
  return (
    <table className="admin-cron-runs">
      <thead>
        <tr>
          <th>Date</th>
          <th style={{ textAlign: "right" }}>New</th>
          <th style={{ textAlign: "right" }}>Real unsub</th>
          <th style={{ textAlign: "right" }}>Auto unsub</th>
          <th style={{ textAlign: "right" }}>Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const net = r.newSubs - (r.unsubsReal + r.unsubsAuto);
          return (
            <tr key={r.date}>
              <td><code>{r.date}</code></td>
              <td style={{ textAlign: "right" }}>{r.newSubs > 0 ? `+${r.newSubs}` : "0"}</td>
              <td style={{ textAlign: "right" }}>{r.unsubsReal > 0 ? `−${r.unsubsReal}` : "0"}</td>
              <td style={{ textAlign: "right" }}>{r.unsubsAuto > 0 ? `−${r.unsubsAuto}` : "0"}</td>
              <td
                style={{ textAlign: "right" }}
                className={net > 0 ? "admin-kpi-delta-good" : net < 0 ? "admin-kpi-delta-bad" : undefined}
              >
                {formatDelta(net)}
              </td>
            </tr>
          );
        })}
        <tr>
          <td><strong>Total</strong></td>
          <td style={{ textAlign: "right" }}><strong>+{totalNew}</strong></td>
          <td style={{ textAlign: "right" }}><strong>−{totalReal}</strong></td>
          <td style={{ textAlign: "right" }}><strong>−{totalAuto}</strong></td>
          <td style={{ textAlign: "right" }}><strong>{formatDelta(totalNew - totalReal - totalAuto)}</strong></td>
        </tr>
      </tbody>
    </table>
  );
}

// ─── RSS readership table ────────────────────────────────────────────────

export function RssReadershipTable({ rows }: { rows: RssReadershipDay[] }) {
  if (rows.length === 0) {
    return (
      <p className="admin-meta">
        No RSS polls in window yet — likely the route hasn&apos;t been hit
        since the table came online, or the migration hasn&apos;t been
        applied.
      </p>
    );
  }
  return (
    <table className="admin-cron-runs">
      <thead>
        <tr>
          <th>Date</th>
          <th style={{ textAlign: "right" }}>Polls</th>
          <th style={{ textAlign: "right" }}>Aggregator subs</th>
          <th style={{ textAlign: "right" }}>Individuals</th>
          <th style={{ textAlign: "right" }}>Est. readers</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.date}>
            <td><code>{r.date}</code></td>
            <td style={{ textAlign: "right" }}>{r.polls.toLocaleString()}</td>
            <td style={{ textAlign: "right" }}>{r.aggregatorSubs.toLocaleString()}</td>
            <td style={{ textAlign: "right" }}>{r.individuals.toLocaleString()}</td>
            <td style={{ textAlign: "right" }}>
              <strong>{r.estimatedReaders.toLocaleString()}</strong>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Send coverage table ─────────────────────────────────────────────────

export function SendCoverageTable({ rows }: { rows: SendCoverageRow[] }) {
  if (rows.length === 0) {
    return <p className="admin-meta">No send-capable sports are configured yet.</p>;
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
        <span className="admin-send-coverage-gap"> — {gap.toLocaleString()} missed</span>
      )}
    </span>
  );
}
