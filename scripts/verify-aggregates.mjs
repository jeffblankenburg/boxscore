import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

for (const t of ["daily_send_stats", "daily_subscriber_events", "daily_placement_imps"]) {
  const { data, error, count } = await sb.from(t).select("*", { count: "exact" }).limit(5).order(
    t === "daily_placement_imps" ? "computed_at" : "date",
    { ascending: false },
  );
  console.log(`\n=== ${t} (${count} rows) ===`);
  if (error) { console.error(error); continue; }
  for (const r of data) console.log(JSON.stringify(r));
}
