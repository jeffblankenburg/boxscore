// One-shot backfill: render + upload the daily scoreboard share-image for
// every past MLB digest that doesn't already have one. Skips dates that
// already have a captured image in storage, so re-running is safe.
//
// Run from a workstation:
//
//   # Capture against production (fast; targets the live /share route)
//   BASE_URL=https://boxscore.email npm run backfill-shares
//
//   # Capture against localhost (slow because of dev-mode compile; useful
//   # only when verifying changes before they ship)
//   BASE_URL=http://localhost:3001 npm run backfill-shares
//
// One Puppeteer browser is launched per date, so wall-clock per missing
// date is dominated by the launch (~3–5s locally) rather than the screenshot
// itself (~1–2s). For a typical 30–60 date backlog plan on 5–10 minutes
// total. Each upload uses upsert so partial progress is recoverable —
// re-running picks up where the previous run failed.

import { nextDay } from "../lib/dates";
import { renderScoreboardShareImage } from "../lib/render-images";
import { uploadScoreboardShareImage } from "../lib/share-storage";
import { supabaseAdmin } from "../lib/supabase";

const BASE_URL = process.env.BASE_URL ?? "https://boxscore.email";
const BUCKET = "share-images";

type DigestRow = { date: string };

async function main(): Promise<void> {
  console.log(`Backfilling MLB scoreboard share-images via ${BASE_URL}`);

  const supa = supabaseAdmin();

  // Every MLB digest row, oldest first. Each row's `date` is the games_date;
  // the edition date (used by the URL + the image filename) is games_date + 1.
  const { data: rows, error } = await supa
    .from("daily_digests")
    .select("date")
    .eq("sport", "mlb")
    .order("date", { ascending: true });
  if (error) throw new Error(`list digests: ${error.message}`);
  const digests = (rows ?? []) as DigestRow[];
  console.log(`  ${digests.length} MLB digest rows`);

  // Enumerate already-uploaded filenames once so we skip work for any date
  // that already has its scoreboard image.
  const existing = new Set<string>();
  let offset = 0;
  while (true) {
    const { data, error: lErr } = await supa.storage.from(BUCKET).list("", {
      limit: 1000, offset,
    });
    if (lErr) throw new Error(`list bucket: ${lErr.message}`);
    if (!data?.length) break;
    for (const f of data) existing.add(f.name);
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(`  ${existing.size} files already in bucket`);

  let ok = 0, skipped = 0, failed = 0;
  const failures: string[] = [];
  const t0 = Date.now();

  for (const { date: gamesDate } of digests) {
    const editionDate = nextDay(gamesDate);
    const filename = `${editionDate}_scoreboard.png`;
    if (existing.has(filename)) {
      skipped++;
      continue;
    }

    const tStart = Date.now();
    try {
      const { png, width, height } = await renderScoreboardShareImage({
        editionDate, baseUrl: BASE_URL,
      });
      const { publicUrl } = await uploadScoreboardShareImage({
        editionDate, png,
      });
      const ms = Date.now() - tStart;
      console.log(
        `  ✓ ${editionDate}  ${width}×${height}  ${(png.length / 1024).toFixed(0)} KB  ${ms}ms  → ${publicUrl}`,
      );
      ok++;
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`  ✗ ${editionDate}: ${msg}`);
      failures.push(`${editionDate}: ${msg}`);
      failed++;
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("");
  console.log(`Backfill complete in ${elapsed}s`);
  console.log(`  rendered: ${ok}`);
  console.log(`  skipped (already existed): ${skipped}`);
  console.log(`  failed: ${failed}`);
  if (failures.length > 0) {
    console.log("");
    console.log("Failures:");
    for (const f of failures) console.log(`  ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
