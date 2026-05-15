// Local screenshot script — generates share images for a given date and
// writes them + manifest.json to out/share/{date}/. Uses the same renderer
// the production cron uses; the only difference is the output sink (disk
// here, BlueSky upload there).

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isValidIsoDate, prettyDate } from "../lib/dates";
import { renderShareImages, type ManifestEntry } from "../lib/render-images";

type Manifest = {
  sport: "mlb";
  date: string;
  prettyDate: string;
  entries: ManifestEntry[];
};

async function main() {
  const date = process.argv[2] ?? "2026-05-14";
  if (!isValidIsoDate(date)) {
    console.error(`Bad date: ${date}. Use YYYY-MM-DD.`);
    process.exit(1);
  }

  const shareRoot = resolve("out/share");
  const outDir = resolve(shareRoot, date);

  // Clean up other dates' folders — they can be regenerated any time.
  try {
    for (const entry of await readdir(shareRoot)) {
      if (entry !== date) {
        await rm(resolve(shareRoot, entry), { recursive: true, force: true });
        console.log(`Cleaned up out/share/${entry}/`);
      }
    }
  } catch { /* first run */ }

  await mkdir(outDir, { recursive: true });
  console.log(`Rendering share images for ${date} ...`);
  const baseUrl = process.env.SHARE_BASE_URL ?? "http://localhost:3001";
  const images = await renderShareImages({ date, baseUrl });

  const manifest: Manifest = {
    sport: "mlb",
    date,
    prettyDate: prettyDate(date),
    entries: [],
  };

  for (const { entry, png } of images) {
    await writeFile(resolve(outDir, entry.file), png);
    manifest.entries.push(entry);
    console.log(`  ${entry.file}`);
  }

  await writeFile(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`  manifest.json (${manifest.entries.length} entries)`);
  console.log(`\nWrote ${images.length} images + manifest to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
