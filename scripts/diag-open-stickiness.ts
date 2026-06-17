// One-off diagnostic: stickiness histogram over the last 7 MLB league
// digest sends. For each subscriber who received all 7 daily league
// emails, count how many of those 7 they opened (per Resend's
// email.opened event). Reports the full 0–7 histogram and the headline
// "% who opened all 7".
//
// Why "received all 7" as the denominator: the question is about
// subscriber stickiness, not signup velocity. Excluding subscribers who
// signed up mid-window (and therefore couldn't open all 7) keeps the
// metric a fair read on engagement among the eligible base.
//
// MPP / prefetch caveat: Apple Mail Privacy Protection silently
// pre-fetches the open-tracking pixel on most iCloud subscribers, so
// "opened" here is an upper bound on real reads. We report observed
// counts and footnote the caveat — see feedback_no_apmp_adjustment.md.
//
// Run:
//   npx tsx --env-file=.env.local scripts/diag-open-stickiness.ts

import { supabaseAdmin } from "../lib/supabase";

const SPORT = "mlb";
const WINDOW_DAYS = 7;

function ymdInET(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Yesterday + 6 prior days in ET. Today is excluded because today's
// digest has only been live for a partial open window.
function lastNDaysET(n: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(ymdInET(new Date(Date.now() - i * 86_400_000)));
  }
  return out.reverse();
}

type SendRow = { subscriber_id: string; digest_date: string; resend_id: string | null };
type OpenRow = { resend_id: string };

async function main(): Promise<void> {
  const db = supabaseAdmin();
  const dates = lastNDaysET(WINDOW_DAYS);
  console.log(`Window: ${dates[0]} → ${dates[dates.length - 1]} ET (${WINDOW_DAYS} dates)\n`);

  // 1. Pull every successful league send (no team_id, no error) in window.
  const sends: SendRow[] = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("sends")
      .select("subscriber_id, digest_date, resend_id, error, team_id")
      .eq("digest_sport", SPORT)
      .is("team_id", null)
      .is("error", null)
      .gte("digest_date", dates[0]!)
      .lte("digest_date", dates[dates.length - 1]!)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`sends query: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) {
      sends.push({
        subscriber_id: r.subscriber_id as string,
        digest_date:   r.digest_date as string,
        resend_id:     (r.resend_id as string | null) ?? null,
      });
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Loaded ${sends.length.toLocaleString()} successful league sends.\n`);

  // 2. Per-subscriber → set of distinct send dates received.
  const subDates = new Map<string, Set<string>>();
  const sendIdByPair = new Map<string, string>(); // "sub|date" → resend_id (for join later)
  for (const s of sends) {
    (subDates.get(s.subscriber_id) ?? subDates.set(s.subscriber_id, new Set()).get(s.subscriber_id)!)
      .add(s.digest_date);
    if (s.resend_id) sendIdByPair.set(`${s.subscriber_id}|${s.digest_date}`, s.resend_id);
  }

  // 3. Eligible = received all WINDOW_DAYS distinct dates in the window.
  const eligible: string[] = [];
  for (const [sub, ds] of subDates) {
    if (ds.size === WINDOW_DAYS) eligible.push(sub);
  }
  console.log(`Eligible subscribers (received all ${WINDOW_DAYS} sends): ${eligible.length.toLocaleString()}\n`);
  if (eligible.length === 0) {
    console.log("No eligible subscribers — exiting.");
    return;
  }

  // 4. Pull every email.opened event whose resend_id is one of the
  // eligible-subscriber send ids. Deduped to one open per resend_id.
  const eligibleSet = new Set(eligible);
  const candidateResendIds: string[] = [];
  for (const s of sends) {
    if (s.resend_id && eligibleSet.has(s.subscriber_id)) candidateResendIds.push(s.resend_id);
  }
  const candidateSet = new Set(candidateResendIds);
  console.log(`Candidate resend_ids to check for opens: ${candidateSet.size.toLocaleString()}\n`);

  // .in() has a practical URL-length limit so we batch resend_ids.
  const opened = new Set<string>();
  const ids = [...candidateSet];
  const IN_BATCH = 250;
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const chunk = ids.slice(i, i + IN_BATCH);
    let pageFrom = 0;
    for (;;) {
      const { data, error } = await db
        .from("email_events")
        .select("resend_id")
        .eq("event_type", "email.opened")
        .in("resend_id", chunk)
        .range(pageFrom, pageFrom + PAGE - 1) as unknown as { data: OpenRow[] | null; error: { message: string } | null };
      if (error) throw new Error(`opens query: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const e of data) opened.add(e.resend_id);
      if (data.length < PAGE) break;
      pageFrom += PAGE;
    }
  }
  console.log(`Distinct resend_ids with at least one open: ${opened.size.toLocaleString()}\n`);

  // 5. Per eligible subscriber, count opened dates in the window.
  const histogram = new Array<number>(WINDOW_DAYS + 1).fill(0);
  for (const sub of eligible) {
    let opens = 0;
    for (const date of dates) {
      const rid = sendIdByPair.get(`${sub}|${date}`);
      if (rid && opened.has(rid)) opens++;
    }
    histogram[opens]!++;
  }

  // 6. Output.
  const total = eligible.length;
  console.log(`Stickiness histogram (${total.toLocaleString()} eligible subscribers):\n`);
  console.log(`  Opens   Subs   %`);
  console.log(`  -----   ----   ---`);
  for (let i = WINDOW_DAYS; i >= 0; i--) {
    const c = histogram[i]!;
    const pct = (c / total) * 100;
    const bar = "█".repeat(Math.round(pct / 2));
    console.log(`  ${String(i).padStart(3)}/${WINDOW_DAYS}   ${String(c).padStart(5)}   ${pct.toFixed(1).padStart(4)}%  ${bar}`);
  }
  const allSeven = histogram[WINDOW_DAYS]!;
  const atLeastOne = total - histogram[0]!;
  console.log(`\n  Opened all ${WINDOW_DAYS}/${WINDOW_DAYS}: ${allSeven.toLocaleString()} (${(allSeven / total * 100).toFixed(1)}%)`);
  console.log(`  Opened ≥1/${WINDOW_DAYS}:  ${atLeastOne.toLocaleString()} (${(atLeastOne / total * 100).toFixed(1)}%)`);
  console.log(`\nNote: Apple Mail Privacy Protection silently prefetches the tracking pixel,`);
  console.log(`so these counts are an upper bound on real reads.`);
}

main().catch((err) => { console.error(err); process.exit(1); });

export {};
