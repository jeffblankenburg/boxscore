import { supabaseAdmin } from "./supabase";

export type Digest = {
  sport: string;
  date: string;
  generated_at: string;
  game_count: number;
  html: string;
  email_html: string | null;
};

export async function getDigest(sport: string, date: string): Promise<Digest | null> {
  const { data, error } = await supabaseAdmin()
    .from("daily_digests")
    .select("sport, date, generated_at, game_count, html, email_html")
    .eq("sport", sport)
    .eq("date", date)
    .maybeSingle<Digest>();
  if (error) throw new Error(`getDigest: ${error.message}`);
  return data ?? null;
}

export async function upsertDigest(args: {
  sport: string;
  date: string;
  html: string;
  email_html: string;
  game_count: number;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("daily_digests")
    .upsert(
      {
        sport: args.sport,
        date: args.date,
        html: args.html,
        email_html: args.email_html,
        game_count: args.game_count,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "sport,date" },
    );
  if (error) throw new Error(`upsertDigest: ${error.message}`);
}
