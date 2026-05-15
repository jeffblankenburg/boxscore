import { supabaseAdmin } from "./supabase";

export type Platform = "twitter" | "bluesky" | "facebook";

export async function hasAlreadyPosted(
  platform: Platform, sport: string, date: string, subId: string = "",
): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("social_posts")
    .select("id, error")
    .eq("platform", platform)
    .eq("sport", sport)
    .eq("date", date)
    .eq("sub_id", subId)
    .maybeSingle<{ id: string; error: string | null }>();
  if (error) throw new Error(`hasAlreadyPosted: ${error.message}`);
  return data != null && data.error == null;
}

export async function recordPost(args: {
  platform: Platform;
  sport: string;
  date: string;
  subId?: string;
  remoteId: string | null;
  remoteUrl: string | null;
  error: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("social_posts")
    .upsert(
      {
        platform: args.platform,
        sport: args.sport,
        date: args.date,
        sub_id: args.subId ?? "",
        remote_id: args.remoteId,
        remote_url: args.remoteUrl,
        error: args.error,
        posted_at: new Date().toISOString(),
      },
      { onConflict: "platform,sport,date,sub_id" },
    );
  if (error) throw new Error(`recordPost: ${error.message}`);
}
