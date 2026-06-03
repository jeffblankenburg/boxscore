import { supabaseAdmin } from "./supabase";
import type { ManifestEntry, RenderedImage } from "./render-images";
import { prettyDate as formatPrettyDate, prevDay } from "./dates";

// Storage strategy for share images:
//   - Images accumulate per date so RSS items can embed their own day's images.
//     Files live at bucket root keyed by `{date}_{file}`, e.g.
//     "2026-05-14_al-standings.png".
//   - Each generate `upsert`s its set — re-running a date overwrites in place.
//     `clearShareImages` exists for an explicit wipe but the normal cron path
//     doesn't call it.
//   - Manifest: "_manifest.json" — full entry metadata (titles, teams, league)
//     for downstream consumers like the admin Twitter page that need to
//     compose post text without re-rendering. Tracks only the most recently
//     generated date.
//   - Public bucket → <img> tags work without auth.

const BUCKET = "share-images";
const MANIFEST_FILE = "_manifest.json";

export type StoredImage = {
  file: string;        // e.g. "al-standings.png" (without the date_ prefix)
  url: string;
  updatedAt: string | null;
};

export type ManifestImage = {
  entry: ManifestEntry;
  url: string;
};

export type StoredManifest = {
  // EDITION date (matches the bucket file prefix and og:image URL).
  date: string;
  // Edition date in human form — used for standings/leaders captions where
  // the content is a "morning of" snapshot.
  prettyDate: string;
  // Games date in human form — used for scoreboard/box-score captions where
  // the content describes games actually played that day.
  gamesPrettyDate: string;
  entries: ManifestImage[];
};

export async function clearShareImages(): Promise<number> {
  const supa = supabaseAdmin();
  const { data, error } = await supa.storage.from(BUCKET).list("", { limit: 1000 });
  if (error) throw new Error(`storage list: ${error.message}`);
  const names = (data ?? [])
    .map((f) => f.name)
    .filter((n) => n !== ".emptyFolderPlaceholder");
  if (names.length === 0) return 0;
  const { error: rmErr } = await supa.storage.from(BUCKET).remove(names);
  if (rmErr) throw new Error(`storage remove: ${rmErr.message}`);
  return names.length;
}

export async function uploadShareImages(args: {
  editionDate: string;
  images: RenderedImage[];
}): Promise<StoredManifest> {
  // Historical accumulation: every edition's images stay in the bucket so the
  // RSS feed can embed them per-item. Each upload uses `upsert: true` so
  // re-regenerating an edition overwrites in place rather than appending. The
  // manifest at _manifest.json still describes only the most recently
  // generated edition; per-edition manifests aren't tracked because the
  // {editionDate}_<file> prefix is enough to look up an edition's set from
  // storage.
  //
  // Keyed by EDITION date to match `uploadScoreboardShareImage`, the og:image
  // URL convention on /mlb/[editionDate], and the backfill script. The
  // per-image CONTENT date (e.g. box-score images showing the games date) is
  // handled at render time and is independent of the storage key.
  const supa = supabaseAdmin();
  const entries: ManifestImage[] = [];
  for (const { entry, png, mime } of args.images) {
    const path = `${args.editionDate}_${entry.file}`;
    const { error } = await supa.storage.from(BUCKET).upload(path, png, {
      contentType: mime,
      upsert: true,
    });
    if (error) throw new Error(`storage upload ${path}: ${error.message}`);
    const { data: urlData } = supa.storage.from(BUCKET).getPublicUrl(path);
    entries.push({ entry, url: urlData.publicUrl });
  }

  const manifest: StoredManifest = {
    date: args.editionDate,
    prettyDate: formatPrettyDate(args.editionDate),
    gamesPrettyDate: formatPrettyDate(prevDay(args.editionDate)),
    entries,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  const { error: mErr } = await supa.storage.from(BUCKET).upload(MANIFEST_FILE, manifestBytes, {
    contentType: "application/json",
    upsert: true,
  });
  if (mErr) throw new Error(`storage upload manifest: ${mErr.message}`);

  return manifest;
}

export async function getStoredManifest(): Promise<StoredManifest | null> {
  const supa = supabaseAdmin();
  const { data, error } = await supa.storage.from(BUCKET).download(MANIFEST_FILE);
  if (error || !data) return null;
  try {
    const text = await data.text();
    return JSON.parse(text) as StoredManifest;
  } catch {
    return null;
  }
}

// List images for a single date. When `date` is omitted, the latest date
// present in the bucket is used so the caller doesn't need to guess. Returns
// the date that was actually used (null only when the bucket is empty), which
// lets the admin view label the grid correctly even when defaulting.
export async function listStoredImages(
  date?: string,
): Promise<{ date: string | null; images: StoredImage[] }> {
  const supa = supabaseAdmin();
  // 10k cap — well above any per-date set size and roughly two seasons of
  // accumulated daily images. Bump if we ever ship sports with much larger
  // image sets per date.
  const { data, error } = await supa.storage.from(BUCKET).list("", { limit: 10_000 });
  if (error) throw new Error(`storage list: ${error.message}`);

  type FileEntry = { date: string; file: string; updatedAt: string | null };
  const allFiles: FileEntry[] = [];
  for (const f of data ?? []) {
    if (f.name === ".emptyFolderPlaceholder") continue;
    const m = f.name.match(/^(\d{4}-\d{2}-\d{2})_(.+)$/);
    if (!m) continue;
    allFiles.push({ date: m[1]!, file: m[2]!, updatedAt: f.updated_at ?? null });
  }

  if (allFiles.length === 0) return { date: null, images: [] };

  // Default to the most recent date present in storage (lexical sort works for
  // ISO YYYY-MM-DD).
  const targetDate =
    date ?? allFiles.map((f) => f.date).sort().at(-1)!;

  const images: StoredImage[] = [];
  for (const f of allFiles) {
    if (f.date !== targetDate) continue;
    const { data: urlData } = supa.storage.from(BUCKET).getPublicUrl(`${f.date}_${f.file}`);
    images.push({ file: f.file, url: urlData.publicUrl, updatedAt: f.updatedAt });
  }

  images.sort((a, b) => imagePriority(a.file) - imagePriority(b.file));
  return { date: targetDate, images };
}

// All distinct dates present in the bucket, newest first. Used by the admin
// images view to populate a date selector.
export async function listStoredDates(): Promise<string[]> {
  const supa = supabaseAdmin();
  const { data, error } = await supa.storage.from(BUCKET).list("", { limit: 10_000 });
  if (error) throw new Error(`storage list: ${error.message}`);
  const dates = new Set<string>();
  for (const f of data ?? []) {
    const m = f.name.match(/^(\d{4}-\d{2}-\d{2})_/);
    if (m) dates.add(m[1]!);
  }
  return Array.from(dates).sort().reverse();
}

function imagePriority(file: string): number {
  if (file === "scoreboard.png") return -1;
  if (file === "full.jpg" || file === "full.png") return 0;
  if (file === "al-standings.png") return 1;
  if (file === "al-leaders.png") return 2;
  if (file === "nl-standings.png") return 3;
  if (file === "nl-leaders.png") return 4;
  const m = file.match(/^boxscore-(\d+)\.png$/);
  if (m) return 100 + Number(m[1]);
  return 999;
}

// Upload the 1200×630 scoreboard share-image. Lives at the bucket root with
// the same `{date}_<file>` naming convention as the other share images, so it
// participates in listings and storage stats. Keyed by EDITION date so the URL
// matches what /mlb/[editionDate] would use as its og:image. Upsert: true so
// re-rendering replaces in place.
export async function uploadScoreboardShareImage(args: {
  editionDate: string;
  png: Uint8Array;
}): Promise<{ path: string; publicUrl: string }> {
  const supa = supabaseAdmin();
  const path = `${args.editionDate}_scoreboard.png`;
  const { error } = await supa.storage.from(BUCKET).upload(path, args.png, {
    contentType: "image/png",
    upsert: true,
    cacheControl: "31536000",
  });
  if (error) throw new Error(`uploadScoreboardShareImage ${path}: ${error.message}`);
  const { data } = supa.storage.from(BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

// Look up an already-uploaded scoreboard image for an edition date. Returns
// null when the file doesn't exist. Used by /mlb/[editionDate]'s
// generateMetadata to set og:image when we've already rendered the image.
export async function getScoreboardShareImageUrl(editionDate: string): Promise<string | null> {
  const supa = supabaseAdmin();
  const path = `${editionDate}_scoreboard.png`;
  // list with a tight prefix filter is cheaper than HEAD or download.
  const { data, error } = await supa.storage.from(BUCKET).list("", { search: path, limit: 1 });
  if (error) return null;
  if (!data?.some((f) => f.name === path)) return null;
  const { data: urlData } = supa.storage.from(BUCKET).getPublicUrl(path);
  return urlData.publicUrl;
}
