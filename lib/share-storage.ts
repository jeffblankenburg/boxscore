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
  await clearShareImages();
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
  if (file === "full.png") return 0;
  if (file === "al-standings.png") return 1;
  if (file === "al-leaders.png") return 2;
  if (file === "nl-standings.png") return 3;
  if (file === "nl-leaders.png") return 4;
  const m = file.match(/^boxscore-(\d+)\.png$/);
  if (m) return 100 + Number(m[1]);
  return 999;
}
