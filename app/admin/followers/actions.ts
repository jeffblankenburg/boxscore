"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "../require-admin";
import {
  setFollowerStarred,
  setFollowerNotes,
  syncAllFollowers,
  type Platform,
} from "@/lib/social-followers";

function parsePlatform(raw: FormDataEntryValue | null): Platform {
  if (raw === "twitter" || raw === "bluesky") return raw;
  throw new Error(`Unknown platform: ${String(raw)}`);
}

export async function toggleStar(formData: FormData): Promise<void> {
  await requireAdmin();
  const platform = parsePlatform(formData.get("platform"));
  const handle = String(formData.get("handle") ?? "");
  // current="1" means it's currently starred — toggle removes the star.
  const current = formData.get("current") === "1";
  if (!handle) throw new Error("toggleStar: missing handle");
  await setFollowerStarred(platform, handle, !current);
  revalidatePath("/admin/followers");
}

export async function saveNotes(formData: FormData): Promise<void> {
  await requireAdmin();
  const platform = parsePlatform(formData.get("platform"));
  const handle = String(formData.get("handle") ?? "");
  const notes = String(formData.get("notes") ?? "");
  if (!handle) throw new Error("saveNotes: missing handle");
  await setFollowerNotes(platform, handle, notes);
  revalidatePath("/admin/followers");
}

// Force a sync now, bypassing the staleness check. Lets the admin pull fresh
// data after a known new follow event without waiting out the 5-minute TTL.
export async function forceSync(): Promise<void> {
  await requireAdmin();
  await syncAllFollowers();
  revalidatePath("/admin/followers");
}
