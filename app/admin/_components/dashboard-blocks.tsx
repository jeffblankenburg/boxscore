// Async server components for the /admin morning report card.
//
// Each block is its own React Suspense unit on /admin so they stream in
// independently — a slow query (e.g. yesterday's send counts joining the
// sends table) doesn't block fast queries (e.g. the action queue counts).
// Pair every block with a same-height skeleton so the layout doesn't shift
// when blocks resolve.

import {
  getAdminActionQueue,
  getDashboardWatchwall,
  getLast24hPulse,
  getTodaysSendSummaries,
} from "@/lib/dashboard";
import { loadDailyMetrics, type DailyMetric } from "@/lib/daily-metrics";
import { yesterdayInET, prettyDate } from "@/lib/dates";
import { Watchwall } from "../charts";
import { Section, StatusBadge, type BadgeVariant } from "./primitives";

// ─── Today's send results ──────────────────────────────────────────────

export async function TodaysSendBlock() {
  const summaries = await getTodaysSendSummaries();
  const date = yesterdayInET();

  return (
    <Section title={`This morning's send · ${prettyDate(date)}`}>
      {summaries.length === 0 ? (
        <p className="a-muted">No send-capable sports configured.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {summaries.map((s) => {
            const totalSent = s.leagueSent + s.teamSent;
            const failed = s.failed;
            const variant: BadgeVariant =
              failed > 0
                ? "danger"
                : totalSent > 0
                  ? "success"
                  : "warning";
            const label =
              failed > 0
                ? `${failed} failed`
                : totalSent > 0
                  ? "shipped"
                  : "no sends yet";
            return (
              <div
                key={s.sport}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  border: "1px solid var(--a-border)",
                  borderRadius: 6,
                  background: "var(--a-bg)",
                }}
              >
                <div className="a-row" style={{ gap: 16 }}>
                  <strong style={{ minWidth: 60 }}>
                    {s.sportName.toUpperCase()}
                  </strong>
                  <StatusBadge variant={variant}>{label}</StatusBadge>
                  <span className="a-muted">
                    {s.hasSendRoute && (
                      <>{s.leagueSent.toLocaleString()} league</>
                    )}
                    {s.hasSendRoute && s.hasTeamSendRoute && " · "}
                    {s.hasTeamSendRoute && (
                      <>{s.teamSent.toLocaleString()} team</>
                    )}
                    {failed > 0 && (
                      <span style={{ color: "var(--a-danger-fg)", marginLeft: 8 }}>
                        · {failed} failed
                      </span>
                    )}
                  </span>
                </div>
                <div className="a-muted" style={{ fontSize: 12 }}>
                  {s.lastSentAt
                    ? `last at ${new Date(s.lastSentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : "—"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

export function TodaysSendSkeleton() {
  return (
    <Section title="This morning's send">
      <div style={{ display: "grid", gap: 10 }}>
        {[0, 1, 2].map((i) => (
          <SkeletonBar key={i} height={48} />
        ))}
      </div>
    </Section>
  );
}

// ─── Watchwall (cron health) ───────────────────────────────────────────

export async function WatchwallBlock() {
  const rows = await getDashboardWatchwall();
  return (
    <Section
      title="Watchwall"
      actions={<a href="/admin/operations/crons" className="a-btn a-btn-sm">All cron history</a>}
    >
      <Watchwall rows={rows} />
    </Section>
  );
}

export function WatchwallSkeleton() {
  return (
    <Section title="Watchwall">
      <SkeletonBar height={140} />
    </Section>
  );
}

// ─── Last 24h pulse ────────────────────────────────────────────────────

function formatDelta24(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${n.toLocaleString()}` : `−${Math.abs(n).toLocaleString()}`;
}

function pulseDeltaTone(now: number, prior: number, higherIsBetter: boolean): "good" | "bad" | "neutral" {
  const delta = now - prior;
  if (delta === 0) return "neutral";
  const isUp = delta > 0;
  return isUp === higherIsBetter ? "good" : "bad";
}

export async function PulseBlock() {
  const pulse = await getLast24hPulse();
  const items: Array<{
    label: string;
    value: string;
    delta?: string;
    tone?: "good" | "bad" | "neutral";
    sub?: string;
  }> = [
    {
      label: "New subscribers",
      value: pulse.newSubs.toLocaleString(),
      delta: `${formatDelta24(pulse.newSubs - pulse.newSubsPrior)} vs prior 24h`,
      tone: pulseDeltaTone(pulse.newSubs, pulse.newSubsPrior, true),
    },
    {
      label: "Unsubscribes",
      value: pulse.unsubs.toLocaleString(),
      delta: `${formatDelta24(pulse.unsubs - pulse.unsubsPrior)} vs prior 24h`,
      tone: pulseDeltaTone(pulse.unsubs, pulse.unsubsPrior, false),
    },
    {
      label: "Opens",
      value: pulse.opens.toLocaleString(),
      delta: `${formatDelta24(pulse.opens - pulse.opensPrior)} vs prior 24h`,
      tone: pulseDeltaTone(pulse.opens, pulse.opensPrior, true),
    },
    {
      label: "Bounces",
      value: pulse.bounces.toLocaleString(),
      tone: pulse.bounces > 0 ? "bad" : "good",
      sub: pulse.bounces === 0 ? "none" : undefined,
    },
    {
      label: "Pending subs",
      value: pulse.pendingTotal.toLocaleString(),
      sub: "signed up, never confirmed",
    },
  ];

  return (
    <Section title="Last 24 hours">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        {items.map((it) => (
          <div
            key={it.label}
            style={{
              padding: "12px 14px",
              border: "1px solid var(--a-border)",
              borderRadius: 6,
              background: "var(--a-bg)",
            }}
          >
            <div className="a-muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {it.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
              {it.value}
            </div>
            {it.delta && (
              <div
                style={{
                  fontSize: 12,
                  marginTop: 2,
                  color:
                    it.tone === "good"
                      ? "var(--a-success-fg)"
                      : it.tone === "bad"
                        ? "var(--a-danger-fg)"
                        : "var(--a-text-muted)",
                }}
              >
                {it.delta}
              </div>
            )}
            {it.sub && (
              <div className="a-muted" style={{ fontSize: 12, marginTop: 2 }}>
                {it.sub}
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

export function PulseSkeleton() {
  return (
    <Section title="Last 24 hours">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <SkeletonBar key={i} height={84} />
        ))}
      </div>
    </Section>
  );
}

// ─── Action queue ──────────────────────────────────────────────────────

export async function QueueBlock() {
  const items = await getAdminActionQueue();
  const active = items.filter((i) => i.count > 0);

  return (
    <Section title="Needs my attention">
      {active.length === 0 ? (
        <div
          style={{
            padding: 16,
            border: "1px solid var(--a-border)",
            borderRadius: 6,
            background: "var(--a-success-bg)",
            color: "var(--a-success-fg)",
          }}
        >
          ✓ Nothing waiting. Inbox zero.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {active.map((it) => (
            <a
              key={it.key}
              href={it.href}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                border: "1px solid var(--a-border)",
                borderRadius: 6,
                background: "var(--a-bg)",
                color: "var(--a-text)",
                textDecoration: "none",
              }}
            >
              <span>{it.label}</span>
              <StatusBadge variant="warning">{it.count}</StatusBadge>
            </a>
          ))}
        </div>
      )}
    </Section>
  );
}

export function QueueSkeleton() {
  return (
    <Section title="Needs my attention">
      <SkeletonBar height={56} />
    </Section>
  );
}

// ─── Stock-style ticker (open rate · reach · subscribers) ─────────────
//
// Three cards rendered from one daily_metrics scan. Each card answers the
// same shape of question: where are we today, how does it compare to the
// trailing week, what's the all-time band? The card is intentionally
// compact — Jeff wants a five-second scan, not a deep-dive. Click-through
// for detail lives on the existing /admin/ads/explore page.
//
// History gaps (e.g. opens are null before tracking turned on) are skipped
// in the hi/lo and 7-day-avg math, not zeroed — a null day shouldn't drag
// the all-time low down to 0 just because Resend wasn't tracking yet.

type MetricPoint = { date: string; value: number };

function pointsFromMetrics(
  metrics: DailyMetric[],
  pick: (m: DailyMetric) => number | null,
): MetricPoint[] {
  const out: MetricPoint[] = [];
  for (const m of metrics) {
    const v = pick(m);
    if (v === null || Number.isNaN(v)) continue;
    out.push({ date: m.date, value: v });
  }
  return out;
}

function avgPriorWindow(points: MetricPoint[], days: number): number | null {
  // Last point = yesterday; the prior window is the `days` points before
  // that. If we don't have enough history yet, the avg is undefined.
  if (points.length < days + 1) return null;
  const slice = points.slice(-1 - days, -1);
  const sum = slice.reduce((s, p) => s + p.value, 0);
  return sum / slice.length;
}

function findExtreme(points: MetricPoint[], kind: "max" | "min"): MetricPoint | null {
  if (points.length === 0) return null;
  let best = points[0]!;
  for (const p of points) {
    if (kind === "max" ? p.value > best.value : p.value < best.value) best = p;
  }
  return best;
}

// Lightweight inline sparkline. ~120×32 viewBox, single path, no axes.
function Sparkline({ points, color }: { points: MetricPoint[]; color: string }) {
  if (points.length < 2) {
    return (
      <div style={{ height: 32, color: "var(--a-muted-fg)", fontSize: 11, alignSelf: "end" }}>
        not enough history
      </div>
    );
  }
  const W = 120, H = 32, padY = 3;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.0001);
  const xAt = (i: number) => (i / (points.length - 1)) * W;
  const yAt = (v: number) => padY + (H - padY * 2) * (1 - (v - min) / span);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="trend">
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

type TickerCardProps = {
  label:    string;
  points:   MetricPoint[];                 // chronological asc
  format:   (n: number) => string;         // headline + extremes
  deltaFmt: (delta: number) => string;     // "+1.3pp" / "+2.1%" / "+12"
  betterIsHigher: boolean;
  sparkColor: string;
};

function TickerCard({ label, points, format, deltaFmt, betterIsHigher, sparkColor }: TickerCardProps) {
  const last = points[points.length - 1];
  const priorAvg = avgPriorWindow(points, 7);
  const ath = findExtreme(points, "max");
  const atl = findExtreme(points, "min");
  const spark = points.slice(-30);

  if (!last) {
    return (
      <div style={cardStyle}>
        <div style={labelStyle}>{label}</div>
        <div style={emptyStyle}>no data yet</div>
      </div>
    );
  }

  const delta = priorAvg !== null ? last.value - priorAvg : null;
  const tone: "good" | "bad" | "neutral" =
    delta === null || delta === 0
      ? "neutral"
      : (delta > 0) === betterIsHigher
        ? "good"
        : "bad";
  const arrow = delta === null || delta === 0 ? "·" : delta > 0 ? "▲" : "▼";

  return (
    <div style={cardStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>
            {format(last.value)}
          </div>
          {/* Edition stamp — screenshot-friendly. Spelled-out month + year so
              a card lifted out of the dashboard is still unambiguous when
              shared months later. */}
          <div style={{ fontSize: 11, fontStyle: "italic", color: "var(--a-muted-fg)", marginTop: 2 }}>
            {prettyDate(last.date)}
          </div>
        </div>
        <Sparkline points={spark} color={sparkColor} />
      </div>
      <div style={{ fontSize: 12, marginTop: 6, color: toneColor(tone) }}>
        {arrow}{" "}
        {delta === null
          ? "needs 8 days of history"
          : <>{deltaFmt(delta)} <span style={{ color: "var(--a-muted-fg)" }}>vs 7d avg</span></>}
      </div>
      <div style={{ fontSize: 11, color: "var(--a-muted-fg)", marginTop: 6 }}>
        ATH {ath ? `${format(ath.value)} (${shortDate(ath.date)})` : "—"}
        {"  ·  "}
        ATL {atl ? `${format(atl.value)} (${shortDate(atl.date)})` : "—"}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  flex: "1 1 0",
  minWidth: 200,
  padding: "14px 16px",
  border: "1px solid var(--a-border)",
  borderRadius: 6,
  background: "var(--a-bg)",
};
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--a-muted-fg)",
  marginBottom: 8,
};
const emptyStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--a-muted-fg)",
  paddingTop: 4,
};
function toneColor(tone: "good" | "bad" | "neutral"): string {
  if (tone === "good") return "var(--a-success-fg, #0a7f2e)";
  if (tone === "bad")  return "var(--a-danger-fg,  #8a1a1a)";
  return "var(--a-muted-fg)";
}
function shortDate(iso: string): string {
  // "2026-06-19" → "6/19"
  const parts = iso.split("-");
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

// Per-audience accessors. `scope` is the audience we're slicing for; the
// math in each closure works off the league columns, the team columns, or
// the sum of both depending on scope. Null+number sums treat null as 0 so
// a single missing scope doesn't blank the combined ALL row.
type Scope = "all" | "league" | "team";

function openRate(m: DailyMetric, scope: Scope): number | null {
  let opened = 0, delivered = 0;
  if (scope === "league" || scope === "all") {
    opened += m.opened ?? 0; delivered += m.delivered ?? 0;
  }
  if (scope === "team" || scope === "all") {
    opened += m.team_opened ?? 0; delivered += m.team_delivered ?? 0;
  }
  return delivered > 0 ? opened / delivered : null;
}

function reach(m: DailyMetric, scope: Scope): number | null {
  let total = 0;
  let anyNonNull = false;
  if (scope === "league" || scope === "all") {
    if (m.delivered !== null)      { total += m.delivered;      anyNonNull = true; }
    if (m.web_pageviews !== null)  { total += m.web_pageviews;  anyNonNull = true; }
  }
  if (scope === "team" || scope === "all") {
    if (m.team_delivered !== null)     { total += m.team_delivered;     anyNonNull = true; }
    if (m.team_web_pageviews !== null) { total += m.team_web_pageviews; anyNonNull = true; }
  }
  return anyNonNull ? total : null;
}

function subscribers(m: DailyMetric, scope: Scope): number | null {
  if (scope === "league") return m.active_subscribers;
  if (scope === "team")   return m.team_active_subscribers;
  // ALL = league + team subscription counts. This DOUBLE-COUNTS people who
  // are opted into both — but the alternative (distinct-people proxy) made
  // "All emails" disagree with MLB + Teams visually, which reads as a bug.
  // Treat the card as "total subscription slots across products," consistent
  // with how Reach sums.
  if (m.active_subscribers === null && m.team_active_subscribers === null) return null;
  return (m.active_subscribers ?? 0) + (m.team_active_subscribers ?? 0);
}

type ScopeRow = {
  scope: Scope;
  label: string;
  subsLabel: string;
};

const SCOPE_ROWS: ScopeRow[] = [
  { scope: "all",    label: "All emails",  subsLabel: "Subscribers" },
  { scope: "league", label: "MLB league",  subsLabel: "MLB league subscribers" },
  { scope: "team",   label: "MLB teams",   subsLabel: "MLB team subscribers" },
];

function TickerRow({
  row,
  metrics,
}: {
  row: ScopeRow;
  metrics: DailyMetric[];
}) {
  const openRatePts = pointsFromMetrics(metrics, (m) => openRate(m, row.scope));
  const reachPts    = pointsFromMetrics(metrics, (m) => reach(m, row.scope));
  const subsPts     = pointsFromMetrics(metrics, (m) => subscribers(m, row.scope));
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "var(--a-muted-fg)",
          paddingBottom: 6, marginBottom: 8,
          borderBottom: "1px solid var(--a-border)",
        }}
      >
        {row.label}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <TickerCard
          label="Open rate"
          points={openRatePts}
          format={(n) => `${(n * 100).toFixed(1)}%`}
          deltaFmt={(d) => `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}pp`}
          betterIsHigher={true}
          sparkColor="#2a4d80"
        />
        <TickerCard
          label="Reach"
          points={reachPts}
          format={(n) => Math.round(n).toLocaleString()}
          deltaFmt={(d) => `${d >= 0 ? "+" : ""}${Math.round(d).toLocaleString()}`}
          betterIsHigher={true}
          sparkColor="#1f5a1f"
        />
        <TickerCard
          label={row.subsLabel}
          points={subsPts}
          format={(n) => Math.round(n).toLocaleString()}
          deltaFmt={(d) => `${d >= 0 ? "+" : ""}${Math.round(d).toLocaleString()}`}
          betterIsHigher={true}
          sparkColor="#5a3b1f"
        />
      </div>
    </div>
  );
}

export async function TickerBlock() {
  const metrics = await loadDailyMetrics("mlb");
  return (
    <Section title="At a glance">
      {SCOPE_ROWS.map((row) => (
        <TickerRow key={row.scope} row={row} metrics={metrics} />
      ))}
    </Section>
  );
}

export function TickerSkeleton() {
  return (
    <Section title="At a glance">
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ ...cardStyle, padding: 0 }}>
            <SkeletonBar height={120} />
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── Skeleton primitive ────────────────────────────────────────────────

function SkeletonBar({ height }: { height: number }) {
  return (
    <div
      style={{
        height,
        borderRadius: 6,
        background:
          "linear-gradient(90deg, var(--a-bg-muted) 0%, var(--a-bg-hover) 50%, var(--a-bg-muted) 100%)",
        backgroundSize: "200% 100%",
        animation: "aShimmer 1.4s ease-in-out infinite",
      }}
    />
  );
}
