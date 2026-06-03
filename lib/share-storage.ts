import { supabaseAdmin } from "./supabase";
import type { ManifestEntry, RenderedImage } from "./render-images";

// Storage strategy for share images:
//   - One set of images in the bucket at a time. No history.
//   - Images: "2026-05-14_al-standings.png" at bucket root.
//   - Manifest: "_manifest.json" — full entry metadata (titles, teams, league)
//     for downstream consumers like the admin Twitter page that need to
//     compose post text without re-rendering.
//   - Each generate clears the bucket first, then uploads the new set.
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
  date: string;
  prettyDate: string;
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
  date: string;
  prettyDate: string;
  images: RenderedImage[];
}): Promise<StoredManifest> {
  // Historical accumulation: every date's images stay in the bucket so the
  // RSS feed can embed them per-item. Each upload uses `upsert: true` so
  // re-regenerating a date overwrites in place rather than appending. The
  // manifest at _manifest.json still describes only the most recently
  // generated date; per-date manifests aren't tracked because the
  // YYYY-MM-DD_<file> prefix is enough to look up a date's set from storage.
  const supa = supabaseAdmin();
  const entries: ManifestImage[] = [];
  for (const { entry, png, mime } of args.images) {
    const path = `${args.date}_${entry.file}`;
    const { error } = await supa.storage.from(BUCKET).upload(path, png, {
      contentType: mime,
      upsert: true,
    });
    if (error) throw new Error(`storage upload ${path}: ${error.message}`);
    const { data: urlData } = supa.storage.from(BUCKET).getPublicUrl(path);
    entries.push({ entry, url: urlData.publicUrl });
  }

  const manifest: StoredManifest = {
    date: args.date,
    prettyDate: args.prettyDate,
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

export async function listStoredImages(): Promise<{ date: string | null; images: StoredImage[] }> {
  const supa = supabaseAdmin();
  const { data, error } = await supa.storage.from(BUCKET).list("", { limit: 100 });
  if (error) throw new Error(`storage list: ${error.message}`);

  let date: string | null = null;
  const images: StoredImage[] = [];
  for (const f of data ?? []) {
    if (f.name === ".emptyFolderPlaceholder") continue;
    const m = f.name.match(/^(\d{4}-\d{2}-\d{2})_(.+)$/);
    if (!m) continue;
    if (!date) date = m[1]!;
    const { data: urlData } = supa.storage.from(BUCKET).getPublicUrl(f.name);
    images.push({ file: m[2]!, url: urlData.publicUrl, updatedAt: f.updated_at ?? null });
  }

  images.sort((a, b) => imagePriority(a.file) - imagePriority(b.file));
  return { date, images };
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
