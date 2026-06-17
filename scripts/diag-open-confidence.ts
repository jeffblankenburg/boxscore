// One-off diagnostic: three confidence checks on the "40% open zero
// emails in 7 days" stat the stickiness panel reports, before we let
// that number drive an auto-suppression cron.
//
//   (a) Fraction of sends with NULL resend_id. We join opens to sends
//       via resend_id; null = unrecoverable orphan, looks identical to
//       "never opened" in the histogram.
//   (b) Open-time-after-send distribution. The metric assumes opens
//       land within a few days. If the long tail is meaningful we need
//       a wider observation window or a wait period before suppressing.
//   (c) Whether the 0-open cohort has email.delivered events on most
//       messages. If yes, sends are landing at the MTA and the "0 opens"
//       likely reflects real reader behavior (or pixel blocking). If no,
//       a chunk of "0 opens" is actually undeliverable mail.
//
// Run:
//   npx tsx --env-file=.env.local scripts/diag-open-confidence.ts

import { supabaseAdmin } from "../lib/supabase";

const SPORT = "mlb";
const WINDOW_DAYS = 7;
const PAGE = 1000;

function ymdInET(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

type SendRow = {
  subscriber_id: string;
  digest_date:   string;
  resend_id:     string | null;
  sent_at:       string;
  error:         string | null;
};
type OpenRow = { resend_id: string; event_at: string };
type DelRow  = { resend_id: string };

async function main(): Promise<void> {
  const db = supabaseAdmin();

  const dates: string[] = [];
  for (let i = 1; i <= WINDOW_DAYS; i++) {
    dates.push(ymdInET(new Date(Date.now() - i * 86_400_000)));
  }
  dates.reverse();
  const windowStart = dates[0]!;
  const windowEnd   = dates[dates.length - 1]!;

  // Pull all in-window league sends (including errored ones — (a) wants
  // the raw rate of null resend_ids, errored sends typically also lack
  // a resend_id so we'd undercount otherwise).
  const sends: SendRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("sends")
      .select("subscriber_id, digest_date, resend_id, sent_at, error")
      .eq("digest_sport", SPORT)
      .is("team_id", null)
      .gte("digest_date", windowStart)
      .lte("digest_date", windowEnd)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`sends: ${error.message}`);
    if (!data || data.length === 0) break;
    sends.push(...(data as SendRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // ─── (a) NULL resend_id rate ─────────────────────────────────────────
  const successSends = sends.filter((s) => !s.error);
  const nullSuccess  = successSends.filter((s) => !s.resend_id).length;
  const erroredSends = sends.filter((s) => s.error);
  console.log(`\n=== (a) send → resend_id linkage ===`);
  console.log(`Window: ${windowStart} → ${windowEnd} (${WINDOW_DAYS} days, sport=${SPORT})`);
  console.log(`Total league sends:           ${sends.length.toLocaleString()}`);
  console.log(`  with error:                 ${erroredSends.length.toLocaleString()}`);
  console.log(`  without error:              ${successSends.length.toLocaleString()}`);
  console.log(`  successful, NULL resend_id: ${nullSuccess.toLocaleString()} (${(nullSuccess / Math.max(1, successSends.length) * 100).toFixed(2)}%)`);
  console.log(`Anything with null resend_id is orphaned from open events — looks identical to "never opened".`);

  // Open events keyed to in-window sends.
  // Query window: from start of stickiness window through now. The
  // current dashboard.ts logic pads 2 days before windowStart on the
  // lower bound; we pull a wider window here to characterize what we
  // could be missing.
  const sentByRid = new Map<string, Date>();
  for (const s of sends) {
    if (s.resend_id) sentByRid.set(s.resend_id, new Date(s.sent_at));
  }
  const sinceIso = new Date(new Date(windowStart + "T00:00:00Z").getTime() - 2 * 86_400_000).toISOString();
  const untilIso = new Date().toISOString();

  // ─── (b) open-time-after-send distribution ───────────────────────────
  const opens: OpenRow[] = [];
  from = 0;
  for (;;) {
    const { data, error } = await db
      .from("email_events")
      .select("resend_id, event_at")
      .eq("event_type", "email.opened")
      .gte("event_at", sinceIso)
      .lte("event_at", untilIso)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`opens: ${error.message}`);
    if (!data || data.length === 0) break;
    opens.push(...(data as OpenRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  const deltaHrs: number[] = [];
  for (const o of opens) {
    const sent = sentByRid.get(o.resend_id);
    if (!sent) continue;
    const dh = (new Date(o.event_at).getTime() - sent.getTime()) / 3_600_000;
    if (dh < -1) continue;
    deltaHrs.push(dh);
  }
  deltaHrs.sort((a, b) => a - b);
  const pctile = (p: number) => deltaHrs[Math.floor(deltaHrs.length * p)] ?? 0;
  const bucketLabels = ["<1h", "1-6h", "6-24h", "1-3d", "3-7d", "7+d"];
  const bucketEdges  = [1, 6, 24, 72, 168];
  const bucketCounts = [0, 0, 0, 0, 0, 0];
  for (const dh of deltaHrs) {
    let idx = bucketEdges.findIndex((e) => dh < e);
    if (idx < 0) idx = bucketLabels.length - 1;
    bucketCounts[idx]!++;
  }
  console.log(`\n=== (b) open-time-after-send distribution ===`);
  console.log(`Open events matched to in-window sends: ${deltaHrs.length.toLocaleString()}`);
  if (deltaHrs.length > 0) {
    console.log(`  p50: ${pctile(0.50).toFixed(1)}h`);
    console.log(`  p75: ${pctile(0.75).toFixed(1)}h`);
    console.log(`  p90: ${pctile(0.90).toFixed(1)}h`);
    console.log(`  p95: ${pctile(0.95).toFixed(1)}h`);
    console.log(`  p99: ${pctile(0.99).toFixed(1)}h`);
    console.log(`  max: ${(deltaHrs[deltaHrs.length - 1] ?? 0).toFixed(1)}h`);
    console.log(`Distribution:`);
    for (let i = 0; i < bucketLabels.length; i++) {
      const c = bucketCounts[i]!;
      const pct = (c / deltaHrs.length) * 100;
      const bar = "█".repeat(Math.round(pct / 2));
      console.log(`  ${bucketLabels[i]!.padEnd(6)} ${String(c).padStart(7)} (${pct.toFixed(1).padStart(4)}%) ${bar}`);
    }
  }

  // ─── (c) delivered-events coverage on the 0-open cohort ──────────────
  const subDates = new Map<string, Set<string>>();
  const ridByPair = new Map<string, string>();
  for (const s of successSends) {
    (subDates.get(s.subscriber_id) ?? subDates.set(s.subscriber_id, new Set()).get(s.subscriber_id)!)
      .add(s.digest_date);
    if (s.resend_id) ridByPair.set(`${s.subscriber_id}|${s.digest_date}`, s.resend_id);
  }
  const eligibleSubs: string[] = [];
  for (const [sub, ds] of subDates) {
    if (ds.size === WINDOW_DAYS) eligibleSubs.push(sub);
  }
  const openedRids = new Set<string>(opens.map((o) => o.resend_id));
  const zeroOpenSubs: string[] = [];
  for (const sub of eligibleSubs) {
    let opens7 = 0;
    for (const d of dates) {
      const rid = ridByPair.get(`${sub}|${d}`);
      if (rid && openedRids.has(rid)) opens7++;
    }
    if (opens7 === 0) zeroOpenSubs.push(sub);
  }
  const zeroOpenSet = new Set(zeroOpenSubs);
  const zeroOpenRids: string[] = [];
  for (const s of successSends) {
    if (s.resend_id && zeroOpenSet.has(s.subscriber_id)) zeroOpenRids.push(s.resend_id);
  }
  const zeroOpenRidSet = new Set(zeroOpenRids);
  const deliveredRids = new Set<string>();
  from = 0;
  for (;;) {
    const { data, error } = await db
      .from("email_events")
      .select("resend_id")
      .eq("event_type", "email.delivered")
      .gte("event_at", sinceIso)
      .lte("event_at", untilIso)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`delivered: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const e of data as DelRow[]) {
      if (zeroOpenRidSet.has(e.resend_id)) deliveredRids.add(e.resend_id);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`\n=== (c) 0-open cohort delivery verification ===`);
  console.log(`Eligible subscribers (received all ${WINDOW_DAYS} sends): ${eligibleSubs.length.toLocaleString()}`);
  console.log(`  of which 0 opens in window: ${zeroOpenSubs.length.toLocaleString()}`);
  console.log(`  their resend_ids:           ${zeroOpenRids.length.toLocaleString()}`);
  console.log(`  ...with email.delivered:    ${deliveredRids.size.toLocaleString()} (${(deliveredRids.size / Math.max(1, zeroOpenRids.length) * 100).toFixed(1)}%)`);
  console.log(`A high % means sends are reaching the MTA → dormancy or pixel blocking, not delivery failure.`);
  console.log(`A low %  means a chunk of "0 opens" is undeliverable mail we should suppress on bounces instead.`);
}

main().catch((err) => { console.error(err); process.exit(1); });

export {};
