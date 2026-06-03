// One-time backfill: generate per-section share images for every historical
// MLB digest that doesn't already have them in the bucket. The post-cron
// pipeline only writes today's images going forward, so old dates need a
// manual fill before the RSS feed can show per-section thumbnails for them.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-share-images.ts
//   npx tsx --env-file=.env.local scripts/backfill-share-images.ts --dry
//   npx tsx --env-file=.env.local scripts/backfill-share-images.ts --since 2026-04-01
//   npx tsx --env-file=.env.local scripts/backfill-share-images.ts --redo
//
// --dry  : list what would happen without rendering or uploading.
// --since: only process digest dates >= the ISO date.
// --redo : re-render dates that already have images (overwrites in place).

import { supabaseAdmin } from "../lib/supabase";
import { renderShareImages } from "../lib/render-images";
import { uploadShareImages } from "../lib/share-storage";
import { nextDay, prettyDate } from "../lib/dates";
import { EMAIL_LINK_BASE } from "../lib/site";

const IN_SEASON_MODES = ["regular", "no-games", "all-star", "postseason"];
const SHARE_BUCKET = "share-images";

const DRY = process.argv.includes("--dry");
const REDO = process.argv.includes("--redo");
const sinceIdx = process.argv.indexOf("--since");
const SINCE: string | null = sinceIdx >= 0 ? (process.argv[sinceIdx + 1] ?? null) : null;

async function listExistingImageDates(): Promise<Set<string>> {
  const supa = supabaseAdmin();
  const dates = new Set<string>();
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supa.storage.from(SHARE_BUCKET).list("", { limit: pageSize, offset });
    if (error) throw new Error(`bucket list: ${error.message}`);
    const page = data ?? [];
    if (page.length === 0) break;
    for (const f of page) {
      const m = f.name.match(/^(\d{4}-\d{2}-\d{2})_/);
      if (m) dates.add(m[1]!);
    }
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return dates;
}

async function listDigestDates(): Promise<string[]> {
  const supa = supabaseAdmin();
  const { data, error } = await supa
    .from("daily_digests")
    .select("date")
    .eq("sport", "mlb")
    .in("mode", IN_SEASON_MODES)
    .order("date", { ascending: true });
  if (error) throw new Error(`digest list: ${error.message}`);
  let dates = ((data ?? []) as { date: string }[]).map((r) => r.date);
  if (SINCE) dates = dates.filter((d) => d >= SINCE);
  return dates;
}

async function main() {
  const existing = REDO ? new Set<string>() : await listExistingImageDates();
  const allDates = await listDigestDates();
  const todo = allDates.filter((d) => !existing.has(d));

  console.log(`Digest dates total:   ${allDates.length}`);
  console.log(`Already have images:  ${existing.size}`);
  console.log(`Will render:          ${todo.length}${REDO ? " (redo)" : ""}${SINCE ? ` since ${SINCE}` : ""}`);
  if (DRY) {
    for (const d of todo) console.log(`  [dry] ${d}`);
    console.log("dry run, exiting");
    return;
  }

  // renderShareImages launches a fresh browser per call. For ~30-100 dates
  // that's 30-100 puppeteer launches over the course of the run — slower
  // than reusing one browser, but the existing renderer encapsulates the
  // launch+goto+screenshot+close cycle and refactoring it for reuse is out
  // of scope here. Each render is ~20-30s; budget accordingly.
  let ok = 0, failed = 0;
  for (let i = 0; i < todo.length; i++) {
    const date = todo[i]!;
    const tag = `[${i + 1}/${todo.length}] ${date}`;
    try {
      const t0 = Date.now();
      const images = await renderShareImages({ date, baseUrl: EMAIL_LINK_BASE });
      const renderMs = Date.now() - t0;
      const editionDate = nextDay(date);
      await uploadShareImages({ editionDate, images });
      console.log(`${tag} ✓ ${images.length} images in ${renderMs}ms`);
      ok++;
    } catch (e) {
      console.error(`${tag} ✗ ${(e as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone. rendered=${ok} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
