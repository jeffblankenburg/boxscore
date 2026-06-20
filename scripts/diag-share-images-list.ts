// One-off: list every file in the share-images bucket for a given date.
// Run: npx tsx --env-file=.env.local scripts/diag-share-images-list.ts 2026-06-16

import { supabaseAdmin } from "../lib/supabase";

async function main(): Promise<void> {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`usage: diag-share-images-list.ts YYYY-MM-DD`);
    process.exit(1);
  }
  const supa = supabaseAdmin();
  const { data, error } = await supa.storage.from("share-images").list("", { limit: 10_000 });
  if (error) throw new Error(`list: ${error.message}`);
  const matches = (data ?? [])
    .filter((f) => f.name.startsWith(`${date}_`))
    .sort((a, b) => a.name.localeCompare(b.name));
  console.log(`${matches.length} file(s) for ${date}:`);
  for (const f of matches) {
    const sz = f.metadata?.size ?? "?";
    console.log(`  ${f.name.padEnd(40)} ${String(sz).padStart(8)} bytes  updated ${f.updated_at}`);
  }
  console.log(`\nTotal files in bucket: ${(data ?? []).length}`);
  // Try searching too — Supabase storage list can hit a default limit on
  // metadata fetch even when limit param is high.
  const { data: searched } = await supa.storage.from("share-images").list("", {
    search: `${date}_`,
    limit: 10_000,
  });
  console.log(`Search results for "${date}_": ${(searched ?? []).length}`);
  for (const f of searched ?? []) {
    console.log(`  ${f.name}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
