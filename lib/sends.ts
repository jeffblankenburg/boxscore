import { supabaseAdmin } from "./supabase";

// teamId disambiguates league sends (NULL/undefined) from team-scoped sends.
// Every helper treats undefined and null identically — null is the wire value
// stored in the column for league sends.

export async function hasAlreadySent(
  subscriberId: string, sport: string, date: string,
  teamId?: string | null,
): Promise<boolean> {
  let q = supabaseAdmin()
    .from("sends")
    .select("id, error")
    .eq("subscriber_id", subscriberId)
    .eq("digest_sport", sport)
    .eq("digest_date", date);
  q = teamId == null ? q.is("team_id", null) : q.eq("team_id", teamId);
  const { data, error } = await q.maybeSingle<{ id: string; error: string | null }>();
  if (error) throw new Error(`hasAlreadySent: ${error.message}`);
  return data != null && data.error == null;
}

// Bulk version: returns the set of subscriber_ids that already have a
// successful send recorded for (sport, date) — optionally scoped to a single
// team. Used by the send-email cron to avoid 1 round-trip per subscriber.
// Paginated because the sends table grows past Supabase's default 1000-row
// cap.
export async function getSentSubscriberIds(
  sport: string, date: string,
  teamId?: string | null,
): Promise<Set<string>> {
  const out = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let q = supabaseAdmin()
      .from("sends")
      .select("subscriber_id")
      .eq("digest_sport", sport)
      .eq("digest_date", date)
      .is("error", null);
    q = teamId == null ? q.is("team_id", null) : q.eq("team_id", teamId);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw new Error(`getSentSubscriberIds: ${error.message}`);
    const page = (data ?? []) as Array<{ subscriber_id: string }>;
    for (const row of page) out.add(row.subscriber_id);
    if (page.length < pageSize) break;
  }
  return out;
}

export async function recordSend(args: {
  subscriberId: string;
  sport: string;
  date: string;
  resendId: string | null;
  error: string | null;
  teamId?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("sends")
    .upsert(
      {
        subscriber_id: args.subscriberId,
        digest_sport: args.sport,
        digest_date: args.date,
        team_id: args.teamId ?? null,
        resend_id: args.resendId,
        error: args.error,
        sent_at: new Date().toISOString(),
      },
      { onConflict: "subscriber_id,digest_sport,digest_date,team_id" },
    );
  if (error) throw new Error(`recordSend: ${error.message}`);
}
