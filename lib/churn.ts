// Churn analysis for /admin/metrics/churn — WHY people unsubscribe.
//
// The survey data (unsubscribe_user_reason + unsubscribe_feedback) and the
// system reason (unsubscribe_reason: user|bounce|complaint|manual) have been
// captured since migrations 0010/0056 but were never surfaced. This reads them
// back, plus tenure (confirmed→unsub), acquisition source, and how many emails
// a churned reader had received before leaving.
//
// One paginated scan of the unsubscribed rows drives everything except the
// emails-before-unsub distribution, which chunks indexed sends lookups over the
// user-initiated set. The heavier "did they stop opening first" correlation
// needs an email_events scan and is intentionally left for a cron rollup.

import { supabaseAdmin } from "./supabase";

const PAGE = 1000;

// Canned dropdown reasons (mirrors app/u/[token]/page.tsx UNSUB_REASONS) so the
// admin view labels them even when zero people picked one.
const REASON_LABELS: Record<string, string> = {
  too_many: "Too many emails",
  not_relevant: "Not relevant to my interests",
  never_signed: "I didn't subscribe to this",
  switching: "Switching to a different newsletter",
  taking_break: "Taking a break from sports",
  other: "Other (free text)",
};

const SYSTEM_LABELS: Record<string, string> = {
  user: "User — clicked unsubscribe",
  bounce: "Bounce — mailbox rejected (deliverability)",
  complaint: "Complaint — marked as spam",
  manual: "Manual — admin removed",
  unknown: "Uncategorized (legacy)",
};

export type Count = { key: string; label: string; count: number; pct: number };
export type TenureBucket = { label: string; count: number };
export type FeedbackRow = {
  email: string;
  reason: string | null;
  reasonLabel: string;
  feedback: string;
  at: string | null;
};

export type ChurnAnalysis = {
  totalUnsub: number;
  userInitiated: number;
  deliverability: number; // bounce + complaint
  surveyAnsweredPct: number; // of user-initiated
  medianTenureDays: number | null;
  systemReasons: Count[];
  statedReasons: Count[]; // among user-initiated, incl. "no answer"
  tenure: TenureBucket[];
  sources: Count[]; // acquisition source of churned readers
  feedback: FeedbackRow[]; // most recent verbatim, newest first
  emailsBeforeUnsub: { median: number | null; buckets: TenureBucket[]; sampled: number };
};

type Row = {
  id: string;
  email: string;
  unsubscribe_reason: string | null;
  unsubscribe_user_reason: string | null;
  unsubscribe_feedback: string | null;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  created_at: string | null;
  utm_source: string | null;
  referrer: string | null;
};

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((1000 * n) / d) / 10;
}

function tally(
  rows: { key: string; }[],
  labels: Record<string, string>,
): Count[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.key, (m.get(r.key) ?? 0) + 1);
  const total = rows.length;
  return [...m.entries()]
    .map(([key, count]) => ({ key, label: labels[key] ?? key, count, pct: pct(count, total) }))
    .sort((a, b) => b.count - a.count);
}

function tenureDays(r: Row): number | null {
  const start = r.confirmed_at ?? r.created_at;
  if (!start || !r.unsubscribed_at) return null;
  const d = (+new Date(r.unsubscribed_at) - +new Date(start)) / 86_400_000;
  return d >= 0 ? d : null;
}

function bucketTenure(d: number): string {
  if (d < 1) return "< 1 day";
  if (d < 7) return "1–7 days";
  if (d < 30) return "7–30 days";
  if (d < 90) return "30–90 days";
  return "90+ days";
}
const TENURE_ORDER = ["< 1 day", "1–7 days", "7–30 days", "30–90 days", "90+ days"];

function bucketEmails(n: number): string {
  if (n <= 1) return "0–1";
  if (n <= 5) return "2–5";
  if (n <= 15) return "6–15";
  if (n <= 30) return "16–30";
  return "30+";
}
const EMAIL_ORDER = ["0–1", "2–5", "6–15", "16–30", "30+"];

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function sourceKey(r: Row): string {
  if (r.utm_source) return r.utm_source;
  if (r.referrer) {
    try { return new URL(r.referrer).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
  }
  return "direct / unknown";
}

// Emails a churned reader received before leaving. Chunks the user-initiated
// subscriber ids through the indexed sends_subscriber_idx (avoids a full-table
// scan and keeps the .in() URL short), then counts per subscriber up to their
// unsubscribe time.
async function emailsBeforeUnsub(
  rows: Row[],
): Promise<{ median: number | null; buckets: TenureBucket[]; sampled: number }> {
  const withDate = rows.filter((r) => r.unsubscribed_at);
  const cutoff = new Map(withDate.map((r) => [r.id, +new Date(r.unsubscribed_at!)]));
  const counts = new Map<string, number>();
  const ids = [...cutoff.keys()];
  for (let i = 0; i < ids.length; i += 60) {
    const chunk = ids.slice(i, i + 60);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin()
        .from("sends")
        .select("subscriber_id, sent_at")
        .in("subscriber_id", chunk)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`emailsBeforeUnsub: ${error.message}`);
      const page = (data ?? []) as Array<{ subscriber_id: string; sent_at: string }>;
      for (const s of page) {
        if (+new Date(s.sent_at) <= (cutoff.get(s.subscriber_id) ?? 0)) {
          counts.set(s.subscriber_id, (counts.get(s.subscriber_id) ?? 0) + 1);
        }
      }
      if (page.length < PAGE) break;
    }
  }
  // Subscribers with zero matching sends still count as 0 received.
  const values = ids.map((id) => counts.get(id) ?? 0);
  const bm = new Map<string, number>();
  for (const v of values) bm.set(bucketEmails(v), (bm.get(bucketEmails(v)) ?? 0) + 1);
  return {
    median: median(values),
    buckets: EMAIL_ORDER.map((label) => ({ label, count: bm.get(label) ?? 0 })),
    sampled: values.length,
  };
}

export async function getChurnAnalysis(): Promise<ChurnAnalysis> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin()
      .from("subscribers")
      .select("id, email, unsubscribe_reason, unsubscribe_user_reason, unsubscribe_feedback, confirmed_at, unsubscribed_at, created_at, utm_source, referrer")
      .eq("status", "unsubscribed")
      .order("unsubscribed_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`getChurnAnalysis: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const isUser = (r: Row) => r.unsubscribe_reason === null || r.unsubscribe_reason === "user";
  const userRows = rows.filter(isUser);
  const deliverability = rows.filter(
    (r) => r.unsubscribe_reason === "bounce" || r.unsubscribe_reason === "complaint",
  ).length;

  const systemReasons = tally(
    rows.map((r) => ({ key: r.unsubscribe_reason ?? "unknown" })),
    SYSTEM_LABELS,
  );
  const statedReasons = tally(
    userRows.map((r) => ({ key: r.unsubscribe_user_reason ?? "no_answer" })),
    { ...REASON_LABELS, no_answer: "No answer (one-click / skipped)" },
  );
  const sources = tally(rows.map((r) => ({ key: sourceKey(r) })), {});

  const tenures = rows.map(tenureDays).filter((d): d is number => d != null);
  const tb = new Map<string, number>();
  for (const d of tenures) tb.set(bucketTenure(d), (tb.get(bucketTenure(d)) ?? 0) + 1);
  const tenure = TENURE_ORDER.map((label) => ({ label, count: tb.get(label) ?? 0 }));

  const surveyAnswered = userRows.filter(
    (r) => r.unsubscribe_user_reason || (r.unsubscribe_feedback && r.unsubscribe_feedback.trim()),
  ).length;

  const feedback: FeedbackRow[] = rows
    .filter((r) => r.unsubscribe_feedback && r.unsubscribe_feedback.trim())
    .slice(0, 100)
    .map((r) => ({
      email: r.email,
      reason: r.unsubscribe_user_reason,
      reasonLabel: r.unsubscribe_user_reason ? (REASON_LABELS[r.unsubscribe_user_reason] ?? r.unsubscribe_user_reason) : "—",
      feedback: r.unsubscribe_feedback!.trim(),
      at: r.unsubscribed_at,
    }));

  const emails = await emailsBeforeUnsub(userRows);

  return {
    totalUnsub: rows.length,
    userInitiated: userRows.length,
    deliverability,
    surveyAnsweredPct: pct(surveyAnswered, userRows.length),
    medianTenureDays: median(tenures),
    systemReasons,
    statedReasons,
    tenure,
    sources: sources.slice(0, 10),
    feedback,
    emailsBeforeUnsub: emails,
  };
}
