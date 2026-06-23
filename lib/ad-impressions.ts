import { supabaseAdmin } from "./supabase";
import { prevDay } from "./dates";

export type ImpressionCounts = { email: number; web: number };

/**
 * Per-placement impression breakdown. Email = unique `email.opened` events
 * deduped by `resend_id` (one open per recipient regardless of reopens).
 * Web = every production pageview on the dated digest path (each render =
 * another impression of the ad). Returned map keyed by `${sport}|${date}`,
 * where `date` is the placement's **edition date** (the day the digest is
 * delivered) — same semantics as `ad_placements.date` and the public URL
 * `/{sport}/{date}`.
 *
 * Date semantics gotcha:
 *   `ad_placements.date` is the EDITION date (e.g. 2026-06-18 = the digest
 *   delivered on the morning of 6/18). But `sends.digest_date` is the
 *   GAMES date — one day earlier — because the cron writes "yesterday's
 *   box scores recap" with games_date as its key. So the join is
 *   `sends.digest_date = prevDay(placement.date)`. Output map stays keyed
 *   on the edition date so callers can look up by placement directly.
 *
 * Excludes errored sends and team digests — placement.sport is always the
 * league digest in v1.
 *
 * Implementation notes:
 *   - Sends are paginated with `.order("id")` so range fetches stay
 *     deterministic across pages (PostgREST's natural order shifts
 *     between requests and silently drops rows otherwise).
 *   - Opens are NOT filtered by `in(resend_id, [...])` because the URL
 *     overflows PostgREST's ~8KB cap once the id list grows. Instead we
 *     scan email.opened events from the earliest send date forward and
 *     intersect against the in-scope set in JS — same pattern as
 *     `eventsByResendId` in lib/dashboard.ts.
 */
export async function loadImpressionsByPair(
  pairs: Array<{ sport: string; date: string }>,
): Promise<Map<string, ImpressionCounts>> {
  const out = new Map<string, ImpressionCounts>();
  if (pairs.length === 0) return out;

  const seen = new Set<string>();
  const distinct: Array<{ sport: string; date: string }> = [];
  for (const p of pairs) {
    const k = `${p.sport}|${p.date}`;
    if (seen.has(k)) continue;
    seen.add(k);
    distinct.push(p);
    out.set(k, { email: 0, web: 0 });
  }
  const distinctSports = Array.from(new Set(distinct.map((p) => p.sport)));
  // Map from sends.digest_date (= edition_date - 1) back to the edition
  // date used as the pair key. Lets us look up which placement a send row
  // belongs to without flipping the dates twice downstream.
  const sendDateToEditionDate = new Map<string, string>();
  for (const p of distinct) {
    sendDateToEditionDate.set(prevDay(p.date), p.date);
  }
  const distinctSendDates = Array.from(sendDateToEditionDate.keys());

  const db = supabaseAdmin();

  type SendRow = { resend_id: string | null; digest_sport: string; digest_date: string };
  const resendToPair = new Map<string, string>();
  let sendsScanned = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("sends")
      .select("resend_id, digest_sport, digest_date")
      .in("digest_sport", distinctSports)
      .in("digest_date", distinctSendDates)
      .is("team_id", null)
      .is("error", null)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) {
      console.error(`loadImpressionsByPair sends: ${error.message}`);
      break;
    }
    const page = (data ?? []) as SendRow[];
    sendsScanned += page.length;
    for (const r of page) {
      if (!r.resend_id) continue;
      const editionDate = sendDateToEditionDate.get(r.digest_date);
      if (!editionDate) continue;
      const k = `${r.digest_sport}|${editionDate}`;
      if (!out.has(k)) continue;
      resendToPair.set(r.resend_id, k);
    }
    if (page.length < 1000) break;
  }

  // Open-events scan window starts at the earliest send_date (= one day
  // before the earliest edition_date). Opens for a digest sent on
  // games_date=X land in email_events on the morning of X+1 (or later as
  // recipients catch up); going back to X catches them all.
  const sortedSendDates = [...distinctSendDates].sort();
  const sinceIso = `${sortedSendDates[0]}T00:00:00Z`;
  const openedResendIds = new Set<string>();
  let opensScanned = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("email_events")
      .select("resend_id, event_at")
      .in("event_type", ["email.opened", "boxscore.opened"])
      .gte("event_at", sinceIso)
      .order("event_at", { ascending: true })
      .range(from, from + 999);
    if (error) {
      console.error(`loadImpressionsByPair opens: ${error.message}`);
      break;
    }
    const page = (data ?? []) as Array<{ resend_id: string | null; event_at: string }>;
    opensScanned += page.length;
    for (const r of page) {
      if (r.resend_id && resendToPair.has(r.resend_id)) {
        openedResendIds.add(r.resend_id);
      }
    }
    if (page.length < 1000) break;
  }
  for (const id of openedResendIds) {
    const pair = resendToPair.get(id);
    if (!pair) continue;
    const cur = out.get(pair);
    if (cur) cur.email += 1;
  }

  const pathToPair = new Map<string, string>();
  for (const p of distinct) {
    pathToPair.set(`/${p.sport}/${p.date}`, `${p.sport}|${p.date}`);
  }
  const paths = Array.from(pathToPair.keys());
  let pageviewsScanned = 0;
  if (paths.length > 0) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("page_views")
        .select("path")
        .eq("event_type", "pageview")
        .eq("vercel_environment", "production")
        .in("path", paths)
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) {
        console.error(`loadImpressionsByPair pageviews: ${error.message}`);
        break;
      }
      const page = (data ?? []) as Array<{ path: string | null }>;
      pageviewsScanned += page.length;
      for (const r of page) {
        if (!r.path) continue;
        const pair = pathToPair.get(r.path);
        if (!pair) continue;
        const cur = out.get(pair);
        if (cur) cur.web += 1;
      }
      if (page.length < 1000) break;
    }
  }

  // One-line summary so we can confirm scan volumes without per-row spam.
  console.log(
    `[impressions] pairs=${distinct.length} sendsScanned=${sendsScanned} resendIdsMapped=${resendToPair.size} opensScanned=${opensScanned} openedInScope=${openedResendIds.size} pvScanned=${pageviewsScanned}`,
  );

  return out;
}
