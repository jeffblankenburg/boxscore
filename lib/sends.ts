import { supabaseAdmin } from "./supabase";

export async function hasAlreadySent(
  subscriberId: string, sport: string, date: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("sends")
    .select("id, error")
    .eq("subscriber_id", subscriberId)
    .eq("digest_sport", sport)
    .eq("digest_date", date)
    .maybeSingle<{ id: string; error: string | null }>();
  if (error) throw new Error(`hasAlreadySent: ${error.message}`);
  return data != null && data.error == null;
}

export async function recordSend(args: {
  subscriberId: string;
  sport: string;
  date: string;
  resendId: string | null;
  error: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("sends")
    .upsert(
      {
        subscriber_id: args.subscriberId,
        digest_sport: args.sport,
        digest_date: args.date,
        resend_id: args.resendId,
        error: args.error,
        sent_at: new Date().toISOString(),
      },
      { onConflict: "subscriber_id,digest_sport,digest_date" },
    );
  if (error) throw new Error(`recordSend: ${error.message}`);
}
