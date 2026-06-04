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
