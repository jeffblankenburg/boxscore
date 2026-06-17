"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "../../require-admin";
import { isValidIsoDate } from "@/lib/dates";
import { fetchAndStoreSdioDaily } from "@/lib/sports/mlb/sources/sdio-storage";

// Ad-hoc SDIO pull triggered from the admin preview page. The daily cron
// at 9:05 UTC handles the routine case; this is for backfilling a date
// or refreshing after an SDIO data correction.
export async function fetchSdioNowAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const date = String(formData.get("date") ?? "");
  if (!isValidIsoDate(date)) throw new Error(`bad date: ${date}`);
  await fetchAndStoreSdioDaily("mlb", date);
  revalidatePath(`/admin/preview/canonical/${date}`);
  redirect(`/admin/preview/canonical/${date}?source=sdio`);
}
