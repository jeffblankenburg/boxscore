// One-off diagnostic. Reads puzzle_picks + puzzle_attempts around today
// to see whether Jeff's solve is orphaned under a different date.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SECRET_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const dates = ["2026-06-09", "2026-06-10", "2026-06-11"];

  const { data: picks } = await sb
    .from("puzzle_picks")
    .select("*")
    .eq("game", "linescordle")
    .in("puzzle_date", dates)
    .order("puzzle_date");
  console.log("picks:", JSON.stringify(picks, null, 2));

  const { data: attempts } = await sb
    .from("puzzle_attempts")
    .select("subscriber_id, puzzle_date, puzzle_subject_id, solved, guess_count, completed_at, updated_at")
    .eq("game", "linescordle")
    .in("puzzle_date", dates)
    .order("puzzle_date");
  console.log("attempts:", JSON.stringify(attempts, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
