import { supabaseAdmin } from "./supabase";

export type Platform = "twitter" | "bluesky" | "facebook";

export async function hasAlreadyPosted(
  platform: Platform, sport: string, date: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("social_posts")
    .select("id, error")
    .eq("platform", platform)
    .eq("sport", sport)
    .eq("date", date)
    .maybeSingle<{ id: string; error: string | null }>();
  if (error) throw new Error(`hasAlreadyPosted: ${error.message}`);
  return data != null && data.error == null;
}

export async function recordPost(args: {
  platform: Platform;
  sport: string;
  date: string;
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
        remote_id: args.remoteId,
        remote_url: args.remoteUrl,
        error: args.error,
        posted_at: new Date().toISOString(),
      },
      { onConflict: "platform,sport,date" },
    );
  if (error) throw new Error(`recordPost: ${error.message}`);
}
